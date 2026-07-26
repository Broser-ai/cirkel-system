// C:\Users\Ambro2\cirkel-system\api\admin\impersonate.ts
//
// Cirkel — Admin Support · POST /api/admin/impersonate
//
// Formål:
//   Give en verificeret platform-admin mulighed for at "impersonere" en
//   slut-bruger til support-formål (fx debugging af en konkret sag). Endpointet
//   udsteder et SCOPED Firebase custom token gyldigt i 60 minutter og skriver
//   samtidig en obligatorisk audit-log entry i sovereign_audit_trail. Uden
//   audit-write bliver der ALDRIG udstedt et token — audit er en hård
//   forudsætning for enhver impersonation.
//
// Body (POST JSON):
//   {
//     "target_user_id": "<firebase-uid>",   // required, den bruger admin vil imitere
//     "reason":         "<free-text>"       // required, min 10 tegn, max 500 tegn
//   }
//
// Response (success 200):
//   {
//     success: true,
//     data: {
//       target_user_id:            string,
//       impersonated_by_admin_uid: string,
//       admin_email:               string | null,
//       custom_token:              string,      // exchange via Firebase signInWithCustomToken()
//       expires_at:                string,      // ISO-8601 (nu + 60 min)
//       expires_in_seconds:        3600,
//       audit_id:                  string,      // sovereign_audit_trail.id
//       reason:                    string,
//       scope:                     "support"
//     }
//   }
//
// Response (fejl):
//   { success: false, error: string, code?: string, detail?: string }
//
// SIKKERHED (F3.8 + admin-role + audit):
//   - Firebase Bearer-token verificeres via verifyFirebaseToken (F3.8-primitiv
//     bag resolveTrustedUid). Vi bruger verifyFirebaseToken direkte for at få
//     adgang til decoded_token.claims — resolveTrustedUid returnerer kun UID
//     og kan ikke bruges til at inspicere admin-claimet.
//   - Uanset FIREBASE_ADMIN_ENFORCE håndhæves cryptografisk verify eksplicit
//     for dette endpoint (admin-endpoints må ALDRIG passe warn_only).
//   - Admin-claim tjek: decoded_token.admin === true ELLER role === 'admin'.
//   - Selv-impersonation blokeres (target_user_id må ikke være admin's egen uid).
//   - Admin-til-admin impersonation blokeres (defense-in-depth mod
//     rettighedseskalering imellem admins).
//   - Audit-log skrives til sovereign_audit_trail FØR custom token udstedes.
//     Fejler audit-write → 500, intet token udstedes.
//   - Custom token bærer ekstra claims (impersonated, impersonated_by,
//     impersonation_expires_at_ms, scope) så downstream services kan aflæse
//     kontekstsemantikken direkte fra det udvekslede ID-token.
//   - Ingen hardkodede secrets — udelukkende process.env.
//   - Supabase service-role klient (lazy init, samme pattern som scan.ts).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAdminAuth } from '../_firebase-admin.js';
import {
  resolveTrustedUid,
  verifyFirebaseToken,
} from '../_verify-firebase-token.js';

// ---------- Vercel config -----------------------------------------------

export const config = {
  api: {
    bodyParser: true,
  },
} as const;

// ---------- Konstanter --------------------------------------------------

/**
 * Firebase UID: alfanumeriske tegn, understregning og bindestreg, 1-128 tegn.
 * Firebase's officielle grænse er 128 tegn; formatet er ellers frit men
 * indeholder aldrig whitespace eller specialtegn i praksis.
 */
const FIREBASE_UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

/**
 * Scoped session-token levetid: 60 minutter.
 * Firebase custom tokens er gyldige i 1 time før exchange; efter exchange
 * lever ID-tokenet også 1 time. Vi eksponerer expires_at eksplicit i
 * responset så klienten kan tvinge re-auth ved udløb.
 */
const SESSION_TTL_SECONDS = 60 * 60;

/**
 * Scope-etiket der skrives ind i custom-token claims. Downstream services
 * kan validere at et impersoneret ID-token faktisk kommer fra dette flow.
 */
const IMPERSONATION_SCOPE = 'support' as const;

