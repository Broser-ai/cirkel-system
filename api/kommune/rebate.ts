// cirkel-system/api/kommune/rebate.ts
//
// Modul 11.3 — Municipal Tax Rebate Calculator (kvartalsvis afgiftsrabat).
// Backing store: migration 011_municipal_tax_rebates.sql
//                (public.municipal_tax_rebates).
//
// Endpoint:
//   POST /api/kommune/rebate
//     body: {
//       user_id:          string (påkrævet, UUID v4/v1 — refererer profiles.id)
//       quarterly_period: string (påkrævet, ^[0-9]{4}-Q[1-4]$ fx "2026-Q3")
//     }
//
// Adfærd:
//   1) Beregner kvartalets [from, to)-vindue ud fra quarterly_period.
//   2) Aggregerer alle brugerens scans i vinduet.
//   3) Henter emission_factors-embed (LEFT JOIN) og udleder CO2-kg pr. scan
//      som weight_kg × co2_kg_per_kg. Fallbacker gracefully hvis relationen
//      ikke findes i skemaet (samme pattern som api/kpi/scans.ts).
//   4) Rebate-formel: min(total_co2_kg × 1.50 DKK, 500 DKK). Loft matcher
//      EU-PPWR statsstøtte-cap og migrationens CHECK-constraint.
//   5) UPSERT på (user_id, quarterly_period) — matcher migration 011's
//      UNIQUE-constraint, så gentagne kald opdaterer in-place uden fejl.
//   6) municipal_zone hentes fra profiles.municipality (kanonisk kilde).
//
// Auth:   F3.8-mønsteret. Officer-portalen/sovereign-cron sender Firebase
//         ID-token i Authorization: Bearer <token>. verifyFirebaseToken
//         bruger FIREBASE_ADMIN_ENFORCE til at bestemme om mismatch = 401.
//         requiredUid sendes IKKE — user_id her er profiles.id (Supabase-UUID),
//         ikke Firebase-uid; token-verify bekræfter kun caller-identitet.
//
// Response-format:
//   200 { success: true,  data: { rebate: MunicipalTaxRebateRow,
//                                 computation: { total_weight_sorted_kg,
//                                                total_co2_kg,
//                                                calculated_rebate_dkk,
//                                                capped: boolean,
//                                                scan_count: number,
//                                                emission_factors_available: boolean,
//                                                period_start: string,
//                                                period_end: string },
//                                 auth: { firebase_verified: boolean } } }
//   4xx/5xx { success: false, error: "<slug>", detail?: "<string>" }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Domænetyper (afspejler migration 011) ----------

interface MunicipalTaxRebateRow {
  rebate_id: string;
  user_id: string;
  municipal_zone: string;
  quarterly_period: string;
  total_weight_sorted_kg: number;
  calculated_rebate_dkk: number;
  paid_out: boolean;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RebateRequestBody {
  user_id: string;
  quarterly_period: string;
}

interface EmissionFactorEmbed {
  material: string;
  co2_kg_per_kg: number | string | null;
}

interface ScanRow {
  weight_grams: number | string | null;
  material: string | null;
  created_at: string;
  emission_factors: EmissionFactorEmbed | EmissionFactorEmbed[] | null;
}

interface ScanRowWithoutFactor {
  weight_grams: number | string | null;
  material: string | null;
  created_at: string;
}

interface ProfileMunicipalityRow {
  id: string;
  municipality: string | null;
}

interface ComputationSummary {
  total_weight_sorted_kg: number;
  total_co2_kg: number;
  calculated_rebate_dkk: number;
  capped: boolean;
  scan_count: number;
  emission_factors_available: boolean;
  period_start: string;
  period_end: string;
}

interface RebateSuccessData {
  rebate: MunicipalTaxRebateRow;
  computation: ComputationSummary;
  auth: { firebase_verified: boolean };
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

// ---------- Konstanter (matcher migration 011 + task-spec) ----------

// Rebate-formel: DKK pr. kg CO2 sparet. Overstyrbar via env for zone-specifik
// justering (Aarhus, København osv.) — default matcher task-spec 11.3.
const REBATE_RATE_DKK_PER_KG_CO2: number = (() => {
  const raw = process.env.CIRKEL_REBATE_RATE_DKK_PER_KG_CO2;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1.5;
})();

// Loft pr. borger pr. kvartal — jf. EU-PPWR statsstøtte-cap. Matcher DB
// CHECK-constraint calculated_rebate_dkk <= 500; må aldrig hæves uden
// samtidig migration af constrainten.
const MAX_REBATE_DKK = 500;

// Regex matcher DB-constraint municipal_tax_rebates_period_format_chk.
const QUARTERLY_PERIOD_REGEX = /^([0-9]{4})-Q([1-4])$/;

// UUID v1-v5 (bredt) — user_id er profiles.id som er UUID. Robust mod både
// v4 (default fra uuid-ossp) og evt. auth.users v1 hvis nogen skulle findes.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Øvre bound matcher DB CHECK total_weight_sorted_kg <= 10000. Hvis en
// aggregeret sum overstiger dette, capper vi til grænsen (ellers ville
// UPSERT'en fejle med check_violation).
const MAX_WEIGHT_SORTED_KG = 10000;

const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';
const CONFLICT_TARGET = 'user_id,quarterly_period';
const DEFAULT_MUNICIPALITY = 'Aarhus Kommune';

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/kommune/rebate' } },
  });
  return cachedClient;
}

