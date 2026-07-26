// cirkel-system/api/marketplace/verify-claim.ts
//
// Modul 14.2 · NFC-handshake ved fysisk pickup af et give-away opslag
// (bulky_waste_marketplace, migration 009). Endpointet er den betroede
// state-transition fra "reserved / claimed" -> "collected" og udloeser
// samtidig payout paa 75 DKK til kollektoren hvis opslagets handling_type
// er 'municipal_pickup' (kommunal storskrald-afhentning).
//
// Kontrakt:
//   POST /api/marketplace/verify-claim
//   Headers:
//     Authorization: Bearer <firebase-id-token>   (F3.8 audit — mode fra env)
//     Content-Type:  application/json
//   Body:
//     {
//       "item_id":            "<uuid>",
//       "collector_user_id":  "<uuid>",
//       "device_lat":         56.1567,
//       "device_long":        10.2108
//     }
//
// State-maskine:
//   1. Item hentes; status skal vaere 'reserved' eller 'claimed'.
//   2. collector_user_id i body skal matche row.collector_user_id.
//   3. Haversine-afstand fra (device_lat, device_long) til
//      (row.latitude, row.longitude) skal vaere <= 15 meter.
//   4. status opdateres til 'collected' i eet UPDATE (status-guard via WHERE).
//   5. Hvis handling_type = 'municipal_pickup': proev at complete den
//      koblede logistics_bounties-raekke (asset_id=item_id, event_type
//      ='bulky_pickup', status='claimed', claimed_by=collector) og
//      registrer payout_dkk = 75. Best-effort — flow fejler ikke hvis
//      bounty mangler.
//
// Respons:
//   200 { success: true,  data: VerifyClaimData }
//   400 { success: false, error: "<invalid_field>" }
//   401 { success: false, error: "firebase_token_missing"|"firebase_token_invalid" }
//   403 { success: false, error: "firebase_uid_spoof"|"collector_mismatch" }
//   404 { success: false, error: "item_not_found" }
//   405 { success: false, error: "method_not_allowed" }
//   409 { success: false, error: "invalid_status_transition" }
//   422 { success: false, error: "geo_out_of_range" }
//   500 { success: false, error: "database_error"|"internal_error", detail?: string }
//   503 { success: false, error: "supabase_not_configured" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Konstanter (Modul 14.2 spec) ----------

/** Maks tilladt afstand mellem device-position og opslag ved NFC-handshake. */
const MAX_HANDSHAKE_DISTANCE_METERS = 15;

/** Fast payout for kommunal storskrald-afhentning (Modul 14.2 / 12.2). */
const MUNICIPAL_PICKUP_PAYOUT_DKK = 75;

/** Handling-type der udloeser payout. Vaerdien matcher CHECK i migration 009. */
const MUNICIPAL_PICKUP_HANDLING_TYPE = 'municipal_pickup';

/** Event-type i logistics_bounties (migration 012) som koder pickup-bounty. */
const BULKY_PICKUP_BOUNTY_EVENT = 'bulky_pickup';

/** Jordens middelradius i meter (til Haversine). */
const EARTH_RADIUS_METERS = 6_371_000;

/** UUID v4-regex — validerer body-felter INDEN vi rammer DB. */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cache-Control paa alle svar — NFC-handshake cachees aldrig. */
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';

/** Endpoint-tag brugt i logs og response-headers. */
const ENDPOINT_TAG = 'api/marketplace/verify-claim';

// ---------- Types ----------

/** Handling-typer som defineret i migration 009 CHECK-constraint. */
export type BulkyHandlingType =
  | 'free_giveaway'
  | 'municipal_pickup'
  | 'paid_collection';

/** Status-vaerdier i bulky_waste_marketplace (migration 009). */
export type BulkyStatus =
  | 'available'
  | 'reserved'
  | 'claimed'
  | 'collected'
  | 'expired';

/** Body-schema efter validering. */
export interface VerifyClaimRequestBody {
  item_id: string;
  collector_user_id: string;
  device_lat: number;
  device_long: number;
}