/**
 * sovereign_audit_trail.tenant_id er NOT NULL uuid. Platform-admin actions
 * hører ikke til en enkelt tenant, så vi bruger en dedikeret system-tenant
 * fra env (ADMIN_AUDIT_TENANT_ID) med fallback til nil-UUID. Nil-UUID er
 * bevidst valgt så platform-scope er trivielt at filtrere fra i audit-queries.
 */
const NIL_UUID = '00000000-0000-0000-0000-000000000000' as const;

const AUDIT_ENTITY_TYPE = 'admin_impersonation' as const;
const AUDIT_FIELD = 'session_token_issued' as const;

// ---------- Body-parsing typer -----------------------------------------

interface RawBody {
  readonly target_user_id?: unknown;
  readonly reason?: unknown;
}

interface ParsedBody {
  readonly target_user_id: string;
  readonly reason: string;
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

// ---------- Auth-token typer -------------------------------------------

interface DecodedTokenClaims {
  readonly uid?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly admin?: boolean;
  readonly role?: string;
  // Firebase reserverer en række standard-felter (iss, aud, iat, exp, …)
  // som vi ikke behøver at typiere præcist for admin-flowet.
  readonly [key: string]: unknown;
}

// ---------- Response typer ---------------------------------------------

interface ImpersonateData {
  readonly target_user_id: string;
  readonly impersonated_by_admin_uid: string;
  readonly admin_email: string | null;
  readonly custom_token: string;
  readonly expires_at: string;
  readonly expires_in_seconds: typeof SESSION_TTL_SECONDS;
  readonly audit_id: string;
  readonly reason: string;
  readonly scope: typeof IMPERSONATION_SCOPE;
}

interface SuccessResponse {
  readonly success: true;
  readonly data: ImpersonateData;
}

interface ErrorResponse {
  readonly success: false;
  readonly error: string;
  readonly code?: string;
  readonly detail?: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

// ---------- DB-row typer -----------------------------------------------

interface AuditInsertedRow {
  readonly id: string;
  readonly changed_at: string;
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

function ok(res: VercelResponse, data: ImpersonateData): void {
  sendJson(res, 200, { success: true, data });
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

function readAuditTenantId(): string {
  const raw = process.env.ADMIN_AUDIT_TENANT_ID;
  if (typeof raw !== 'string') return NIL_UUID;
  const trimmed = raw.trim();
  // Simpel UUID-validering (v4-agnostic — vi accepterer alle uuid-formater
  // så en tenant kan pege på et vilkårligt org-scope).
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRe.test(trimmed) ? trimmed : NIL_UUID;
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

  const targetUserId = toStringOrNull(raw.target_user_id);
  if (!targetUserId) {
    return {
      ok: false,
      reason: "Field 'target_user_id' er påkrævet.",
      code: 'missing_target_user_id',
    };
  }
  if (!FIREBASE_UID_RE.test(targetUserId)) {
    return {
      ok: false,
      reason:
        "Field 'target_user_id' skal være et gyldigt Firebase UID (a-z, A-Z, 0-9, _ eller -, 1-128 tegn).",
      code: 'invalid_target_user_id',
    };
  }

  const reasonRaw = toStringOrNull(raw.reason);
  if (!reasonRaw) {
    return {
      ok: false,
      reason: "Field 'reason' er påkrævet for audit-log accountability.",
      code: 'missing_reason',
    };
  }
  if (reasonRaw.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      reason: `Field 'reason' skal være mindst ${MIN_REASON_LENGTH} tegn (meningsfuld audit-begrundelse).`,
      code: 'reason_too_short',
    };
  }
  if (reasonRaw.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      reason: `Field 'reason' må højst være ${MAX_REASON_LENGTH} tegn.`,
      code: 'reason_too_long',
    };
  }

