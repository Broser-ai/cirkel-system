// cirkel-system/api/kpi/scans.ts
//
// GET /api/kpi/scans — Aggregeret scan-tælling pr kommune med material- og
// brugertype-breakdown samt daglig trend.
//
// Query params:
//   kommune    (required)   Kommune-navn (matcher profiles.municipality — case-sensitive
//                           exact match, samme konvention som resten af Cirkel-stakken).
//   from_date  (optional)   ISO-8601 dato YYYY-MM-DD (inklusiv). Default: 30 dage siden.
//   to_date    (optional)   ISO-8601 dato YYYY-MM-DD (inklusiv). Default: i dag.
//
// Response (success 200):
//   {
//     success: true,
//     data: {
//       kommune: string,
//       from_date: string,           // ISO-dato faktisk brugt
//       to_date: string,             // ISO-dato faktisk brugt
//       total_scans: number,         // Antal rækker i scans-tabellen i intervallet
//       by_material: Array<{
//         material: string,
//         scan_count: number,
//         total_weight_kg: number,   // SUM(scans.weight_grams) / 1000
//         total_co2_kg: number       // SUM(weight_grams/1000 * co2_kg_per_kg) — 0 hvis emission_factor mangler
//       }>,
//       by_user_type: Array<{
//         user_type: string,         // 'citizen' | 'collector' | 'business' | 'unknown'
//         scan_count: number,
//         total_weight_kg: number
//       }>,
//       daily_trend: Array<{
//         day: string,               // ISO-dato YYYY-MM-DD
//         scan_count: number,
//         total_weight_kg: number
//       }>
//     }
//   }
//
// Response (fejl): { success: false, error: string }
//
// SIKKERHED:
//   - Firebase-token verificeres via _verify-firebase-token (F3.8-pattern).
//     Endpointet er læse-orienteret men afskærmes bag verified bruger så
//     kun autentificerede B2B-portaler/CX-apps kan hente KPI'er.
//   - Supabase service-role klient (lazy init, samme mønster som api/kpi/co2.ts).
//   - Alle secrets via process.env — INGEN hardkodede secrets.
//   - Query-params valideres strengt (regex + Date-parsing + længde-cap).
//
// DATA-KILDE:
//   scans (public.scans) LEFT JOIN emission_factors ON scans.material
//   filtreret via INNER JOIN profiles.municipality = :kommune.
//   Aggregering sker in-memory i denne handler (rækker er lette — én række pr scan
//   inden for intervallet — og datospænd er cappet ved MAX_LOOKBACK_DAYS).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Konstanter ---------------------------------------------------

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 366;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_KOMMUNE_LEN = 100;
const PAGE_SIZE = 1000;      // Supabase max-page — vi paginerer for at samle hele intervallet
const MAX_PAGES = 50;        // Sikkerheds-loft: 50k scans pr forespørgsel. Nået → advarsel.

// ---------- Typer --------------------------------------------------------

/**
 * PostgREST-embedded row-form: en scan med profil-info og evt. emission-factor.
 * Bemærk: PostgREST kan returnere embedded relations enten som object eller array
 * afhængigt af FK-cardinality. Vi håndterer begge former i extractProfile()/extractFactor().
 */
interface ScanRow {
  material: string | null;
  weight_grams: number | string | null;
  created_at: string | null;
  profiles: ProfileEmbed | ProfileEmbed[] | null;
  emission_factors: EmissionFactorEmbed | EmissionFactorEmbed[] | null;
}

interface ProfileEmbed {
  user_type: string | null;
  municipality: string | null;
}

interface EmissionFactorEmbed {
  material: string | null;
  co2_kg_per_kg: number | string | null;
}

interface MaterialBreakdown {
  material: string;
  scan_count: number;
  total_weight_kg: number;
  total_co2_kg: number;
}

interface UserTypeBreakdown {
  user_type: string;
  scan_count: number;
  total_weight_kg: number;
}

