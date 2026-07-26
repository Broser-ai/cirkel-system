// C:\Users\Ambro2\cirkel-system\api\kyc\submit.ts
//
// Cirkel — Modul 10 · B2B KYC-onboarding · POST /api/kyc/submit
//
// Formål:
//   Modtag KYC-indsendelse fra en B2B-producent (virksomhed der onboarder
//   sig på Cirkel-platformen). Verificér Firebase-ID-token (F3.8), validér
//   input og opret en pending row i public.b2b_producers med subscription_tier
//   = "pending". Rækken forbliver is_active = FALSE indtil compliance-teamet
//   godkender KYC-materialet manuelt i admin-portalen.
//
// Body (POST JSON):
//   {
//     "cvr":            "12345678",              // required, 8 cifre (DK)
//     "contact_email":  "kyc@virksomhed.dk",     // required, RFC-lite
//     "business_type":  "wholesale_packaging",   // required, kort slug
//     "docs_urls":      [                        // required, 1..10 URLs
//       "https://storage/…/cvr-udskrift.pdf",
//       "https://storage/…/ejer-erklaering.pdf"
//     ]
//   }
//
// Response (success 201):
//   {
//     success: true,
//     data: {
//       producer_id: string,
//       cvr_number: string,
//       contact_email: string,
//       business_type: string,
//       subscription_tier: "pending",
//       is_active: false,
//       docs_received: number,
//       submitted_at: string
//     }
//   }
//
// Response (fejl):
//   { success: false, error: string, code?: string, detail?: string }
//
// SIKKERHED:
//   - F3.8 — Firebase Bearer-token verificeres via resolveTrustedUid FØR alt
//     andet arbejde. KYC-endpoints må aldrig serveres til uidentificerede
//     klienter, så vi håndhæver verified === true uanset FIREBASE_ADMIN_ENFORCE
//     (samme pattern som b2b/payouts.ts).
//   - Ingen hardkodede secrets — alle nøgler via process.env.
//   - Supabase service-role klient (lazy init, samme pattern som api/scan.ts
//     og api/dashboard.ts).
//   - Anti-double-submit: 409 hvis CVR eller contact_email allerede findes.
//
// SKEMA-NOTE:
//   Migration 013 kræver company_name NOT NULL og har CHECK-constraint der
//   kun tillader subscription_tier IN ('standard','premium','enterprise').
//   For at kunne indsætte en pending-KYC row uden company_name (som først
//   registreres efter Virk.dk-validering) sætter denne handler et deterministisk
//   placeholder-firmanavn afledt af business_type + CVR. En kommende migration
//   forventes at (a) tilføje 'pending' til subscription_tier CHECK og
//   (b) tillade NULL company_name for pending rows — denne handler er skrevet
//   forwards-kompatibelt så placeholder kan fjernes uden yderligere ændringer.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';

// ---------- Vercel config -----------------------------------------------

export const config = {
  api: {
    bodyParser: true,
  },
} as const;

// ---------- Konstanter --------------------------------------------------

/** Dansk CVR: præcis 8 cifre. Matcher CHECK i migration 013. */
const CVR_RE = /^[0-9]{8}$/;

/** RFC-lite email. Matcher CHECK i migration 013 (contact_email). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * business_type slug — kort ASCII-slug (a-z, 0-9, _-). Holdes bevidst
 * restriktiv så vi kan bruge værdien i logs og placeholder-company_name
 * uden yderligere escaping.
 */
const BUSINESS_TYPE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

/** URL-whitelist: kun http/https accepteres for KYC-dokumenter. */
const URL_ALLOWED_PROTOCOLS: ReadonlyArray<string> = ['http:', 'https:'];

const MAX_DOCS = 10;
const MAX_DOC_URL_LENGTH = 2048;
const MAX_CONTACT_EMAIL_LENGTH = 254;

/** Værdi vi skriver i subscription_tier for KYC-pending rows. */
const KYC_PENDING_TIER = 'pending' as const;

// ---------- Body-parsing typer -----------------------------------------

interface RawBody {
  readonly cvr?: unknown;
  readonly contact_email?: unknown;
  readonly business_type?: unknown;
  readonly docs_urls?: unknown;
}

interface ParsedBody {
  readonly cvr: string;
  readonly contact_email: string;
  readonly business_type: string;
  readonly docs_urls: ReadonlyArray<string>;
}

interface ValidationFailure {
  readonly ok: false;
  readonly reason: string;
  readonly code: string;
}

