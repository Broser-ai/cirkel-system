// cirkel-system/api/bins/status/[id].ts
//
// Modul 6/11/12 - Single-bin status endpoint.
//
// GET /api/bins/status/:id
//   Path param :id → smart_bins.bin_id (VARCHAR(50), matcher migration 004).
//
// Ansvar:
//   1. Method-guard (svarer 405 hvis ikke GET).
//   2. Path-param validation (svarer 400 hvis :id mangler eller ugyldigt format).
//   3. F3.8: verify Firebase-token hvis sendt (warn_only-mode — endpointet
//      er public read jf. migration 004 RLS-policy "Public read active bins",
//      men UID-spoof logges og "verified"-flag returneres til klienten).
//   4. Supabase service-role klient (lazy init, samme pattern som api/scan.ts,
//      api/dashboard.ts og api/bins/index.ts).
//   5. Hent smart_bins-row via bin_id (maybeSingle → 404 hvis ikke fundet).
//   6. Hent kommune_waste_stats for de sidste 7 dage og aggreger:
//        - total_weight_delta_kg  (sum over vinduet)
//        - total_co2_offset_g     (sum over vinduet)
//        - event_count            (antal ping-events)
//        - by_material            (per material_type breakdown)
//        - daily                  (24-timers buckets, seneste-først)
//   7. Returner struktureret JSON-response.
//
// Response-format:
//   200: { success: true, data: { bin: SmartBin, waste_stats: WasteStatsWindow,
//                                 auth: AuthInfo } }
//   400: { success: false, error: "invalid_bin_id" }
//   404: { success: false, error: "bin_not_found" }
//   405: { success: false, error: "method_not_allowed" }
//   500: { success: false, error: "database_error" | "internal_error", detail?: string }
//   503: { success: false, error: "supabase_not_configured" }
//
// Depth: api/bins/status/[id].ts ligger to niveauer under api/, saa imports
// bruger ../../ for at ramme _verify-firebase-token.js. Vercel-serverless
// kraever .js-suffix paa lokale imports selv i .ts-kildefiler.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../../_verify-firebase-token.js';

// ---------- Types ----------

/** Rå række fra smart_bins (matcher migration 004 kolonner). */
interface SmartBinRow {
  bin_id: string;
  kommune_navn: string;
  latitude: number | string;
  longitude: number | string;
  current_weight_kg: number | string;
  fill_level_percentage: number;
  operating_status: OperatingStatus;
  last_iot_ping: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Normaliseret smart_bins-repraesentation (numeriske felter cast til number). */
interface SmartBin {
  bin_id: string;
  kommune_navn: string;
  latitude: number;
  longitude: number;
  current_weight_kg: number;
  fill_level_percentage: number;
  operating_status: OperatingStatus;
  last_iot_ping: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Enum-lignende alias — matcher CHECK-constraint i migration 004. */
type OperatingStatus = 'Operational' | 'Maintenance' | 'Offline' | 'Full';

/** Rå række fra kommune_waste_stats (migration 006). */
interface WasteStatRow {
  stat_id: string;
  bin_id: string;
  kommune_navn: string;
  material_type: string | null;
  weight_delta_kg: number | string;
  co2_offset_g: number | string | null;
  recorded_at: string;
}

/** Per-material aggregering. */
interface MaterialBreakdown {
  material_type: string;
  total_weight_kg: number;
  total_co2_offset_g: number;
  event_count: number;
}

/** Per-dag bucket (UTC, seneste-foerst). */
interface DailyBucket {
  day: string; // ISO YYYY-MM-DD
  total_weight_kg: number;
  total_co2_offset_g: number;
  event_count: number;
}

interface WasteStatsWindow {
  window_days: number;
  from_iso: string;
  to_iso: string;
  event_count: number;
  total_weight_delta_kg: number;
  total_co2_offset_g: number;
  by_material: MaterialBreakdown[];
  daily: DailyBucket[];
}

interface AuthInfo {
  verified: boolean;
  uid: string | null;
}

interface StatusSuccessResponse {
  success: true;
  data: {
    bin: SmartBin;
    waste_stats: WasteStatsWindow;
    auth: AuthInfo;
  };
}

interface StatusErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type StatusResponse = StatusSuccessResponse | StatusErrorResponse;

// ---------- Konstanter ----------

const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** VARCHAR(50) i migration 004 — kun alfanumerisk + _ og -. Matcher ingest.ts. */
const BIN_ID_PATTERN = /^[A-Za-z0-9_\-]{1,50}$/;

const BIN_COLUMNS = [
  'bin_id',
  'kommune_navn',
  'latitude',
  'longitude',
  'current_weight_kg',
  'fill_level_percentage',
  'operating_status',
  'last_iot_ping',
  'is_active',
  'created_at',
  'updated_at',
].join(', ');

const STAT_COLUMNS = [
  'stat_id',
  'bin_id',
  'kommune_navn',
  'material_type',
  'weight_delta_kg',
  'co2_offset_g',
  'recorded_at',
].join(', ');

/** Fornuftigt loft — 7 dage × 1 ping/min per bin = 10 080. */
const STATS_ROW_LIMIT = 20_000;

const CACHE_CONTROL_SUCCESS =
  'public, max-age=15, s-maxage=30, stale-while-revalidate=60';
const CACHE_CONTROL_ERROR = 'no-store, max-age=0';

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/bins/status/[id]' } },
  });
  return cachedClient;
}

