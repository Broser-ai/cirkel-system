// cirkel-system/api/bins/ingest.ts
//
// Modul 11.1 — Weight-ingest fra IoT-hardware (smart bins).
//
// POST /api/bins/ingest
//   Headers:
//     X-Cirkel-Iot-Token: <IOT_INGEST_TOKEN>   (paakraevet, timing-safe compare)
//     Authorization: Bearer <firebase-id-token> (valgfrit — F3.8 audit-trail)
//     Content-Type: application/json
//   Body:
//     {
//       "bin_id": "AAR-0001",              // reference til smart_bins.bin_id
//       "added_weight_grams": 1234,        // delta siden sidste ping (>= 0)
//       "latitude": 56.15,                 // valgfrit — hardware GPS
//       "longitude": 10.20,                // valgfrit — hardware GPS
//       "volumetric_depth_cm": 42          // ultralyd: afstand top->affald (0..MAX)
//     }
//
// Adfaerd:
//   1) Verificerer IoT-bearer-token med crypto.timingSafeEqual.
//   2) Slaar bin_id op i smart_bins (kommune_navn brugt som fallback).
//   3) Hvis lat/lon findes → DAWA reverse-lookup for kommune-navn.
//   4) Regner nyt current_weight_kg + fill_level_percentage + operating_status.
//   5) UPDATE smart_bins.
//   6) INSERT i kommune_waste_stats med weight_delta_kg.
//
// Response (struktureret):
//   200 { success: true, data: { ... } }
//   400 { success: false, error: "<invalid_field>" }
//   401 { success: false, error: "iot_token_missing" | "iot_token_mismatch" }
//   404 { success: false, error: "bin_not_found" }
//   405 { success: false, error: "method_not_allowed" }
//   500 { success: false, error: "internal_error", detail?: string }
//   503 { success: false, error: "supabase_not_configured" | "iot_token_not_configured" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Konstanter ----------

/** Maks sensor-afstand (top-af-bin → bund). 100 cm = default; kan overrides via env. */
const BIN_MAX_DEPTH_CM_DEFAULT = 100;

/** Faktor for konvertering: g → kg. */
const GRAMS_PER_KG = 1000;

/** Fill-level threshold hvor operating_status skifter til 'Full'. */
const FULL_THRESHOLD_PCT = 95;

/** Header-navne. */
const IOT_TOKEN_HEADER = 'x-cirkel-iot-token';

/** Cache-Control paa fejl — IoT-ingest cachees aldrig. */
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';

// ---------- Types ----------

interface IngestBody {
  bin_id: string;
  added_weight_grams: number;
  latitude?: number;
  longitude?: number;
  volumetric_depth_cm: number;
  material_type?: string;
  co2_offset_g?: number;
}

interface SmartBinRow {
  bin_id: string;
  kommune_navn: string;
  latitude: number;
  longitude: number;
  current_weight_kg: number;
  fill_level_percentage: number;
  operating_status: string;
  is_active: boolean;
}

interface IngestSuccessData {
  bin_id: string;
  kommune_navn: string;
  current_weight_kg: number;
  fill_level_percentage: number;
  operating_status: string;
  weight_delta_kg: number;
  co2_offset_g: number | null;
  last_iot_ping: string;
  stat_id: string;
  dawa: {
    lookup_used: boolean;
    resolved_kommune: string | null;
    fallback_reason: string | null;
  };
  auth: {
    iot_token_verified: boolean;
    firebase_verified: boolean;
    firebase_uid: string | null;
  };
}

interface IngestSuccessResponse {
  success: true;
  data: IngestSuccessData;
}

interface IngestErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type IngestResponse = IngestSuccessResponse | IngestErrorResponse;

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/bins/ingest' } },
  });
  return cachedClient;
}

// ---------- Bearer-token verify (timing-safe) ----------

