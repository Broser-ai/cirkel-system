// cirkel-system/api/kpi/co2.ts
//
// GET /api/kpi/co2 — Aggregeret CO2-savings pr kommune.
//
// Query params:
//   kommune    (required)   Kommune-navn (matcher kommune_navn i view)
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
//       total_kg: number,            // Sum af CO2-savings i kg (fra total_co2_kg)
//       breakdown_by_material: Array<{
//         material_type: string,
//         total_kg: number,
//         event_count: number
//       }>,
//       trend: Array<{
//         day: string,               // ISO-dato YYYY-MM-DD
//         total_kg: number,
//         event_count: number
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
//   - Supabase service-role klient (lazy init, samme mønster som dashboard.ts).
//   - Alle secrets via process.env.
//   - Query-params valideres strengt (regex + Date-parsing).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';

// ---------- Konstanter ---------------------------------------------------

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 366;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_KOMMUNE_LEN = 100;

// ---------- Typer --------------------------------------------------------

/** Én række som returneret af kommune_waste_daily-viewet. */
interface WasteDailyRow {
  kommune_navn: string;
  material_type: string | null;
  day: string;                 // TIMESTAMPTZ serialiseres som ISO-string af PostgREST
  total_weight_kg: number | string;
  total_co2_kg: number | string;
  event_count: number | string;
}

interface MaterialBreakdown {
  material_type: string;
  total_kg: number;
  event_count: number;
}

interface TrendPoint {
  day: string;                 // YYYY-MM-DD
  total_kg: number;
  event_count: number;
}

interface Co2KpiData {
  kommune: string;
  from_date: string;
  to_date: string;
  total_kg: number;
  breakdown_by_material: MaterialBreakdown[];
  trend: TrendPoint[];
}

interface SuccessResponse {
  success: true;
  data: Co2KpiData;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

interface ParsedQuery {
  kommune: string;
  from_date: string;       // YYYY-MM-DD
  to_date: string;         // YYYY-MM-DD
}

// ---------- Supabase lazy-init (samme mønster som dashboard.ts) ----------

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
function parseAndValidateQuery(query: VercelRequest['query']): { ok: true; value: ParsedQuery } | { ok: false; reason: string } {
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

function toIntSafe(n: number | string | null | undefined): number {
  if (n === null || n === undefined) return 0;
  const v = typeof n === 'number' ? n : parseInt(n, 10);
  return isFinite(v) ? Math.trunc(v) : 0;
}

function dayKey(raw: string): string {
  // Viewet returnerer TIMESTAMPTZ. Vi normaliserer til YYYY-MM-DD (UTC-dagen).
  if (ISO_DATE_RE.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!isFinite(parsed.getTime())) return raw.slice(0, 10);
  return toYYYYMMDD(parsed);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregate(rows: WasteDailyRow[], kommune: string, from_date: string, to_date: string): Co2KpiData {
  let totalKg = 0;
  const materialMap = new Map<string, { total_kg: number; event_count: number }>();
  const trendMap = new Map<string, { total_kg: number; event_count: number }>();

  for (const row of rows) {
    const co2Kg = toNumber(row.total_co2_kg);
    const events = toIntSafe(row.event_count);
    const material = (row.material_type ?? '').trim() || 'Ukendt';
    const day = dayKey(String(row.day ?? ''));

    totalKg += co2Kg;

    const matBucket = materialMap.get(material) ?? { total_kg: 0, event_count: 0 };
    matBucket.total_kg += co2Kg;
    matBucket.event_count += events;
    materialMap.set(material, matBucket);

    const trendBucket = trendMap.get(day) ?? { total_kg: 0, event_count: 0 };
    trendBucket.total_kg += co2Kg;
    trendBucket.event_count += events;
    trendMap.set(day, trendBucket);
  }

  const breakdown_by_material: MaterialBreakdown[] = Array.from(materialMap.entries())
    .map(([material_type, v]) => ({
      material_type,
      total_kg: round2(v.total_kg),
      event_count: v.event_count,
    }))
    .sort((a, b) => b.total_kg - a.total_kg);

  const trend: TrendPoint[] = Array.from(trendMap.entries())
    .map(([day, v]) => ({
      day,
      total_kg: round2(v.total_kg),
      event_count: v.event_count,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    kommune,
    from_date,
    to_date,
    total_kg: round2(totalKg),
    breakdown_by_material,
    trend,
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

  // Query validering
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
    console.error('[api/kpi/co2] verifyFirebaseToken kastede:', message);
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

  // Hent fra kommune_waste_daily viewet.
  // 'day' er TIMESTAMPTZ (DATE_TRUNC('day', ...)) — vi bruger inklusiv til-slut på dagen.
  const toInclusiveEnd = `${to_date}T23:59:59.999Z`;
  const fromStart = `${from_date}T00:00:00.000Z`;

  try {
    const { data, error } = await sb
      .from('kommune_waste_daily')
      .select('kommune_navn,material_type,day,total_weight_kg,total_co2_kg,event_count')
      .eq('kommune_navn', kommune)
      .gte('day', fromStart)
      .lte('day', toInclusiveEnd)
      .order('day', { ascending: true });

    if (error) {
      console.error('[api/kpi/co2] Supabase-fejl:', error.message, error.details);
      const body: ErrorResponse = { success: false, error: `Kunne ikke hente KPI: ${error.message}` };
      res.status(502).json(body);
      return;
    }

    const rows: WasteDailyRow[] = Array.isArray(data) ? (data as WasteDailyRow[]) : [];
    const aggregated = aggregate(rows, kommune, from_date, to_date);

    const body: SuccessResponse = { success: true, data: aggregated };
    res.status(200).json(body);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/kpi/co2] uventet fejl:', message);
    const body: ErrorResponse = { success: false, error: `Uventet fejl: ${message}` };
    res.status(500).json(body);
    return;
  }
}

// Suppress unused-type warning for ApiResponse — eksporteret som public kontrakt
// så klienter kan importere response-typen direkte.
export type { ApiResponse, SuccessResponse, ErrorResponse, Co2KpiData, MaterialBreakdown, TrendPoint };