interface ValidationSuccess {
  readonly ok: true;
  readonly value: ParsedBody;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

// ---------- Response typer ---------------------------------------------

interface KycSubmitData {
  readonly producer_id: string;
  readonly cvr_number: string;
  readonly contact_email: string;
  readonly business_type: string;
  readonly subscription_tier: typeof KYC_PENDING_TIER;
  readonly is_active: false;
  readonly docs_received: number;
  readonly submitted_at: string;
}

interface SuccessResponse {
  readonly success: true;
  readonly data: KycSubmitData;
}

interface ErrorResponse {
  readonly success: false;
  readonly error: string;
  readonly code?: string;
  readonly detail?: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

// ---------- DB-row typer -----------------------------------------------

interface InsertedProducerRow {
  readonly producer_id: string;
  readonly cvr_number: string;
  readonly contact_email: string;
  readonly subscription_tier: string;
  readonly is_active: boolean;
  readonly created_at: string;
}

// ---------- Lazy Supabase-singleton ------------------------------------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _sb;
}

// ---------- Response helpers -------------------------------------------

function sendJson(res: VercelResponse, status: number, body: ApiResponse): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}

function ok(res: VercelResponse, data: KycSubmitData): void {
  sendJson(res, 201, { success: true, data });
}

function fail(
  res: VercelResponse,
  status: number,
  error: string,
  code?: string,
  detail?: string,
): void {
  const body: ErrorResponse = { success: false, error };
  if (code !== undefined) (body as { code?: string }).code = code;
  if (detail !== undefined) (body as { detail?: string }).detail = detail;
  sendJson(res, status, body);
}

// ---------- Type-guards & coercion helpers ------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toStringArrayOrNull(v: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (trimmed.length === 0) return null;
    out.push(trimmed);
  }
  return out;
}

function isSafeHttpUrl(candidate: string): boolean {
  if (candidate.length > MAX_DOC_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (!URL_ALLOWED_PROTOCOLS.includes(url.protocol)) return false;
  if (url.hostname.length === 0) return false;
  return true;
}

// ---------- Body-validering --------------------------------------------

function parseAndValidateBody(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      reason: 'Request body skal være et JSON-objekt.',
      code: 'invalid_body',
    };
  }
  const raw: RawBody = body;

  // cvr
  const cvr = toStringOrNull(raw.cvr);
  if (!cvr) {
    return { ok: false, reason: "Field 'cvr' er påkrævet.", code: 'missing_cvr' };
  }
  if (!CVR_RE.test(cvr)) {
    return {
      ok: false,
      reason: "Field 'cvr' skal være præcis 8 cifre (dansk CVR).",
      code: 'invalid_cvr',
    };
  }

  // contact_email
  const contactEmailRaw = toStringOrNull(raw.contact_email);
  if (!contactEmailRaw) {
    return {
      ok: false,
      reason: "Field 'contact_email' er påkrævet.",
      code: 'missing_contact_email',
    };
  }
  if (contactEmailRaw.length > MAX_CONTACT_EMAIL_LENGTH) {
    return {
      ok: false,
      reason: `Field 'contact_email' må højst være ${MAX_CONTACT_EMAIL_LENGTH} tegn.`,
      code: 'contact_email_too_long',
    };
  }
  const contact_email = contactEmailRaw.toLowerCase();
  if (!EMAIL_RE.test(contact_email)) {
    return {
      ok: false,
      reason: "Field 'contact_email' er ikke en gyldig email-adresse.",
      code: 'invalid_contact_email',
    };
  }

  // business_type
  const businessTypeRaw = toStringOrNull(raw.business_type);
  if (!businessTypeRaw) {
    return {
      ok: false,
      reason: "Field 'business_type' er påkrævet.",
      code: 'missing_business_type',
    };
  }
  const business_type = businessTypeRaw.toLowerCase();
  if (!BUSINESS_TYPE_RE.test(business_type)) {
    return {
      ok: false,
      reason:
        "Field 'business_type' skal være et kort slug (a-z, 0-9, _, -) på 1-64 tegn.",
      code: 'invalid_business_type',
    };
  }

  // docs_urls
  const docsUrls = toStringArrayOrNull(raw.docs_urls);
  if (!docsUrls) {
    return {
      ok: false,
      reason:
        "Field 'docs_urls' er påkrævet og skal være et array af ikke-tomme strings.",
      code: 'missing_docs_urls',
    };
  }
  if (docsUrls.length === 0) {
    return {
      ok: false,
      reason: "Field 'docs_urls' skal indeholde mindst én URL.",
      code: 'empty_docs_urls',
    };
  }
  if (docsUrls.length > MAX_DOCS) {
    return {
      ok: false,
      reason: `Field 'docs_urls' må højst indeholde ${MAX_DOCS} URLs.`,
      code: 'too_many_docs',
    };
  }
  for (const candidate of docsUrls) {
    if (!isSafeHttpUrl(candidate)) {
      return {
        ok: false,
        reason: `Ugyldig doc-URL: '${candidate}'. Kun http(s) og max ${MAX_DOC_URL_LENGTH} tegn.`,
        code: 'invalid_doc_url',
      };
    }
  }
  // Dedup — beskyt mod klient der sender samme URL flere gange.
  const dedup = Array.from(new Set(docsUrls));

  return {
    ok: true,
    value: {
      cvr,
      contact_email,
      business_type,
      docs_urls: dedup,
    },
  };
}

