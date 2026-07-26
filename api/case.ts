// cirkel-system/api/case.ts
//
// Modul 5.2 — Case Management (fraud-review + disputes + refunds + complaints).
// Backing store: migration 007_cases.sql (public.cases).
// F3.8: alle metoder verificerer Firebase-ID-token via resolveTrustedUid før
//       skrivning eller listning. RLS på cases blokerer al client-side adgang,
//       så vi bruger SUPABASE_SERVICE_ROLE_KEY på server-siden (bypass RLS)
//       og håndhæver ejer/assignee-permissions i handleren selv.
//
// Endpoints:
//   GET   /api/case?firebaseUid=<uid>&role=owner|assignee&status=<status>
//         &case_type=<type>&limit=<n>&offset=<n>
//         → liste af sager (default: role=owner)
//   POST  /api/case
//         body: { firebaseUid, case_type, description, scan_id?, priority? }
//         → opret ny sag (status=open, priority=3 default)
//   PATCH /api/case
//         body: { firebaseUid, case_id, status?, resolution?, assigned_to?, priority? }
//         → opdater eksisterende sag (kun ejer eller assignee)
//
// Response-format (struktureret):
//   200/201 { success: true, data: { ... } }
//   4xx/5xx { success: false, error: "<slug>", detail?: "<string>" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from './_verify-firebase-token.js';
import logger from '../src/lib/logger.js';

// ---------- Domænetyper (afspejler migration 007) ----------

type CaseType = 'fraud_review' | 'dispute' | 'refund' | 'complaint';
type CaseStatus = 'open' | 'in_review' | 'resolved' | 'rejected';
type CaseRole = 'owner' | 'assignee';

interface CaseRow {
  case_id: string;
  user_id: string;
  scan_id: string | null;
  case_type: CaseType;
  status: CaseStatus;
  assigned_to: string | null;
  priority: number;
  description: string;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

interface CaseCreateBody {
  firebaseUid: string;
  case_type: CaseType;
  description: string;
  scan_id?: string;
  priority?: number;
}

interface CasePatchBody {
  firebaseUid: string;
  case_id: string;
  status?: CaseStatus;
  resolution?: string | null;
  assigned_to?: string | null;
  priority?: number;
}

interface ListSuccessData {
  cases: CaseRow[];
  total: number;
  limit: number;
  offset: number;
  role: CaseRole;
  auth: { firebase_verified: boolean; trusted_uid: string };
}

interface CaseEnvelope {
  case: CaseRow;
  auth: { firebase_verified: boolean; trusted_uid: string };
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

// ---------- Konstanter ----------

const VALID_CASE_TYPES: readonly CaseType[] = [
  'fraud_review',
  'dispute',
  'refund',
  'complaint',
];

const VALID_STATUSES: readonly CaseStatus[] = [
  'open',
  'in_review',
  'resolved',
  'rejected',
];

const MIN_PRIORITY = 1;
const MAX_PRIORITY = 5;
const DEFAULT_PRIORITY = 3;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MIN_DESCRIPTION_LEN = 3;
const MAX_DESCRIPTION_LEN = 8000;
const MAX_RESOLUTION_LEN = 8000;

const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/case' } },
  });
  return cachedClient;
}

// ---------- Type-guards + parsere ----------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function isCaseType(value: unknown): value is CaseType {
  return typeof value === 'string' && VALID_CASE_TYPES.includes(value as CaseType);
}

function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as CaseStatus);
}

function parsePriority(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isInteger(n) || n < MIN_PRIORITY || n > MAX_PRIORITY) return null;
  return n;
}

