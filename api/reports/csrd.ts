// cirkel-system/api/reports/csrd.ts
//
// Modul 10.3 -- CSRD / EPR Export Engine (B2B Producer Portal)
//
// Formaal:
//   Aggregér alle recycling-transaktioner (public.scans) for én producent
//   i ét givet kvartal og returnér en struktureret JSON-rapport i "Vana"-
//   format klar til import i CSRD-værktøjer (Vana, Position Green, Sweep)
//   og til EPR-indberetning (Emballageregisteret / DPA).
//
// Endpoint:
//   POST /api/reports/csrd
//   Headers: Authorization: Bearer <firebase-id-token>
//   Body:   { firebaseUid: string, producer_id: string (uuid), quarter: string ("YYYY-QN") }
//
// Response:
//   200 { success: true, data: CSRDExportPayload }
//   4xx/5xx { success: false, error: string, detail?: string }
//
// Datamodel-join:
//   scans (recycling-transaktioner) JOIN material_passports (barcode → producer)
//   Filtreret på material_passports.producer_id + scans.created_at ∈ kvartal.
//
// Ansvar:
//   * Firebase-token-verify via F3.8 (resolveTrustedUid)
//   * Autorisation: kun aktive producenter tilknyttet kaldende bruger må trække
//   * Aggregering, EPR-fee-beregning, CO2-estimering pr. fraktion
//   * Vana-format v1 output (report_meta / producer / aggregates /
//     material_breakdown / fraction_breakdown / epr_summary / co2 / audit)
//
// Sikkerhed:
//   * Kun service-role Supabase-klient (bypass RLS, hentet lazy fra env)
//   * Ingen hemmeligheder i kode -- alt via process.env
//   * Cache-Control: no-store (rapport indeholder finansielle aggregater)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';
import {
  calculateDynamicEPRPenalty,
  BASE_EPR_FEE_PER_KG,
  type MaterialPassport as EPRMaterialPassport,
} from '../_epr.js';

// ---------- Konstanter ----------

const REPORT_FORMAT = 'vana-csrd-epr-v1';
const REPORT_VERSION = '1.0.0';
const CACHE_CONTROL_NO_STORE = 'no-store, max-age=0';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUARTER_REGEX = /^([0-9]{4})-Q([1-4])$/;
const CVR_REGEX = /^[0-9]{8}$/;

// Supabase har hårde grænser på .in() (typisk ~1000). Vi batch'er barcodes.
const BARCODE_IN_BATCH_SIZE = 500;
// Sikkerheds-øvre bund på antal scans der aggregeres pr. rapport (memory-guard).
const MAX_SCANS_PER_REPORT = 250000;
const SCAN_PAGE_SIZE = 1000;

// CO2-besparelser (kg CO2e sparet pr. kg genanvendt materiale). Danske
// standardfaktorer fra DAKOFA/Miljøstyrelsen 2024, afrundet til 1 decimal.
// Bruges kun til rapport-estimat -- ikke revisionsgrundlag.
const CO2_FACTOR_KG_PER_KG: Readonly<Record<string, number>> = Object.freeze({
  Plast: 1.5,
  Metal: 4.0,
  Glas: 0.3,
  Papir: 0.9,
  Pap: 0.9,
  'Mad- og drikkekartoner': 0.9,
  Madaffald: 0.5,
  Elektronik: 3.0,
  Batterier: 8.0,
  Tekstil: 3.5,
  'Farligt affald': 0.0,
  Restaffald: 0.0,
});
const CO2_FACTOR_DEFAULT = 0.5;

// ---------- Domænetyper ----------

type Quarter = `${number}-Q${1 | 2 | 3 | 4}`;

interface CSRDRequestBody {
  firebaseUid: string;
  producer_id: string;
  quarter: string;
}

interface ProducerRow {
  producer_id: string;
  company_name: string;
  cvr_number: string;
  contact_email: string;
  subscription_tier: string;
  monthly_fee_dkk: number;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
}