/** Row-form for de kolonner vi laeser fra bulky_waste_marketplace. */
interface BulkyItemRow {
  item_id: string;
  user_id: string;
  collector_user_id: string | null;
  handling_type: BulkyHandlingType;
  current_status: BulkyStatus;
  latitude: string | number;
  longitude: string | number;
}

/** Row-form for de kolonner vi laeser tilbage efter UPDATE. */
interface BulkyItemUpdatedRow {
  item_id: string;
  current_status: BulkyStatus;
  collector_user_id: string | null;
  handling_type: BulkyHandlingType;
  updated_at: string;
}

/** Row-form for logistics_bounties (kun de felter vi rammer). */
interface BountyRow {
  bounty_id: string;
  payout_dkk: string | number;
  status: string;
  claimed_by: string | null;
}

/** Payout-blok i success-svaret. */
export interface VerifyClaimPayoutInfo {
  eligible: boolean;
  amount_dkk: number;
  bounty_id: string | null;
  bounty_completed: boolean;
  reason: string;
}

/** Struktureret success-payload til klienten. */
export interface VerifyClaimData {
  claim_receipt_id: string;
  item_id: string;
  collector_user_id: string;
  previous_status: BulkyStatus;
  new_status: BulkyStatus;
  handling_type: BulkyHandlingType;
  distance_meters: number;
  handshake_verified_at: string;
  payout: VerifyClaimPayoutInfo;
  auth: {
    firebase_verified: boolean;
    firebase_uid: string | null;
    mode: string;
  };
}

export interface VerifyClaimSuccessResponse {
  success: true;
  data: VerifyClaimData;
}

export interface VerifyClaimErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

