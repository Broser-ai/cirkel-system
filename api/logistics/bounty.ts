// cirkel-system/api/logistics/bounty.ts
//
// Modul 12.2 · Collector Bounty · Broadcast-endpoint.
//
// Formaal:
//   Sovereign-runtime (og evt. kommune-dashboards) kalder dette endpoint naar
//   en asset skifter til en tilstand der kraever kollektor-handling. Endpointet
//   beregner payout ud fra event_type, genererer et unikt bounty_id og
//   inserter en raekke i public.logistics_bounties (status='pending_claim').
//   Freelance kollektorer poller derefter markedet via egne endpoints og
//   claimer via SECURITY DEFINER RPC (uden for scope her).
//
// POST /api/logistics/bounty
//   Headers:
//     Authorization: Bearer <firebase-id-token>   (F3.8 audit — mode fra env)
//     Content-Type: application/json
//   Body:
//     {
//       "event_type": "bulky_pickup" | "full_bin_empty" | "maintenance",
//       "asset_id":   "<uuid>",         // paakraevet for bulky_pickup, valgfri ellers
//       "latitude":   56.15,            // -90..90
//       "longitude":  10.20             // -180..180
//     }
//
// Payout-tabel (fast, spec Modul 12.2):
//   bulky_pickup     = 75 DKK
//   full_bin_empty   = 35 DKK
//   maintenance      = 50 DKK
//
// Respons:
//   200 { success: true, data: { bounty_id, event_type, payout_dkk, status,
//                                claim_deadline, created_at, auth: {...} } }
//   400 { success: false, error: "<invalid_field>" }
//   401 { success: false, error: "firebase_token_missing" | "firebase_token_invalid" }
//   405 { success: false, error: "method_not_allowed" }
//   500 { success: false, error: "internal_error", detail?: string }
//   503 { success: false, error: "supabase_not_configured" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Konstanter ----------

/** Payout i DKK pr. event_type (Modul 12.2 spec — laaste vaerdier). */
const PAYOUT_DKK_BY_EVENT: Readonly<Record<BountyEventType, number>> = Object.freeze({
  bulky_pickup: 75,
  full_bin_empty: 35,
  maintenance: 50,
});

/** Claim-deadline TTL (millisekunder) pr. event_type. Efter deadline expirer bounty. */
const CLAIM_DEADLINE_MS_BY_EVENT: Readonly<Record<BountyEventType, number>> = Object.freeze({
  bulky_pickup: 48 * 60 * 60 * 1000,   // 48 timer — planlagt afhentning
  full_bin_empty: 12 * 60 * 60 * 1000, // 12 timer — akut, overfuld bin
  maintenance: 72 * 60 * 60 * 1000,    // 72 timer — service-vindue
});

/** UUID v4 regex — validerer at asset_id har korrekt form INDEN vi rammer DB. */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cache-Control paa alle svar — bounty-broadcast cachees aldrig. */
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';

/** Endpoint-tag brugt i logs og response-headers. */
const ENDPOINT_TAG = 'api/logistics/bounty';

// ---------- Types ----------

/** De tre event-typer der udloeser bounty. Matcher CHECK-constraint i migration 012. */
export type BountyEventType = 'bulky_pickup' | 'full_bin_empty' | 'maintenance';

/** Body-schema efter validering. */
export interface BountyRequestBody {
  event_type: BountyEventType;
  asset_id: string | null;
  latitude: number;
  longitude: number;
}

/** Row-form som vi skriver til Supabase. */
interface BountyInsertRow {
  bounty_id: string;
  asset_id: string | null;
  event_type: BountyEventType;
  payout_dkk: number;
  latitude: number;
  longitude: number;
  status: 'pending_claim';
  claim_deadline: string;
  created_at: string;
  updated_at: string;
}

/** Row-form som vi laeser tilbage efter insert. */
interface BountySelectRow {
  bounty_id: string;
  asset_id: string | null;
  event_type: BountyEventType;
  payout_dkk: string | number;
  latitude: string | number;
  longitude: string | number;
  status: string;
  claim_deadline: string | null;
  created_at: string;
}

/** Struktureret success-payload til klienten. */
export interface BountySuccessData {
  bounty_id: string;
  asset_id: string | null;
  event_type: BountyEventType;
  payout_dkk: number;
  latitude: number;
  longitude: number;
  status: 'pending_claim';
  claim_deadline: string;
  created_at: string;
  auth: {
    firebase_verified: boolean;
    firebase_uid: string | null;
    mode: string;
  };
}

export interface BountySuccessResponse {
  success: true;
  data: BountySuccessData;
}