interface DailyTrendPoint {
  day: string;                // YYYY-MM-DD
  scan_count: number;
  total_weight_kg: number;
}

interface ScansKpiData {
  kommune: string;
  from_date: string;
  to_date: string;
  total_scans: number;
  by_material: MaterialBreakdown[];
  by_user_type: UserTypeBreakdown[];
  daily_trend: DailyTrendPoint[];
}

interface SuccessResponse {
  success: true;
  data: ScansKpiData;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

interface ParsedQuery {
  kommune: string;
  from_date: string;          // YYYY-MM-DD
  to_date: string;            // YYYY-MM-DD
}

// ---------- Supabase lazy-init (samme mønster som api/kpi/co2.ts) --------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ---------- Query-validering --------------------------------------------

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

/**
 * Streng validering af query-params. Returnerer struktureret fejl-årsag hvis noget er galt.
 * from_date/to_date defaultes hvis udeladt (til-dato = i dag, fra-dato = 30 dage siden).
 */
function parseAndValidateQuery(
  query: VercelRequest['query'],
): { ok: true; value: ParsedQuery } | { ok: false; reason: string } {
  const kommune = normalizeQueryValue(query?.kommune);
  if (!kommune) {
    return { ok: false, reason: "Query-param 'kommune' er påkrævet." };
  }
  if (kommune.length > MAX_KOMMUNE_LEN) {
    return { ok: false, reason: `Query-param 'kommune' må højst være ${MAX_KOMMUNE_LEN} tegn.` };
  }

  const rawFrom = normalizeQueryValue(query?.from_date);
  const rawTo = normalizeQueryValue(query?.to_date);

  const today = new Date();
  const defaultTo = toYYYYMMDD(today);
  const defaultFromDate = new Date(today);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  const defaultFrom = toYYYYMMDD(defaultFromDate);

  const from_date = rawFrom ?? defaultFrom;
  const to_date = rawTo ?? defaultTo;

  if (!ISO_DATE_RE.test(from_date)) {
    return { ok: false, reason: "Query-param 'from_date' skal være ISO-8601 YYYY-MM-DD." };
  }
  if (!ISO_DATE_RE.test(to_date)) {
    return { ok: false, reason: "Query-param 'to_date' skal være ISO-8601 YYYY-MM-DD." };
  }

  const fromMs = Date.parse(`${from_date}T00:00:00.000Z`);
  const toMs = Date.parse(`${to_date}T23:59:59.999Z`);
  if (!isFinite(fromMs)) {
    return { ok: false, reason: "'from_date' er ikke en gyldig dato." };
  }
  if (!isFinite(toMs)) {
    return { ok: false, reason: "'to_date' er ikke en gyldig dato." };
  }
  if (fromMs > toMs) {
    return { ok: false, reason: "'from_date' skal være <= 'to_date'." };
  }

  const spanDays = Math.ceil((toMs - fromMs) / (24 * 60 * 60 * 1000));
  if (spanDays > MAX_LOOKBACK_DAYS) {
    return { ok: false, reason: `Datospænd overstiger maks (${MAX_LOOKBACK_DAYS} dage).` };
  }

  return { ok: true, value: { kommune, from_date, to_date } };
}

// ---------- Aggregering --------------------------------------------------

function toNumber(n: number | string | null | undefined): number {
  if (n === null || n === undefined) return 0;
  const v = typeof n === 'number' ? n : parseFloat(n);
  return isFinite(v) ? v : 0;
}

function dayKey(raw: string): string {
  if (ISO_DATE_RE.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!isFinite(parsed.getTime())) return raw.slice(0, 10);
  return toYYYYMMDD(parsed);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Trækker ét profile-embed ud uanset om PostgREST returnerede object eller array. */
function extractProfile(embed: ProfileEmbed | ProfileEmbed[] | null): ProfileEmbed | null {
  if (!embed) return null;
  if (Array.isArray(embed)) return embed.length > 0 ? embed[0] : null;
  return embed;
}

/** Trækker ét emission_factor-embed ud uanset om PostgREST returnerede object eller array. */
function extractFactor(
  embed: EmissionFactorEmbed | EmissionFactorEmbed[] | null,
): EmissionFactorEmbed | null {
  if (!embed) return null;
  if (Array.isArray(embed)) return embed.length > 0 ? embed[0] : null;
  return embed;
}

function normalizeMaterial(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed.length === 0 ? 'Ukendt' : trimmed;
}

function normalizeUserType(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim().toLowerCase();
  return trimmed.length === 0 ? 'unknown' : trimmed;
}

function aggregate(
  rows: ScanRow[],
  kommune: string,
  from_date: string,
  to_date: string,
): ScansKpiData {
  const materialMap = new Map<string, { scan_count: number; total_weight_kg: number; total_co2_kg: number }>();
  const userTypeMap = new Map<string, { scan_count: number; total_weight_kg: number }>();
  const trendMap = new Map<string, { scan_count: number; total_weight_kg: number }>();

  let total_scans = 0;

  for (const row of rows) {
    total_scans += 1;

    const material = normalizeMaterial(row.material);
    const weightKg = toNumber(row.weight_grams) / 1000;
    const day = dayKey(String(row.created_at ?? ''));

    const profile = extractProfile(row.profiles);
    const user_type = normalizeUserType(profile?.user_type);

    const factor = extractFactor(row.emission_factors);
    const co2PerKg = toNumber(factor?.co2_kg_per_kg);
    const co2Kg = weightKg * co2PerKg;

    // Material-bucket
    const matBucket = materialMap.get(material) ?? { scan_count: 0, total_weight_kg: 0, total_co2_kg: 0 };
    matBucket.scan_count += 1;
    matBucket.total_weight_kg += weightKg;
    matBucket.total_co2_kg += co2Kg;
    materialMap.set(material, matBucket);

    // User-type-bucket
    const utBucket = userTypeMap.get(user_type) ?? { scan_count: 0, total_weight_kg: 0 };
    utBucket.scan_count += 1;
    utBucket.total_weight_kg += weightKg;
    userTypeMap.set(user_type, utBucket);

    // Trend-bucket
    const trendBucket = trendMap.get(day) ?? { scan_count: 0, total_weight_kg: 0 };
    trendBucket.scan_count += 1;
    trendBucket.total_weight_kg += weightKg;
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

  const by_user_type: UserTypeBreakdown[] = Array.from(userTypeMap.entries())
    .map(([user_type, v]) => ({
      user_type,
      scan_count: v.scan_count,
      total_weight_kg: round3(v.total_weight_kg),
    }))
    .sort((a, b) => b.scan_count - a.scan_count);

  const daily_trend: DailyTrendPoint[] = Array.from(trendMap.entries())
    .map(([day, v]) => ({
      day,
      scan_count: v.scan_count,
      total_weight_kg: round3(v.total_weight_kg),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    kommune,
    from_date,
    to_date,
    total_scans,
    by_material,
    by_user_type,
    daily_trend,
  };
}

// ---------- Data-fetch ---------------------------------------------------

/**
 * Henter scans-rækker paginated. Hver page er PAGE_SIZE rækker; vi stopper når
 * en page er kortere end PAGE_SIZE (= sidste page) eller når MAX_PAGES er nået.
 *
 * Selektorer:
 *   - profiles!inner(user_type, municipality) — INNER JOIN så vi kan filtrere
 *     på profiles.municipality via PostgREST's eq('profiles.municipality', ...).
 *   - emission_factors(material, co2_kg_per_kg) — LEFT JOIN (default). Bruges
 *     kun til co2-berigelse; hvis tabellen ikke findes eller ingen match, får
 *     material 0 co2_kg (vi silencer fejlen — se catch nedenfor).
 */
async function fetchScans(
  sb: SupabaseClient,
  kommune: string,
  fromIso: string,
  toIso: string,
): Promise<{ rows: ScanRow[]; truncated: boolean; emissionJoinFailed: boolean }> {
  const collected: ScanRow[] = [];
  let emissionJoinFailed = false;

  // Første forsøg: WITH emission_factors embed. Hvis den fejler (fx tabel findes ikke),
  // falder vi tilbage til uden — men vi holder co2=0 så output-schema er stabilt.
  const selectWithFactors =
    'material,weight_grams,created_at,profiles!inner(user_type,municipality),emission_factors(material,co2_kg_per_kg)';
  const selectWithoutFactors =
    'material,weight_grams,created_at,profiles!inner(user_type,municipality)';

  let selectExpr = selectWithFactors;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await sb
      .from('scans')
      .select(selectExpr)
      .eq('profiles.municipality', kommune)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      // Hvis emission_factors-relation ikke findes i skemaet: retry uden.
      const msg = String(error.message || '').toLowerCase();
      const details = String(error.details || '').toLowerCase();
      const isRelationErr =
        selectExpr === selectWithFactors &&
        (msg.includes('emission_factors') || details.includes('emission_factors') ||
         msg.includes('relationship') || msg.includes('does not exist'));

      if (isRelationErr) {
        console.warn(
          '[api/kpi/scans] emission_factors-embed ikke tilgængelig — falder tilbage til uden co2-berigelse. Årsag:',
          error.message,
        );
        emissionJoinFailed = true;
        selectExpr = selectWithoutFactors;
        // Prøv samme page igen med det simplere select.
        page -= 1;
        continue;
      }

      // Anden fejl: kaster videre til handler, som returnerer 502.
      const err = new Error(`Supabase-fejl: ${error.message}`);
      (err as Error & { supabase?: unknown }).supabase = error;
      throw err;
    }

    const pageRows: ScanRow[] = Array.isArray(data) ? (data as unknown as ScanRow[]) : [];
    for (const r of pageRows) collected.push(r);

    if (pageRows.length < PAGE_SIZE) {
      return { rows: collected, truncated: false, emissionJoinFailed };
    }
  }

  console.warn(
    `[api/kpi/scans] MAX_PAGES (${MAX_PAGES}) ramt for kommune="${kommune}" ` +
      `— response er trunkeret. Overvej at snævre datospænd.`,
  );
  return { rows: collected, truncated: true, emissionJoinFailed };
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
  const { kommune, from_date, to_date } = parsed.value;

  // Firebase-token verify (F3.8-pattern). requiredUid udelades: her tjekker vi kun
  // at kalderen er autentificeret — ikke at UID matcher et specifikt body-felt.
  try {
    const verified = await verifyFirebaseToken(req, {});
    if (!verified.ok) {
      const body: ErrorResponse = { success: false, error: verified.reason };
      res.status(verified.status).json(body);
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/kpi/scans] verifyFirebaseToken kastede:', message);
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
    const { rows, truncated, emissionJoinFailed } = await fetchScans(sb, kommune, fromIso, toIso);
    const aggregated = aggregate(rows, kommune, from_date, to_date);

    if (truncated || emissionJoinFailed) {
      // Lette diagnose-headers uden at ændre response-schemaet.
      if (truncated) res.setHeader('X-Cirkel-Truncated', '1');
      if (emissionJoinFailed) res.setHeader('X-Cirkel-Emission-Join', 'unavailable');
    }

    const body: SuccessResponse = { success: true, data: aggregated };
    res.status(200).json(body);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/kpi/scans] uventet fejl:', message);
    const body: ErrorResponse = { success: false, error: `Kunne ikke hente KPI: ${message}` };
    res.status(502).json(body);
    return;
  }
}

// Eksporterede typer — public kontrakt for klienter der vil importere response-formen.
export type {
  ApiResponse,
  SuccessResponse,
  ErrorResponse,
  ScansKpiData,
  MaterialBreakdown,
  UserTypeBreakdown,
  DailyTrendPoint,
};