// ---------- Helpers ----------

function firstQueryValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Sikker number-cast (Supabase kan returnere NUMERIC som string). */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Rund til 3 decimaler for kg, 2 for co2/pct. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normaliser rå DB-række til klient-vendt SmartBin. */
function normalizeBin(row: SmartBinRow): SmartBin {
  return {
    bin_id: row.bin_id,
    kommune_navn: row.kommune_navn,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    current_weight_kg: round3(toNumber(row.current_weight_kg)),
    fill_level_percentage:
      typeof row.fill_level_percentage === 'number'
        ? row.fill_level_percentage
        : Math.round(toNumber(row.fill_level_percentage)),
    operating_status: row.operating_status,
    last_iot_ping: row.last_iot_ping,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** UTC dags-nøgle YYYY-MM-DD fra ISO-timestamp. */
function dayKeyUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '1970-01-01';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Aggreger raa stat-rows til vindue-summary + material + daily buckets. */
function aggregate(
  rows: WasteStatRow[],
  windowDays: number,
  fromIso: string,
  toIso: string,
): WasteStatsWindow {
  let totalWeight = 0;
  let totalCo2 = 0;

  const materialMap = new Map<string, MaterialBreakdown>();
  const dailyMap = new Map<string, DailyBucket>();

  for (const r of rows) {
    const w = toNumber(r.weight_delta_kg);
    const c = r.co2_offset_g === null ? 0 : toNumber(r.co2_offset_g);
    totalWeight += w;
    totalCo2 += c;

    const matKey = r.material_type ?? 'Ukendt';
    const existingMat = materialMap.get(matKey);
    if (existingMat) {
      existingMat.total_weight_kg += w;
      existingMat.total_co2_offset_g += c;
      existingMat.event_count += 1;
    } else {
      materialMap.set(matKey, {
        material_type: matKey,
        total_weight_kg: w,
        total_co2_offset_g: c,
        event_count: 1,
      });
    }

    const dKey = dayKeyUtc(r.recorded_at);
    const existingDay = dailyMap.get(dKey);
    if (existingDay) {
      existingDay.total_weight_kg += w;
      existingDay.total_co2_offset_g += c;
      existingDay.event_count += 1;
    } else {
      dailyMap.set(dKey, {
        day: dKey,
        total_weight_kg: w,
        total_co2_offset_g: c,
        event_count: 1,
      });
    }
  }

  const by_material: MaterialBreakdown[] = Array.from(materialMap.values())
    .map((m) => ({
      material_type: m.material_type,
      total_weight_kg: round3(m.total_weight_kg),
      total_co2_offset_g: round2(m.total_co2_offset_g),
      event_count: m.event_count,
    }))
    .sort((a, b) => b.total_weight_kg - a.total_weight_kg);

  const daily: DailyBucket[] = Array.from(dailyMap.values())
    .map((d) => ({
      day: d.day,
      total_weight_kg: round3(d.total_weight_kg),
      total_co2_offset_g: round2(d.total_co2_offset_g),
      event_count: d.event_count,
    }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  return {
    window_days: windowDays,
    from_iso: fromIso,
    to_iso: toIso,
    event_count: rows.length,
    total_weight_delta_kg: round3(totalWeight),
    total_co2_offset_g: round2(totalCo2),
    by_material,
    daily,
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
    const body: StatusErrorResponse = {
      success: false,
      error: 'method_not_allowed',
    };
    return res.status(405).json(body);
  }

  // 2) Path-param validation
  //    Vercel serverless mapper [id] → req.query.id.
  const rawId = firstQueryValue(req.query.id);
  if (rawId === null || !BIN_ID_PATTERN.test(rawId)) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: StatusErrorResponse = {
      success: false,
      error: 'invalid_bin_id',
      detail:
        'Path-param :id skal matche /^[A-Za-z0-9_-]{1,50}$/ jf. smart_bins.bin_id.',
    };
    return res.status(400).json(body);
  }
  const bin_id = rawId;

  // 3) F3.8 — verify Firebase-token hvis sendt. Public read jf. migration 004
  //    RLS-policy; warn_only saa endpointet fungerer uden token.
  const verifyResult = await verifyFirebaseToken(req, { mode: 'warn_only' });
  const authInfo: AuthInfo = {
    verified: verifyResult.verified === true,
    uid: verifyResult.uid ?? null,
  };

  // 4) Supabase service-role klient
  const sb = getSupabase();
  if (!sb) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: StatusErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail:
        'SUPABASE_URL/VITE_SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  // 5) + 6) — Hent bin + stats vinduet (parallelt)
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - WINDOW_MS);
  const toIso = toDate.toISOString();
  const fromIso = fromDate.toISOString();

  try {
    const [binResult, statsResult] = await Promise.all([
      sb
        .from('smart_bins')
        .select(BIN_COLUMNS)
        .eq('bin_id', bin_id)
        .maybeSingle<SmartBinRow>(),
      sb
        .from('kommune_waste_stats')
        .select(STAT_COLUMNS)
        .eq('bin_id', bin_id)
        .gte('recorded_at', fromIso)
        .lte('recorded_at', toIso)
        .order('recorded_at', { ascending: false })
        .limit(STATS_ROW_LIMIT),
    ]);

    if (binResult.error) {
      console.error(
        '[api/bins/status/[id]] Supabase select smart_bins-fejl:',
        binResult.error.message,
        binResult.error.code,
      );
      res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
      const body: StatusErrorResponse = {
        success: false,
        error: 'database_error',
        detail: binResult.error.message,
      };
      return res.status(500).json(body);
    }

    if (!binResult.data) {
      res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
      const body: StatusErrorResponse = {
        success: false,
        error: 'bin_not_found',
        detail: `Ingen smart_bins-row med bin_id="${bin_id}".`,
      };
      return res.status(404).json(body);
    }

    if (statsResult.error) {
      console.error(
        '[api/bins/status/[id]] Supabase select kommune_waste_stats-fejl:',
        statsResult.error.message,
        statsResult.error.code,
      );
      res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
      const body: StatusErrorResponse = {
        success: false,
        error: 'database_error',
        detail: statsResult.error.message,
      };
      return res.status(500).json(body);
    }

    const bin = normalizeBin(binResult.data);
    const statRows: WasteStatRow[] = Array.isArray(statsResult.data)
      ? (statsResult.data as unknown as WasteStatRow[])
      : [];
    const waste_stats = aggregate(statRows, WINDOW_DAYS, fromIso, toIso);

    // 7) Success — CDN-cache-venligt, kortvarigt.
    res.setHeader('Cache-Control', CACHE_CONTROL_SUCCESS);
    res.setHeader('X-Cirkel-Endpoint', 'api/bins/status/[id]');
    res.setHeader('X-Cirkel-Bin-Id', bin.bin_id);
    res.setHeader('X-Cirkel-Stats-Count', String(waste_stats.event_count));

    const body: StatusSuccessResponse = {
      success: true,
      data: {
        bin,
        waste_stats,
        auth: authInfo,
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/bins/status/[id]] Uventet fejl:', message);
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: StatusErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}

// Rene type-eksporter saa tests / klienter kan importere schema uden run-time cost.
export type {
  SmartBin,
  OperatingStatus,
  WasteStatsWindow,
  MaterialBreakdown,
  DailyBucket,
  AuthInfo,
  StatusResponse,
  StatusSuccessResponse,
  StatusErrorResponse,
};