  return {
    ok: true,
    value: {
      target_user_id: targetUserId,
      reason: reasonRaw,
    },
  };
}

// ---------- Admin-role check -------------------------------------------

/**
 * Platform-admin: enten custom claim admin === true eller role === 'admin'.
 * Andre roller er ikke tilstrækkelige — impersonation er strengt begrænset
 * til fuld platform-admin.
 */
function isPlatformAdmin(decoded: DecodedTokenClaims | null): boolean {
  if (!decoded) return false;
  if (decoded.admin === true) return true;
  if (
    typeof decoded.role === 'string' &&
    decoded.role.toLowerCase() === 'admin'
  ) {
    return true;
  }
  return false;
}

// ---------- Target-user lookup + guard ---------------------------------

interface TargetUserSummary {
  readonly uid: string;
  readonly email: string | null;
  readonly disabled: boolean;
  readonly is_admin: boolean;
}

/**
 * Slår target-brugeren op via Firebase Admin så vi kan (a) fejle tidligt
 * hvis brugeren ikke findes, (b) blokere impersonation af en anden admin,
 * (c) blokere impersonation af en disabled bruger, og (d) berige audit-log
 * med target-email.
 */
async function fetchTargetUser(
  targetUid: string,
): Promise<
  | { ok: true; user: TargetUserSummary }
  | { ok: false; status: number; code: string; reason: string }
> {
  let auth: { getUser: (uid: string) => Promise<unknown> };
  try {
    auth = (await getAdminAuth()) as {
      getUser: (uid: string) => Promise<unknown>;
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 500,
      code: 'admin_sdk_unavailable',
      reason: `Firebase Admin SDK ikke tilgængelig: ${message}`,
    };
  }

  let userRecord: unknown;
  try {
    userRecord = await auth.getUser(targetUid);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'auth/user-not-found') {
      return {
        ok: false,
        status: 404,
        code: 'target_user_not_found',
        reason: `Target-bruger findes ikke: ${targetUid}`,
      };
    }
    return {
      ok: false,
      status: 502,
      code: 'admin_sdk_lookup_failed',
      reason: `Firebase Admin lookup fejlede: ${message}`,
    };
  }

  const record = userRecord as {
    uid?: unknown;
    email?: unknown;
    disabled?: unknown;
    customClaims?: Record<string, unknown> | null;
  };

  const uid = typeof record.uid === 'string' ? record.uid : targetUid;
  const email = typeof record.email === 'string' ? record.email : null;
  const disabled = record.disabled === true;
  const claims = record.customClaims ?? {};
  const isAdmin =
    claims.admin === true ||
    (typeof claims.role === 'string' && claims.role.toLowerCase() === 'admin');

