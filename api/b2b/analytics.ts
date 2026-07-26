// cirkel-system/api/b2b/analytics.ts
//
// GET /api/b2b/analytics — Aggregerede B2B-analytics for én producent.
// Bygger scans + emissions-breakdown pr. materiale, samt daglig trend.
// Endpointet er B2B-portalens hjemmefane (Modul 10.1 Recharts-dashboard).
//
// Query params:
//   range        (required)  '7d' | '30d' | '90d' — lookback-vindue.
//   producer_id  (required)  UUID for producenten. Skal matche
//                             public.b2b_producers.producer_id.
//
// Response (success 200):
//   {
//     success: true,
//     data: {
//       producer_id: string,
//       range: '7d' | '30d' | '90d',
//       from_date: string,             // YYYY-MM-DD (inklusiv)
//       to_date: string,               // YYYY-MM-DD (inklusiv)
//       total_scans: number,
//       total_weight_kg: number,
//       total_co2_kg: number,
//       by_material: Array<{
//         material: string,
//         scan_count: number,
//         total_weight_kg: number,
//         total_co2_kg: number
//       }>,
//       daily_trend: Array<{
//         day: string,                 // YYYY-MM-DD
//         scan_count: number,
//         total_weight_kg: number,
//         total_co2_kg: number
//       }>
//     }
//   }
//
// Response (fejl):
//   { success: false, error: string }
//
// SIKKERHED:
//   - F3.8 — Firebase-token verificeres via verifyFirebaseToken FØR nogen
//     data-fetch. Cryptografisk gyldigt token er hårdt krav (auth-only mode
//     — vi håndhæver "ok"-flaget uanset ENFORCE-envvar, fordi B2B-analytics
//     ikke må serveres til uidentificerede klienter).
//   - Admin-check: kalderen skal enten (a) matche producentens contact_email
//     via decoded_token.email, ELLER (b) have custom claim `admin === true`.
//     Ellers 403 FORBIDDEN.
//   - Supabase service-role klient (lazy init, samme pattern som api/scan.ts
//     og api/kpi/*.ts).
//   - Alle secrets via process.env — INGEN hardkodede secrets.
//   - Query-params valideres strengt (regex + UUID-format).
//   - Producer_id verificeres eksisterende + is_active FØR aggregering.
//
// DATA-KILDER:
//   scans (public.scans)                    — pr-scan events (barcode, material, weight_grams, created_at)
//   material_passports (public.material_passports) — barcode → producer_id
//   emission_factors (public.emission_factors)     — material → co2_kg_per_kg (LEFT JOIN, optional)
//   b2b_producers (public.b2b_producers)    — producer_id → contact_email (admin-check)
//
// Join-model:
//   1. material_passports WHERE producer_id = :producer_id → sæt af barcodes.
//   2. scans WHERE barcode IN (...) AND created_at ∈ [from,to] → rå event-rækker.
//   3. emission_factors WHERE material IN (observerede materialer) → co2-berigelse.
//   Alle tre skridt sker in-memory efter fetch (rækker er lette, datospænd cappet).
//
// Bemærk: PostgREST-embed via FK bruges IKKE her (material_passports har
// ingen hard FK på scans.barcode → barcode_id i schema pt., jf. supabase_schema.sql
// og migration 008). Vi kører derfor tre eksplicitte queries og aggregerer selv.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Konstanter ---------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RANGES = ['7d', '30d', '90d'] as const;
type RangeKey = typeof VALID_RANGES[number];

const RANGE_TO_DAYS: Readonly<Record<RangeKey, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// Supabase page-loft: 1000 rækker pr. request. Vi paginerer indtil sidste page
// eller MAX_PAGES er ramt (50k rækker/producent/vindue er rigelig headroom).
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

// .in()-filteret komprimerer barcodes til URL-query. For at holde requestet
// under PostgREST's URL-loft splittes store barcode-sæt i chunks. 500 er
// konservativt (barcodes er typisk 8-14 tegn → ~7 KB pr. chunk).
const BARCODE_IN_CHUNK = 500;

// ---------- Typer --------------------------------------------------------

