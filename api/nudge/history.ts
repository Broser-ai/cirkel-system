// cirkel-system/api/nudge/history.ts
//
// Modul 11 · Smart Nudging · Historik-endpoint.
// Backing store: public.nudge_history
//   nudge_id     UUID PK
//   user_id      UUID FK → profiles.id
//   sent_at      TIMESTAMPTZ NOT NULL
//   message      TEXT NOT NULL
//   opened       BOOLEAN NOT NULL DEFAULT false
//   converted    BOOLEAN NOT NULL DEFAULT false
//   deep_link    TEXT
//   created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
//
// F3.8:
//   - GET only, ENFORCE-mode (historik er personhenfoerbar).
//   - Query-param user_id skal vaere klientens firebase-UID og skal matche
//     Authorization Bearer-tokenets uid; profil-id resolves server-side via
//     get_dashboard-RPC (samme moenster som andre F3.8-beskyttede endpoints).
//
// Endpoint:
//   GET /api/nudge/history
//        ?user_id=<firebase-uid>              (paakraevet, F3.8-verified)
//        &from_date=<ISO-8601>                (valgfri, inklusiv underkant)
//        &to_date=<ISO-8601>                  (valgfri, eksklusiv overkant)
//        &limit=<1..200>                      (valgfri, default 50)
//        &cursor=<opaque base64 cursor>       (valgfri, fra next_cursor i forrige side)
//
//   Response 200:
//     {
//       success: true,
//       data: {
//         items: NudgeHistoryItem[],           // sent_at DESC, tie-break nudge_id DESC
//         count: number,
//         filters: FilterEcho,
//         next_cursor: string | null,          // null naar sidste side er naaet
//         auth: AuthInfo,
//       }
//     }
//
// Response-format:
//   2xx { success: true,  data: {...} }
//   4xx { success: false, error: "<slug>", detail?: "<string>" }
//   5xx { success: false, error: "<slug>", detail?: "<string>" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';

// ---------- Konstanter ----------

const ENDPOINT_TAG = 'api/nudge/history';

const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const FIREBASE_UID_MIN_LEN = 1;
const FIREBASE_UID_MAX_LEN = 128;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SELECT-projektion: eksplicit skema saa vi altid returnerer forudsigelig JSON.
const NUDGE_COLUMNS = [
  'nudge_id',
  'user_id',
  'sent_at',
  'message',
  'opened',
  'converted',
  'deep_link',
].join(', ');

// ---------- Types ----------

export interface NudgeHistoryItem {
  nudge_id: string;
  sent_at: string;
  message: string;
  opened: boolean;
  converted: boolean;
  deep_link: string | null;
}

export interface FilterEcho {
  user_id: string;
  from_date: string | null;
  to_date: string | null;
  limit: number;
  has_cursor: boolean;
}

export interface AuthInfo {
  firebase_verified: boolean;
  firebase_uid: string;
  mode: 'enforce';
}

export interface HistorySuccessData {
  items: NudgeHistoryItem[];
  count: number;
  filters: FilterEcho;
  next_cursor: string | null;
  auth: AuthInfo;
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

export type NudgeHistoryResponse =
  | SuccessResponse<HistorySuccessData>
  | ErrorResponse;

// Row-shape som Supabase returnerer.
interface RawNudgeRow {
  nudge_id: string;
  user_id: string;
  sent_at: string;
  message: string;
  opened: boolean | null;
  converted: boolean | null;
  deep_link: string | null;
}

interface Cursor {
  sent_at: string; // ISO-8601 timestamp fra sidste row paa forrige side
  nudge_id: string; // tie-breaker for lige sent_at-vaerdier
}

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': ENDPOINT_TAG } },
  });
  return cachedClient;
}

// ---------- Response-helpers ----------

function sendSuccess<T>(
  res: VercelResponse,
  data: T,
  statusCode: number,
): VercelResponse {
  res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
  res.setHeader('X-Cirkel-Endpoint', ENDPOINT_TAG);
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
  res.setHeader('X-Cirkel-Endpoint', ENDPOINT_TAG);
  const body: ErrorResponse = { success: false, error };
  if (detail) body.detail = detail;
  return res.status(statusCode).json(body);
}

// ---------- Query-helpers ----------

function firstQueryValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseIntBounded(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): { value: number; ok: boolean } {
  if (raw === null) return { value: fallback, ok: true };
  if (!/^\d{1,7}$/.test(raw)) return { value: fallback, ok: false };
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return { value: fallback, ok: false };
  return { value: n, ok: true };
}

