// cirkel-system/api/kommune/rules.ts
//
// Modul 11.2 — Municipal Rule Overrides (kommune-specifikke sorteringsregler).
// Backing store: migration 010_municipal_rule_overrides.sql
//                (public.municipal_rule_overrides).
//
// Endpoint:
//   POST /api/kommune/rules
//     body: {
//       zip_code:                       string  (påkrævet, 3-10 chars, [A-Z0-9-])
//       kommune_name:                   string  (påkrævet, 1-100 chars)
//       fraction_key:                   string | null  (valgfri, 1-50 chars; null
//                                                       = generel zip-override)
//       localized_sorting_instruction:  string  (påkrævet, ikke-tom whitespace)
//       officer_email:                  string | null  (valgfri, RFC-lite email)
//       expires_at:                     string | null  (valgfri ISO-8601;
//                                                       sæson-regler)
//     }
//
// Adfærd: UPSERT på (zip_code, fraction_key) — matcher NULLS NOT DISTINCT
//         UNIQUE-constrainten i migration 010, så gentagne POST'er af samme
//         (zip, fraktion) overskriver instruktion + officer + expiry.
//
// Auth:   F3.8-mønsteret. Officer-portalen sender Firebase ID-token i
//         Authorization: Bearer <token>. verifyFirebaseToken bruger env
//         FIREBASE_ADMIN_ENFORCE til at bestemme om mismatch = 401.
//         officer_email valideres separat mod DB-constraint — Firebase-uid
//         behøver ikke matche emailen (portal-brugeren kan skrive på vegne
//         af en offentliggjort officer-adresse).
//
// Response-format:
//   200 { success: true,  data: { override: MunicipalRuleOverrideRow,
//                                 upserted: boolean,
//                                 auth: { firebase_verified: boolean } } }
//   4xx/5xx { success: false, error: "<slug>", detail?: "<string>" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Domænetyper (afspejler migration 010) ----------

interface MunicipalRuleOverrideRow {
  override_id: string;
  zip_code: string;
  kommune_name: string;
  fraction_key: string | null;
  localized_sorting_instruction: string;
  updated_by_officer_email: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RulesUpsertBody {
  zip_code: string;
  kommune_name: string;
  fraction_key: string | null;
  localized_sorting_instruction: string;
  officer_email: string | null;
  expires_at?: string | null;
}

interface UpsertSuccessData {
  override: MunicipalRuleOverrideRow;
  upserted: true;
  auth: { firebase_verified: boolean };
}

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

// ---------- Konstanter (matcher SQL-constraints i migration 010) ----------

const ZIP_REGEX = /^[A-Z0-9-]{3,10}$/;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const KOMMUNE_MAX_LEN = 100;
const FRACTION_MAX_LEN = 50;
const INSTRUCTION_MAX_LEN = 8000;
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';
const CONFLICT_TARGET = 'zip_code,fraction_key';

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/kommune/rules' } },
  });
  return cachedClient;
}

// ---------- Type-guards + parsere ----------

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function normalizeZip(value: string): string {
  return value.trim().toUpperCase();
}

function isValidZip(value: string): boolean {
  return ZIP_REGEX.test(value);
}

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

function isValidIsoTimestamp(value: string): boolean {
  const t = Date.parse(value);
  return Number.isFinite(t);
}

// ---------- Response-helpers ----------

function sendSuccess<T>(
  res: VercelResponse,
  data: T,
  statusCode = 200,
): VercelResponse {
  res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
  const body: SuccessResponse<T> = { success: true, data };
  return res.status(statusCode).json(body);
}

function sendError(
  res: VercelResponse,
  statusCode: number,
  error: string,
  detail?: string,
): VercelResponse {
  res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
  const body: ErrorResponse = { success: false, error };
  if (detail) body.detail = detail;
  return res.status(statusCode).json(body);
}

// ---------- Body-validering ----------

interface ValidatedInput {
  zip_code: string;
  kommune_name: string;
  fraction_key: string | null;
  localized_sorting_instruction: string;
  officer_email: string | null;
  expires_at: string | null;
}

interface ValidationOk {
  ok: true;
  value: ValidatedInput;
}

interface ValidationFail {
  ok: false;
  status: number;
  error: string;
  detail?: string;
}

type ValidationResult = ValidationOk | ValidationFail;