interface MaterialPassportRow {
  barcode_id: string;
  producer_id: string | null;
  product_name: string;
  primary_material: string | null;
  composite_materials: Record<string, unknown> | null;
  danish_fraction: string | null;
  base_reward_points: number;
  epr_penalty_dkk: number | null;
}

interface ScanRow {
  id: string;
  user_id: string;
  barcode: string;
  material: string;
  weight_grams: number;
  sorting_compliance: number;
  points_earned: number;
  kroner_earned: number;
  created_at: string;
}

interface MaterialBreakdownEntry {
  material: string;
  danish_fraction: string;
  transactions: number;
  weight_kg: number;
  kroner_earned: number;
  points_earned: number;
  co2_saved_kg: number;
  average_sorting_compliance_pct: number;
}

interface FractionBreakdownEntry {
  danish_fraction: string;
  transactions: number;
  weight_kg: number;
  co2_saved_kg: number;
  share_of_total_weight_pct: number;
}

interface QuarterPeriod {
  quarter: Quarter;
  year: number;
  q: 1 | 2 | 3 | 4;
  period_start: string; // ISO
  period_end: string;   // ISO (exclusive)
}

interface CSRDReportMeta {
  generated_at: string;
  report_version: string;
  format: string;
  producer_id: string;
  quarter: Quarter;
  period_start: string;
  period_end: string;
}

interface CSRDProducerBlock {
  producer_id: string;
  company_name: string;
  cvr_number: string;
  contact_email: string;
  subscription_tier: string;
  is_active: boolean;
  activated_at: string | null;
}

interface CSRDAggregates {
  total_transactions: number;
  total_weight_grams: number;
  total_weight_kg: number;
  total_kroner_earned: number;
  total_points_earned: number;
  unique_users: number;
  unique_barcodes_active: number;
  unique_barcodes_registered: number;
  average_sorting_compliance_pct: number;
}

interface CSRDEprSummary {
  base_fee_dkk_per_kg: number;
  total_epr_penalty_dkk: number;
  transactions_with_passport_fee: number;
  transactions_with_dynamic_fallback: number;
  currency: 'DKK';
}

interface CSRDCo2Block {
  total_co2_saved_kg: number;
  estimation_method: string;
  source: string;
  factors_used: Record<string, number>;
}

interface CSRDAudit {
  firebase_verified: boolean;
  trusted_uid: string;
  scans_scanned: number;
  scans_truncated: boolean;
  data_lineage: {
    source_tables: readonly string[];
    join_key: string;
    filter: string;
  };
}

interface CSRDExportPayload {
  report_meta: CSRDReportMeta;
  producer: CSRDProducerBlock;
  aggregates: CSRDAggregates;
  material_breakdown: MaterialBreakdownEntry[];
  fraction_breakdown: FractionBreakdownEntry[];
  epr_summary: CSRDEprSummary;
  co2: CSRDCo2Block;
  audit: CSRDAudit;
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

// ---------- Supabase (lazy init, service-role) ----------

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/reports/csrd' } },
  });
  return cachedClient;
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

// ---------- Type-guards + parsere ----------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function parseQuarter(value: unknown): QuarterPeriod | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().toUpperCase().match(QUARTER_REGEX);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const q = Number.parseInt(match[2], 10) as 1 | 2 | 3 | 4;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

  // Kvartals-grænser i UTC. Slut er eksklusivt (start på Q+1).
  const startMonth = (q - 1) * 3; // 0, 3, 6, 9
  const endMonth = q * 3;         // 3, 6, 9, 12
  const period_start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0)).toISOString();
  const period_end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0)).toISOString();

  return {
    quarter: `${year}-Q${q}` as Quarter,
    year,
    q,
    period_start,
    period_end,
  };
}

