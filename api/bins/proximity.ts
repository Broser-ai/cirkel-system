// cirkel-system/api/bins/proximity.ts
//
// Modul 13.2 — Proximity grid for map-display.
//
// GET /api/bins/proximity?user_lat=56.1567&user_long=10.2107&max_distance_km=2.5
//    [&kommune=Aarhus%20Kommune][&status=Operational][&limit=200]
//
// Ansvar:
//   1. Method-guard (svarer 405 hvis ikke GET).
//   2. Query-parsing + validation (svarer 400 hvis felter mangler eller er ugyldige).
//   3. F3.8: verify Firebase-token hvis sendt (warn_only-mode — public map-endpoint,
//      men UID-spoof logges og "verified"-flag rapporteres tilbage).
//   4. Supabase service-role klient (lazy init som resten af api/*.ts).
//   5. Hent smart_bins (bounding-box prefilter for at spare rows), beregn
//      Haversine-distance på server, filtrer på max_distance_km, sortér stigende.
//   6. Tilføj routing_directive per bin:
//        - DIVERT_CONSUMER_ROUTING  hvis status er "Full" eller "Blocked"
//        - PROCEED_DIRECT           ellers
//   7. Returnér struktureret JSON-response.
//
// Response-format:
//   200: { success: true, data: { bins: ProximityBin[], count: number,
//                                 query: {...}, auth: {...} } }
//   400: { success: false, error: "<invalid_param>" }
//   405: { success: false, error: "method_not_allowed" }
//   500: { success: false, error: "database_error" | "internal_error", detail?: string }
//   503: { success: false, error: "supabase_not_configured" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Types ----------

type RoutingDirective = 'DIVERT_CONSUMER_ROUTING' | 'PROCEED_DIRECT';

interface ProximityQuery {
  user_lat: number;
  user_long: number;
  max_distance_km: number;
  kommune: string | null;
  status: string | null;
  limit: number;
}

interface ProximityBin {
  id: string;
  kommune: string | null;
  status: string | null;
  location: string | null;
  latitude: number;
  longitude: number;
  capacity_liters: number | null;
  fill_level_percent: number | null;
  material_type: string | null;
  last_seen: string | null;
  distance_km: number;
  routing_directive: RoutingDirective;
}

interface ProximitySuccessResponse {
  success: true;
  data: {
    bins: ProximityBin[];
    count: number;
    query: ProximityQuery;
    auth: {
      verified: boolean;
      uid: string | null;
    };
  };
}

interface ProximityErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type ProximityResponse = ProximitySuccessResponse | ProximityErrorResponse;

interface SmartBinRow {
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
}

// ---------- Konstanter ----------

const ALLOWED_STATUSES = new Set<string>([
  'Operational',
  'Fault',
  'Maintenance',
  'Full',
  'Offline',
  'Retired',
  'Blocked',
]);

// Statuser der skal dirigere brugeren væk fra bin'et (Modul 13.2).
const DIVERT_STATUSES = new Set<string>(['Full', 'Blocked']);

const KOMMUNE_PATTERN = /^[A-Za-zAEOEAaeoeaaÀ-ſ\s\-']{2,64}$/;

// Danmark-bounding-box (grove hegn — beskytter mod urimelige input).
// Latitude 54.5..58.0, Longitude 8.0..15.5.
const LAT_MIN = -90;
const LAT_MAX = 90;
const LON_MIN = -180;
const LON_MAX = 180;

const MAX_DISTANCE_KM_HARD_LIMIT = 500;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const EARTH_RADIUS_KM = 6371.0088;

const CACHE_CONTROL_SUCCESS = 'public, max-age=15, s-maxage=30, stale-while-revalidate=60';
const CACHE_CONTROL_ERROR = 'no-store, max-age=0';

const SMART_BINS_TABLE = 'smart_bins';
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
    global: { headers: { 'x-cirkel-endpoint': 'api/bins/proximity' } },
  });
  return cachedClient;
}

// ---------- Query-parsing ----------

function firstQueryValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseFloatBounded(
  raw: string | null,
  min: number,
  max: number,
): { value: number; ok: boolean } {
  if (raw === null) return { value: NaN, ok: false };
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return { value: NaN, ok: false };
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return { value: NaN, ok: false };
  if (n < min || n > max) return { value: NaN, ok: false };
  return { value: n, ok: true };
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
  if (!Number.isFinite(n)) return { value: fallback, ok: false };
  if (n < min || n > max) return { value: fallback, ok: false };
  return { value: n, ok: true };
}

interface ParsedQueryOk {
  ok: true;
  query: ProximityQuery;
}

interface ParsedQueryErr {
  ok: false;
  error: string;
}

function parseQuery(query: VercelRequest['query']): ParsedQueryOk | ParsedQueryErr {
  const latRaw = firstQueryValue(query.user_lat);
  const latParsed = parseFloatBounded(latRaw, LAT_MIN, LAT_MAX);
  if (!latParsed.ok) return { ok: false, error: 'invalid_user_lat' };

  const lonRaw = firstQueryValue(query.user_long);
  const lonParsed = parseFloatBounded(lonRaw, LON_MIN, LON_MAX);
  if (!lonParsed.ok) return { ok: false, error: 'invalid_user_long' };

  const distRaw = firstQueryValue(query.max_distance_km);
  const distParsed = parseFloatBounded(distRaw, 0.01, MAX_DISTANCE_KM_HARD_LIMIT);
  if (!distParsed.ok) return { ok: false, error: 'invalid_max_distance_km' };

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

  return {
    ok: true,
    query: {
      user_lat: latParsed.value,
      user_long: lonParsed.value,
      max_distance_km: distParsed.value,
      kommune,
      status,
      limit: limitParsed.value,
    },
  };
}

