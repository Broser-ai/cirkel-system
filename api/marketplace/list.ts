// cirkel-system/api/marketplace/list.ts
//
// Modul 14.1 · Bulky-Waste Marketplace · Search + Opret listing.
// Backing store: migration 009_bulky_waste_marketplace.sql
//                (public.bulky_waste_marketplace).
//
// F3.8:
//   - GET  (public search, warn_only) → kortet skal virke pre-login.
//   - POST (opret listing, enforce)    → kraever gyldig Firebase-ID-token
//                                        og at token.uid == body.firebaseUid.
//
// Endpoints:
//   GET  /api/marketplace/list
//        ?status=available|reserved|claimed|collected|expired      (default: available)
//        &handling=free_giveaway|municipal_pickup|paid_collection  (valgfri)
//        &bbox=<minLon>,<minLat>,<maxLon>,<maxLat>                 (valgfri, kort-viewport)
//        &lat=<n>&lon=<n>&radius_km=<n>                            (valgfri, punkt+radius)
//        &owner_firebase_uid=<uid>                                 (valgfri, "mine opslag")
//        &q=<free-text>                                            (valgfri, title-search)
//        &limit=<1..200>&offset=<0..1_000_000>
//
//        Response 200:
//          { success: true, data: { items: BulkyItem[], count, filters, auth } }
//
//   POST /api/marketplace/list
//        Headers: Authorization: Bearer <firebase-id-token>
//        Body:
//          {
//            "firebaseUid":        "<uid>",             // paakraevet, matches token.uid
//            "item_title":         "<3..200 chars>",    // paakraevet
//            "description":        "<0..4000 chars>",   // valgfri
//            "volumetric_profile": { ... }              // valgfri JSON, default {}
//            "handling_type":      "free_giveaway"|"municipal_pickup"|"paid_collection"
//                                                       // valgfri, default free_giveaway
//            "latitude":           <number -90..90>,    // paakraevet
//            "longitude":          <number -180..180>,  // paakraevet
//            "claim_deadline":     "<ISO-8601>",        // valgfri, TIMESTAMPTZ
//            "image_urls":         ["<https://…>", …]   // valgfri, 0..10 URLs
//          }
//
//        Response 201:
//          { success: true, data: { item: BulkyItem, auth } }
//
// Response-format (alle svar):
//   2xx { success: true,  data: {...} }
//   4xx { success: false, error: "<slug>", detail?: "<string>" }
//   5xx { success: false, error: "<slug>", detail?: "<string>" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken, resolveTrustedUid } from '../_verify-firebase-token.js';

// ---------- Konstanter ----------

const ENDPOINT_TAG = 'api/marketplace/list';

const CACHE_CONTROL_GET_OK = 'public, max-age=15, s-maxage=30, stale-while-revalidate=60';
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';

const HANDLING_TYPES = ['free_giveaway', 'municipal_pickup', 'paid_collection'] as const;
const ITEM_STATUSES = ['available', 'reserved', 'claimed', 'collected', 'expired'] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 1_000_000;

const TITLE_MIN_LEN = 3;
const TITLE_MAX_LEN = 200;
const DESC_MAX_LEN = 4000;
const MAX_IMAGE_URLS = 10;
const MAX_IMAGE_URL_LEN = 2048;
const MAX_Q_LEN = 200;
const MAX_RADIUS_KM = 500;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SELECT-projektion: eksplicit skema saa vi altid returnerer forudsigelig JSON.
const ITEM_COLUMNS = [
  'item_id',
  'user_id',
  'item_title',
  'description',
  'volumetric_profile',
  'handling_type',
  'latitude',
  'longitude',
  'current_status',
  'claim_deadline',
  'collector_user_id',
  'image_urls',
  'created_at',
  'updated_at',
].join(', ');

// ---------- Types ----------