function validateBody(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, status: 400, error: 'body_invalid', detail: 'JSON object required' };
  }

  const body = raw as Partial<RulesUpsertBody>;

  // zip_code
  if (!isNonEmptyString(body.zip_code)) {
    return { ok: false, status: 400, error: 'zip_code_required' };
  }
  const zipNormalized = normalizeZip(body.zip_code);
  if (!isValidZip(zipNormalized)) {
    return {
      ok: false,
      status: 400,
      error: 'zip_code_invalid',
      detail: 'Must match ^[A-Z0-9-]{3,10}$ (e.g. "8000" or "FO-100")',
    };
  }

  // kommune_name
  if (!isNonEmptyString(body.kommune_name)) {
    return { ok: false, status: 400, error: 'kommune_name_required' };
  }
  const kommuneTrimmed = body.kommune_name.trim();
  if (kommuneTrimmed.length > KOMMUNE_MAX_LEN) {
    return {
      ok: false,
      status: 400,
      error: 'kommune_name_too_long',
      detail: `max ${KOMMUNE_MAX_LEN} chars`,
    };
  }

  // fraction_key (nullable)
  let fractionKey: string | null = null;
  if (!isNullOrUndefined(body.fraction_key)) {
    if (!isString(body.fraction_key)) {
      return { ok: false, status: 400, error: 'fraction_key_invalid' };
    }
    const trimmed = body.fraction_key.trim();
    if (trimmed.length === 0) {
      // Tom string behandles som "generel override" (null) for at matche
      // NULLS NOT DISTINCT UNIQUE-constrainten.
      fractionKey = null;
    } else if (trimmed.length > FRACTION_MAX_LEN) {
      return {
        ok: false,
        status: 400,
        error: 'fraction_key_too_long',
        detail: `max ${FRACTION_MAX_LEN} chars`,
      };
    } else {
      fractionKey = trimmed;
    }
  }

  // localized_sorting_instruction
  if (!isString(body.localized_sorting_instruction)) {
    return { ok: false, status: 400, error: 'localized_sorting_instruction_required' };
  }
  const instructionTrimmed = body.localized_sorting_instruction.trim();
  if (instructionTrimmed.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'localized_sorting_instruction_empty',
      detail: 'DB-constraint kræver char_length(btrim(...)) > 0',
    };
  }
  if (instructionTrimmed.length > INSTRUCTION_MAX_LEN) {
    return {
      ok: false,
      status: 400,
      error: 'localized_sorting_instruction_too_long',
      detail: `max ${INSTRUCTION_MAX_LEN} chars`,
    };
  }

  // officer_email (nullable)
  let officerEmail: string | null = null;
  if (!isNullOrUndefined(body.officer_email)) {
    if (!isString(body.officer_email)) {
      return { ok: false, status: 400, error: 'officer_email_invalid' };
    }
    const trimmed = body.officer_email.trim();
    if (trimmed.length > 0) {
      if (!isValidEmail(trimmed)) {
        return {
          ok: false,
          status: 400,
          error: 'officer_email_invalid',
          detail: 'Must match RFC-lite ^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
        };
      }
      officerEmail = trimmed;
    }
  }

  // expires_at (nullable ISO-timestamp)
  let expiresAt: string | null = null;
  if (!isNullOrUndefined(body.expires_at)) {
    if (!isString(body.expires_at)) {
      return { ok: false, status: 400, error: 'expires_at_invalid' };
    }
    const trimmed = body.expires_at.trim();
    if (trimmed.length > 0) {
      if (!isValidIsoTimestamp(trimmed)) {
        return {
          ok: false,
          status: 400,
          error: 'expires_at_invalid',
          detail: 'Must be a parseable ISO-8601 timestamp',
        };
      }
      const parsed = Date.parse(trimmed);
      if (parsed <= Date.now()) {
        return {
          ok: false,
          status: 400,
          error: 'expires_at_in_past',
          detail: 'DB-constraint kræver expires_at > created_at (nu)',
        };
      }
      expiresAt = new Date(parsed).toISOString();
    }
  }

  return {
    ok: true,
    value: {
      zip_code: zipNormalized,
      kommune_name: kommuneTrimmed,
      fraction_key: fractionKey,
      localized_sorting_instruction: instructionTrimmed,
      officer_email: officerEmail,
      expires_at: expiresAt,
    },
  };
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  const method = (req.method ?? 'GET').toUpperCase();

  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'method_not_allowed');
  }

  const sb = getSupabase();
  if (!sb) return sendError(res, 503, 'supabase_not_configured');

  // F3.8 — verificer Firebase ID-token hvis sendt. Uden requiredUid tjekkes
  // kun cryptografisk gyldighed. FIREBASE_ADMIN_ENFORCE=1 gør manglende/ugyldig
  // token til hård 401; ellers pass-through i warn_only (backward-compat).
  const verify = await verifyFirebaseToken(req);
  if (!verify.ok) {
    return sendError(res, verify.status, 'firebase_verify_failed', verify.reason);
  }

  const validation = validateBody(req.body);
  if (!validation.ok) {
    return sendError(res, validation.status, validation.error, validation.detail);
  }
  const input = validation.value;

  // Insert-row. updated_by_officer_email kortlægges fra body.officer_email
  // (feltet hedder officer_email udadtil for kortere JSON).
  const insertRow = {
    zip_code: input.zip_code,
    kommune_name: input.kommune_name,
    fraction_key: input.fraction_key,
    localized_sorting_instruction: input.localized_sorting_instruction,
    updated_by_officer_email: input.officer_email,
    expires_at: input.expires_at,
  };

  try {
    // UPSERT på (zip_code, fraction_key) — matcher NULLS NOT DISTINCT UNIQUE
    // fra migration 010. defaultToNull sikrer at manglende fraction_key i
    // insert-row læses som NULL af Postgres, ikke som column-default.
    const { data, error } = await sb
      .from('municipal_rule_overrides')
      .upsert(insertRow, {
        onConflict: CONFLICT_TARGET,
        ignoreDuplicates: false,
        defaultToNull: true,
      })
      .select('*')
      .single();

    if (error) {
      // 23514 = check_violation, 23505 = unique_violation
      if (error.code === '23514') {
        return sendError(res, 400, 'db_check_violation', error.message);
      }
      if (error.code === '23505') {
        return sendError(res, 409, 'db_unique_violation', error.message);
      }
      return sendError(res, 500, 'db_upsert_failed', error.message);
    }

    if (!data) {
      return sendError(res, 500, 'db_upsert_empty_result');
    }

    const payload: UpsertSuccessData = {
      override: data as MunicipalRuleOverrideRow,
      upserted: true,
      auth: { firebase_verified: verify.verified },
    };
    return sendSuccess(res, payload, 200);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'unknown internal error';
    console.error('[api/kommune/rules] internal_error:', message);
    return sendError(res, 500, 'internal_error', message);
  }
}