interface ParsedQuery {
  readonly range: RangeKey;
  readonly producer_id: string;
  readonly from_date: string;   // YYYY-MM-DD
  readonly to_date: string;     // YYYY-MM-DD
}

interface ProducerRow {
  readonly producer_id: string;
  readonly contact_email: string;
  readonly is_active: boolean;
}

interface PassportRow {
  readonly barcode_id: string;
}

interface ScanRow {
  readonly material: string | null;
  readonly weight_grams: number | string | null;
  readonly created_at: string | null;
}

interface EmissionFactorRow {
  readonly material: string | null;
  readonly co2_kg_per_kg: number | string | null;
}

interface MaterialBreakdown {
  readonly material: string;
  readonly scan_count: number;
  readonly total_weight_kg: number;
  readonly total_co2_kg: number;
}

interface DailyTrendPoint {
  readonly day: string;               // YYYY-MM-DD
  readonly scan_count: number;
  readonly total_weight_kg: number;
  readonly total_co2_kg: number;
}

interface AnalyticsData {
  readonly producer_id: string;
  readonly range: RangeKey;
  readonly from_date: string;
  readonly to_date: string;
  readonly total_scans: number;
  readonly total_weight_kg: number;
  readonly total_co2_kg: number;
  readonly by_material: readonly MaterialBreakdown[];
  readonly daily_trend: readonly DailyTrendPoint[];
}

interface SuccessResponse {
  readonly success: true;
  readonly data: AnalyticsData;
}

