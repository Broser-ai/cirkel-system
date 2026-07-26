// cirkel-system/api/bins/index.ts
//
// GET /api/bins?kommune=Aarhus%20Kommune&status=Operational&limit=100&offset=0
//
// Returnerer aktive smart_bins filtreret pa kommune + status. Bruger Supabase
// service-role klienten (lazy init som resten af api/*.ts), F3.8-verify i
// warn_only-mode (public listing, men logger UID-spoof hvis token findes),
// og korte Cache-Control-headere sa endpointet er rate-limit-venligt bag CDN.
//
// Response-format (struktureret):
//   200: { success: true, data: { bins: SmartBin[], count: number, filters: {...} } }
//   400: { success: false, error: "<invalid_param>" }
//   405: { success: false, error: "method_not_allowed" }
//   503: { success: false, error: "supabase_not_configured" }
//   500: { success: false, error: "internal_error", detail?: string }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Types ----------

interface SmartBin {
  id: string;
  kommune: string | null;
  status: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity_liters: number | null;
  fill_level_percent: number | null;
  material_type: string | null;
  last_seen: string | null;
  installed_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

interface BinsFilters {
  kommune: string | null;
  status: string | null;
  limit: number;
  offset: number;
}

interface BinsSuccessResponse {
  success: true;
  data: {
    bins: SmartBin[];
    count: number;
    filters: BinsFilters;
    auth: {
      verified: boolean;
      uid: string | null;
    };
  };
}

interface BinsErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type BinsResponse = BinsSuccessResponse | BinsErrorResponse;

// ---------- Konstanter ----------

const ALLOWED_STATUSES = new Set<string>([
  'Operational',
  'Fault',
  'Maintenance',
  'Full',
  'Offline',
  'Retired',
]);

// Kommune-navne kan indeholde bogstaver, mellemrum, bindestreg og bade ae/oe/aa.
// Vi holder os til rimelige laengder for at undgae DoS via lange strings.
const KOMMUNE_PATTERN = /^[A-Za-zAEOEAaeoeaaÀ-ſ\s\-']{2,64}$/;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const CACHE_CONTROL_SUCCESS = 'public, max-age=15, s-maxage=30, stale-while-revalidate=60';
const CACHE_CONTROL_ERROR = 'no-store, max-age=0';

// Standard-projektionen: udvider ikke * fordi vi vil have et forudsigeligt skema
// og typet response. Kolonner der ikke findes returneres som null.
const BIN_COLUMNS = [
  'id',
  'kommune',
  'status',
  'location',
  'latitude',
  'longitude',
  'capacity_liters',
  'fill_level_percent',
  'material_type',
  'last_seen',
  'installed_at',
  'updated_at',
].join(', ');

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/bins' } },
  });
  return cachedClient;
}

// ---------- Query-string parsing ----------

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
  if (!/^\d{1,6}$/.test(raw)) return { value: fallback, ok: false };
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return { value: fallback, ok: false };
  if (n < min || n > max) return { value: fallback, ok: false };
  return { value: n, ok: true };
}

interface ParsedQuery {
  ok: true;
  filters: BinsFilters;
}

interface ParsedQueryError {
  ok: false;
  error: string;
}

function parseQuery(query: VercelRequest['query']): ParsedQuery | ParsedQueryError {
  const kommune = firstQueryValue(query.kommune);
  if (kommune !== null && !KOMMUNE_PATTERN.test(kommune)) {
    return { ok: false, error: 'invalid_kommune' };
  }

  const status = firstQueryValue(query.status);
  if (status !== null && !ALLOWED_STATUSES.has(status)) {
    return { ok: false, error: 'invalid_status' };
  }

  const limitRaw = firstQueryValue(query.limit);
  const limitParsed = parseIntBounded(limitRaw, DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (!limitParsed.ok) return { ok: false, error: 'invalid_limit' };

  const offsetRaw = firstQueryValue(query.offset);
  const offsetParsed = parseIntBounded(offsetRaw, 0, 0, 1_000_000);
  if (!offsetParsed.ok) return { ok: false, error: 'invalid_offset' };

  return {
    ok: true,
    filters: {
      kommune,
      status,
      limit: limitParsed.value,
      offset: offsetParsed.value,
    },
  };
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // 1) Method-guard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: BinsErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2) Query-string validation (svar 400 hvis invalid)
  const parsed = parseQuery(req.query);
  if (!parsed.ok) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: BinsErrorResponse = { success: false, error: parsed.error };
    return res.status(400).json(body);
  }
  const { filters } = parsed;

  // 3) F3.8: verify Firebase-token hvis det er sendt. warn_only-mode -
  //    endpointet er public listing, men vi logger UID-spoof og bereger
  //    "verified"-flag til response saa klienter kan se om deres token blev
  //    accepteret. Fejl her stopper IKKE requestet (verify returnerer ok:true
  //    i warn_only).
  const verifyResult = await verifyFirebaseToken(req, { mode: 'warn_only' });
  const authInfo = {
    verified: verifyResult.verified === true,
    uid: verifyResult.uid ?? null,
  };

  // 4) Supabase service-role klient
  const sb = getSupabase();
  if (!sb) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: BinsErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail: 'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  // 5) Query smart_bins
  try {
    let q = sb
      .from('smart_bins')
      .select(BIN_COLUMNS)
      .order('kommune', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(filters.offset, filters.offset + filters.limit - 1);

    if (filters.kommune !== null) {
      q = q.eq('kommune', filters.kommune);
    }
    if (filters.status !== null) {
      q = q.eq('status', filters.status);
    }

    const { data, error } = await q;

    if (error) {
      console.error('[api/bins] Supabase-fejl:', error.message, error.code);
      res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
      const body: BinsErrorResponse = {
        success: false,
        error: 'database_error',
        detail: error.message,
      };
      return res.status(500).json(body);
    }

    const rows: SmartBin[] = Array.isArray(data)
      ? (data as unknown as SmartBin[])
      : [];

    // 6) Success — rate-limit-friendly caching
    res.setHeader('Cache-Control', CACHE_CONTROL_SUCCESS);
    res.setHeader('X-Cirkel-Endpoint', 'api/bins');
    res.setHeader('X-Result-Count', String(rows.length));

    const body: BinsSuccessResponse = {
      success: true,
      data: {
        bins: rows,
        count: rows.length,
        filters,
        auth: authInfo,
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/bins] Uventet fejl:', message);
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: BinsErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}

// Ren type-eksport saa tests / klienter kan importere schema uden run-time cost.
export type { SmartBin, BinsFilters, BinsResponse, BinsSuccessResponse, BinsErrorResponse };