function extractHeader(
  headers: VercelRequest['headers'],
  name: string,
): string | null {
  const raw = headers[name];
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Verificerer IoT-bearer-token mod IOT_INGEST_TOKEN med konstant-tid-sammenligning.
 *
 * Statuskoder:
 *   'ok'                 → token matcher
 *   'not_configured'     → env mangler (503 → drift-fejl, ikke klient-fejl)
 *   'missing'            → header findes ikke (401)
 *   'mismatch'           → token forkert eller forkert laengde (401)
 */
function verifyIotToken(
  headers: VercelRequest['headers'],
): 'ok' | 'not_configured' | 'missing' | 'mismatch' {
  const expected = process.env.IOT_INGEST_TOKEN;
  if (!expected || expected.length === 0) return 'not_configured';

  const provided = extractHeader(headers, IOT_TOKEN_HEADER);
  if (provided === null) return 'missing';

  // timingSafeEqual kraever buffers af samme laengde.
  // Vi normaliserer til UTF-8 buffers og bailer hvis laengden ikke matcher —
  // laengden alene laekker ikke hemmeligheden, og selve sammenligningen er stadig
  // konstant-tid inden for buffer-laengden.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return 'mismatch';

  try {
    return timingSafeEqual(expectedBuf, providedBuf) ? 'ok' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

// ---------- DAWA reverse-lookup (lat/lon → kommune_navn) ----------

const dawaReverseCache = new Map<string, { navn: string | null; at: number }>();
const DAWA_CACHE_TTL_MS = 5 * 60_000;

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function kommuneFromLatLon(
  latitude: number,
  longitude: number,
): Promise<{ navn: string | null; reason: string | null }> {
  const cacheKey = `${roundCoord(latitude)},${roundCoord(longitude)}`;
  const cached = dawaReverseCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DAWA_CACHE_TTL_MS) {
    return { navn: cached.navn, reason: cached.navn === null ? 'cached_null' : null };
  }

  const url =
    `https://api.dataforsyningen.dk/kommuner/reverse` +
    `?x=${encodeURIComponent(String(longitude))}` +
    `&y=${encodeURIComponent(String(latitude))}` +
    `&format=json&srid=4326`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      dawaReverseCache.set(cacheKey, { navn: null, at: Date.now() });
      return { navn: null, reason: `dawa_http_${r.status}` };
    }
    const data = (await r.json()) as { navn?: unknown } | null;
    const navn =
      data && typeof data === 'object' && typeof data.navn === 'string'
        ? data.navn
        : null;
    dawaReverseCache.set(cacheKey, { navn, at: Date.now() });
    return { navn, reason: navn === null ? 'dawa_no_match' : null };
  } catch (err) {
    const reason = err instanceof Error ? `dawa_exception:${err.message}` : 'dawa_exception';
    return { navn: null, reason };
  }
}

// ---------- Body-validering ----------

interface ParsedBody {
  ok: true;
  body: IngestBody;
}
interface ParsedBodyError {
  ok: false;
  error: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseBody(raw: unknown): ParsedBody | ParsedBodyError {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'invalid_body' };
  }
  const b = raw as Record<string, unknown>;

  // bin_id: non-empty string, matcher smart_bins.bin_id VARCHAR(50).
  if (typeof b.bin_id !== 'string') return { ok: false, error: 'invalid_bin_id' };
  const bin_id = b.bin_id.trim();
  if (bin_id.length === 0 || bin_id.length > 50) {
    return { ok: false, error: 'invalid_bin_id' };
  }
  if (!/^[A-Za-z0-9_\-]+$/.test(bin_id)) {
    return { ok: false, error: 'invalid_bin_id' };
  }

  // added_weight_grams: >= 0 og rimeligt loft (50 kg pr. ping).
  if (!isFiniteNumber(b.added_weight_grams)) {
    return { ok: false, error: 'invalid_added_weight_grams' };
  }
  const added_weight_grams = b.added_weight_grams;
  if (added_weight_grams < 0 || added_weight_grams > 50_000) {
    return { ok: false, error: 'invalid_added_weight_grams' };
  }

  // volumetric_depth_cm: 0..500 cm — hardware-sensor giver typisk 5..300.
  if (!isFiniteNumber(b.volumetric_depth_cm)) {
    return { ok: false, error: 'invalid_volumetric_depth_cm' };
  }
  const volumetric_depth_cm = b.volumetric_depth_cm;
  if (volumetric_depth_cm < 0 || volumetric_depth_cm > 500) {
    return { ok: false, error: 'invalid_volumetric_depth_cm' };
  }

  // latitude/longitude valgfrie, men hvis sendt skal de vaere valide.
  let latitude: number | undefined;
  if (b.latitude !== undefined && b.latitude !== null) {
    if (!isFiniteNumber(b.latitude) || b.latitude < -90 || b.latitude > 90) {
      return { ok: false, error: 'invalid_latitude' };
    }
    latitude = b.latitude;
  }
  let longitude: number | undefined;
  if (b.longitude !== undefined && b.longitude !== null) {
    if (!isFiniteNumber(b.longitude) || b.longitude < -180 || b.longitude > 180) {
      return { ok: false, error: 'invalid_longitude' };
    }
    longitude = b.longitude;
  }
  if ((latitude === undefined) !== (longitude === undefined)) {
    return { ok: false, error: 'invalid_coordinate_pair' };
  }

  // material_type valgfri — kort streng, whitelist-agtig sanering.
  let material_type: string | undefined;
  if (b.material_type !== undefined && b.material_type !== null) {
    if (typeof b.material_type !== 'string') {
      return { ok: false, error: 'invalid_material_type' };
    }
    const mt = b.material_type.trim();
    if (mt.length === 0 || mt.length > 50 || !/^[A-Za-z0-9_\-\s]+$/.test(mt)) {
      return { ok: false, error: 'invalid_material_type' };
    }
    material_type = mt;
  }

  // co2_offset_g valgfri — beregnet upstream eller efterlades til DB-lag.
  let co2_offset_g: number | undefined;
  if (b.co2_offset_g !== undefined && b.co2_offset_g !== null) {
    if (!isFiniteNumber(b.co2_offset_g) || b.co2_offset_g < 0 || b.co2_offset_g > 1_000_000) {
      return { ok: false, error: 'invalid_co2_offset_g' };
    }
    co2_offset_g = b.co2_offset_g;
  }

  return {
    ok: true,
    body: {
      bin_id,
      added_weight_grams,
      latitude,
      longitude,
      volumetric_depth_cm,
      material_type,
      co2_offset_g,
    },
  };
}