// ---------- Placeholder-helpers ----------------------------------------

/**
 * Placeholder-firmanavn for pending-KYC rows. b2b_producers.company_name er
 * NOT NULL i migration 013, men KYC-flow'et modtager først det juridiske
 * firmanavn efter Virk.dk-validering i admin-godkendelsen. Vi skriver en
 * deterministisk streng der er (a) genkendelig for compliance-teamet i
 * portalen og (b) inde under VARCHAR(255).
 */
function buildPlaceholderCompanyName(businessType: string, cvr: string): string {
  const raw = `[PENDING KYC] ${businessType} · CVR ${cvr}`;
  return raw.length > 255 ? raw.slice(0, 255) : raw;
}

// ---------- Handler ----------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  // 2) Body-validering (parse først så en fejl-body ikke lækker gennem auth)
  const parsed = parseAndValidateBody(req.body);
  if (!parsed.ok) {
    return fail(res, 400, parsed.reason, parsed.code);
  }
  const { cvr, contact_email, business_type, docs_urls } = parsed.value;

  // 3) F3.8 — Firebase-token verify. KYC må ALDRIG serveres til uidentificerede
  //    klienter, så vi kalder resolveTrustedUid uden et klient-oplyst UID
  //    (kaster i enforce-mode; verified-flaget håndhæves eksplicit herunder).
  let trustedUid: string;
  let uidVerified = false;
  try {
    // Vi kender ikke klientens UID (KYC-onboarding er ikke bundet til et
    // eksisterende Firebase-brugerobjekt endnu), så vi sender tom streng
    // som "hint" — resolveTrustedUid returnerer token.uid uændret når der
    // ingen mismatch er at detektere.
    const verified = await resolveTrustedUid(req, '');
    if (!verified.trusted_uid) {
      return fail(
        res,
        401,
        'Firebase-token er påkrævet for KYC-indsendelse.',
        'auth_required',
      );
    }
    trustedUid = verified.trusted_uid;
    uidVerified = verified.verified;
  } catch (err) {
    const status = (err as { status?: number }).status ?? 401;
    const reason =
      (err as { reason?: string }).reason ??
      (err instanceof Error ? err.message : 'UID_SPOOF_DETECTED');
    console.error('[kyc/submit] F3.8 blokerede request:', reason);
    return fail(res, status, 'UID_SPOOF_DETECTED', 'auth_failed', reason);
  }

  // Håndhæv cryptografisk verify — KYC må ikke gå igennem på warn_only-pass.
  if (!uidVerified) {
    return fail(
      res,
      401,
      'Firebase-token er ikke cryptografisk verificeret. Bearer-token påkrævet.',
      'token_not_verified',
    );
  }

  // 4) Supabase-klient
  const sb = getSupabase();
  if (!sb) {
    return fail(
      res,
      503,
      'Supabase service-role-nøgle ikke konfigureret.',
      'supabase_unavailable',
    );
  }

  // 5) Anti-double-submit: tjek om CVR eller contact_email allerede findes.
  //    Migration 013 har UNIQUE-constraints på begge, så DB'en fanger det
  //    også — men vi giver klienten en pænere 409 før INSERT.
  try {
    const existing = await sb
      .from('b2b_producers')
      .select('producer_id,cvr_number,contact_email')
      .or(`cvr_number.eq.${cvr},contact_email.eq.${contact_email}`)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      console.error(
        '[kyc/submit] duplicate-check fejlede:',
        existing.error.message,
      );
      return fail(
        res,
        502,
        'Kunne ikke verificere om CVR/email allerede findes.',
        'db_error_select',
        existing.error.message,
      );
    }
    if (existing.data) {
      return fail(
        res,
        409,
        'CVR eller contact_email er allerede registreret.',
        'producer_already_exists',
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[kyc/submit] duplicate-check kastede:', message);
    return fail(res, 500, 'Duplicate-check fejlede.', 'db_exception', message);
  }

  // 6) Insert pending-KYC row.
  //    - subscription_tier = 'pending' (kræver at CHECK-constraint tillader det;
  //      se skema-note øverst i filen).
  //    - is_active = FALSE indtil compliance godkender.
  //    - activated_at forbliver NULL — b2b_producers CHECK tillader dette
  //      så længe is_active = FALSE.
  //    - company_name er NOT NULL i skemaet → placeholder afledt af business_type.
  const submittedAt = new Date().toISOString();
  const insertPayload = {
    company_name: buildPlaceholderCompanyName(business_type, cvr),
    cvr_number: cvr,
    contact_email,
    subscription_tier: KYC_PENDING_TIER,
    monthly_fee_dkk: 0,
    remaining_funds: 0,
    is_active: false,
  } as const;

  let inserted: InsertedProducerRow;
  try {
    const { data, error } = await sb
      .from('b2b_producers')
      .insert(insertPayload)
      .select('producer_id,cvr_number,contact_email,subscription_tier,is_active,created_at')
      .single();

    if (error) {
      // Postgres 23505 = unique_violation (race mellem duplicate-check og insert).
      const isUniqueViolation =
        (error as { code?: string }).code === '23505' ||
        /duplicate key value/i.test(error.message);
      if (isUniqueViolation) {
        return fail(
          res,
          409,
          'CVR eller contact_email er allerede registreret.',
          'producer_already_exists',
          error.message,
        );
      }
      // Postgres 23514 = check_violation (fx subscription_tier='pending' før
      // migration har tilføjet værdien til CHECK-constraint).
      const isCheckViolation =
        (error as { code?: string }).code === '23514' ||
        /check constraint/i.test(error.message);
      if (isCheckViolation) {
        console.error(
          '[kyc/submit] CHECK-constraint blokerede INSERT — mangler migration for subscription_tier="pending"?',
          error.message,
        );
        return fail(
          res,
          500,
          'Skema tillader endnu ikke pending-KYC rows. Kør migration.',
          'schema_missing_pending_tier',
          error.message,
        );
      }
      console.error('[kyc/submit] insert fejlede:', error.message);
      return fail(
        res,
        502,
        'Kunne ikke registrere KYC-indsendelse.',
        'db_error_insert',
        error.message,
      );
    }
    if (!data) {
      return fail(
        res,
        500,
        'Insert returnerede ingen række.',
        'db_no_row_returned',
      );
    }
    inserted = data as InsertedProducerRow;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[kyc/submit] insert kastede:', message);
    return fail(res, 500, 'Insert fejlede.', 'db_exception', message);
  }

  // 7) Struktureret audit-log (docs_urls persisteres IKKE på b2b_producers
  //    row'en — der findes ikke en kolonne. Compliance-teamet ser dem via
  //    log-aggregation indtil en dedikeret kyc_documents-tabel er oprettet).
  console.log(
    `[kyc/submit] PENDING producer_id=${inserted.producer_id} ` +
      `cvr=${inserted.cvr_number} email=${inserted.contact_email} ` +
      `business_type=${business_type} docs=${docs_urls.length} ` +
      `submitted_by_uid=${trustedUid} at=${submittedAt}`,
  );
  for (const url of docs_urls) {
    console.log(
      `[kyc/submit] doc producer_id=${inserted.producer_id} url=${url}`,
    );
  }

  // 8) Success
  return ok(res, {
    producer_id: inserted.producer_id,
    cvr_number: inserted.cvr_number,
    contact_email: inserted.contact_email,
    business_type,
    subscription_tier: KYC_PENDING_TIER,
    is_active: false,
    docs_received: docs_urls.length,
    submitted_at: inserted.created_at ?? submittedAt,
  });
}

// ---------- Public type exports ----------------------------------------

export type {
  ApiResponse,
  SuccessResponse,
  ErrorResponse,
  KycSubmitData,
  ParsedBody,
};