function parseIsoTimestamp(raw: string): string | null {
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function encodeCursor(c: Cursor): string {
  const json = JSON.stringify({ s: c.sent_at, n: c.nudge_id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length === 0 || buf.length > 512) return null;
    const parsed = JSON.parse(buf.toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { s?: unknown }).s !== 'string' ||
      typeof (parsed as { n?: unknown }).n !== 'string'
    ) {
      return null;
    }
    const s = (parsed as { s: string }).s;
    const n = (parsed as { n: string }).n;
    if (!UUID_REGEX.test(n)) return null;
    if (parseIsoTimestamp(s) === null) return null;
    return { sent_at: s, nudge_id: n };
  } catch {
    return null;
  }
}

function coerceRow(raw: RawNudgeRow): NudgeHistoryItem {
  return {
    nudge_id: raw.nudge_id,
    sent_at: raw.sent_at,
    message: raw.message,
    opened: raw.opened === true,
    converted: raw.converted === true,
    deep_link: raw.deep_link,
  };
}

// ---------- Firebase→profil-resolver ----------
//
// nudge_history.user_id peger paa profiles.id (UUID). Vi genbruger get_dashboard-RPC'en
// som allerede kender firebase→profil-broen — samme moenster som marketplace/list.ts.
async function resolveProfileId(
  sb: SupabaseClient,
  firebaseUid: string,
): Promise<string | null> {
  const { data, error } = await sb.rpc('get_dashboard', {
    p_firebase_uid: firebaseUid,
  });
  if (error) {
    console.error(
      `[${ENDPOINT_TAG}] resolveProfileId get_dashboard fejl: ${error.message}`,
    );
    return null;
  }
  const profile = (data as { profile?: { id?: unknown } } | null)?.profile;
  const id = profile?.id;
  if (typeof id === 'string' && UUID_REGEX.test(id)) return id;
  return null;
}

// ---------- Query-parsing ----------

interface ParsedQueryOk {
  ok: true;
  user_id: string;
  from_date: string | null;
  to_date: string | null;
  limit: number;
  cursor: Cursor | null;
}
interface ParsedQueryErr {
  ok: false;
  error: string;
}

