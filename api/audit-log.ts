// cirkel-system/api/audit-log.ts
//
// F3.8 · Admin-only Audit Log endpoint.
//
// GET /api/audit-log
//   ?firebaseUid=<uid>          (påkrævet — kalder-identitet, verificeres via F3.8)
//   &from_date=<ISO-8601>       (valgfri — inclusive; default = for 30 dage siden)
//   &to_date=<ISO-8601>         (valgfri — inclusive; default = nu)
//   &user_id=<uuid|firebase_uid> (valgfri — filtrér på anden brugers profil.id
//                                eller firebase UID; kræver admin-rolle)
//   &action=<slug>              (valgfri — filtrér admin_actions.action_type;
//                                understøtter komma-separeret liste)
//
// Formål: samler ét komplet revisions-spor på tværs af kritiske tabeller:
//   • ledger                      → SHA-256 hash-chain (kroner + points bevægelse)
//   • biometric_verifications     → WebAuthn/MitID/device-fingerprint log
//   • wallet_payouts              → MobilePay/Stripe/manual payouts
//   • admin_actions               → hvad administratorer har gjort (hvis tabel findes)
//
// Autentifikation (obligatorisk):
//   1. F3.8 verify (resolveTrustedUid) på kaldende firebaseUid.
//      - Enforce-mode: mismatch/ingen token → 401 UID_SPOOF_DETECTED.
//      - Warn_only-mode: fortsætter med body-UID, men logges.
//   2. Admin-rolle-check på det VERIFICEREDE UID:
//      - Primær kilde: profiles.user_type = 'admin' på den tilhørende profil.
//      - Fallback: ADMIN_FIREBASE_UIDS env-var (komma-separeret hvidliste).
//      - Ingen match → 403 forbidden.
//
// Response-format:
//   200 { success: true,  data: AuditLogPayload }
//   4xx/5xx { success: false, error: '<slug>', detail?: '<string>' }
//
// Ingen hemmeligheder hardcodes — alt læses fra process.env.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from './_verify-firebase-token.js';
import logger from '../src/lib/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Konstanter
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';
const DEFAULT_WINDOW_DAYS = 30;
const MAX_ROWS_PER_TABLE = 5000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// Typer — aggregerede audit-rows
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerAuditRow {
  id: number;
  scan_id: string;
  user_id: string;
  points: number | null;
  balance: number | string | null;
  prev_hash: string | null;
  hash: string | null;
  is_valid: boolean | null;
  created_at: string | null;
}

interface BiometricVerificationAuditRow {
  verification_id: string;
  user_id: string;
  device_fingerprint: string | null;
  webauthn_credential_id: string | null;
  verification_method: string | null;
  ip_address: string | null;
  user_agent: string | null;
  verification_result: string | null;
  verified_at: string | null;
}

interface WalletPayoutAuditRow {
  payout_id: string;
  user_id: string;
  amount_dkk: number | string | null;
  psp_provider: string | null;
  psp_reference: string | null;
  danish_phone: string | null;
  status: string | null;
  failure_reason: string | null;
  initiated_at: string | null;
  completed_at: string | null;
}

interface AdminActionAuditRow {
  id: string | number;
  admin_user_id: string | null;
  target_user_id: string | null;
  action_type: string | null;
  action_details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
}

interface AuditLogFilter {
  from_date: string;
  to_date: string;
  user_id: string | null;
  user_id_resolved_to: string | null;
  action_types: string[] | null;
}

interface AuditLogCounts {
  ledger: number;
  biometric_verifications: number;
  wallet_payouts: number;
  admin_actions: number;
  total: number;
}

interface AuditLogMeta {
  generated_at: string;
  requested_by_firebase_uid: string;
  requested_by_verified: boolean;
  requested_by_spoofed: boolean;
  admin_authorization_source: 'profiles.user_type' | 'env.ADMIN_FIREBASE_UIDS';
  truncated_tables: string[];
  missing_tables: string[];
}

interface AuditLogPayload {
  meta: AuditLogMeta;
  filter: AuditLogFilter;
  counts: AuditLogCounts;
  ledger: LedgerAuditRow[];
  biometric_verifications: BiometricVerificationAuditRow[];
  wallet_payouts: WalletPayoutAuditRow[];
  admin_actions: AdminActionAuditRow[];
}