function toNumberSafe(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function co2FactorForFraction(fraction: string | null): number {
  if (!fraction) return CO2_FACTOR_DEFAULT;
  const f = CO2_FACTOR_KG_PER_KG[fraction];
  return typeof f === 'number' ? f : CO2_FACTOR_DEFAULT;
}

// ---------- F3.8 verify-wrapper ----------

async function verifyOrReject(
  req: VercelRequest,
  res: VercelResponse,
  clientProvidedUid: string,
): Promise<{ trustedUid: string; verified: boolean } | null> {
  try {
    const v = await resolveTrustedUid(req, clientProvidedUid);
    return { trustedUid: v.trusted_uid, verified: v.verified };
  } catch (err: unknown) {
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 401;
    const reason =
      typeof (err as { reason?: unknown })?.reason === 'string'
        ? (err as { reason: string }).reason
        : err instanceof Error
          ? err.message
          : 'firebase_verify_failed';
    sendError(res, status, 'firebase_verify_failed', reason);
    return null;
  }
}

// ---------- Datahentning ----------

async function fetchProducer(
  sb: SupabaseClient,
  producerId: string,
): Promise<{ producer: ProducerRow | null; error: string | null }> {
  const { data, error } = await sb
    .from('b2b_producers')
    .select(
      'producer_id, company_name, cvr_number, contact_email, subscription_tier, monthly_fee_dkk, is_active, activated_at, created_at',
    )
    .eq('producer_id', producerId)
    .maybeSingle();
  if (error) return { producer: null, error: error.message };
  return { producer: (data as ProducerRow | null) ?? null, error: null };
}

async function fetchMaterialPassports(
  sb: SupabaseClient,
  producerId: string,
): Promise<{ rows: MaterialPassportRow[]; error: string | null }> {
  const { data, error } = await sb
    .from('material_passports')
    .select(
      'barcode_id, producer_id, product_name, primary_material, composite_materials, danish_fraction, base_reward_points, epr_penalty_dkk',
    )
    .eq('producer_id', producerId);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as MaterialPassportRow[] | null) ?? [], error: null };
}

async function fetchScansForBarcodes(
  sb: SupabaseClient,
  barcodes: readonly string[],
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: ScanRow[]; truncated: boolean; error: string | null }> {
  if (barcodes.length === 0) {
    return { rows: [], truncated: false, error: null };
  }

  const collected: ScanRow[] = [];
  let truncated = false;

  // Batch barcodes for at undgå .in()-limit på Postgres/PostgREST.
  for (let i = 0; i < barcodes.length; i += BARCODE_IN_BATCH_SIZE) {
    const chunk = barcodes.slice(i, i + BARCODE_IN_BATCH_SIZE);

    // Paginer indenfor batch for at holde memory under kontrol.
    let from = 0;
    for (;;) {
      const to = from + SCAN_PAGE_SIZE - 1;
      const { data, error } = await sb
        .from('scans')
        .select(
          'id, user_id, barcode, material, weight_grams, sorting_compliance, points_earned, kroner_earned, created_at',
        )
        .in('barcode', chunk)
        .gte('created_at', periodStart)
        .lt('created_at', periodEnd)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) return { rows: [], truncated: false, error: error.message };

      const page = (data as ScanRow[] | null) ?? [];
      collected.push(...page);

      if (collected.length >= MAX_SCANS_PER_REPORT) {
        collected.length = MAX_SCANS_PER_REPORT;
        truncated = true;
        break;
      }

      if (page.length < SCAN_PAGE_SIZE) break;
      from += SCAN_PAGE_SIZE;
    }

    if (truncated) break;
  }

  return { rows: collected, truncated, error: null };
}

// ---------- Aggregering ----------