export type HandlingType = (typeof HANDLING_TYPES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface BulkyItem {
  item_id: string;
  user_id: string;
  item_title: string;
  description: string | null;
  volumetric_profile: Record<string, unknown>;
  handling_type: HandlingType;
  latitude: number;
  longitude: number;
  current_status: ItemStatus;
  claim_deadline: string | null;
  collector_user_id: string | null;
  image_urls: string[];
  created_at: string;
  updated_at: string;
}

interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface RadiusFilter {
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface ListFilters {
  status: ItemStatus;
  handling: HandlingType | null;
  bbox: BoundingBox | null;
  radius: RadiusFilter | null;
  owner_firebase_uid: string | null;
  q: string | null;
  limit: number;
  offset: number;
}

export interface CreateBody {
  firebaseUid: string;
  item_title: string;
  description: string | null;
  volumetric_profile: Record<string, unknown>;
  handling_type: HandlingType;
  latitude: number;
  longitude: number;
  claim_deadline: string | null;
  image_urls: string[];
}

interface AuthInfo {
  firebase_verified: boolean;
  firebase_uid: string | null;
  mode: string;
}

interface ListSuccessData {
  items: BulkyItem[];
  count: number;
  filters: ListFilters;
  auth: AuthInfo;
}

interface CreateSuccessData {
  item: BulkyItem;
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

export type MarketplaceListResponse =
  | SuccessResponse<ListSuccessData>
  | SuccessResponse<CreateSuccessData>
  | ErrorResponse;

// Row-shape som Supabase returnerer (NUMERIC-kolonner kommer typisk som strings).
interface RawItemRow {
  item_id: string;
  user_id: string;
  item_title: string;
  description: string | null;
  volumetric_profile: unknown;
  handling_type: string;
  latitude: string | number;
  longitude: string | number;
  current_status: string;
  claim_deadline: string | null;
  collector_user_id: string | null;
  image_urls: string[] | null;
  created_at: string;
  updated_at: string;
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
  cacheControl: string,
): VercelResponse {
  res.setHeader('Cache-Control', cacheControl);
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

// ---------- Type-guards + parsere ----------

function firstQueryValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isHandlingType(v: unknown): v is HandlingType {
  return typeof v === 'string' && (HANDLING_TYPES as readonly string[]).includes(v);
}

function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === 'string' && (ITEM_STATUSES as readonly string[]).includes(v);
}

function parseFloatSafe(raw: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
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

function coerceNumber(v: string | number, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const parsed = parseFloat(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Vercel parser typisk JSON automatisk, men handleren kan modtage raw string. */
function normalizeRawBody(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined; // signalerer parse-fejl til caller
  }
}

function coerceRow(raw: RawItemRow): BulkyItem {
  const vp = raw.volumetric_profile;
  const volumetric_profile: Record<string, unknown> =
    vp !== null && typeof vp === 'object' && !Array.isArray(vp)
      ? (vp as Record<string, unknown>)
      : {};
  const image_urls: string[] = Array.isArray(raw.image_urls)
    ? raw.image_urls.filter((u): u is string => typeof u === 'string')
    : [];
  const handling_type: HandlingType = isHandlingType(raw.handling_type)
    ? raw.handling_type
    : 'free_giveaway';
  const current_status: ItemStatus = isItemStatus(raw.current_status)
    ? raw.current_status
    : 'available';
  return {
    item_id: raw.item_id,
    user_id: raw.user_id,
    item_title: raw.item_title,
    description: raw.description,
    volumetric_profile,
    handling_type,
    latitude: coerceNumber(raw.latitude, 0),
    longitude: coerceNumber(raw.longitude, 0),
    current_status,
    claim_deadline: raw.claim_deadline,
    collector_user_id: raw.collector_user_id,
    image_urls,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

// ---------- Firebase→profil-resolver ----------
//
// bulky_waste_marketplace.user_id peger paa profiles.id (UUID). Vi genbruger
// get_dashboard-RPC'en som allerede kender firebase→profil-broen. Fejlende
// RPC eller manglende profil returnerer null → caller mapper til 404.
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

// ---------- Query-string parsing (GET) ----------

interface ParsedQueryOk {
  ok: true;
  filters: ListFilters;
}
interface ParsedQueryErr {
  ok: false;
  error: string;
}

function parseBbox(raw: string): BoundingBox | null {
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 4) return null;
  const [minLon, minLat, maxLon, maxLat] = parts.map(parseFloatSafe);
  if (
    minLon === null ||
    minLat === null ||
    maxLon === null ||
    maxLat === null
  ) {
    return null;
  }
  if (minLon < -180 || maxLon > 180 || minLon >= maxLon) return null;
  if (minLat < -90 || maxLat > 90 || minLat >= maxLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function parseQuery(query: VercelRequest['query']): ParsedQueryOk | ParsedQueryErr {
  // status (default: available — kortet skal vise ledige opslag pre-login).
  const statusRaw = firstQueryValue(query.status);
  let status: ItemStatus = 'available';
  if (statusRaw !== null) {
    if (!isItemStatus(statusRaw)) return { ok: false, error: 'invalid_status' };
    status = statusRaw;
  }

  // handling_type (valgfri).
  const handlingRaw = firstQueryValue(query.handling);
  let handling: HandlingType | null = null;
  if (handlingRaw !== null) {
    if (!isHandlingType(handlingRaw)) {
      return { ok: false, error: 'invalid_handling_type' };
    }
    handling = handlingRaw;
  }

  // bbox=minLon,minLat,maxLon,maxLat (valgfri).
  const bboxRaw = firstQueryValue(query.bbox);
  let bbox: BoundingBox | null = null;
  if (bboxRaw !== null) {
    bbox = parseBbox(bboxRaw);
    if (bbox === null) return { ok: false, error: 'invalid_bbox' };
  }

  // lat/lon/radius_km (valgfri; alle tre skal vaere sat sammen).
  const latRaw = firstQueryValue(query.lat);
  const lonRaw = firstQueryValue(query.lon);
  const radiusRaw = firstQueryValue(query.radius_km);
  let radius: RadiusFilter | null = null;
  const anyRadiusFieldSet = latRaw !== null || lonRaw !== null || radiusRaw !== null;
  if (anyRadiusFieldSet) {
    if (latRaw === null || lonRaw === null || radiusRaw === null) {
      return { ok: false, error: 'radius_requires_lat_lon_radius_km' };
    }
    const lat = parseFloatSafe(latRaw);
    const lon = parseFloatSafe(lonRaw);
    const radiusKm = parseFloatSafe(radiusRaw);
    if (lat === null || lat < -90 || lat > 90) {
      return { ok: false, error: 'invalid_lat' };
    }
    if (lon === null || lon < -180 || lon > 180) {
      return { ok: false, error: 'invalid_lon' };
    }
    if (radiusKm === null || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) {
      return { ok: false, error: 'invalid_radius_km' };
    }
    radius = { lat, lon, radiusKm };
  }

  // owner_firebase_uid (valgfri — "mine opslag").
  const ownerFbUid = firstQueryValue(query.owner_firebase_uid);
  if (ownerFbUid !== null && (ownerFbUid.length < 1 || ownerFbUid.length > 128)) {
    return { ok: false, error: 'invalid_owner_firebase_uid' };
  }

  // Fri-tekst q (valgfri).
  const qRaw = firstQueryValue(query.q);
  if (qRaw !== null && qRaw.length > MAX_Q_LEN) {
    return { ok: false, error: 'invalid_q' };
  }

  // limit / offset.
  const limitParsed = parseIntBounded(
    firstQueryValue(query.limit),
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );
  if (!limitParsed.ok) return { ok: false, error: 'invalid_limit' };

  const offsetParsed = parseIntBounded(
    firstQueryValue(query.offset),
    0,
    0,
    MAX_OFFSET,
  );
  if (!offsetParsed.ok) return { ok: false, error: 'invalid_offset' };

  return {
    ok: true,
    filters: {
      status,
      handling,
      bbox,
      radius,
      owner_firebase_uid: ownerFbUid,
      q: qRaw,
      limit: limitParsed.value,
      offset: offsetParsed.value,
    },
  };
}

// Approx bounding-box fra (lat, lon, radiusKm). Grov filtrering paa DB-sidn;
// klienten kan filtrere praecist paa Haversine efterfoelgende.
function radiusToBbox(r: RadiusFilter): BoundingBox {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = Math.max(
    111.32 * Math.cos((r.lat * Math.PI) / 180),
    1e-6,
  );
  const dLat = r.radiusKm / kmPerDegLat;
  const dLon = r.radiusKm / kmPerDegLon;
  const minLat = Math.max(-90, r.lat - dLat);
  const maxLat = Math.min(90, r.lat + dLat);
  const minLon = Math.max(-180, r.lon - dLon);
  const maxLon = Math.min(180, r.lon + dLon);
  return { minLon, minLat, maxLon, maxLat };
}

// PostgREST ilike-pattern-escape: '%' og '_' skal escapes for at undgaa
// utilsigtet wildcarding baseret paa bruger-input.
function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// ---------- Body validation (POST) ----------

interface ParsedBodyOk {
  ok: true;
  body: CreateBody;
}
interface ParsedBodyErr {
  ok: false;
  error: string;
}

function isValidUrl(s: string): boolean {
  if (s.length === 0 || s.length > MAX_IMAGE_URL_LEN) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseCreateBody(raw: unknown): ParsedBodyOk | ParsedBodyErr {
  const normalized = normalizeRawBody(raw);
  if (normalized === undefined) return { ok: false, error: 'invalid_json' };
  if (!isPlainObject(normalized)) return { ok: false, error: 'invalid_body' };
  const b = normalized;

  // firebaseUid — paakraevet, matches token.uid (verify sker separat).
  if (!isNonEmptyString(b.firebaseUid) || b.firebaseUid.length > 128) {
    return { ok: false, error: 'firebaseUid_required' };
  }
  const firebaseUid = b.firebaseUid.trim();

  // item_title — 3..200 tegn (matcher CHECK-constraint).
  if (!isNonEmptyString(b.item_title)) {
    return { ok: false, error: 'item_title_required' };
  }
  const item_title = b.item_title.trim();
  if (item_title.length < TITLE_MIN_LEN || item_title.length > TITLE_MAX_LEN) {
    return { ok: false, error: 'invalid_item_title_length' };
  }

  // description — valgfri, max 4000 tegn.
  let description: string | null = null;
  if (b.description !== undefined && b.description !== null && b.description !== '') {
    if (typeof b.description !== 'string') {
      return { ok: false, error: 'invalid_description' };
    }
    const trimmed = b.description.trim();
    if (trimmed.length > DESC_MAX_LEN) {
      return { ok: false, error: 'description_too_long' };
    }
    description = trimmed.length === 0 ? null : trimmed;
  }

  // volumetric_profile — JSONB, default {}.
  let volumetric_profile: Record<string, unknown> = {};
  if (b.volumetric_profile !== undefined && b.volumetric_profile !== null) {
    if (!isPlainObject(b.volumetric_profile)) {
      return { ok: false, error: 'invalid_volumetric_profile' };
    }
    volumetric_profile = b.volumetric_profile;
  }

  // handling_type — valgfri, default free_giveaway.
  let handling_type: HandlingType = 'free_giveaway';
  if (b.handling_type !== undefined && b.handling_type !== null && b.handling_type !== '') {
    if (!isHandlingType(b.handling_type)) {
      return { ok: false, error: 'invalid_handling_type' };
    }
    handling_type = b.handling_type;
  }

  // latitude — paakraevet, -90..90.
  if (!isFiniteNumber(b.latitude) || b.latitude < -90 || b.latitude > 90) {
    return { ok: false, error: 'invalid_latitude' };
  }
  const latitude = b.latitude;

  // longitude — paakraevet, -180..180.
  if (!isFiniteNumber(b.longitude) || b.longitude < -180 || b.longitude > 180) {
    return { ok: false, error: 'invalid_longitude' };
  }
  const longitude = b.longitude;

  // claim_deadline — valgfri, ISO-8601, i fremtiden.
  let claim_deadline: string | null = null;
  if (b.claim_deadline !== undefined && b.claim_deadline !== null && b.claim_deadline !== '') {
    if (typeof b.claim_deadline !== 'string') {
      return { ok: false, error: 'invalid_claim_deadline' };
    }
    const ts = Date.parse(b.claim_deadline);
    if (!Number.isFinite(ts)) {
      return { ok: false, error: 'invalid_claim_deadline' };
    }
    if (ts <= Date.now()) {
      return { ok: false, error: 'claim_deadline_in_past' };
    }
    claim_deadline = new Date(ts).toISOString();
  }

  // image_urls — valgfri, 0..10 URLs, hver http(s) og <= 2048 tegn.
  let image_urls: string[] = [];
  if (b.image_urls !== undefined && b.image_urls !== null) {
    if (!Array.isArray(b.image_urls)) {
      return { ok: false, error: 'invalid_image_urls' };
    }
    if (b.image_urls.length > MAX_IMAGE_URLS) {
      return { ok: false, error: 'too_many_image_urls' };
    }
    const cleaned: string[] = [];
    for (const u of b.image_urls) {
      if (typeof u !== 'string' || !isValidUrl(u)) {
        return { ok: false, error: 'invalid_image_url' };
      }
      cleaned.push(u);
    }
    image_urls = cleaned;
  }

  return {
    ok: true,
    body: {
      firebaseUid,
      item_title,
      description,
      volumetric_profile,
      handling_type,
      latitude,
      longitude,
      claim_deadline,
      image_urls,
    },
  };
}

// ---------- GET (search) ----------

async function handleList(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<VercelResponse> {
  const parsed = parseQuery(req.query);
  if (!parsed.ok) {
    return sendError(res, 400, parsed.error);
  }
  const filters = parsed.filters;

  // F3.8 warn_only — GET er public, men vi logger UID-spoof og rapporterer
  // verified-flag tilbage til klienten.
  const verify = await verifyFirebaseToken(req, { mode: 'warn_only' });
  const authInfo: AuthInfo = {
    firebase_verified: verify.verified === true,
    firebase_uid: verify.uid ?? null,
    mode: verify.mode,
  };

  // owner_firebase_uid → resolve profil-id (matches bulky_waste.user_id).
  let ownerProfileId: string | null = null;
  if (filters.owner_firebase_uid !== null) {
    ownerProfileId = await resolveProfileId(sb, filters.owner_firebase_uid);
    if (ownerProfileId === null) {
      // Ingen profil → tomt resultat er korrekt semantik (ingen opslag ejet
      // af en profil der ikke findes). Vi sender 200 med items: [].
      return sendSuccess<ListSuccessData>(
        res,
        { items: [], count: 0, filters, auth: authInfo },
        200,
        CACHE_CONTROL_NO_STORE,
      );
    }
  }

  try {
    let q = sb
      .from('bulky_waste_marketplace')
      .select(ITEM_COLUMNS)
      .eq('current_status', filters.status)
      .order('created_at', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);

    if (filters.handling !== null) {
      q = q.eq('handling_type', filters.handling);
    }
    if (ownerProfileId !== null) {
      q = q.eq('user_id', ownerProfileId);
    }
    if (filters.q !== null) {
      const escaped = escapeLikePattern(filters.q.trim());
      if (escaped.length > 0) {
        q = q.ilike('item_title', `%${escaped}%`);
      }
    }

    // Geografi: enten bbox eller radius (radius konverteres til bbox for
    // grov DB-filtrering; klient kan filtrere praecist med Haversine).
    const effectiveBbox: BoundingBox | null =
      filters.bbox ?? (filters.radius ? radiusToBbox(filters.radius) : null);
    if (effectiveBbox !== null) {
      q = q
        .gte('latitude', effectiveBbox.minLat)
        .lte('latitude', effectiveBbox.maxLat)
        .gte('longitude', effectiveBbox.minLon)
        .lte('longitude', effectiveBbox.maxLon);
    }

    const { data, error } = await q;

    if (error) {
      console.error(
        `[${ENDPOINT_TAG}] Supabase select-fejl: ${error.message} (code=${error.code})`,
      );
      return sendError(res, 500, 'database_error', error.message);
    }

    const rows: BulkyItem[] = Array.isArray(data)
      ? (data as unknown as RawItemRow[]).map(coerceRow)
      : [];

    res.setHeader('X-Result-Count', String(rows.length));
    // Ved auth-relaterede eller ejer-specifikke queries: no-store, da svaret
    // varierer med caller. Ellers cachees kortvarigt paa CDN.
    const cache =
      authInfo.firebase_verified || ownerProfileId !== null
        ? CACHE_CONTROL_NO_STORE
        : CACHE_CONTROL_GET_OK;

    return sendSuccess<ListSuccessData>(
      res,
      { items: rows, count: rows.length, filters, auth: authInfo },
      200,
      cache,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${ENDPOINT_TAG}] Uventet fejl (GET): ${message}`);
    return sendError(res, 500, 'internal_error', message);
  }
}

// ---------- POST (opret listing) ----------

async function handleCreate(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<VercelResponse> {
  const parsed = parseCreateBody(req.body);
  if (!parsed.ok) {
    return sendError(res, 400, parsed.error);
  }
  const body = parsed.body;

  // F3.8 enforce (uanset mode-default) — opret er en side-effect, saa vi
  // kraever gyldig token OG at token.uid == body.firebaseUid.
  let trustedUid: string;
  let verified: boolean;
  try {
    const v = await resolveTrustedUid(req, body.firebaseUid);
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
      status === 403 ? 'firebase_uid_spoof' : status === 401 ? 'firebase_token_invalid' : 'firebase_verify_failed';
    return sendError(res, status, errorSlug, reason);
  }

  // Resolve profil-id fra det VERIFICEREDE UID (aldrig fra body).
  const profileId = await resolveProfileId(sb, trustedUid);
  if (profileId === null) {
    return sendError(res, 404, 'profile_not_found', `firebase_uid=${trustedUid}`);
  }

  const authInfo: AuthInfo = {
    firebase_verified: verified,
    firebase_uid: trustedUid,
    mode: 'enforce',
  };

  // Insert-row. current_status og collector_user_id styres af state-maskinen
  // og RLS INSERT-policy (skal begge vaere 'available' + NULL ved opret).
  const insertRow = {
    user_id: profileId,
    item_title: body.item_title,
    description: body.description,
    volumetric_profile: body.volumetric_profile,
    handling_type: body.handling_type,
    latitude: body.latitude,
    longitude: body.longitude,
    current_status: 'available' as const,
    claim_deadline: body.claim_deadline,
    collector_user_id: null,
    image_urls: body.image_urls,
  };

  try {
    const { data: insertedRow, error: insertErr } = await sb
      .from('bulky_waste_marketplace')
      .insert(insertRow)
      .select(ITEM_COLUMNS)
      .single<RawItemRow>();

    if (insertErr) {
      // Foreign-key: profiles.id findes ikke (usandsynligt efter resolveProfileId,
      // men race conditions eller admin-cleanup kan give det).
      if (insertErr.code === '23503') {
        console.warn(
          `[${ENDPOINT_TAG}] FK-fejl profiles.id=${profileId}: ${insertErr.message}`,
        );
        return sendError(res, 400, 'profile_reference_failed', insertErr.message);
      }
      // CHECK-constraint (title-laengde, koordinater, status/collector).
      if (insertErr.code === '23514') {
        console.warn(`[${ENDPOINT_TAG}] CHECK-constraint fejl: ${insertErr.message}`);
        return sendError(res, 400, 'constraint_violation', insertErr.message);
      }
      // RLS-blokering (uendeligt usandsynligt paa service-role, men eksplicit).
      if (insertErr.code === '42501') {
        console.warn(`[${ENDPOINT_TAG}] RLS-blokering: ${insertErr.message}`);
        return sendError(res, 403, 'rls_denied', insertErr.message);
      }
      console.error(
        `[${ENDPOINT_TAG}] Supabase insert-fejl: ${insertErr.message} (code=${insertErr.code})`,
      );
      return sendError(res, 500, 'database_error', insertErr.message);
    }

    if (!insertedRow) {
      return sendError(res, 500, 'insert_returned_empty');
    }

    const item = coerceRow(insertedRow);
    res.setHeader('X-Cirkel-Item-Id', item.item_id);
    console.log(
      `[${ENDPOINT_TAG}] Opslag oprettet: item_id=${item.item_id} user_id=${item.user_id} handling=${item.handling_type}`,
    );
    return sendSuccess<CreateSuccessData>(
      res,
      { item, auth: authInfo },
      201,
      CACHE_CONTROL_NO_STORE,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${ENDPOINT_TAG}] Uventet fejl (POST): ${message}`);
    return sendError(res, 500, 'internal_error', message);
  }
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  res.setHeader('X-Cirkel-Endpoint', ENDPOINT_TAG);

  // 1) Method-guard — kun GET og POST.
  const method = (req.method ?? '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'method_not_allowed');
  }

  // 2) Supabase service-role klient (fejles fast hvis env mangler).
  const sb = getSupabase();
  if (!sb) {
    return sendError(
      res,
      503,
      'supabase_not_configured',
      'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    );
  }

  // 3) Route paa metode.
  if (method === 'GET') {
    return handleList(req, res, sb);
  }
  return handleCreate(req, res, sb);
}
