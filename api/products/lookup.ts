// cirkel-system/api/products/lookup.ts
//
// Modul 2 — Produkt-katalog lookup via GTIN (Global Trade Item Number).
//
// GET /api/products/lookup?gtin=<8|12|13|14 digits>
//   200 → { found: true, ...ProductLookupResult }    (cachet 1 time hvis found)
//   200 → { found: false, gtin, suggestion: '...' }  (miss — no-store)
//   400 → { error: 'invalid_gtin' | 'missing_gtin', detail?: string }
//   405 → { error: 'method_not_allowed' }
//   429 → { error: 'rate_limited' }                  (+ Retry-After header)
//   500 → { error: 'internal_error', detail?: string }
//
// Ansvar:
//   1. Method-guard (GET only).
//   2. Rate-limit via PUBLIC_API_LIMITER (100 req/min pr. IP).
//   3. Query-parse + GTIN-format-validation (8, 12, 13, eller 14 cifre).
//   4. Delegér til lookupGTIN() i ../_gs1.ts.
//   5. Miss → { found:false, suggestion: 'Brug AI-scan i stedet' } + no-cache.
//   6. Hit  → full ProductLookupResult + Cache-Control: public, max-age=3600.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lookupGTIN, type ProductLookupResult } from '../_gs1.js';
import { PUBLIC_API_LIMITER } from '../_rate-limit.js';

// ---------- Response-typer ----------

interface LookupHit extends ProductLookupResult {
  found: true;
}

interface LookupMiss {
  found: false;
  gtin: string;
  suggestion: string;
}

interface LookupError {
  error: string;
  detail?: string;
}

type LookupResponse = LookupHit | LookupMiss | LookupError;

// ---------- Konstanter ----------

const ALLOWED_GTIN_LENGTHS: ReadonlySet<number> = new Set<number>([8, 12, 13, 14]);
const GTIN_DIGIT_PATTERN = /^\d+$/;

const CACHE_CONTROL_HIT = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_CONTROL_MISS_OR_ERROR = 'no-store, max-age=0';

const MISS_SUGGESTION = 'Brug AI-scan i stedet';

// ---------- Query-parsing ----------

function firstQueryValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface GtinParseOk {
  ok: true;
  gtin: string;
}
interface GtinParseErr {
  ok: false;
  error: 'missing_gtin' | 'invalid_gtin';
  detail?: string;
}

/**
 * Validér GTIN-string:
 *   - Ikke tom
 *   - Kun cifre (leading zeros bevares — de er signifikante)
 *   - Længde skal være 8, 12, 13 eller 14
 *
 * Check-digit (Mod 10) valideres ikke her — det ligger i _gs1.ts hvis relevant.
 */
function parseGtin(query: VercelRequest['query']): GtinParseOk | GtinParseErr {
  const raw = firstQueryValue(query.gtin);
  if (raw === null) {
    return { ok: false, error: 'missing_gtin', detail: 'query-parameter "gtin" mangler' };
  }
  if (!GTIN_DIGIT_PATTERN.test(raw)) {
    return { ok: false, error: 'invalid_gtin', detail: 'GTIN må kun indeholde cifre' };
  }
  if (!ALLOWED_GTIN_LENGTHS.has(raw.length)) {
    return {
      ok: false,
      error: 'invalid_gtin',
      detail: `GTIN skal være 8, 12, 13 eller 14 cifre (fik ${raw.length})`,
    };
  }
  return { ok: true, gtin: raw };
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // 1) Method-guard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', CACHE_CONTROL_MISS_OR_ERROR);
    const body: LookupError = { error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2) Rate-limit (100 req/min pr. IP)
  const rl = await PUBLIC_API_LIMITER.check(req);
  const rlHeaders = PUBLIC_API_LIMITER.headers(rl);
  for (const [name, value] of Object.entries(rlHeaders)) {
    res.setHeader(name, value);
  }
  if (!rl.allow) {
    res.setHeader('Cache-Control', CACHE_CONTROL_MISS_OR_ERROR);
    const body: LookupError = { error: 'rate_limited' };
    return res.status(429).json(body);
  }

  // 3) GTIN-format-validation
  const parsed = parseGtin(req.query);
  if (!parsed.ok) {
    res.setHeader('Cache-Control', CACHE_CONTROL_MISS_OR_ERROR);
    const body: LookupError = { error: parsed.error, detail: parsed.detail };
    return res.status(400).json(body);
  }
  const { gtin } = parsed;

  // 4) Delegér til _gs1.lookupGTIN()
  try {
    const result: ProductLookupResult | null = await lookupGTIN(gtin);

    // 5) Miss — foreslå AI-scan, cache ikke (så et fremtidigt hit ikke skygges).
    if (result === null) {
      res.setHeader('Cache-Control', CACHE_CONTROL_MISS_OR_ERROR);
      res.setHeader('X-Cirkel-Endpoint', 'api/products/lookup');
      res.setHeader('X-Lookup-Result', 'miss');
      const body: LookupMiss = {
        found: false,
        gtin,
        suggestion: MISS_SUGGESTION,
      };
      return res.status(200).json(body);
    }

    // 6) Hit — cache 1 time i CDN + klient.
    res.setHeader('Cache-Control', CACHE_CONTROL_HIT);
    res.setHeader('X-Cirkel-Endpoint', 'api/products/lookup');
    res.setHeader('X-Lookup-Result', 'hit');
    const body: LookupHit = { found: true, ...result };
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/products/lookup] Uventet fejl:', message);
    res.setHeader('Cache-Control', CACHE_CONTROL_MISS_OR_ERROR);
    const body: LookupError = { error: 'internal_error', detail: message };
    return res.status(500).json(body);
  }
}

// Ren type-eksport så tests og klienter kan importere schema uden run-time cost.
export type { LookupHit, LookupMiss, LookupError, LookupResponse };
