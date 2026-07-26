// cirkel-system/api/bins/ping.ts
//
// Modul 12.1 — IoT Smart-Bin heartbeat endpoint.
//
// POST /api/bins/ping
//
// Body (application/json):
//   {
//     "bin_id": "SB-AAR-0142",
//     "current_weight_kg": 12.4,
//     "fill_level_percentage": 87.5,
//     "battery_voltage_mv": 3720,
//     "tilt_sensor_triggered": false
//   }
//
// Ansvar:
//   1. Validér body-payload (400 hvis felter mangler eller er ugyldige).
//   2. Beregn operating_status ud fra sensor-tilstand:
//        - fill_level_percentage >= 85     -> "Full"
//        - tilt_sensor_triggered === true  -> "Maintenance"
//        - ellers                          -> "Operational"
//      (Bemærk: rækkefølgen følger spec bogstaveligt — Full > Maintenance > Operational.)
//   3. F3.8: verificér Bearer-token hvis sendt (warn_only-mode; IoT-devices kan
//      autentificere via device-key i stedet, men vi logger UID-spoof for
//      eventuelle klient-drevne pings).
//   4. Persistér heartbeat i to trin:
//        a) UPDATE smart_bins (fill_level_percent, status, last_seen, ...)
//        b) INSERT into bin_heartbeats (rå event-log for tidsserie).
//      Fejler heartbeat-log-insertet (fx tabel ikke migreret endnu), logges det
//      men request'et returnerer stadig 200 så længe smart_bins-update lykkedes.
//
// Response-format:
//   200: { success: true, data: { bin_id, operating_status, previous_status,
//                                 fill_level_percentage, battery_voltage_mv,
//                                 tilt_sensor_triggered, current_weight_kg,
//                                 heartbeat_at, log_persisted, auth } }
//   400: { success: false, error: "invalid_body" | "invalid_<field>" }
//   401/403: { success: false, error: "<verify_reason>" }  (kun i enforce-mode)
//   404: { success: false, error: "bin_not_found" }
//   405: { success: false, error: "method_not_allowed" }
//   500: { success: false, error: "internal_error", detail?: string }
//   503: { success: false, error: "supabase_not_configured" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Types ----------

type OperatingStatus = 'Operational' | 'Maintenance' | 'Full';

interface PingBody {
  bin_id: string;
  current_weight_kg: number;
  fill_level_percentage: number;
  battery_voltage_mv: number;
  tilt_sensor_triggered: boolean;
}

interface PingSuccessData {
  bin_id: string;
  operating_status: OperatingStatus;
  previous_status: string | null;
  fill_level_percentage: number;
  battery_voltage_mv: number;
  tilt_sensor_triggered: boolean;
  current_weight_kg: number;
  heartbeat_at: string;
  log_persisted: boolean;
  auth: {
    verified: boolean;
    uid: string | null;
  };
}

interface PingSuccessResponse {
  success: true;
  data: PingSuccessData;
}

interface PingErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type PingResponse = PingSuccessResponse | PingErrorResponse;

// Whitelist af tilladt input for bin_id — undgår SQL/URL-injektion via odd tegn.
// Format: prefiks-KOMMUNE-nummer, fx "SB-AAR-0142". 4-64 tegn, alfanumerisk + bindestreg/underscore.
const BIN_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

const FILL_LEVEL_FULL_THRESHOLD = 85;
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';
const HEARTBEAT_LOG_TABLE = 'bin_heartbeats';
const SMART_BINS_TABLE = 'smart_bins';

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/bins/ping' } },
  });
  return cachedClient;
}

// ---------- Body-parsing & validation ----------

interface ParsedBody {
  ok: true;
  body: PingBody;
}