// ---------- Type-guards + helpers ----------

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Trækker ét emission_factor-embed ud uanset om PostgREST returnerede
 *  object eller array (afhænger af FK-retning i schemaet). Samme kontrakt
 *  som api/kpi/scans.ts:extractFactor for konsistent adfærd. */
function extractFactor(
  embed: EmissionFactorEmbed | EmissionFactorEmbed[] | null,
): EmissionFactorEmbed | null {
  if (!embed) return null;
  if (Array.isArray(embed)) return embed.length > 0 ? embed[0] : null;
  return embed;
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

// ---------- Body-validering ----------

interface ValidatedInput {
  user_id: string;
  quarterly_period: string;
}

interface ValidationOk {
  ok: true;
  value: ValidatedInput;
}

interface ValidationFail {
  ok: false;
  status: number;
  error: string;
  detail?: string;
}

type ValidationResult = ValidationOk | ValidationFail;

function validateBody(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, status: 400, error: 'body_invalid', detail: 'JSON object required' };
  }

  const body = raw as Partial<RebateRequestBody>;

  // user_id
  if (!isNonEmptyString(body.user_id)) {
    return { ok: false, status: 400, error: 'user_id_required' };
  }
  const userId = body.user_id.trim().toLowerCase();
  if (!isValidUuid(userId)) {
    return {
      ok: false,
      status: 400,
      error: 'user_id_invalid',
      detail: 'Must be a UUID (profiles.id)',
    };
  }

  // quarterly_period
  if (!isNonEmptyString(body.quarterly_period)) {
    return { ok: false, status: 400, error: 'quarterly_period_required' };
  }
  const period = body.quarterly_period.trim().toUpperCase();
  if (!QUARTERLY_PERIOD_REGEX.test(period)) {
    return {
      ok: false,
      status: 400,
      error: 'quarterly_period_invalid',
      detail: 'Must match ^[0-9]{4}-Q[1-4]$ (e.g. "2026-Q3")',
    };
  }

  return {
    ok: true,
    value: { user_id: userId, quarterly_period: period },
  };
}

// ---------- Kvartal → date-range ----------

interface QuarterRange {
  /** Inklusiv start (ISO-8601, UTC). */
  startIso: string;
  /** Eksklusiv slut (ISO-8601, UTC) — start på næste kvartal. */
  endIsoExclusive: string;
}

/** Konverterer "YYYY-QN" til [start, next-quarter-start) i UTC.
 *  Q1 = jan-mar, Q2 = apr-jun, Q3 = jul-sep, Q4 = okt-dec. */