export interface BountyErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

export type BountyResponse = BountySuccessResponse | BountyErrorResponse;

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

// ---------- Body validation ----------

interface ParsedBodyOk {
  ok: true;
  body: BountyRequestBody;
}
interface ParsedBodyErr {
  ok: false;
  error: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBountyEventType(v: unknown): v is BountyEventType {
  return v === 'bulky_pickup' || v === 'full_bin_empty' || v === 'maintenance';
}

/**
 * Vercel parser typisk JSON automatisk (application/json), men handleren kan
 * ogsaa modtage en raw string hvis Content-Type mangler. Vi normaliserer.
 */
function normalizeRawBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined; // signalerer parse-fejl til caller
  }
}

function parseBody(raw: unknown): ParsedBodyOk | ParsedBodyErr {
  const normalized = normalizeRawBody(raw);
  if (normalized === undefined) return { ok: false, error: 'invalid_json' };
  if (normalized === null || typeof normalized !== 'object') {
    return { ok: false, error: 'invalid_body' };
  }
  const b = normalized as Record<string, unknown>;

  // event_type — skal matche CHECK-constraint (bulky_pickup | full_bin_empty | maintenance).
  if (!isBountyEventType(b.event_type)) {
    return { ok: false, error: 'invalid_event_type' };
  }
  const event_type: BountyEventType = b.event_type;

  // asset_id — UUID v4. Paakraevet for bulky_pickup (migration constraint),
  // valgfri for de to andre event-typer (asset-loese runder tilladt).
  let asset_id: string | null = null;
  if (b.asset_id !== undefined && b.asset_id !== null && b.asset_id !== '') {
    if (typeof b.asset_id !== 'string') {
      return { ok: false, error: 'invalid_asset_id' };
    }
    const trimmed = b.asset_id.trim();
    if (!UUID_V4_REGEX.test(trimmed)) {
      return { ok: false, error: 'invalid_asset_id' };
    }
    asset_id = trimmed.toLowerCase();
  }
  if (event_type === 'bulky_pickup' && asset_id === null) {
    return { ok: false, error: 'asset_id_required_for_bulky_pickup' };
  }

  // latitude — matcher NUMERIC(10,7) CHECK BETWEEN -90 AND 90.
  if (!isFiniteNumber(b.latitude) || b.latitude < -90 || b.latitude > 90) {
    return { ok: false, error: 'invalid_latitude' };
  }
  const latitude = b.latitude;

  // longitude — matcher NUMERIC(10,7) CHECK BETWEEN -180 AND 180.
  if (!isFiniteNumber(b.longitude) || b.longitude < -180 || b.longitude > 180) {
    return { ok: false, error: 'invalid_longitude' };
  }
  const longitude = b.longitude;

  return {
    ok: true,
    body: { event_type, asset_id, latitude, longitude },
  };
}

// ---------- Bounty-id generator ----------

/**
 * Genererer et bounty_id af form 'BNTY-<uuid-v4>' (41 tegn) — fits VARCHAR(50).
 * Bruger crypto.randomUUID (RFC 4122 v4) for global unikhed uden DB-roundtrip.
 */
function generateBountyId(): string {
  return `BNTY-${randomUUID()}`;
}

// ---------- Numerisk normalisering af DB-svar ----------