interface ParsedBodyError {
  ok: false;
  error: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function coerceBody(raw: unknown): unknown {
  // Vercel parser normalt JSON automatisk, men hvis Content-Type ikke er sat
  // eller runtime'n leverer body som streng, forsøger vi at parse den her.
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function parseBody(raw: unknown): ParsedBody | ParsedBodyError {
  const source = coerceBody(raw);
  if (!isPlainObject(source)) {
    return { ok: false, error: 'invalid_body' };
  }

  const bin_id = source.bin_id;
  if (typeof bin_id !== 'string' || !BIN_ID_PATTERN.test(bin_id)) {
    return { ok: false, error: 'invalid_bin_id' };
  }

  const current_weight_kg = source.current_weight_kg;
  if (!isFiniteNumber(current_weight_kg) || current_weight_kg < 0 || current_weight_kg > 10_000) {
    return { ok: false, error: 'invalid_current_weight_kg' };
  }

  const fill_level_percentage = source.fill_level_percentage;
  if (!isFiniteNumber(fill_level_percentage) || fill_level_percentage < 0 || fill_level_percentage > 100) {
    return { ok: false, error: 'invalid_fill_level_percentage' };
  }

  const battery_voltage_mv = source.battery_voltage_mv;
  if (!isFiniteNumber(battery_voltage_mv) || battery_voltage_mv < 0 || battery_voltage_mv > 20_000) {
    return { ok: false, error: 'invalid_battery_voltage_mv' };
  }

  const tilt_sensor_triggered = source.tilt_sensor_triggered;
  if (typeof tilt_sensor_triggered !== 'boolean') {
    return { ok: false, error: 'invalid_tilt_sensor_triggered' };
  }

  return {
    ok: true,
    body: {
      bin_id,
      current_weight_kg,
      fill_level_percentage,
      battery_voltage_mv,
      tilt_sensor_triggered,
    },
  };
}

// ---------- Domain-logik ----------

/**
 * Beregner operating_status ud fra spec (Modul 12.1):
 *   - Full         hvis fill_level_percentage >= 85
 *   - Maintenance  hvis tilt_sensor_triggered === true
 *   - Operational  ellers
 *
 * Rækkefølgen følger spec bogstaveligt — Full evalueres først. Hvis begge
 * betingelser er sande vinder Full (hardware-anomali kræver visuel inspektion
 * af fyldegraden ved tømning uanset).
 */
export function computeOperatingStatus(input: {
  fill_level_percentage: number;
  tilt_sensor_triggered: boolean;
}): OperatingStatus {
  if (input.fill_level_percentage >= FILL_LEVEL_FULL_THRESHOLD) return 'Full';
  if (input.tilt_sensor_triggered) return 'Maintenance';
  return 'Operational';
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
    const body: PingErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2) Body-validation (400 hvis ugyldig)
  const parsed = parseBody(req.body);
  if (!parsed.ok) {
    res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
    const body: PingErrorResponse = { success: false, error: parsed.error };
    return res.status(400).json(body);
  }
  const payload = parsed.body;

  // 3) F3.8 — verify Bearer-token hvis sendt. IoT-devices bruger typisk device-key
  //    i stedet for Firebase-token, så vi kører warn_only her og eskalerer kun
  //    hvis env-mode er "enforce".
  const verifyResult = await verifyFirebaseToken(req, { mode: 'warn_only' });
  if (!verifyResult.ok) {
    res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
    const body: PingErrorResponse = {
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
    res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
    const body: PingErrorResponse = {
      success: false,
      error: 'supabase_not_configured',
      detail: 'SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler i env.',
    };
    return res.status(503).json(body);
  }

  // 5) Beregn operating_status
  const operating_status = computeOperatingStatus({
    fill_level_percentage: payload.fill_level_percentage,
    tilt_sensor_triggered: payload.tilt_sensor_triggered,
  });

  const heartbeat_at = new Date().toISOString();

  try {
    // 6) Slå bin op for at få previous_status og verificere at bin'et eksisterer.
    const lookup = await sb
      .from(SMART_BINS_TABLE)
      .select('id, status')
      .eq('id', payload.bin_id)
      .maybeSingle();

    if (lookup.error) {
      console.error('[api/bins/ping] Supabase-lookup-fejl:', lookup.error.message, lookup.error.code);
      res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
      const body: PingErrorResponse = {
        success: false,
        error: 'database_error',
        detail: lookup.error.message,
      };
      return res.status(500).json(body);
    }

    if (!lookup.data) {
      res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
      const body: PingErrorResponse = { success: false, error: 'bin_not_found' };
      return res.status(404).json(body);
    }

    const previous_status: string | null =
      typeof lookup.data.status === 'string' ? lookup.data.status : null;

    // 7) UPDATE smart_bins med sensor-snapshot.
    const update = await sb
      .from(SMART_BINS_TABLE)
      .update({
        status: operating_status,
        fill_level_percent: payload.fill_level_percentage,
        last_seen: heartbeat_at,
        updated_at: heartbeat_at,
      })
      .eq('id', payload.bin_id);

    if (update.error) {
      console.error('[api/bins/ping] Supabase-update-fejl:', update.error.message, update.error.code);
      res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
      const body: PingErrorResponse = {
        success: false,
        error: 'database_error',
        detail: update.error.message,
      };
      return res.status(500).json(body);
    }

    // 8) INSERT ind i bin_heartbeats (tidsserie-log). Fejler dette (fx tabel
    //    ikke migreret endnu), logger vi og lader response'en gå igennem —
    //    hovedopgaven (smart_bins-update) er allerede sket.
    let log_persisted = false;
    try {
      const insert = await sb.from(HEARTBEAT_LOG_TABLE).insert({
        bin_id: payload.bin_id,
        current_weight_kg: payload.current_weight_kg,
        fill_level_percentage: payload.fill_level_percentage,
        battery_voltage_mv: payload.battery_voltage_mv,
        tilt_sensor_triggered: payload.tilt_sensor_triggered,
        operating_status,
        heartbeat_at,
      });
      if (insert.error) {
        console.warn(
          '[api/bins/ping] Heartbeat-log-insert fejlede (fortsætter):',
          insert.error.message,
          insert.error.code,
        );
      } else {
        log_persisted = true;
      }
    } catch (logErr) {
      const msg = logErr instanceof Error ? logErr.message : String(logErr);
      console.warn('[api/bins/ping] Heartbeat-log-insert kastede (fortsætter):', msg);
    }

    // 9) Success-response
    res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
    res.setHeader('X-Cirkel-Endpoint', 'api/bins/ping');
    res.setHeader('X-Bin-Status', operating_status);

    const body: PingSuccessResponse = {
      success: true,
      data: {
        bin_id: payload.bin_id,
        operating_status,
        previous_status,
        fill_level_percentage: payload.fill_level_percentage,
        battery_voltage_mv: payload.battery_voltage_mv,
        tilt_sensor_triggered: payload.tilt_sensor_triggered,
        current_weight_kg: payload.current_weight_kg,
        heartbeat_at,
        log_persisted,
        auth: authInfo,
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/bins/ping] Uventet fejl:', message);
    res.setHeader('Cache-Control', CACHE_CONTROL_NO_STORE);
    const body: PingErrorResponse = {
      success: false,
      error: 'internal_error',
      detail: message,
    };
    return res.status(500).json(body);
  }
}

// Ren type-eksport så tests / klienter kan importere schema uden run-time cost.
export type {
  PingBody,
  PingSuccessData,
  PingSuccessResponse,
  PingErrorResponse,
  PingResponse,
  OperatingStatus,
};