// ---------- Fill-level beregning ----------

function computeFillLevelPercentage(
  volumetric_depth_cm: number,
  max_depth_cm: number,
): number {
  if (max_depth_cm <= 0) return 0;
  // Sensor = afstand fra top ned til overflade af affaldet.
  // Tom bin: sensor = max_depth. Fuld bin: sensor ~ 0.
  const filled = max_depth_cm - volumetric_depth_cm;
  const pct = (filled / max_depth_cm) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function nextOperatingStatus(currentStatus: string, fillPct: number): string {
  // Behold Maintenance/Offline hvis drift har sat dem manuelt.
  if (currentStatus === 'Maintenance' || currentStatus === 'Offline') {
    return currentStatus;
  }
  return fillPct >= FULL_THRESHOLD_PCT ? 'Full' : 'Operational';
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
  res.setHeader('X-Cirkel-Endpoint', 'api/bins/ingest');

  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    const body: IngestErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2) IoT-bearer-token (crypto.timingSafeEqual)
  const iotStatus = verifyIotToken(req.headers);
  if (iotStatus === 'not_configured') {
    const body: IngestErrorResponse = {
      success: false,
      error: 'iot_token_not_configured',
      detail: 'IOT_INGEST_TOKEN mangler i server-env.',
    };
    return res.status(503).json(body);
  }
  if (iotStatus === 'missing') {
    const body: IngestErrorResponse = {
      success: false,
      error: 'iot_token_missing',
      detail: `Header '${IOT_TOKEN_HEADER}' paakraevet.`,
    };
    return res.status(401).json(body);
  }
  if (iotStatus === 'mismatch') {
    console.warn('[api/bins/ingest] IoT-token mismatch fra IP:', req.headers['x-forwarded-for'] ?? 'ukendt');
    const body: IngestErrorResponse = { success: false, error: 'iot_token_mismatch' };
    return res.status(401).json(body);
  }

  // 3) F3.8 Firebase-audit (warn_only — IoT primaer, Firebase valgfri audit-trail)
  const firebaseVerify = await verifyFirebaseToken(req, { mode: 'warn_only' });
  const authInfo = {
    iot_token_verified: true,
    firebase_verified: firebaseVerify.verified === true,
    firebase_uid: firebaseVerify.uid ?? null,
  };

  // 4) Body parsing + validation
  const parsed = parseBody(req.body);
  if (!parsed.ok) {
    const body: IngestErrorResponse = { success: false, error: parsed.error };
    return res.status(400).json(body);
  }
  const {
    bin_id,
    added_weight_grams,
    latitude,
    longitude,
    volumetric_depth_cm,
    material_type,
    co2_offset_g,
  } = parsed.body;

  // 5) Supabase service-role klient
  const sb = getSupabase();
  if (!sb) {
    const body: IngestErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail: 'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  try {
    // 6) Hent nuvaerende bin-state (kommune-fallback + current_weight)
    const { data: binRow, error: binErr } = await sb
      .from('smart_bins')
      .select(
        'bin_id, kommune_navn, latitude, longitude, current_weight_kg, fill_level_percentage, operating_status, is_active',
      )
      .eq('bin_id', bin_id)
      .maybeSingle<SmartBinRow>();

    if (binErr) {
      console.error('[api/bins/ingest] Supabase select-fejl:', binErr.message, binErr.code);
      const body: IngestErrorResponse = {
        success: false,
        error: 'database_error',
        detail: binErr.message,
      };
      return res.status(500).json(body);
    }
    if (!binRow) {
      const body: IngestErrorResponse = { success: false, error: 'bin_not_found' };
      return res.status(404).json(body);
    }
    if (binRow.is_active === false) {
      const body: IngestErrorResponse = { success: false, error: 'bin_inactive' };
      return res.status(409).json(body);
    }

    // 7) DAWA reverse-lookup hvis vi har GPS fra hardware, ellers behold DB-kommune
    let resolvedKommune: string = binRow.kommune_navn;
    let dawaLookupUsed = false;
    let dawaResolvedKommune: string | null = null;
    let dawaFallbackReason: string | null = null;

    if (latitude !== undefined && longitude !== undefined) {
      dawaLookupUsed = true;
      const dawa = await kommuneFromLatLon(latitude, longitude);
      dawaResolvedKommune = dawa.navn;
      dawaFallbackReason = dawa.reason;
      if (dawa.navn && dawa.navn.length > 0) {
        resolvedKommune = dawa.navn;
      }
    }

    // 8) Beregn nyt state
    const maxDepthEnv = Number(process.env.BIN_MAX_DEPTH_CM);
    const maxDepth =
      Number.isFinite(maxDepthEnv) && maxDepthEnv > 0
        ? maxDepthEnv
        : BIN_MAX_DEPTH_CM_DEFAULT;

    const addedKg = added_weight_grams / GRAMS_PER_KG;
    const newWeightKg =
      Math.round((Number(binRow.current_weight_kg) + addedKg) * 1000) / 1000;
    const newFillPct = computeFillLevelPercentage(volumetric_depth_cm, maxDepth);
    const newStatus = nextOperatingStatus(binRow.operating_status, newFillPct);
    const nowIso = new Date().toISOString();

    // 9) UPDATE smart_bins
    const { data: updatedRows, error: updErr } = await sb
      .from('smart_bins')
      .update({
        current_weight_kg: newWeightKg,
        fill_level_percentage: newFillPct,
        operating_status: newStatus,
        kommune_navn: resolvedKommune,
        last_iot_ping: nowIso,
      })
      .eq('bin_id', bin_id)
      .select('bin_id, kommune_navn, current_weight_kg, fill_level_percentage, operating_status, last_iot_ping');

    if (updErr) {
      console.error('[api/bins/ingest] Supabase update-fejl:', updErr.message, updErr.code);
      const body: IngestErrorResponse = {
        success: false,
        error: 'database_error',
        detail: updErr.message,
      };
      return res.status(500).json(body);
    }
    if (!updatedRows || updatedRows.length === 0) {
      const body: IngestErrorResponse = { success: false, error: 'update_failed' };
      return res.status(500).json(body);
    }

    // 10) INSERT i kommune_waste_stats (weight_delta_kg — kan vaere 0 for ren fill-ping)
    const { data: statRow, error: statErr } = await sb
      .from('kommune_waste_stats')
      .insert({
        bin_id,
        kommune_navn: resolvedKommune,
        material_type: material_type ?? null,
        weight_delta_kg: Math.round(addedKg * 1000) / 1000,
        co2_offset_g: co2_offset_g ?? null,
        recorded_at: nowIso,
      })
      .select('stat_id')
      .single<{ stat_id: string }>();

    if (statErr) {
      // Kritisk: bin er allerede opdateret, men stat-insert fejlede.
      // Vi returnerer stadig 500 saa hardware ved den skal retry —
      // stats-tabellen er kilde-til-sandhed for rapportering (Modul 11.1).
      console.error(
        '[api/bins/ingest] kommune_waste_stats insert-fejl:',
        statErr.message,
        statErr.code,
        'bin_id=',
        bin_id,
      );
      const body: IngestErrorResponse = {
        success: false,
        error: 'stats_insert_failed',
        detail: statErr.message,
      };
      return res.status(500).json(body);
    }

    // 11) Success
    const success: IngestSuccessResponse = {
      success: true,
      data: {
        bin_id,
        kommune_navn: resolvedKommune,
        current_weight_kg: newWeightKg,
        fill_level_percentage: newFillPct,
        operating_status: newStatus,
        weight_delta_kg: Math.round(addedKg * 1000) / 1000,
        co2_offset_g: co2_offset_g ?? null,
        last_iot_ping: nowIso,
        stat_id: statRow?.stat_id ?? '',
        dawa: {
          lookup_used: dawaLookupUsed,
          resolved_kommune: dawaResolvedKommune,
          fallback_reason: dawaFallbackReason,
        },
        auth: authInfo,
      },
    };
    res.setHeader('X-Cirkel-Bin-Id', bin_id);
    res.setHeader('X-Cirkel-Fill-Pct', String(newFillPct));
    return res.status(200).json(success);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/bins/ingest] Uventet fejl:', message);
    const body: IngestErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}

// Rene type-eksporter saa tests / klienter kan importere schemaet uden run-time cost.
export type {
  IngestBody,
  IngestResponse,
  IngestSuccessResponse,
  IngestSuccessData,
  IngestErrorResponse,
};