interface ErrorResponse {
  readonly success: false;
  readonly error: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

// Minimal type-shape for decoded Firebase-token felter vi bruger.
// verifyFirebaseToken returnerer `decoded_token` som `any` — vi indsnævrer.
interface DecodedTokenLite {
  readonly uid?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly admin?: boolean;
  readonly role?: string;
}

// ---------- Supabase lazy-init (samme mønster som api/scan.ts) -----------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ---------- Utilities ----------------------------------------------------

function toYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeQueryValue(raw: string | string[] | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return null;
  const trimmed = first.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toNumber(n: number | string | null | undefined): number {
  if (n === null || n === undefined) return 0;
  const v = typeof n === 'number' ? n : parseFloat(n);
  return Number.isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dayKey(raw: string): string {
  if (ISO_DATE_RE.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw.slice(0, 10);
  return toYYYYMMDD(parsed);
}

function normalizeMaterial(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed.length === 0 ? 'Ukendt' : trimmed;
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ---------- Query-validering --------------------------------------------

function isRangeKey(v: string): v is RangeKey {
  return (VALID_RANGES as readonly string[]).includes(v);
}

function parseAndValidateQuery(
  query: VercelRequest['query'],
): { ok: true; value: ParsedQuery } | { ok: false; reason: string } {
  const rangeRaw = normalizeQueryValue(query?.range);
  if (!rangeRaw) {
    return { ok: false, reason: "Query-param 'range' er påkrævet (7d|30d|90d)." };
  }
  if (!isRangeKey(rangeRaw)) {
    return { ok: false, reason: `Query-param 'range' skal være én af: ${VALID_RANGES.join(', ')}.` };
  }
  const range: RangeKey = rangeRaw;

  const producer_id = normalizeQueryValue(query?.producer_id);
  if (!producer_id) {
    return { ok: false, reason: "Query-param 'producer_id' er påkrævet." };
  }
  if (!UUID_RE.test(producer_id)) {
    return { ok: false, reason: "Query-param 'producer_id' skal være et gyldigt UUID." };
  }

  const days = RANGE_TO_DAYS[range];
  const today = new Date();
  const to_date = toYYYYMMDD(today);
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - days);
  const from_date = toYYYYMMDD(fromDate);

  return {
    ok: true,
    value: { range, producer_id, from_date, to_date },
  };
}

// ---------- Admin-check --------------------------------------------------

/**
 * Afgør om kalderen har lov til at læse denne producents analytics.
 * To måder man kan være "admin":
 *   1. Producentens egen contact_email matcher decoded_token.email (email_verified påkrævet).
 *   2. Platform-admin via Firebase custom claim: token.admin === true (eller token.role === 'admin').
 */
function isAuthorizedForProducer(
  decoded: DecodedTokenLite | null | undefined,
  producer: ProducerRow,
): boolean {
  if (!decoded) return false;

  // Platform-admin via custom claim.
  if (decoded.admin === true) return true;
  if (typeof decoded.role === 'string' && decoded.role.toLowerCase() === 'admin') return true;

  // Producer-selv via verificeret email-match.
  const tokenEmail = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const producerEmail = producer.contact_email.trim().toLowerCase();
  if (!tokenEmail || !producerEmail) return false;
  if (tokenEmail !== producerEmail) return false;

  // Firebase-anbefaling: kræv email_verified for at undgå at en angriber
  // opretter en account med samme email uden at eje inboxen. Hvis claim
  // mangler helt (ældre tokens), afvises for sikkerheds skyld.
  if (decoded.email_verified !== true) return false;

  return true;
}

// ---------- Data-fetch ---------------------------------------------------

/**
 * Slår producenten op og returnerer rækken. Bruges både til existence-tjek
 * og til admin-check (contact_email-matching).
 */
async function fetchProducer(
  sb: SupabaseClient,
  producer_id: string,
): Promise<ProducerRow | null> {
  const { data, error } = await sb
    .from('b2b_producers')
    .select('producer_id,contact_email,is_active')
    .eq('producer_id', producer_id)
    .maybeSingle();

  if (error) {
    const err = new Error(`b2b_producers-lookup fejlede: ${error.message}`);
    (err as Error & { supabase?: unknown }).supabase = error;
    throw err;
  }
  if (!data) return null;

  // Row-typen fra PostgREST er `any` — narrow her.
  const row = data as { producer_id: string; contact_email: string; is_active: boolean };
  return {
    producer_id: row.producer_id,
    contact_email: row.contact_email,
    is_active: row.is_active,
  };
}

/**
 * Henter alle barcodes registreret på denne producent i material_passports.
 * Paginated for at håndtere producenter med tusindvis af SKU'er.
 */
async function fetchProducerBarcodes(
  sb: SupabaseClient,
  producer_id: string,
): Promise<string[]> {
  const collected: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await sb
      .from('material_passports')
      .select('barcode_id')
      .eq('producer_id', producer_id)
      .order('barcode_id', { ascending: true })
      .range(from, to);

    if (error) {
      const err = new Error(`material_passports-lookup fejlede: ${error.message}`);
      (err as Error & { supabase?: unknown }).supabase = error;
      throw err;
    }

    const rows = (Array.isArray(data) ? data : []) as PassportRow[];
    for (const r of rows) {
      if (typeof r.barcode_id === 'string' && r.barcode_id.length > 0) {
        collected.push(r.barcode_id);
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }
  return collected;
}

/**
 * Henter scans for de givne barcodes i det givne interval. Barcodes chunks'es
 * så .in()-filteret ikke sprænger PostgREST's URL-loft. Hver chunk paginated.
 */
async function fetchScansForBarcodes(
  sb: SupabaseClient,
  barcodes: readonly string[],
  fromIso: string,
  toIso: string,
): Promise<{ rows: ScanRow[]; truncated: boolean }> {
  const collected: ScanRow[] = [];
  let truncated = false;

  for (const group of chunk(barcodes, BARCODE_IN_CHUNK)) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await sb
        .from('scans')
        .select('material,weight_grams,created_at')
        .in('barcode', group)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) {
        const err = new Error(`scans-lookup fejlede: ${error.message}`);
        (err as Error & { supabase?: unknown }).supabase = error;
        throw err;
      }

      const rows = (Array.isArray(data) ? data : []) as ScanRow[];
      for (const r of rows) collected.push(r);

      if (rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) {
        truncated = true;
        console.warn(
          `[api/b2b/analytics] MAX_PAGES (${MAX_PAGES}) ramt for barcode-chunk ` +
            `(${group.length} barcodes). Response er trunkeret.`,
        );
      }
    }
  }

  return { rows: collected, truncated };
}

/**
 * Slår emission-factor op for hvert observeret materiale. Silencer fejl
 * (fx tabel findes ikke) — så aggregeringen falder gracefully tilbage til
 * total_co2_kg = 0 for materialer uden factor.
 */
async function fetchEmissionFactors(
  sb: SupabaseClient,
  materials: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (materials.length === 0) return out;

  try {
    const { data, error } = await sb
      .from('emission_factors')
      .select('material,co2_kg_per_kg')
      .in('material', materials);

    if (error) {
      console.warn(
        '[api/b2b/analytics] emission_factors-lookup fejlede — falder tilbage til co2=0.',
        error.message,
      );
      return out;
    }

    const rows = (Array.isArray(data) ? data : []) as EmissionFactorRow[];
    for (const r of rows) {
      if (typeof r.material === 'string' && r.material.length > 0) {
        out.set(r.material, toNumber(r.co2_kg_per_kg));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[api/b2b/analytics] emission_factors-lookup kastede — ignorer og fortsæt.', message);
  }

  return out;
}

// ---------- Aggregering --------------------------------------------------

function aggregate(
  rows: readonly ScanRow[],
  factorMap: ReadonlyMap<string, number>,
  producer_id: string,
  range: RangeKey,
  from_date: string,
  to_date: string,
): AnalyticsData {
  const materialMap = new Map<string, { scan_count: number; total_weight_kg: number; total_co2_kg: number }>();
  const trendMap = new Map<string, { scan_count: number; total_weight_kg: number; total_co2_kg: number }>();

  let total_scans = 0;
  let total_weight_kg = 0;
  let total_co2_kg = 0;

  for (const row of rows) {
    total_scans += 1;

    const material = normalizeMaterial(row.material);
    const weightKg = toNumber(row.weight_grams) / 1000;
    const co2PerKg = factorMap.get(material) ?? 0;
    const co2Kg = weightKg * co2PerKg;
    const day = dayKey(String(row.created_at ?? ''));

    total_weight_kg += weightKg;
    total_co2_kg += co2Kg;

    const matBucket = materialMap.get(material) ?? { scan_count: 0, total_weight_kg: 0, total_co2_kg: 0 };
    matBucket.scan_count += 1;
    matBucket.total_weight_kg += weightKg;
    matBucket.total_co2_kg += co2Kg;
    materialMap.set(material, matBucket);

    const trendBucket = trendMap.get(day) ?? { scan_count: 0, total_weight_kg: 0, total_co2_kg: 0 };
    trendBucket.scan_count += 1;
    trendBucket.total_weight_kg += weightKg;
    trendBucket.total_co2_kg += co2Kg;
    trendMap.set(day, trendBucket);
  }

  const by_material: MaterialBreakdown[] = Array.from(materialMap.entries())
    .map(([material, v]) => ({
      material,
      scan_count: v.scan_count,
      total_weight_kg: round3(v.total_weight_kg),
      total_co2_kg: round2(v.total_co2_kg),
    }))
    .sort((a, b) => b.scan_count - a.scan_count);

  const daily_trend: DailyTrendPoint[] = Array.from(trendMap.entries())
    .map(([day, v]) => ({
      day,
      scan_count: v.scan_count,
      total_weight_kg: round3(v.total_weight_kg),
      total_co2_kg: round2(v.total_co2_kg),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    producer_id,
    range,
    from_date,
    to_date,
    total_scans,
    total_weight_kg: round3(total_weight_kg),
    total_co2_kg: round2(total_co2_kg),
    by_material,
    daily_trend,
  };
}

// ---------- Handler ------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Method-guard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    const body: ErrorResponse = { success: false, error: 'Method not allowed' };
    res.status(405).json(body);
    return;
  }

  // Query validering (400 hvis invalid)
  const parsed = parseAndValidateQuery(req.query);
  if (!parsed.ok) {
    const body: ErrorResponse = { success: false, error: parsed.reason };
    res.status(400).json(body);
    return;
  }
  const { range, producer_id, from_date, to_date } = parsed.value;

  // F3.8 — Firebase-token verify. Vi håndhæver ok-flaget uanset ENFORCE-envvar
  // fordi B2B-analytics ikke må serveres til uidentificerede klienter.
  // verifyFirebaseToken returnerer decoded_token vi bruger til admin-check.
  let decoded: DecodedTokenLite | null = null;
  try {
    const verified = await verifyFirebaseToken(req, {});
    if (!verified.ok) {
      const body: ErrorResponse = { success: false, error: verified.reason };
      res.status(verified.status).json(body);
      return;
    }
    // Selv i warn_only-mode kræver dette endpoint et cryptografisk verificeret
    // token — vi kan ikke stole på en advarsel som "ingen token pass-through".
    if (!verified.verified) {
      const body: ErrorResponse = {
        success: false,
        error: 'Firebase-token er ikke cryptografisk verificeret. Bearer-token påkrævet.',
      };
      res.status(401).json(body);
      return;
    }
    decoded = (verified.decoded_token ?? null) as DecodedTokenLite | null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/b2b/analytics] verifyFirebaseToken kastede:', message);
    const body: ErrorResponse = { success: false, error: 'Auth-verifikation fejlede.' };
    res.status(500).json(body);
    return;
  }

  // Supabase-klient
  const sb = getSupabase();
  if (!sb) {
    const body: ErrorResponse = { success: false, error: 'Supabase service-role-nøgle ikke konfigureret.' };
    res.status(503).json(body);
    return;
  }

  // Interval-grænser (created_at er TIMESTAMPTZ — inklusiv slut på til-dato).
  const fromIso = `${from_date}T00:00:00.000Z`;
  const toIso = `${to_date}T23:59:59.999Z`;

  try {
    // 1) Slå producent op — 404 hvis den ikke findes.
    const producer = await fetchProducer(sb, producer_id);
    if (!producer) {
      const body: ErrorResponse = { success: false, error: 'Producer_id findes ikke.' };
      res.status(404).json(body);
      return;
    }

    // 2) Admin-check — 403 hvis kalderen ikke ejer producenten og ikke er platform-admin.
    if (!isAuthorizedForProducer(decoded, producer)) {
      const body: ErrorResponse = {
        success: false,
        error: 'FORBIDDEN — kalderen har ikke adgang til denne producents analytics.',
      };
      res.status(403).json(body);
      return;
    }

    // 3) Hent barcodes for denne producent. Ingen barcodes → tomt datasæt.
    const barcodes = await fetchProducerBarcodes(sb, producer_id);
    if (barcodes.length === 0) {
      const emptyData: AnalyticsData = {
        producer_id,
        range,
        from_date,
        to_date,
        total_scans: 0,
        total_weight_kg: 0,
        total_co2_kg: 0,
        by_material: [],
        daily_trend: [],
      };
      const body: SuccessResponse = { success: true, data: emptyData };
      res.status(200).json(body);
      return;
    }

    // 4) Hent scans for de barcodes i det givne interval.
    const { rows, truncated } = await fetchScansForBarcodes(sb, barcodes, fromIso, toIso);

    // 5) Hent emission-factors for de observerede materialer (silent-fail-tolerant).
    const materials = Array.from(
      new Set(rows.map(r => normalizeMaterial(r.material))),
    );
    const factorMap = await fetchEmissionFactors(sb, materials);

    // 6) Aggregér.
    const aggregated = aggregate(rows, factorMap, producer_id, range, from_date, to_date);

    if (truncated) {
      // Let diagnose-header uden at ændre response-schemaet.
      res.setHeader('X-Cirkel-Truncated', '1');
    }

    const body: SuccessResponse = { success: true, data: aggregated };
    res.status(200).json(body);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/b2b/analytics] uventet fejl:', message);
    const body: ErrorResponse = { success: false, error: `Kunne ikke hente analytics: ${message}` };
    res.status(502).json(body);
    return;
  }
}

// Eksporterede typer — public kontrakt for klienter der vil importere response-formen.
export type {
  ApiResponse,
  SuccessResponse,
  ErrorResponse,
  AnalyticsData,
  MaterialBreakdown,
  DailyTrendPoint,
  RangeKey,
};