function parseQuery(query: VercelRequest['query']): ParsedQueryOk | ParsedQueryErr {
  // user_id — firebase-UID, paakraevet.
  const userIdRaw = firstQueryValue(query.user_id);
  if (userIdRaw === null) {
    return { ok: false, error: 'user_id_required' };
  }
  if (
    userIdRaw.length < FIREBASE_UID_MIN_LEN ||
    userIdRaw.length > FIREBASE_UID_MAX_LEN
  ) {
    return { ok: false, error: 'invalid_user_id' };
  }

  // from_date — valgfri ISO-8601.
  const fromRaw = firstQueryValue(query.from_date);
  let from_date: string | null = null;
  if (fromRaw !== null) {
    const iso = parseIsoTimestamp(fromRaw);
    if (iso === null) return { ok: false, error: 'invalid_from_date' };
    from_date = iso;
  }

  // to_date — valgfri ISO-8601.
  const toRaw = firstQueryValue(query.to_date);
  let to_date: string | null = null;
  if (toRaw !== null) {
    const iso = parseIsoTimestamp(toRaw);
    if (iso === null) return { ok: false, error: 'invalid_to_date' };
    to_date = iso;
  }

  // from_date < to_date (kun hvis begge er sat).
  if (from_date !== null && to_date !== null) {
    if (Date.parse(from_date) >= Date.parse(to_date)) {
      return { ok: false, error: 'from_date_must_precede_to_date' };
    }
  }

  // limit.
  const limitParsed = parseIntBounded(
    firstQueryValue(query.limit),
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );
  if (!limitParsed.ok) return { ok: false, error: 'invalid_limit' };

  // cursor — opaque, dekodes til (sent_at, nudge_id).
  const cursorRaw = firstQueryValue(query.cursor);
  let cursor: Cursor | null = null;
  if (cursorRaw !== null) {
    cursor = decodeCursor(cursorRaw);
    if (cursor === null) return { ok: false, error: 'invalid_cursor' };
  }

  return {
    ok: true,
    user_id: userIdRaw,
    from_date,
    to_date,
    limit: limitParsed.value,
    cursor,
  };
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  res.setHeader('X-Cirkel-Endpoint', ENDPOINT_TAG);

  // 1) Method-guard — kun GET.
  const method = (req.method ?? '').toUpperCase();
  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'method_not_allowed');
  }

  // 2) Query-parsing.
  const parsed = parseQuery(req.query);
  if (!parsed.ok) {
    return sendError(res, 400, parsed.error);
  }

  // 3) Supabase service-role klient.
  const sb = getSupabase();
  if (!sb) {
    return sendError(
      res,
      503,
      'supabase_not_configured',
      'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    );
  }

  // 4) F3.8 ENFORCE — token skal vaere gyldigt OG matche query.user_id.
  //    Historik er personhenfoerbar → aldrig warn_only.
  let trustedUid: string;
  let verified: boolean;
  try {
    const v = await resolveTrustedUid(req, parsed.user_id);
    trustedUid = v.trusted_uid;
    verified = v.verified;
  } catch (err) {
    const anyErr = err as { status?: unknown; reason?: unknown; message?: unknown };
    const status = typeof anyErr.status === 'number' ? anyErr.status : 401;
    const reason =
      typeof anyErr.reason === 'string'
        ? anyErr.reason
        : typeof anyErr.message === 'string'
          ? anyErr.message
          : 'firebase_verify_failed';
    const errorSlug =
      status === 403
        ? 'firebase_uid_spoof'
        : status === 401
          ? 'firebase_token_invalid'
          : 'firebase_verify_failed';
    return sendError(res, status, errorSlug, reason);
  }

  const authInfo: AuthInfo = {
    firebase_verified: verified,
    firebase_uid: trustedUid,
    mode: 'enforce',
  };

  // 5) Resolve firebase→profil-id (bruges som DB-filter).
  const profileId = await resolveProfileId(sb, trustedUid);
  if (profileId === null) {
    return sendError(res, 404, 'profile_not_found', `firebase_uid=${trustedUid}`);
  }

  // 6) Byg og udfoer query. Vi henter limit+1 rows for at afgoere om der
  //    findes en naeste side uden et separat count-round-trip.
  const pageSize = parsed.limit;
  const fetchSize = pageSize + 1;

  const filtersEcho: FilterEcho = {
    user_id: trustedUid,
    from_date: parsed.from_date,
    to_date: parsed.to_date,
    limit: pageSize,
    has_cursor: parsed.cursor !== null,
  };

  try {
    let q = sb
      .from('nudge_history')
      .select(NUDGE_COLUMNS)
      .eq('user_id', profileId)
      .order('sent_at', { ascending: false })
      .order('nudge_id', { ascending: false })
      .limit(fetchSize);

    if (parsed.from_date !== null) {
      q = q.gte('sent_at', parsed.from_date);
    }
    if (parsed.to_date !== null) {
      q = q.lt('sent_at', parsed.to_date);
    }

    // Cursor-baseret keyset-pagination: (sent_at, nudge_id) < (cursor.sent_at, cursor.nudge_id)
    // udtrykt via PostgREST `or`-filter for tuple-sammenligning paa sammensat nyngle.
    if (parsed.cursor !== null) {
      const cSent = parsed.cursor.sent_at;
      const cId = parsed.cursor.nudge_id;
      q = q.or(
        `sent_at.lt.${cSent},and(sent_at.eq.${cSent},nudge_id.lt.${cId})`,
      );
    }

    const { data, error } = await q;

    if (error) {
      console.error(
        `[${ENDPOINT_TAG}] Supabase select-fejl: ${error.message} (code=${error.code})`,
      );
      return sendError(res, 500, 'database_error', error.message);
    }

    const rawRows: RawNudgeRow[] = Array.isArray(data)
      ? (data as unknown as RawNudgeRow[])
      : [];

    const hasMore = rawRows.length > pageSize;
    const pageRows = hasMore ? rawRows.slice(0, pageSize) : rawRows;
    const items: NudgeHistoryItem[] = pageRows.map(coerceRow);

    let next_cursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      next_cursor = encodeCursor({
        sent_at: last.sent_at,
        nudge_id: last.nudge_id,
      });
    }

    res.setHeader('X-Result-Count', String(items.length));

    return sendSuccess<HistorySuccessData>(
      res,
      {
        items,
        count: items.length,
        filters: filtersEcho,
        next_cursor,
        auth: authInfo,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${ENDPOINT_TAG}] Uventet fejl (GET): ${message}`);
    return sendError(res, 500, 'internal_error', message);
  }
}