// ---------- Domain-logik ----------

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine great-circle distance i kilometer mellem to lat/long-punkter.
 * Nøjagtig nok til consumer-routing (fejl < 0.5% for typiske afstande).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Routing-direktiv per bin (Modul 13.2):
 *   - DIVERT_CONSUMER_ROUTING  hvis status er "Full" eller "Blocked".
 *   - PROCEED_DIRECT           ellers.
 * Bin uden status behandles konservativt som PROCEED_DIRECT — spec siger
 * eksplicit at kun Full/Blocked skal divertere.
 */
export function computeRoutingDirective(status: string | null): RoutingDirective {
  if (status !== null && DIVERT_STATUSES.has(status)) {
    return 'DIVERT_CONSUMER_ROUTING';
  }
  return 'PROCEED_DIRECT';
}

/**
 * Grov bounding-box for SQL-prefilter — vi undgår at hente hele tabellen
 * for et lille radius. 1 breddegrad ≈ 111.32 km, 1 længdegrad ≈ 111.32·cos(lat).
 * Bufferen bruger max(cos(lat), 0.1) for at undgå division-eksplosion ved poler.
 */
function boundingBox(
  lat: number,
  lon: number,
  radiusKm: number,
): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.max(Math.cos(toRadians(lat)), 0.1);
  const lonDelta = radiusKm / (111.32 * cosLat);
  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
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
    const body: ProximityErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2) Query-string validation (400 hvis invalid)
  const parsed = parseQuery(req.query);
  if (!parsed.ok) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: ProximityErrorResponse = { success: false, error: parsed.error };
    return res.status(400).json(body);
  }
  const q = parsed.query;

  // 3) F3.8 — verify Firebase-token hvis sendt. Public map-endpoint, så warn_only.
  const verifyResult = await verifyFirebaseToken(req, { mode: 'warn_only' });
  if (!verifyResult.ok) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: ProximityErrorResponse = {
      success: false,
      error: verifyResult.reason || 'unauthorized',
    };
    return res.status(verifyResult.status || 401).json(body);
  }
  const authInfo = {
    verified: verifyResult.verified === true,
    uid: verifyResult.uid ?? null,
  };

  // 4) Supabase service-role klient
  const sb = getSupabase();
  if (!sb) {
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: ProximityErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail: 'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  try {
    // 5) Bounding-box prefilter i SQL — reducer antal rows der skal Haversine'es.
    const box = boundingBox(q.user_lat, q.user_long, q.max_distance_km);

    let query = sb
      .from(SMART_BINS_TABLE)
      .select(BIN_COLUMNS)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', box.latMin)
      .lte('latitude', box.latMax)
      .gte('longitude', box.lonMin)
      .lte('longitude', box.lonMax)
      .limit(MAX_LIMIT);

    if (q.kommune !== null) {
      query = query.eq('kommune', q.kommune);
    }
    if (q.status !== null) {
      query = query.eq('status', q.status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[api/bins/proximity] Supabase-fejl:', error.message, error.code);
      res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
      const body: ProximityErrorResponse = {
        success: false,
        error: 'database_error',
        detail: error.message,
      };
      return res.status(500).json(body);
    }

    const rows: SmartBinRow[] = Array.isArray(data)
      ? (data as unknown as SmartBinRow[])
      : [];

    // 6) Haversine + filter + routing_directive + sort by distance.
    const enriched: ProximityBin[] = [];
    for (const row of rows) {
      const lat = typeof row.latitude === 'number' ? row.latitude : NaN;
      const lon = typeof row.longitude === 'number' ? row.longitude : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const distance_km = haversineKm(q.user_lat, q.user_long, lat, lon);
      if (distance_km > q.max_distance_km) continue;

      enriched.push({
        id: row.id,
        kommune: row.kommune,
        status: row.status,
        location: row.location,
        latitude: lat,
        longitude: lon,
        capacity_liters: row.capacity_liters,
        fill_level_percent: row.fill_level_percent,
        material_type: row.material_type,
        last_seen: row.last_seen,
        distance_km: Math.round(distance_km * 1000) / 1000,
        routing_directive: computeRoutingDirective(row.status),
      });
    }

    enriched.sort((a, b) => a.distance_km - b.distance_km);
    const bins = enriched.slice(0, q.limit);

    // 7) Success — CDN-cache-venlig, kortvarig.
    res.setHeader('Cache-Control', CACHE_CONTROL_SUCCESS);
    res.setHeader('X-Cirkel-Endpoint', 'api/bins/proximity');
    res.setHeader('X-Result-Count', String(bins.length));

    const body: ProximitySuccessResponse = {
      success: true,
      data: {
        bins,
        count: bins.length,
        query: q,
        auth: authInfo,
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/bins/proximity] Uventet fejl:', message);
    res.setHeader('Cache-Control', CACHE_CONTROL_ERROR);
    const body: ProximityErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}

// Ren type-eksport så tests / klienter kan importere schema uden run-time cost.
export type {
  ProximityBin,
  ProximityQuery,
  ProximityResponse,
  ProximitySuccessResponse,
  ProximityErrorResponse,
  RoutingDirective,
};