function quarterRange(period: string): QuarterRange {
  const match = QUARTERLY_PERIOD_REGEX.exec(period);
  if (!match) {
    // Skulle aldrig ske efter validateBody, men typescript kræver narrowing.
    throw new Error(`quarterRange: invalid period "${period}"`);
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonthIndex = (quarter - 1) * 3; // 0, 3, 6, 9
  const start = new Date(Date.UTC(year, startMonthIndex, 1, 0, 0, 0, 0));
  const endMonthIndex = startMonthIndex + 3;
  const endYear = endMonthIndex >= 12 ? year + 1 : year;
  const endMonthNormalized = endMonthIndex % 12;
  const end = new Date(Date.UTC(endYear, endMonthNormalized, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIsoExclusive: end.toISOString() };
}

// ---------- Profil-opslag (municipality → municipal_zone) ----------

async function fetchMunicipalZone(
  sb: SupabaseClient,
  userId: string,
): Promise<{ ok: true; zone: string } | { ok: false; status: number; error: string; detail: string }> {
  const { data, error } = await sb
    .from('profiles')
    .select('id,municipality')
    .eq('id', userId)
    .maybeSingle<ProfileMunicipalityRow>();

  if (error) {
    return {
      ok: false,
      status: 500,
      error: 'profile_lookup_failed',
      detail: error.message,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: 'user_not_found',
      detail: `No profile with id="${userId}"`,
    };
  }
  const zone = (data.municipality ?? '').trim() || DEFAULT_MUNICIPALITY;
  return { ok: true, zone };
}

// ---------- Aggregering af scans → weight + CO2 ----------

interface AggregationResult {
  total_weight_kg: number;
  total_co2_kg: number;
  scan_count: number;
  emission_factors_available: boolean;
}

interface AggregationOk {
  ok: true;
  value: AggregationResult;
}

interface AggregationFail {
  ok: false;
  status: number;
  error: string;
  detail: string;
}

type AggregationOutcome = AggregationOk | AggregationFail;

async function aggregateQuarterScans(
  sb: SupabaseClient,
  userId: string,
  range: QuarterRange,
): Promise<AggregationOutcome> {
  // Første forsøg: WITH emission_factors embed. Hvis relationen ikke er
  // eksponeret i PostgREST-schemaet (fx fordi tabellen ikke findes i miljøet),
  // falder vi tilbage til uden co2-berigelse — samme fallback-kontrakt
  // som api/kpi/scans.ts:fetchScans for konsistens.
  const selectWithFactor =
    'weight_grams,material,created_at,emission_factors(material,co2_kg_per_kg)';
  const selectWithoutFactor = 'weight_grams,material,created_at';

  const withFactor = await sb
    .from('scans')
    .select(selectWithFactor)
    .eq('user_id', userId)
    .gte('created_at', range.startIso)
    .lt('created_at', range.endIsoExclusive)
    .returns<ScanRow[]>();

  if (withFactor.error) {
    const msg = String(withFactor.error.message ?? '').toLowerCase();
    const details = String(withFactor.error.details ?? '').toLowerCase();
    const hint = String(withFactor.error.hint ?? '').toLowerCase();
    const looksLikeMissingRelation =
      msg.includes('emission_factors') ||
      details.includes('emission_factors') ||
      hint.includes('emission_factors') ||
      msg.includes('could not find a relationship') ||
      msg.includes('relation') && msg.includes('does not exist');

    if (!looksLikeMissingRelation) {
      return {
        ok: false,
        status: 500,
        error: 'scans_query_failed',
        detail: withFactor.error.message,
      };
    }

    console.warn(
      '[api/kommune/rebate] emission_factors-embed ikke tilgængelig — falder tilbage til weight-only. Årsag:',
      withFactor.error.message,
    );

    const fallback = await sb
      .from('scans')
      .select(selectWithoutFactor)
      .eq('user_id', userId)
      .gte('created_at', range.startIso)
      .lt('created_at', range.endIsoExclusive)
      .returns<ScanRowWithoutFactor[]>();

    if (fallback.error) {
      return {
        ok: false,
        status: 500,
        error: 'scans_query_failed',
        detail: fallback.error.message,
      };
    }

    // Uden emission_factors-tabellen kan vi ikke beregne CO2 → total_co2_kg = 0
    // og dermed rebate = 0. Rebate-rækken oprettes stadig, så cron kan
    // gen-beregne når emission_factors-relationen bliver tilføjet.
    const rows: ScanRowWithoutFactor[] = fallback.data ?? [];
    let total_weight_kg = 0;
    for (const row of rows) {
      total_weight_kg += toNumber(row.weight_grams) / 1000;
    }
    return {
      ok: true,
      value: {
        total_weight_kg,
        total_co2_kg: 0,
        scan_count: rows.length,
        emission_factors_available: false,
      },
    };
  }

  const rows: ScanRow[] = withFactor.data ?? [];
  let total_weight_kg = 0;
  let total_co2_kg = 0;
  for (const row of rows) {
    const weightKg = toNumber(row.weight_grams) / 1000;
    const factor = extractFactor(row.emission_factors);
    const co2PerKg = toNumber(factor?.co2_kg_per_kg);
    total_weight_kg += weightKg;
    total_co2_kg += weightKg * co2PerKg;
  }

  return {
    ok: true,
    value: {
      total_weight_kg,
      total_co2_kg,
      scan_count: rows.length,
      emission_factors_available: true,
    },
  };
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  const method = (req.method ?? 'GET').toUpperCase();

  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'method_not_allowed');
  }

  const sb = getSupabase();
  if (!sb) return sendError(res, 503, 'supabase_not_configured');

  // F3.8 — verificer Firebase ID-token hvis sendt. requiredUid sendes IKKE,
  // fordi user_id her er profiles.id (Supabase-UUID), ikke Firebase-uid.
  // FIREBASE_ADMIN_ENFORCE=1 → manglende/ugyldig token = hård 401.
  const verify = await verifyFirebaseToken(req);
  if (!verify.ok) {
    return sendError(res, verify.status, 'firebase_verify_failed', verify.reason);
  }

  const validation = validateBody(req.body);
  if (!validation.ok) {
    return sendError(res, validation.status, validation.error, validation.detail);
  }
  const input = validation.value;

  try {
    // 1) Hent municipal_zone fra profiles (kanonisk kilde).
    const zoneLookup = await fetchMunicipalZone(sb, input.user_id);
    if (!zoneLookup.ok) {
      return sendError(res, zoneLookup.status, zoneLookup.error, zoneLookup.detail);
    }
    const municipal_zone = zoneLookup.zone;

    // 2) Beregn kvartalets tidsvindue.
    const range = quarterRange(input.quarterly_period);

    // 3) Aggregér scans → weight + CO2.
    const aggregation = await aggregateQuarterScans(sb, input.user_id, range);
    if (!aggregation.ok) {
      return sendError(res, aggregation.status, aggregation.error, aggregation.detail);
    }
    const { total_weight_kg, total_co2_kg, scan_count, emission_factors_available } =
      aggregation.value;

    // 4) Rebate-formel: min(co2_kg × rate, cap). Cap match'er DB-constraint.
    const uncappedRebate = total_co2_kg * REBATE_RATE_DKK_PER_KG_CO2;
    const cappedRebate = Math.min(uncappedRebate, MAX_REBATE_DKK);
    const calculated_rebate_dkk = round2(Math.max(0, cappedRebate));
    const capped = uncappedRebate > MAX_REBATE_DKK;

    // Sikr at total_weight_sorted_kg holder sig inden for DB-constraint
    // (0-10000). Ekstremt scenarie, men undgår hard 500 fra check_violation.
    const total_weight_sorted_kg = round3(
      Math.min(Math.max(0, total_weight_kg), MAX_WEIGHT_SORTED_KG),
    );

    // 5) UPSERT på (user_id, quarterly_period) — genbrug samme række på
    //    gen-beregning fra sovereign cron eller sen-ankommet vægt-data.
    //    paid_out/paid_at røres IKKE her — dem markerer kommune-portalen
    //    efter bank-webhook (jf. migration 011 CHECK-consistency).
    const upsertRow = {
      user_id: input.user_id,
      municipal_zone,
      quarterly_period: input.quarterly_period,
      total_weight_sorted_kg,
      calculated_rebate_dkk,
    };

    const { data: upserted, error: upsertError } = await sb
      .from('municipal_tax_rebates')
      .upsert(upsertRow, {
        onConflict: CONFLICT_TARGET,
        ignoreDuplicates: false,
        defaultToNull: false,
      })
      .select('*')
      .single<MunicipalTaxRebateRow>();

    if (upsertError) {
      // 23514 = check_violation, 23505 = unique_violation, 23503 = fk_violation
      if (upsertError.code === '23514') {
        return sendError(res, 400, 'db_check_violation', upsertError.message);
      }
      if (upsertError.code === '23505') {
        return sendError(res, 409, 'db_unique_violation', upsertError.message);
      }
      if (upsertError.code === '23503') {
        return sendError(res, 404, 'db_fk_violation', upsertError.message);
      }
      return sendError(res, 500, 'db_upsert_failed', upsertError.message);
    }

    if (!upserted) {
      return sendError(res, 500, 'db_upsert_empty_result');
    }

    const payload: RebateSuccessData = {
      rebate: upserted,
      computation: {
        total_weight_sorted_kg,
        total_co2_kg: round3(total_co2_kg),
        calculated_rebate_dkk,
        capped,
        scan_count,
        emission_factors_available,
        period_start: range.startIso,
        period_end: range.endIsoExclusive,
      },
      auth: { firebase_verified: verify.verified },
    };
    return sendSuccess(res, payload, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown internal error';
    console.error('[api/kommune/rebate] internal_error:', message);
    return sendError(res, 500, 'internal_error', message);
  }
}