function coerceNumber(v: string | number, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const parsed = parseFloat(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
  res.setHeader('X-Cirkel-Endpoint', ENDPOINT_TAG);

  // 1) Method-guard — kun POST.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    const body: BountyErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2) F3.8 Firebase-token verify. Mode styres af FIREBASE_ADMIN_ENFORCE
  //    (default warn_only mens migration ruller ud). I enforce-mode blokerer
  //    verifyFirebaseToken hvis token mangler/er ugyldig.
  const firebaseVerify = await verifyFirebaseToken(req);
  if (!firebaseVerify.ok) {
    const errorCode =
      firebaseVerify.status === 401
        ? 'firebase_token_invalid'
        : firebaseVerify.status === 403
          ? 'firebase_uid_spoof'
          : 'firebase_token_missing';
    const body: BountyErrorResponse = {
      success: false,
      error: errorCode,
      detail: firebaseVerify.reason,
    };
    return res.status(firebaseVerify.status).json(body);
  }
  const authInfo: BountySuccessData['auth'] = {
    firebase_verified: firebaseVerify.verified === true,
    firebase_uid: firebaseVerify.uid ?? null,
    mode: firebaseVerify.mode,
  };

  // 3) Body parsing + validering.
  const parsed = parseBody(req.body);
  if (!parsed.ok) {
    const body: BountyErrorResponse = { success: false, error: parsed.error };
    return res.status(400).json(body);
  }
  const { event_type, asset_id, latitude, longitude } = parsed.body;

  // 4) Payout og claim-deadline — statisk mapping fra event_type.
  //    Bruger Object.hasOwn for at afvise proto-pollution paa mappings.
  if (!Object.hasOwn(PAYOUT_DKK_BY_EVENT, event_type)) {
    // Uopnaaeligt: isBountyEventType har allerede screenet, men vi haandhaever
    // whitelist-kontrakten eksplicit for at slippe for at stole paa upstream.
    const body: BountyErrorResponse = { success: false, error: 'invalid_event_type' };
    return res.status(400).json(body);
  }
  const payout_dkk = PAYOUT_DKK_BY_EVENT[event_type];
  const claimDeadlineMs = CLAIM_DEADLINE_MS_BY_EVENT[event_type];

  // 5) Supabase service-role klient.
  const sb = getSupabase();
  if (!sb) {
    const body: BountyErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail: 'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  // 6) Byg row og insert.
  const now = new Date();
  const nowIso = now.toISOString();
  const claimDeadlineIso = new Date(now.getTime() + claimDeadlineMs).toISOString();
  const bounty_id = generateBountyId();

  const insertRow: BountyInsertRow = {
    bounty_id,
    asset_id,
    event_type,
    payout_dkk,
    latitude,
    longitude,
    status: 'pending_claim',
    claim_deadline: claimDeadlineIso,
    created_at: nowIso,
    updated_at: nowIso,
  };

  try {
    const { data: insertedRow, error: insertErr } = await sb
      .from('logistics_bounties')
      .insert(insertRow)
      .select(
        'bounty_id, asset_id, event_type, payout_dkk, latitude, longitude, status, claim_deadline, created_at',
      )
      .single<BountySelectRow>();

    if (insertErr) {
      // Foreign-key fejl paa asset_id (bulky_waste_marketplace.item_id findes ikke).
      if (insertErr.code === '23503') {
        console.warn(
          `[${ENDPOINT_TAG}] asset_id foreign-key fejlede: asset_id=${asset_id} detail=${insertErr.message}`,
        );
        const body: BountyErrorResponse = {
          success: false,
          error: 'asset_id_not_found',
          detail: insertErr.message,
        };
        return res.status(400).json(body);
      }
      // CHECK-constraint (event_type/asset_id/deadline/status).
      if (insertErr.code === '23514') {
        console.warn(
          `[${ENDPOINT_TAG}] CHECK-constraint fejlede: ${insertErr.message}`,
        );
        const body: BountyErrorResponse = {
          success: false,
          error: 'constraint_violation',
          detail: insertErr.message,
        };
        return res.status(400).json(body);
      }
      // Alle andre DB-fejl → 500.
      console.error(
        `[${ENDPOINT_TAG}] Supabase insert-fejl: ${insertErr.message} (code=${insertErr.code})`,
      );
      const body: BountyErrorResponse = {
        success: false,
        error: 'database_error',
        detail: insertErr.message,
      };
      return res.status(500).json(body);
    }
    if (!insertedRow) {
      const body: BountyErrorResponse = {
        success: false,
        error: 'insert_returned_empty',
      };
      return res.status(500).json(body);
    }

    // 7) Struktureret success-svar. NUMERIC-kolonner fra Postgres kommer typisk
    //    som strings i JS-driveren — vi coercer tilbage til number for klienten.
    const success: BountySuccessResponse = {
      success: true,
      data: {
        bounty_id: insertedRow.bounty_id,
        asset_id: insertedRow.asset_id,
        event_type: insertedRow.event_type,
        payout_dkk: coerceNumber(insertedRow.payout_dkk, payout_dkk),
        latitude: coerceNumber(insertedRow.latitude, latitude),
        longitude: coerceNumber(insertedRow.longitude, longitude),
        status: 'pending_claim',
        claim_deadline: insertedRow.claim_deadline ?? claimDeadlineIso,
        created_at: insertedRow.created_at,
        auth: authInfo,
      },
    };
    res.setHeader('X-Cirkel-Bounty-Id', insertedRow.bounty_id);
    res.setHeader('X-Cirkel-Event-Type', event_type);
    console.log(
      `[${ENDPOINT_TAG}] Bounty broadcast: ${insertedRow.bounty_id} event=${event_type} payout=${payout_dkk} DKK asset=${asset_id ?? '(none)'}`,
    );
    return res.status(200).json(success);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${ENDPOINT_TAG}] Uventet fejl: ${message}`);
    const body: BountyErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}