function parseIntSafe(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function firstQuery(
  raw: string | string[] | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

// ---------- Firebase→profil-resolver ----------
//
// process_scan bruger p_firebase_uid direkte, men cases.user_id peger på
// profiles.id (UUID). Vi genbruger get_dashboard-RPC'en som allerede kender
// firebase→profil-broen — den returnerer profile.id som vi kan indsætte i
// cases-tabellen. En 500 fra RPC'en tolkes som "profil ikke fundet" og
// mappes til 404 udadtil (klient kan ikke skelne).
async function resolveProfileId(
  sb: SupabaseClient,
  firebaseUid: string,
): Promise<string | null> {
  const { data, error } = await sb.rpc('get_dashboard', {
    p_firebase_uid: firebaseUid,
  });
  if (error) {
    logger.error('[case] resolveProfileId get_dashboard fejl', error);
    return null;
  }
  const profile = (data as { profile?: { id?: unknown } } | null)?.profile;
  const id = profile?.id;
  return isUuid(id) ? id : null;
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

// ---------- F3.8 verify-wrapper ----------
//
// Returnerer det trusted firebase UID + verified-flag, eller sender en
// fejl-response og returnerer null (så caller kan bail out).
async function verifyOrReject(
  req: VercelRequest,
  res: VercelResponse,
  clientProvidedUid: string,
): Promise<{ trustedUid: string; verified: boolean } | null> {
  try {
    const v = await resolveTrustedUid(req, clientProvidedUid);
    return { trustedUid: v.trusted_uid, verified: v.verified };
  } catch (err: unknown) {
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? ((err as { status: number }).status)
        : 401;
    const reason =
      typeof (err as { reason?: unknown })?.reason === 'string'
        ? (err as { reason: string }).reason
        : err instanceof Error
          ? err.message
          : 'firebase_verify_failed';
    sendError(res, status, 'firebase_verify_failed', reason);
    return null;
  }
}

// ---------- GET (liste) ----------

async function handleList(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<VercelResponse> {
  const firebaseUid = firstQuery(req.query.firebaseUid) ?? '';
  if (!isNonEmptyString(firebaseUid)) {
    return sendError(res, 400, 'firebaseUid_required');
  }

  const auth = await verifyOrReject(req, res, firebaseUid);
  if (!auth) return res;

  const profileId = await resolveProfileId(sb, auth.trustedUid);
  if (!profileId) return sendError(res, 404, 'profile_not_found');

  const roleRaw = firstQuery(req.query.role);
  const role: CaseRole = roleRaw === 'assignee' ? 'assignee' : 'owner';

  const statusRaw = firstQuery(req.query.status);
  const caseTypeRaw = firstQuery(req.query.case_type);

  const limit = Math.min(
    Math.max(parseIntSafe(firstQuery(req.query.limit), DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseIntSafe(firstQuery(req.query.offset), 0), 0);

  let query = sb.from('cases').select('*', { count: 'exact' });

  if (role === 'assignee') {
    query = query.eq('assigned_to', profileId);
  } else {
    query = query.eq('user_id', profileId);
  }

  if (statusRaw !== undefined) {
    if (!isCaseStatus(statusRaw)) return sendError(res, 400, 'status_invalid');
    query = query.eq('status', statusRaw);
  }

  if (caseTypeRaw !== undefined) {
    if (!isCaseType(caseTypeRaw)) return sendError(res, 400, 'case_type_invalid');
    query = query.eq('case_type', caseTypeRaw);
  }

  query = query
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return sendError(res, 500, 'db_query_failed', error.message);

  const rows = (data ?? []) as CaseRow[];
  const payload: ListSuccessData = {
    cases: rows,
    total: count ?? rows.length,
    limit,
    offset,
    role,
    auth: {
      firebase_verified: auth.verified,
      trusted_uid: auth.trustedUid,
    },
  };
  return sendSuccess(res, payload);
}

// ---------- POST (opret) ----------

async function handleCreate(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<VercelResponse> {
  const body = (req.body ?? {}) as Partial<CaseCreateBody>;
  const { firebaseUid, case_type, description, scan_id, priority } = body;

  if (!isNonEmptyString(firebaseUid)) {
    return sendError(res, 400, 'firebaseUid_required');
  }
  if (!isCaseType(case_type)) {
    return sendError(
      res,
      400,
      'case_type_invalid',
      `Expected one of: ${VALID_CASE_TYPES.join(', ')}`,
    );
  }
  if (!isNonEmptyString(description)) {
    return sendError(res, 400, 'description_required');
  }
  const trimmedDescription = description.trim();
  if (trimmedDescription.length < MIN_DESCRIPTION_LEN) {
    return sendError(res, 400, 'description_too_short');
  }
  if (trimmedDescription.length > MAX_DESCRIPTION_LEN) {
    return sendError(res, 400, 'description_too_long');
  }
  if (scan_id !== undefined && scan_id !== null && !isUuid(scan_id)) {
    return sendError(res, 400, 'scan_id_invalid');
  }

  let priorityValue = DEFAULT_PRIORITY;
  if (priority !== undefined && priority !== null) {
    const parsed = parsePriority(priority);
    if (parsed === null) return sendError(res, 400, 'priority_invalid');
    priorityValue = parsed;
  }

  const auth = await verifyOrReject(req, res, firebaseUid);
  if (!auth) return res;

  const profileId = await resolveProfileId(sb, auth.trustedUid);
  if (!profileId) return sendError(res, 404, 'profile_not_found');

  const insertRow = {
    user_id: profileId,
    case_type,
    description: trimmedDescription,
    priority: priorityValue,
    scan_id: scan_id ?? null,
  };

  const { data, error } = await sb
    .from('cases')
    .insert(insertRow)
    .select('*')
    .single();

  if (error) {
    // 23503 = foreign_key_violation (fx ugyldigt scan_id)
    if (error.code === '23503') {
      return sendError(res, 400, 'foreign_key_violation', error.message);
    }
    return sendError(res, 500, 'db_insert_failed', error.message);
  }

  const payload: CaseEnvelope = {
    case: data as CaseRow,
    auth: {
      firebase_verified: auth.verified,
      trusted_uid: auth.trustedUid,
    },
  };
  return sendSuccess(res, payload, 201);
}

// ---------- PATCH (opdater status) ----------

async function handlePatch(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<VercelResponse> {
  const body = (req.body ?? {}) as Partial<CasePatchBody>;
  const { firebaseUid, case_id, status, resolution, assigned_to, priority } =
    body;

  if (!isNonEmptyString(firebaseUid)) {
    return sendError(res, 400, 'firebaseUid_required');
  }
  if (!isUuid(case_id)) {
    return sendError(res, 400, 'case_id_invalid');
  }

  const patch: Record<string, string | number | null> = {};

  if (status !== undefined) {
    if (!isCaseStatus(status)) return sendError(res, 400, 'status_invalid');
    patch.status = status;
  }

  if (resolution !== undefined) {
    if (resolution === null) {
      patch.resolution = null;
    } else if (typeof resolution !== 'string') {
      return sendError(res, 400, 'resolution_invalid');
    } else if (resolution.length > MAX_RESOLUTION_LEN) {
      return sendError(res, 400, 'resolution_too_long');
    } else {
      const trimmed = resolution.trim();
      patch.resolution = trimmed.length === 0 ? null : trimmed;
    }
  }

  if (assigned_to !== undefined) {
    if (assigned_to === null) {
      patch.assigned_to = null;
    } else if (!isUuid(assigned_to)) {
      return sendError(res, 400, 'assigned_to_invalid');
    } else {
      patch.assigned_to = assigned_to;
    }
  }

  if (priority !== undefined && priority !== null) {
    const parsed = parsePriority(priority);
    if (parsed === null) return sendError(res, 400, 'priority_invalid');
    patch.priority = parsed;
  }

  if (Object.keys(patch).length === 0) {
    return sendError(res, 400, 'no_patch_fields');
  }

  const auth = await verifyOrReject(req, res, firebaseUid);
  if (!auth) return res;

  const profileId = await resolveProfileId(sb, auth.trustedUid);
  if (!profileId) return sendError(res, 404, 'profile_not_found');

  // Fetch eksisterende sag → permission-check + status-transitions
  const { data: existing, error: fetchErr } = await sb
    .from('cases')
    .select('case_id, user_id, assigned_to, status')
    .eq('case_id', case_id)
    .maybeSingle();

  if (fetchErr) return sendError(res, 500, 'db_fetch_failed', fetchErr.message);
  if (!existing) return sendError(res, 404, 'case_not_found');

  const row = existing as Pick<
    CaseRow,
    'case_id' | 'user_id' | 'assigned_to' | 'status'
  >;
  const isOwner = row.user_id === profileId;
  const isAssignee = row.assigned_to === profileId;

  if (!isOwner && !isAssignee) {
    return sendError(res, 403, 'forbidden');
  }

  // Business-rules:
  //   - status/resolution/assigned_to må kun ændres af assignee (sagsbehandler)
  //   - priority må ejer også ændre (fx eskalere egen dispute)
  //   - resolved/rejected sager er låst (audit-trail) — kun nyt assignment
  //     eller priority-genåbning er ikke tilladt herfra
  const wantsAdminChange =
    patch.status !== undefined ||
    patch.resolution !== undefined ||
    patch.assigned_to !== undefined;

  if (wantsAdminChange && !isAssignee) {
    return sendError(res, 403, 'only_assignee_can_close');
  }

  if (
    (row.status === 'resolved' || row.status === 'rejected') &&
    Object.keys(patch).length > 0
  ) {
    return sendError(res, 409, 'case_locked', `status=${row.status}`);
  }

  const { data: updated, error: updateErr } = await sb
    .from('cases')
    .update(patch)
    .eq('case_id', case_id)
    .select('*')
    .single();

  if (updateErr) {
    if (updateErr.code === '23503') {
      return sendError(res, 400, 'foreign_key_violation', updateErr.message);
    }
    return sendError(res, 500, 'db_update_failed', updateErr.message);
  }

  const payload: CaseEnvelope = {
    case: updated as CaseRow,
    auth: {
      firebase_verified: auth.verified,
      trusted_uid: auth.trustedUid,
    },
  };
  return sendSuccess(res, payload);
}

// ---------- Handler-dispatcher ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  const method = (req.method ?? 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return sendError(res, 405, 'method_not_allowed');
  }

  const sb = getSupabase();
  if (!sb) return sendError(res, 503, 'supabase_not_configured');

  try {
    if (method === 'GET') return await handleList(req, res, sb);
    if (method === 'POST') return await handleCreate(req, res, sb);
    return await handlePatch(req, res, sb);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'unknown internal error';
    logger.error('[case] internal_error', err);
    return sendError(res, 500, 'internal_error', message);
  }
}