  return {
    ok: true,
    user: {
      uid,
      email,
      disabled,
      is_admin: Boolean(isAdmin),
    },
  };
}

// ---------- Audit-log writer -------------------------------------------

interface AuditPayload {
  readonly admin_uid: string;
  readonly admin_email: string | null;
  readonly target_uid: string;
  readonly target_email: string | null;
  readonly reason: string;
  readonly expires_at_iso: string;
  readonly scope: typeof IMPERSONATION_SCOPE;
}

/**
 * Skriver en audit-entry til sovereign_audit_trail FØR custom token udstedes.
 * Fejler denne write skal caller returnere 500 og aldrig udstede tokenet.
 */
async function writeAuditEntry(
  sb: SupabaseClient,
  payload: AuditPayload,
): Promise<
  | { ok: true; row: AuditInsertedRow }
  | { ok: false; code: string; reason: string }
> {
  const tenantId = readAuditTenantId();
  const insertPayload = {
    tenant_id: tenantId,
    entity_type: AUDIT_ENTITY_TYPE,
    entity_id: payload.target_uid,
    field: AUDIT_FIELD,
    old_value: null,
    new_value: {
      admin_uid: payload.admin_uid,
      admin_email: payload.admin_email,
      target_uid: payload.target_uid,
      target_email: payload.target_email,
      scope: payload.scope,
      expires_at: payload.expires_at_iso,
      ttl_seconds: SESSION_TTL_SECONDS,
    },
    changed_by: payload.admin_uid,
    reason: payload.reason,
  } as const;

  const { data, error } = await sb
    .from('sovereign_audit_trail')
    .insert(insertPayload)
    .select('id,changed_at')
    .single();

  if (error) {
    return {
      ok: false,
      code: 'audit_insert_failed',
      reason: `sovereign_audit_trail insert fejlede: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      code: 'audit_no_row_returned',
      reason: 'sovereign_audit_trail insert returnerede ingen række.',
    };
  }

  const row = data as { id: string; changed_at: string };
  return { ok: true, row: { id: row.id, changed_at: row.changed_at } };
}

// ---------- Custom token issuance --------------------------------------

interface CustomTokenClaims {
  readonly impersonated: true;
  readonly impersonated_by: string;
  readonly impersonation_reason: string;
  readonly impersonation_expires_at_ms: number;
  readonly impersonation_audit_id: string;
  readonly scope: typeof IMPERSONATION_SCOPE;
}

/**
 * Udsteder et Firebase custom token med impersonation-claims så downstream
 * services kan aflæse fuld kontekst direkte fra det udvekslede ID-token.
 * Firebase's custom-token TTL er 1 time før exchange; efter exchange lever
 * ID-tokenet også 1 time — matcher vores SESSION_TTL_SECONDS eksakt.
 */
async function issueScopedCustomToken(
  targetUid: string,
  claims: CustomTokenClaims,
): Promise<
  | { ok: true; token: string }
  | { ok: false; code: string; reason: string }
> {
  let auth: {
    createCustomToken: (
      uid: string,
      developerClaims?: Record<string, unknown>,
    ) => Promise<string>;
  };
  try {
    auth = (await getAdminAuth()) as {
      createCustomToken: (
        uid: string,
        developerClaims?: Record<string, unknown>,
      ) => Promise<string>;
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 'admin_sdk_unavailable',
      reason: `Firebase Admin SDK ikke tilgængelig: ${message}`,
    };
  }

  try {
    const token = await auth.createCustomToken(
      targetUid,
      claims as unknown as Record<string, unknown>,
    );
    return { ok: true, token };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 'custom_token_failed',
      reason: `createCustomToken fejlede: ${message}`,
    };
  }
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

  // 2) Body-validering FØRST (dårlig body skal aldrig nå auth-flowet)
  const parsed = parseAndValidateBody(req.body);
  if (!parsed.ok) {
    return fail(res, 400, parsed.reason, parsed.code);
  }
  const { target_user_id, reason } = parsed.value;

  // 3) F3.8 — Firebase Bearer-token verify.
  //    Vi bruger verifyFirebaseToken direkte i stedet for resolveTrustedUid
  //    fordi vi skal inspicere decoded_token.claims for admin-rollen.
  //    resolveTrustedUid er importeret som dokumentation af det underliggende
  //    F3.8 flow (samme modul, samme verify-primitiv). Admin-endpoints må
  //    aldrig passe warn_only, så vi håndhæver verified === true eksplicit.
  //    Reference til resolveTrustedUid holdes for at signalere at dette
  //    endpoint indgår i F3.8-lag'ets samlede trust-model.
  void resolveTrustedUid;

  let decoded: DecodedTokenClaims | null = null;
  let adminUid: string;
  try {
    const verified = await verifyFirebaseToken(req, {});
    if (!verified.ok) {
      return fail(
        res,
        verified.status,
        verified.reason,
        'auth_failed',
      );
    }
    if (!verified.verified) {
      return fail(
        res,
        401,
        'Firebase-token er ikke cryptografisk verificeret. Bearer-token påkrævet.',
        'token_not_verified',
      );
    }
    if (!verified.uid) {
      return fail(
        res,
        401,
        'Firebase-token indeholder intet uid.',
        'token_missing_uid',
      );
    }
    adminUid = verified.uid;
    decoded = (verified.decoded_token ?? null) as DecodedTokenClaims | null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/impersonate] verifyFirebaseToken kastede:', message);
    return fail(res, 500, 'Auth-verifikation fejlede.', 'auth_error', message);
  }

  // 4) Admin-role gating
  if (!isPlatformAdmin(decoded)) {
    console.warn(
      `[admin/impersonate] FORBIDDEN — non-admin uid=${adminUid} forsøgte impersonation af target=${target_user_id}`,
    );
    return fail(
      res,
      403,
      'FORBIDDEN — kalderen har ikke admin-rolle.',
      'not_admin',
    );
  }

  const adminEmail =
    decoded && typeof decoded.email === 'string' ? decoded.email : null;

  // 5) Selv-impersonation blokeres
  if (target_user_id === adminUid) {
    return fail(
      res,
      400,
      'Selv-impersonation er ikke tilladt (target_user_id === admin uid).',
      'self_impersonation_blocked',
    );
  }

  // 6) Target-user lookup + admin-til-admin guard
  const targetLookup = await fetchTargetUser(target_user_id);
  if (!targetLookup.ok) {
    return fail(
      res,
      targetLookup.status,
      targetLookup.reason,
      targetLookup.code,
    );
  }
  const targetUser = targetLookup.user;

  if (targetUser.disabled) {
    return fail(
      res,
      409,
      'Target-bruger er disabled — impersonation blokeret.',
      'target_disabled',
    );
  }
  if (targetUser.is_admin) {
    console.warn(
      `[admin/impersonate] FORBIDDEN — admin=${adminUid} forsøgte impersonation af anden admin=${target_user_id}`,
    );
    return fail(
      res,
      403,
      'Admin-til-admin impersonation er ikke tilladt.',
      'target_is_admin',
    );
  }

  // 7) Supabase-klient (påkrævet for audit-write)
  const sb = getSupabase();
  if (!sb) {
    return fail(
      res,
      503,
      'Supabase service-role-nøgle ikke konfigureret — audit-write ikke muligt.',
      'supabase_unavailable',
    );
  }

  // 8) Beregn expires_at (nu + 60 min) FØR audit-write så samme timestamp
  //    er kanonisk både i audit-rækken og i token-claim.
  const nowMs = Date.now();
  const expiresAtMs = nowMs + SESSION_TTL_SECONDS * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  // 9) Audit-log FØRST — audit er en hård forudsætning for token-issuance.
  const auditResult = await writeAuditEntry(sb, {
    admin_uid: adminUid,
    admin_email: adminEmail,
    target_uid: targetUser.uid,
    target_email: targetUser.email,
    reason,
    expires_at_iso: expiresAtIso,
    scope: IMPERSONATION_SCOPE,
  });
  if (!auditResult.ok) {
    console.error(
      `[admin/impersonate] AUDIT WRITE FAILED — INGEN TOKEN UDSTEDT admin=${adminUid} target=${target_user_id}: ${auditResult.reason}`,
    );
    return fail(
      res,
      500,
      'Audit-log write fejlede — ingen impersonation-token udstedt.',
      auditResult.code,
      auditResult.reason,
    );
  }

  // 10) Custom token med impersonation-claims
  const tokenResult = await issueScopedCustomToken(targetUser.uid, {
    impersonated: true,
    impersonated_by: adminUid,
    impersonation_reason: reason,
    impersonation_expires_at_ms: expiresAtMs,
    impersonation_audit_id: auditResult.row.id,
    scope: IMPERSONATION_SCOPE,
  });
  if (!tokenResult.ok) {
    console.error(
      `[admin/impersonate] TOKEN ISSUANCE FAILED efter audit (audit_id=${auditResult.row.id}) admin=${adminUid} target=${target_user_id}: ${tokenResult.reason}`,
    );
    return fail(
      res,
      502,
      'Kunne ikke udstede custom token efter audit-write.',
      tokenResult.code,
      tokenResult.reason,
    );
  }

  console.log(
    `[admin/impersonate] ISSUED admin=${adminUid} target=${targetUser.uid} ` +
      `audit_id=${auditResult.row.id} expires_at=${expiresAtIso} ` +
      `scope=${IMPERSONATION_SCOPE}`,
  );

  // 11) Success
  return ok(res, {
    target_user_id: targetUser.uid,
    impersonated_by_admin_uid: adminUid,
    admin_email: adminEmail,
    custom_token: tokenResult.token,
    expires_at: expiresAtIso,
    expires_in_seconds: SESSION_TTL_SECONDS,
    audit_id: auditResult.row.id,
    reason,
    scope: IMPERSONATION_SCOPE,
  });
}

// ---------- Public type exports ----------------------------------------

export type {
  ApiResponse,
  SuccessResponse,
  ErrorResponse,
  ImpersonateData,
  ParsedBody,
};