interface AggregationBuckets {
  perMaterial: Map<
    string,
    {
      material: string;
      danish_fraction: string;
      transactions: number;
      weight_grams: number;
      kroner_earned: number;
      points_earned: number;
      compliance_sum: number;
    }
  >;
  perFraction: Map<
    string,
    { danish_fraction: string; transactions: number; weight_grams: number }
  >;
  users: Set<string>;
  activeBarcodes: Set<string>;
  totalWeightGrams: number;
  totalKroner: number;
  totalPoints: number;
  totalComplianceSum: number;
  totalTransactions: number;
  eprTotalDkk: number;
  eprWithPassportFee: number;
  eprWithDynamicFallback: number;
}

function buildAggregates(
  scans: readonly ScanRow[],
  passportByBarcode: ReadonlyMap<string, MaterialPassportRow>,
): AggregationBuckets {
  const b: AggregationBuckets = {
    perMaterial: new Map(),
    perFraction: new Map(),
    users: new Set(),
    activeBarcodes: new Set(),
    totalWeightGrams: 0,
    totalKroner: 0,
    totalPoints: 0,
    totalComplianceSum: 0,
    totalTransactions: 0,
    eprTotalDkk: 0,
    eprWithPassportFee: 0,
    eprWithDynamicFallback: 0,
  };

  for (const s of scans) {
    const weight = toNumberSafe(s.weight_grams);
    const kroner = toNumberSafe(s.kroner_earned);
    const points = toNumberSafe(s.points_earned);
    const compliance = toNumberSafe(s.sorting_compliance);
    const passport = passportByBarcode.get(s.barcode);
    const fraction = passport?.danish_fraction ?? 'Ukendt';
    const materialKey = s.material || passport?.primary_material || 'Ukendt';

    b.totalTransactions += 1;
    b.totalWeightGrams += weight;
    b.totalKroner += kroner;
    b.totalPoints += points;
    b.totalComplianceSum += compliance;
    b.users.add(s.user_id);
    b.activeBarcodes.add(s.barcode);

    // Materiale-bucket
    const materialBucket = b.perMaterial.get(materialKey) ?? {
      material: materialKey,
      danish_fraction: fraction,
      transactions: 0,
      weight_grams: 0,
      kroner_earned: 0,
      points_earned: 0,
      compliance_sum: 0,
    };
    materialBucket.transactions += 1;
    materialBucket.weight_grams += weight;
    materialBucket.kroner_earned += kroner;
    materialBucket.points_earned += points;
    materialBucket.compliance_sum += compliance;
    b.perMaterial.set(materialKey, materialBucket);

    // Fraktions-bucket
    const fractionBucket = b.perFraction.get(fraction) ?? {
      danish_fraction: fraction,
      transactions: 0,
      weight_grams: 0,
    };
    fractionBucket.transactions += 1;
    fractionBucket.weight_grams += weight;
    b.perFraction.set(fraction, fractionBucket);

    // EPR: brug preset epr_penalty_dkk hvis sat i material_passports;
    // ellers beregn dynamisk via _epr.ts.
    if (passport && typeof passport.epr_penalty_dkk === 'number') {
      b.eprTotalDkk += passport.epr_penalty_dkk;
      b.eprWithPassportFee += 1;
    } else if (weight > 0) {
      const compositeMaterials = extractCompositeList(
        passport?.composite_materials ?? null,
      );
      const mp: EPRMaterialPassport = {
        primary_material: passport?.primary_material ?? materialKey,
        composite_materials: compositeMaterials,
        weight_grams: weight,
      };
      const dyn = calculateDynamicEPRPenalty(mp);
      b.eprTotalDkk += dyn.fee_dkk;
      b.eprWithDynamicFallback += 1;
    }
  }

  return b;
}

function extractCompositeList(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  // JSONB object: brug keys eller values-hvis-strings som composite-liste.
  const record = value as Record<string, unknown>;
  const out: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string' && v.length > 0) out.push(v);
    else if (typeof k === 'string' && k.length > 0) out.push(k);
  }
  return out;
}