export type VerifyClaimResponse =
  | VerifyClaimSuccessResponse
  | VerifyClaimErrorResponse;

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
  body: VerifyClaimRequestBody;
}
interface ParsedBodyErr {
  ok: false;
  error: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isUuidV4(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4_REGEX.test(v.trim());
}

/**
 * Vercel parser typisk JSON automatisk (Content-Type: application/json), men
 * handleren kan modtage en raw string hvis clienten glemmer Content-Type.
 * Vi normaliserer defensively.
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

  // item_id — UUID v4.
  if (!isUuidV4(b.item_id)) {
    return { ok: false, error: 'invalid_item_id' };
  }
  const item_id = (b.item_id as string).trim().toLowerCase();

  // collector_user_id — UUID v4 (profiles.id).
  if (!isUuidV4(b.collector_user_id)) {
    return { ok: false, error: 'invalid_collector_user_id' };
  }
  const collector_user_id = (b.collector_user_id as string).trim().toLowerCase();

  // device_lat — matcher NUMERIC(10,7) CHECK BETWEEN -90 AND 90 (rimelig grid).
  if (!isFiniteNumber(b.device_lat) || b.device_lat < -90 || b.device_lat > 90) {
    return { ok: false, error: 'invalid_device_lat' };
  }
  const device_lat = b.device_lat;

  // device_long — CHECK BETWEEN -180 AND 180.
  if (
    !isFiniteNumber(b.device_long) ||
    b.device_long < -180 ||
    b.device_long > 180
  ) {
    return { ok: false, error: 'invalid_device_long' };
  }
  const device_long = b.device_long;

  return {
    ok: true,
    body: { item_id, collector_user_id, device_lat, device_long },
  };
}

// ---------- Geo (Haversine) ----------

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance i meter mellem to WGS84-punkter.
 * Haversine-formlen — praecis nok til <15m stopgap paa <=100km baseline.
 */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// ---------- Numerisk normalisering af DB-svar ----------

function coerceNumber(v: string | number, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const parsed = parseFloat(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------- Payout: complete den koblede logistics_bounty (best-effort) ----------

/**
 * Naar handling_type='municipal_pickup' er payout paa 75 DKK reserveret i
 * en tilhoerende logistics_bounties-raekke (asset_id = item_id,
 * event_type='bulky_pickup'). Vi flytter den fra 'claimed' -> 'completed'
 * med completed_at = now, saa downstream payout-pipelinen kan udbetale.
 *
 * Best-effort: fejl her invaliderer IKKE selve pickup-registreringen.
 * Payout kan altid haentes ind manuelt hvis bounty mangler.
 */
async function completeCoupledBounty(
  sb: SupabaseClient,
  itemId: string,
  collectorUserId: string,
): Promise<{ eligible: boolean; bounty_id: string | null; completed: boolean; reason: string; amount_dkk: number }> {
  try {
    const { data: bountyRow, error: selectErr } = await sb
      .from('logistics_bounties')
      .select('bounty_id, payout_dkk, status, claimed_by')
      .eq('asset_id', itemId)
      .eq('event_type', BULKY_PICKUP_BOUNTY_EVENT)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<BountyRow>();

    if (selectErr) {
      console.warn(
        `[${ENDPOINT_TAG}] bounty-lookup fejlede: ${selectErr.message} (code=${selectErr.code})`,
      );
      return {
        eligible: true,
        bounty_id: null,
        completed: false,
        reason: `bounty_lookup_failed: ${selectErr.message}`,
        amount_dkk: MUNICIPAL_PICKUP_PAYOUT_DKK,
      };
    }
    if (!bountyRow) {
      return {
        eligible: true,
        bounty_id: null,
        completed: false,
        reason: 'no_coupled_bounty',
        amount_dkk: MUNICIPAL_PICKUP_PAYOUT_DKK,
      };
    }
    if (bountyRow.status !== 'claimed') {
      return {
        eligible: true,
        bounty_id: bountyRow.bounty_id,
        completed: false,
        reason: `bounty_not_in_claimed_state (was=${bountyRow.status})`,
        amount_dkk: coerceNumber(bountyRow.payout_dkk, MUNICIPAL_PICKUP_PAYOUT_DKK),
      };
    }
    if (bountyRow.claimed_by !== collectorUserId) {
      return {
        eligible: true,
        bounty_id: bountyRow.bounty_id,
        completed: false,
        reason: 'bounty_claimer_mismatch',
        amount_dkk: coerceNumber(bountyRow.payout_dkk, MUNICIPAL_PICKUP_PAYOUT_DKK),
      };
    }

    const nowIso = new Date().toISOString();
    const { data: updatedBounty, error: updateErr } = await sb
      .from('logistics_bounties')
      .update({ status: 'completed', completed_at: nowIso, updated_at: nowIso })
      .eq('bounty_id', bountyRow.bounty_id)
      .eq('status', 'claimed') // optimistic guard
      .eq('claimed_by', collectorUserId)
      .select('bounty_id, payout_dkk, status, claimed_by')
      .maybeSingle<BountyRow>();

    if (updateErr) {
      console.warn(
        `[${ENDPOINT_TAG}] bounty-complete fejlede: ${updateErr.message} (code=${updateErr.code})`,
      );
      return {
        eligible: true,
        bounty_id: bountyRow.bounty_id,
        completed: false,
        reason: `bounty_update_failed: ${updateErr.message}`,
        amount_dkk: coerceNumber(bountyRow.payout_dkk, MUNICIPAL_PICKUP_PAYOUT_DKK),
      };
    }
    if (!updatedBounty) {
      return {
        eligible: true,
        bounty_id: bountyRow.bounty_id,
        completed: false,
        reason: 'bounty_update_race_lost',
        amount_dkk: coerceNumber(bountyRow.payout_dkk, MUNICIPAL_PICKUP_PAYOUT_DKK),
      };
    }
    console.log(
      `[${ENDPOINT_TAG}] Bounty completed: ${updatedBounty.bounty_id} payout=${updatedBounty.payout_dkk} DKK collector=${collectorUserId}`,
    );
    return {
      eligible: true,
      bounty_id: updatedBounty.bounty_id,
      completed: true,
      reason: 'bounty_completed',
      amount_dkk: coerceNumber(updatedBounty.payout_dkk, MUNICIPAL_PICKUP_PAYOUT_DKK),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[${ENDPOINT_TAG}] bounty-complete uventet: ${message}`);
    return {
      eligible: true,
      bounty_id: null,
      completed: false,
      reason: `bounty_exception: ${message}`,
      amount_dkk: MUNICIPAL_PICKUP_PAYOUT_DKK,
    };
  }
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
    const body: VerifyClaimErrorResponse = {
      success: false,
      error: 'method_not_allowed',
    };
    return res.status(405).json(body);
  }

  // 2) F3.8 Firebase-token verify. Mode styres af FIREBASE_ADMIN_ENFORCE
  //    (default warn_only mens migration ruller ud). I enforce-mode blokerer
  //    verifyFirebaseToken hvis token mangler eller er ugyldig.
  const firebaseVerify = await verifyFirebaseToken(req);
  if (!firebaseVerify.ok) {
    const errorCode =
      firebaseVerify.status === 401
        ? 'firebase_token_invalid'
        : firebaseVerify.status === 403
          ? 'firebase_uid_spoof'
          : 'firebase_token_missing';
    const body: VerifyClaimErrorResponse = {
      success: false,
      error: errorCode,
      detail: firebaseVerify.reason,
    };
    return res.status(firebaseVerify.status).json(body);
  }
  const authInfo: VerifyClaimData['auth'] = {
    firebase_verified: firebaseVerify.verified === true,
    firebase_uid: firebaseVerify.uid ?? null,
    mode: firebaseVerify.mode,
  };

  // 3) Body parsing + validering.
  const parsed = parseBody(req.body);
  if (!parsed.ok) {
    const body: VerifyClaimErrorResponse = {
      success: false,
      error: parsed.error,
    };
    return res.status(400).json(body);
  }
  const { item_id, collector_user_id, device_lat, device_long } = parsed.body;

  // 4) Supabase service-role klient.
  const sb = getSupabase();
  if (!sb) {
    const body: VerifyClaimErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail:
        'SUPABASE_URL/VITE_SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  try {
    // 5) Hent nuvaerende item-row (til geo + status + collector-kontrol).
    const { data: itemRow, error: itemErr } = await sb
      .from('bulky_waste_marketplace')
      .select(
        'item_id, user_id, collector_user_id, handling_type, current_status, latitude, longitude',
      )
      .eq('item_id', item_id)
      .maybeSingle<BulkyItemRow>();

    if (itemErr) {
      console.error(
        `[${ENDPOINT_TAG}] item-lookup fejlede: ${itemErr.message} (code=${itemErr.code})`,
      );
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'database_error',
        detail: itemErr.message,
      };
      return res.status(500).json(body);
    }
    if (!itemRow) {
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'item_not_found',
      };
      return res.status(404).json(body);
    }

    // 6) Statuskontrakt: kun 'reserved' og 'claimed' kan verificeres.
    const previous_status = itemRow.current_status;
    if (previous_status !== 'reserved' && previous_status !== 'claimed') {
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'invalid_status_transition',
        detail: `current_status=${previous_status}; kun 'reserved' eller 'claimed' kan haandshake-verificeres`,
      };
      return res.status(409).json(body);
    }

    // 7) Kollektor-kontrakt: body.collector_user_id skal matche row.collector_user_id.
    //    (Undgaar at en anden kollektor kaprer en fremmeds reservation.)
    if (
      !itemRow.collector_user_id ||
      itemRow.collector_user_id !== collector_user_id
    ) {
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'collector_mismatch',
        detail: 'collector_user_id matcher ikke den registrerede kollektor.',
      };
      return res.status(403).json(body);
    }

    // 8) Geo-kontrol via Haversine. NUMERIC(10,7) kan komme som string i JS-driveren.
    const itemLat = coerceNumber(itemRow.latitude);
    const itemLon = coerceNumber(itemRow.longitude);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon)) {
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'database_error',
        detail: 'item lat/long ikke numerisk parselbar',
      };
      return res.status(500).json(body);
    }
    const distance_meters = haversineMeters(
      device_lat,
      device_long,
      itemLat,
      itemLon,
    );
    if (!Number.isFinite(distance_meters)) {
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'internal_error',
        detail: 'haversine returnerede ikke-endelig vaerdi',
      };
      return res.status(500).json(body);
    }
    if (distance_meters > MAX_HANDSHAKE_DISTANCE_METERS) {
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'geo_out_of_range',
        detail: `distance=${distance_meters.toFixed(2)}m > max=${MAX_HANDSHAKE_DISTANCE_METERS}m`,
      };
      return res.status(422).json(body);
    }

    // 9) Atomisk state-transition -> 'collected'. Bruger WHERE-guard paa
    //    current_status og collector_user_id, saa race-conditions taber
    //    (row-count = 0) i stedet for at overskrive fremmed data.
    const nowIso = new Date().toISOString();
    const { data: updatedRow, error: updateErr } = await sb
      .from('bulky_waste_marketplace')
      .update({ current_status: 'collected', updated_at: nowIso })
      .eq('item_id', item_id)
      .eq('collector_user_id', collector_user_id)
      .in('current_status', ['reserved', 'claimed'])
      .select(
        'item_id, current_status, collector_user_id, handling_type, updated_at',
      )
      .maybeSingle<BulkyItemUpdatedRow>();

    if (updateErr) {
      console.error(
        `[${ENDPOINT_TAG}] update fejlede: ${updateErr.message} (code=${updateErr.code})`,
      );
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'database_error',
        detail: updateErr.message,
      };
      return res.status(500).json(body);
    }
    if (!updatedRow) {
      // Race-condition tabt: en anden request naaede at flytte status.
      const body: VerifyClaimErrorResponse = {
        success: false,
        error: 'invalid_status_transition',
        detail:
          'row-guard afviste UPDATE — status blev aendret af en anden request eller collector-mismatch opstod',
      };
      return res.status(409).json(body);
    }

    // 10) Payout — kun for 'municipal_pickup'. Best-effort bounty-completion.
    let payout: VerifyClaimPayoutInfo;
    if (updatedRow.handling_type === MUNICIPAL_PICKUP_HANDLING_TYPE) {
      const bountyResult = await completeCoupledBounty(
        sb,
        item_id,
        collector_user_id,
      );
      payout = {
        eligible: true,
        amount_dkk: bountyResult.amount_dkk,
        bounty_id: bountyResult.bounty_id,
        bounty_completed: bountyResult.completed,
        reason: bountyResult.reason,
      };
    } else {
      payout = {
        eligible: false,
        amount_dkk: 0,
        bounty_id: null,
        bounty_completed: false,
        reason: `handling_type=${updatedRow.handling_type} udloeser ingen payout`,
      };
    }

    // 11) Struktureret success-svar.
    const claim_receipt_id = `CLAIM-${randomUUID()}`;
    const success: VerifyClaimSuccessResponse = {
      success: true,
      data: {
        claim_receipt_id,
        item_id: updatedRow.item_id,
        collector_user_id,
        previous_status,
        new_status: updatedRow.current_status,
        handling_type: updatedRow.handling_type,
        distance_meters: Math.round(distance_meters * 100) / 100,
        handshake_verified_at: updatedRow.updated_at,
        payout,
        auth: authInfo,
      },
    };
    res.setHeader('X-Cirkel-Claim-Receipt', claim_receipt_id);
    res.setHeader('X-Cirkel-Item-Id', updatedRow.item_id);
    console.log(
      `[${ENDPOINT_TAG}] pickup verificeret: item=${updatedRow.item_id} collector=${collector_user_id} distance=${distance_meters.toFixed(2)}m handling=${updatedRow.handling_type} payout_eligible=${payout.eligible} bounty_completed=${payout.bounty_completed}`,
    );
    return res.status(200).json(success);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${ENDPOINT_TAG}] uventet fejl: ${message}`);
    const body: VerifyClaimErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}