interface SuccessResponse {
  success: true;
  data: AuditLogPayload;
}

interface ErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase — lazy init (samme mønster som api/scan.ts og api/dashboard.ts)
// ─────────────────────────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/audit-log' } },
  });
  return _sb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hjælpere — type-guards, query-parsing, dato-håndtering
// ─────────────────────────────────────────────────────────────────────────────

function firstQuery(
  raw: string | string[] | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' ? v : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function parseIsoDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function parseActionList(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : null;
}

function sendSuccess(
  res: VercelResponse,
  data: AuditLogPayload,
  statusCode = 200,
): VercelResponse {
  res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
  const body: SuccessResponse = { success: true, data };
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

// ─────────────────────────────────────────────────────────────────────────────
// Admin-rolle-check
//   Primær kilde: profiles.user_type = 'admin' på profilen tilhørende
//                 det verificerede firebase UID (auth.users.id).
//   Fallback:     ADMIN_FIREBASE_UIDS env-var (komma-separeret hvidliste).
// ─────────────────────────────────────────────────────────────────────────────

function envAdminUids(): Set<string> {
  const raw = process.env.ADMIN_FIREBASE_UIDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

interface AdminCheckResult {
  isAdmin: boolean;
  source: 'profiles.user_type' | 'env.ADMIN_FIREBASE_UIDS';
  profileId: string | null;
}

async function verifyAdminRole(
  sb: SupabaseClient,
  trustedUid: string,
): Promise<AdminCheckResult> {
  // 1) Env-fallback (billigst — springer DB-kald hvis hvidliste matcher)
  const envAdmins = envAdminUids();
  if (envAdmins.has(trustedUid)) {
    return { isAdmin: true, source: 'env.ADMIN_FIREBASE_UIDS', profileId: null };
  }

  // 2) DB-check via profiles.user_type = 'admin'
  //    Firebase-broen bruger profiles.id = auth.users.id (samme UUID i Supabase-auth).
  //    Vi tolererer at kolonnen user_type mangler i miljøer uden migration 002
  //    ved at fange 42703 (undefined_column) og falde tilbage til env-only.
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('id, user_type')
      .eq('id', trustedUid)
      .maybeSingle();

    if (error) {
      logger.warn('[audit-log] profiles.user_type-check fejlede', {
        code: error.code,
        message: error.message,
      });
      return { isAdmin: false, source: 'env.ADMIN_FIREBASE_UIDS', profileId: null };
    }

    const row = data as { id?: string | null; user_type?: string | null } | null;
    const userType = row?.user_type ?? null;
    const profileId = typeof row?.id === 'string' ? row.id : null;
    const isAdmin = typeof userType === 'string' && userType.toLowerCase() === 'admin';
    return { isAdmin, source: 'profiles.user_type', profileId };
  } catch (err: unknown) {
    logger.warn('[audit-log] uventet fejl i admin-rolle-check', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { isAdmin: false, source: 'env.ADMIN_FIREBASE_UIDS', profileId: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bruger-filter — oversæt query.user_id (uuid ELLER firebase UID) til profile.id
//   • UUID  → antag det er profiles.id (samme UUID i Supabase-auth). Vi
//             validerer det eksisterer så et 400 fanges tidligt.
//   • ellers → antag firebase UID og slå den op via auth-broen; hvis ikke
//             fundet, returnér null → kalder bestemmer om det skal fejle.
// ─────────────────────────────────────────────────────────────────────────────

async function resolveUserFilter(
  sb: SupabaseClient,
  rawUserId: string | null,
): Promise<{ profileId: string | null; resolvedFrom: string | null }> {
  if (!rawUserId) return { profileId: null, resolvedFrom: null };
  const trimmed = rawUserId.trim();
  if (trimmed.length === 0) return { profileId: null, resolvedFrom: null };

  if (isUuid(trimmed)) {
    const { data, error } = await sb
      .from('profiles')
      .select('id')
      .eq('id', trimmed)
      .maybeSingle();
    if (error) {
      logger.warn('[audit-log] user_id (uuid) lookup fejlede', {
        code: error.code,
        message: error.message,
      });
      return { profileId: null, resolvedFrom: trimmed };
    }
    const id = (data as { id?: string | null } | null)?.id ?? null;
    return { profileId: id, resolvedFrom: trimmed };
  }

  // Ikke UUID → antag firebase UID = profiles.id i denne base.
  const { data, error } = await sb
    .from('profiles')
    .select('id')
    .eq('id', trimmed)
    .maybeSingle();
  if (error) {
    logger.warn('[audit-log] user_id (firebase) lookup fejlede', {
      code: error.code,
      message: error.message,
    });
    return { profileId: null, resolvedFrom: trimmed };
  }
  const id = (data as { id?: string | null } | null)?.id ?? null;
  return { profileId: id, resolvedFrom: trimmed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Table-fetch hjælpere.
//   Hver returnerer { rows, truncated, missing }. Fejl (tabel mangler, RLS
//   blokerer, kolonner mangler) logges og gør ikke hele endpointet fatal.
// ─────────────────────────────────────────────────────────────────────────────

interface FetchResult<T> {
  rows: T[];
  truncated: boolean;
  missing: boolean;
}

function isMissingTableError(code: string | null | undefined): boolean {
  // 42P01 = undefined_table
  return code === '42P01';
}

async function fetchLedger(
  sb: SupabaseClient,
  from: string,
  to: string,
  profileFilter: string | null,
): Promise<FetchResult<LedgerAuditRow>> {
  let query = sb
    .from('ledger')
    .select('id, scan_id, user_id, points, balance, prev_hash, hash, is_valid, created_at')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS_PER_TABLE + 1);

  if (profileFilter) {
    query = query.eq('user_id', profileFilter);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) {
      logger.warn('[audit-log] ledger tabel mangler', { message: error.message });
      return { rows: [], truncated: false, missing: true };
    }
    logger.warn('[audit-log] ledger query fejlede', {
      code: error.code,
      message: error.message,
    });
    return { rows: [], truncated: false, missing: false };
  }

  const raw = (data ?? []) as LedgerAuditRow[];
  const truncated = raw.length > MAX_ROWS_PER_TABLE;
  return {
    rows: truncated ? raw.slice(0, MAX_ROWS_PER_TABLE) : raw,
    truncated,
    missing: false,
  };
}

async function fetchBiometricVerifications(
  sb: SupabaseClient,
  from: string,
  to: string,
  profileFilter: string | null,
): Promise<FetchResult<BiometricVerificationAuditRow>> {
  let query = sb
    .from('biometric_verifications')
    .select(
      'verification_id, user_id, device_fingerprint, webauthn_credential_id, verification_method, ip_address, user_agent, verification_result, verified_at',
    )
    .gte('verified_at', from)
    .lte('verified_at', to)
    .order('verified_at', { ascending: false })
    .limit(MAX_ROWS_PER_TABLE + 1);

  if (profileFilter) {
    query = query.eq('user_id', profileFilter);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) {
      logger.warn('[audit-log] biometric_verifications tabel mangler', {
        message: error.message,
      });
      return { rows: [], truncated: false, missing: true };
    }
    logger.warn('[audit-log] biometric_verifications query fejlede', {
      code: error.code,
      message: error.message,
    });
    return { rows: [], truncated: false, missing: false };
  }

  const raw = (data ?? []) as BiometricVerificationAuditRow[];
  const truncated = raw.length > MAX_ROWS_PER_TABLE;
  return {
    rows: truncated ? raw.slice(0, MAX_ROWS_PER_TABLE) : raw,
    truncated,
    missing: false,
  };
}

async function fetchWalletPayouts(
  sb: SupabaseClient,
  from: string,
  to: string,
  profileFilter: string | null,
): Promise<FetchResult<WalletPayoutAuditRow>> {
  let query = sb
    .from('wallet_payouts')
    .select(
      'payout_id, user_id, amount_dkk, psp_provider, psp_reference, danish_phone, status, failure_reason, initiated_at, completed_at',
    )
    .gte('initiated_at', from)
    .lte('initiated_at', to)
    .order('initiated_at', { ascending: false })
    .limit(MAX_ROWS_PER_TABLE + 1);

  if (profileFilter) {
    query = query.eq('user_id', profileFilter);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) {
      logger.warn('[audit-log] wallet_payouts tabel mangler', {
        message: error.message,
      });
      return { rows: [], truncated: false, missing: true };
    }
    logger.warn('[audit-log] wallet_payouts query fejlede', {
      code: error.code,
      message: error.message,
    });
    return { rows: [], truncated: false, missing: false };
  }

  const raw = (data ?? []) as WalletPayoutAuditRow[];
  const truncated = raw.length > MAX_ROWS_PER_TABLE;
  return {
    rows: truncated ? raw.slice(0, MAX_ROWS_PER_TABLE) : raw,
    truncated,
    missing: false,
  };
}

async function fetchAdminActions(
  sb: SupabaseClient,
  from: string,
  to: string,
  profileFilter: string | null,
  actionTypes: string[] | null,
): Promise<FetchResult<AdminActionAuditRow>> {
  let query = sb
    .from('admin_actions')
    .select(
      'id, admin_user_id, target_user_id, action_type, action_details, ip_address, user_agent, created_at',
    )
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS_PER_TABLE + 1);

  if (profileFilter) {
    // For admin_actions matcher user_id-filter enten den der udførte handlingen
    // eller den handlingen ramte — begge er relevante i et revisions-spor.
    query = query.or(
      `admin_user_id.eq.${profileFilter},target_user_id.eq.${profileFilter}`,
    );
  }

  if (actionTypes && actionTypes.length > 0) {
    query = query.in('action_type', actionTypes);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) {
      logger.warn('[audit-log] admin_actions tabel mangler (endnu ikke migreret)', {
        message: error.message,
      });
      return { rows: [], truncated: false, missing: true };
    }
    logger.warn('[audit-log] admin_actions query fejlede', {
      code: error.code,
      message: error.message,
    });
    return { rows: [], truncated: false, missing: false };
  }

  const raw = (data ?? []) as AdminActionAuditRow[];
  const truncated = raw.length > MAX_ROWS_PER_TABLE;
  return {
    rows: truncated ? raw.slice(0, MAX_ROWS_PER_TABLE) : raw,
    truncated,
    missing: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // 1. Method-guard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'method_not_allowed');
  }

  // 2. Klient-oplyst UID (kalder-identitet)
  const callerFirebaseUid = (firstQuery(req.query.firebaseUid) ?? '').trim();
  if (!isNonEmptyString(callerFirebaseUid)) {
    return sendError(res, 400, 'firebaseUid_required');
  }

  // 3. F3.8 verify — resolveTrustedUid FØR nogen data-fetch
  let trustedUid: string;
  let uidVerified = false;
  let uidSpoofed = false;
  try {
    const verified = await resolveTrustedUid(req, callerFirebaseUid);
    if (!verified || !verified.trusted_uid) {
      logger.warn(
        '[F3.8] audit-log: resolveTrustedUid returnerede intet UID — fortsætter med kalder-UID',
      );
      trustedUid = callerFirebaseUid;
    } else {
      trustedUid = verified.trusted_uid;
      uidVerified = Boolean(verified.verified);
      uidSpoofed = Boolean(verified.spoofed);
      if (uidSpoofed) {
        logger.warn('[F3.8] audit-log warn_only: UID-spoof detekteret', {
          reason: verified.reason,
        });
      } else if (!uidVerified) {
        logger.warn(
          '[F3.8] audit-log warn_only: token IKKE verificeret. Fortsætter med kalder-UID',
          { reason: verified.reason },
        );
      }
    }
  } catch (err: unknown) {
    const errObj = err as { status?: number; reason?: string; message?: string };
    const status = errObj?.status ?? 401;
    logger.error(
      '[F3.8] audit-log enforce: blokerede request',
      err instanceof Error ? err : new Error(String(err)),
      { reason: errObj?.reason },
    );
    return sendError(
      res,
      status,
      'UID_SPOOF_DETECTED',
      errObj?.reason ?? errObj?.message ?? 'Firebase-token verifikation fejlede.',
    );
  }

  // 4. Supabase service-role-klient (server-side, aldrig klient)
  const sb = getSupabase();
  if (!sb) {
    logger.warn('[audit-log] Supabase service-role ikke konfigureret');
    return sendError(
      res,
      503,
      'supabase_unavailable',
      'Service-role-nøgle mangler i miljøet.',
    );
  }

  // 5. Admin-rolle-check på det VERIFICEREDE UID
  const adminCheck = await verifyAdminRole(sb, trustedUid);
  if (!adminCheck.isAdmin) {
    logger.warn('[audit-log] forbidden — kalder er ikke administrator', {
      trustedUid,
      source: adminCheck.source,
    });
    return sendError(
      res,
      403,
      'forbidden',
      'Kun administratorer må læse audit-loggen.',
    );
  }

  // 6. Parse query-parametre
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const fromDate = parseIsoDate(firstQuery(req.query.from_date), defaultFrom);
  const toDate = parseIsoDate(firstQuery(req.query.to_date), now);

  if (fromDate.getTime() > toDate.getTime()) {
    return sendError(
      res,
      400,
      'invalid_date_range',
      'from_date skal være ≤ to_date.',
    );
  }

  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  const rawUserFilter = firstQuery(req.query.user_id) ?? null;
  const actionTypes = parseActionList(firstQuery(req.query.action));

  const { profileId: userIdFilter, resolvedFrom: userIdResolvedFrom } =
    await resolveUserFilter(sb, rawUserFilter);

  // Hvis kalder eksplicit sendte user_id og vi ikke kunne slå den op → 404
  // så admin ikke får tom liste stille og roligt.
  if (rawUserFilter && !userIdFilter) {
    return sendError(
      res,
      404,
      'user_not_found',
      `Ingen profil matcher user_id="${rawUserFilter}".`,
    );
  }

  // 7. Parallel fetch af alle fire underliggende tabeller
  const [ledger, biometricVerifications, walletPayouts, adminActions] =
    await Promise.all([
      fetchLedger(sb, fromIso, toIso, userIdFilter),
      fetchBiometricVerifications(sb, fromIso, toIso, userIdFilter),
      fetchWalletPayouts(sb, fromIso, toIso, userIdFilter),
      fetchAdminActions(sb, fromIso, toIso, userIdFilter, actionTypes),
    ]);

  const truncatedTables: string[] = [];
  if (ledger.truncated) truncatedTables.push('ledger');
  if (biometricVerifications.truncated) truncatedTables.push('biometric_verifications');
  if (walletPayouts.truncated) truncatedTables.push('wallet_payouts');
  if (adminActions.truncated) truncatedTables.push('admin_actions');

  const missingTables: string[] = [];
  if (ledger.missing) missingTables.push('ledger');
  if (biometricVerifications.missing) missingTables.push('biometric_verifications');
  if (walletPayouts.missing) missingTables.push('wallet_payouts');
  if (adminActions.missing) missingTables.push('admin_actions');

  const counts: AuditLogCounts = {
    ledger: ledger.rows.length,
    biometric_verifications: biometricVerifications.rows.length,
    wallet_payouts: walletPayouts.rows.length,
    admin_actions: adminActions.rows.length,
    total:
      ledger.rows.length +
      biometricVerifications.rows.length +
      walletPayouts.rows.length +
      adminActions.rows.length,
  };

  const payload: AuditLogPayload = {
    meta: {
      generated_at: new Date().toISOString(),
      requested_by_firebase_uid: trustedUid,
      requested_by_verified: uidVerified,
      requested_by_spoofed: uidSpoofed,
      admin_authorization_source: adminCheck.source,
      truncated_tables: truncatedTables,
      missing_tables: missingTables,
    },
    filter: {
      from_date: fromIso,
      to_date: toIso,
      user_id: rawUserFilter,
      user_id_resolved_to: userIdFilter,
      action_types: actionTypes,
    },
    counts,
    ledger: ledger.rows,
    biometric_verifications: biometricVerifications.rows,
    wallet_payouts: walletPayouts.rows,
    admin_actions: adminActions.rows,
  };

  logger.info('[audit-log] request served', {
    admin: trustedUid,
    from: fromIso,
    to: toIso,
    counts,
    truncated: truncatedTables,
    missing: missingTables,
  });

  // Referér ubrugte parametre eksplicit for at undgå TS6133/no-unused-vars
  // (userIdResolvedFrom bruges kun i logging over tid; behold reference).
  void userIdResolvedFrom;

  return sendSuccess(res, payload);
}