function buildBreakdowns(
  b: AggregationBuckets,
): {
  materials: MaterialBreakdownEntry[];
  fractions: FractionBreakdownEntry[];
  totalCo2SavedKg: number;
  factorsUsed: Record<string, number>;
} {
  const totalWeightKg = b.totalWeightGrams / 1000;

  const materials: MaterialBreakdownEntry[] = [];
  for (const bucket of b.perMaterial.values()) {
    const weightKg = bucket.weight_grams / 1000;
    const factor = co2FactorForFraction(bucket.danish_fraction);
    const co2SavedKg = weightKg * factor;
    const avgCompliance =
      bucket.transactions > 0
        ? bucket.compliance_sum / bucket.transactions
        : 0;
    materials.push({
      material: bucket.material,
      danish_fraction: bucket.danish_fraction,
      transactions: bucket.transactions,
      weight_kg: round3(weightKg),
      kroner_earned: round2(bucket.kroner_earned),
      points_earned: Math.round(bucket.points_earned),
      co2_saved_kg: round3(co2SavedKg),
      average_sorting_compliance_pct: round2(avgCompliance),
    });
  }
  materials.sort((a, b2) => b2.weight_kg - a.weight_kg);

  const fractions: FractionBreakdownEntry[] = [];
  const factorsUsed: Record<string, number> = {};
  let totalCo2SavedKg = 0;
  for (const bucket of b.perFraction.values()) {
    const weightKg = bucket.weight_grams / 1000;
    const factor = co2FactorForFraction(bucket.danish_fraction);
    factorsUsed[bucket.danish_fraction] = factor;
    const co2SavedKg = weightKg * factor;
    totalCo2SavedKg += co2SavedKg;
    fractions.push({
      danish_fraction: bucket.danish_fraction,
      transactions: bucket.transactions,
      weight_kg: round3(weightKg),
      co2_saved_kg: round3(co2SavedKg),
      share_of_total_weight_pct:
        totalWeightKg > 0 ? round2((weightKg / totalWeightKg) * 100) : 0,
    });
  }
  fractions.sort((a, b2) => b2.weight_kg - a.weight_kg);

  return {
    materials,
    fractions,
    totalCo2SavedKg: round3(totalCo2SavedKg),
    factorsUsed,
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

  // Body-parsing + validation
  const rawBody = (req.body ?? {}) as Partial<CSRDRequestBody> & Record<string, unknown>;
  const { firebaseUid, producer_id, quarter } = rawBody;

  if (!isNonEmptyString(firebaseUid)) {
    return sendError(res, 400, 'firebaseUid_required');
  }
  if (!isUuid(producer_id)) {
    return sendError(
      res,
      400,
      'producer_id_invalid',
      'Expected uuid (b2b_producers.producer_id)',
    );
  }
  const period = parseQuarter(quarter);
  if (!period) {
    return sendError(
      res,
      400,
      'quarter_invalid',
      'Expected "YYYY-QN" (e.g. "2026-Q1")',
    );
  }

  // Firebase-token verify (F3.8)
  const auth = await verifyOrReject(req, res, firebaseUid);
  if (!auth) return res;

  // Supabase-klient
  const sb = getSupabase();
  if (!sb) return sendError(res, 503, 'supabase_not_configured');

  try {
    // 1. Producer-lookup + autorisations-check
    const producerResult = await fetchProducer(sb, producer_id);
    if (producerResult.error) {
      return sendError(
        res,
        500,
        'db_producer_fetch_failed',
        producerResult.error,
      );
    }
    if (!producerResult.producer) {
      return sendError(res, 404, 'producer_not_found');
    }
    const producer = producerResult.producer;

    if (!CVR_REGEX.test(producer.cvr_number)) {
      return sendError(
        res,
        409,
        'producer_cvr_invalid',
        `producer_id=${producer.producer_id} har ugyldigt CVR-nummer`,
      );
    }
    if (!producer.is_active) {
      return sendError(
        res,
        403,
        'producer_inactive',
        'Rapportgenerering kraever aktiv producent',
      );
    }

    // 2. Alle materialepas for producenten
    const passportResult = await fetchMaterialPassports(sb, producer_id);
    if (passportResult.error) {
      return sendError(
        res,
        500,
        'db_passport_fetch_failed',
        passportResult.error,
      );
    }
    const passports = passportResult.rows;
    const passportByBarcode = new Map<string, MaterialPassportRow>();
    for (const p of passports) passportByBarcode.set(p.barcode_id, p);
    const barcodes = Array.from(passportByBarcode.keys());

    // 3. Scans i kvartalet -- JOIN via barcode
    const scanResult = await fetchScansForBarcodes(
      sb,
      barcodes,
      period.period_start,
      period.period_end,
    );
    if (scanResult.error) {
      return sendError(res, 500, 'db_scan_fetch_failed', scanResult.error);
    }
    const scans = scanResult.rows;

    // 4. Aggregér
    const buckets = buildAggregates(scans, passportByBarcode);
    const breakdowns = buildBreakdowns(buckets);

    const totalWeightKg = buckets.totalWeightGrams / 1000;
    const avgCompliance =
      buckets.totalTransactions > 0
        ? buckets.totalComplianceSum / buckets.totalTransactions
        : 0;

    // 5. Byg Vana-format payload
    const payload: CSRDExportPayload = {
      report_meta: {
        generated_at: new Date().toISOString(),
        report_version: REPORT_VERSION,
        format: REPORT_FORMAT,
        producer_id: producer.producer_id,
        quarter: period.quarter,
        period_start: period.period_start,
        period_end: period.period_end,
      },
      producer: {
        producer_id: producer.producer_id,
        company_name: producer.company_name,
        cvr_number: producer.cvr_number,
        contact_email: producer.contact_email,
        subscription_tier: producer.subscription_tier,
        is_active: producer.is_active,
        activated_at: producer.activated_at,
      },
      aggregates: {
        total_transactions: buckets.totalTransactions,
        total_weight_grams: round2(buckets.totalWeightGrams),
        total_weight_kg: round3(totalWeightKg),
        total_kroner_earned: round2(buckets.totalKroner),
        total_points_earned: Math.round(buckets.totalPoints),
        unique_users: buckets.users.size,
        unique_barcodes_active: buckets.activeBarcodes.size,
        unique_barcodes_registered: passports.length,
        average_sorting_compliance_pct: round2(avgCompliance),
      },
      material_breakdown: breakdowns.materials,
      fraction_breakdown: breakdowns.fractions,
      epr_summary: {
        base_fee_dkk_per_kg: BASE_EPR_FEE_PER_KG,
        total_epr_penalty_dkk: round2(buckets.eprTotalDkk),
        transactions_with_passport_fee: buckets.eprWithPassportFee,
        transactions_with_dynamic_fallback: buckets.eprWithDynamicFallback,
        currency: 'DKK',
      },
      co2: {
        total_co2_saved_kg: breakdowns.totalCo2SavedKg,
        estimation_method: 'fraction-factor-weighted',
        source: 'DAKOFA/Miljoestyrelsen 2024 (indikativt estimat)',
        factors_used: breakdowns.factorsUsed,
      },
      audit: {
        firebase_verified: auth.verified,
        trusted_uid: auth.trustedUid,
        scans_scanned: scans.length,
        scans_truncated: scanResult.truncated,
        data_lineage: {
          source_tables: ['public.scans', 'public.material_passports', 'public.b2b_producers'],
          join_key: 'scans.barcode = material_passports.barcode_id',
          filter: `material_passports.producer_id = '${producer_id}' AND scans.created_at >= '${period.period_start}' AND scans.created_at < '${period.period_end}'`,
        },
      },
    };

    return sendSuccess(res, payload);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'unknown internal error';
    console.error('[reports/csrd] internal_error:', message);
    return sendError(res, 500, 'internal_error', message);
  }
}
