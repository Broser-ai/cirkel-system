// cirkel-system/api/_gs1.ts
//
// Modul 2 — GS1/GTIN produkt-opslag med fallback-chain.
// Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 2 (Scan → materialepas).
// Backing store: migration 008_material_passports (public.material_passports).
//
// Formaal: Konvertér en raa GTIN/EAN/UPC-stregkode fra scanner-flow (F1.10)
//          til et delvist materialepas — uden at blokere paa manglende data.
//          Chainen er sekventiel, retry-friendly og cacher succesfulde
//          opslag tilbage i material_passports for fremtidig null-latency.
//
// Fallback-chain (per lookup):
//   1. Supabase material_passports  (cached)        — 0 ms, offline-safe
//   2. GS1 Denmark GEPIR / lookup   (gs1)           — kraever GS1_API_KEY, 1500ms
//   3. Open Food Facts world API    (openfoodfacts) — fri, ingen key, 2000ms
//   4. null                                         — caller falder tilbage til AI
//
// Timeout: pr. remote source (sekventielt). AbortController-baseret.
// Retry-friendly: hver kilde faejler stille (returnerer null), saa caller
// kan re-koere hele chainen uden at rulle en delvist afbrudt state tilbage.
// Ingen 3rd-party deps udover @supabase/supabase-js (allerede i package.json).
// Native fetch + AbortController (Node 18+ / Vercel Edge Runtime kompatibelt).
//
// Caching-politik:
//   - Kun 'gs1' og 'openfoodfacts' resultater persisteres.
//   - 'cached' returneres uaendret (allerede i DB).
//   - Ved skrivning bruger vi upsert(onConflict='barcode_id') for at
//     undgaa race conditions ved parallelle scans af samme stregkode.
//   - Skrivning er best-effort: hvis Supabase er utilgaengelig faejler
//     lookupet ikke — vi returnerer stadig det friske remote-svar.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export interface ProductLookupResult {
  /** Hvilken kilde leverede data. Vigtigt for audit-trail + UI-hint. */
  source: 'gs1' | 'openfoodfacts' | 'cached' | 'ai-fallback';
  /** Normaliseret GTIN (14-cifret, zero-padded). */
  gtin: string;
  /** Produktnavn — altid udfyldt naar resultat er non-null. */
  product_name: string;
  /** Producent / brand — kan mangle for private-label eller AI-fallback. */
  manufacturer?: string;
  /** Primaert materiale (fx "Clear_PET_Plastic", "Corrugated_Cardboard"). */
  primary_material?: string;
  /** Emballage-materiale hvis afvigende fra primary_material. */
  packaging_material?: string;
  /**
   * Konfidens 0.0–1.0. Approximation:
   *   cached       = 0.95  (menneske-verificeret i portal)
   *   gs1          = 0.90  (autoritativ registrant)
   *   openfoodfacts = 0.60 (crowd-sourced, ofte partial)
   *   ai-fallback  = <0.5  (sat af caller, ikke af dette modul)
   */
  confidence: number;
}

// ─────────────────────────────────────────────────────────────
// Konstanter
// ─────────────────────────────────────────────────────────────

const GS1_TIMEOUT_MS = 1500;
const OFF_TIMEOUT_MS = 2000;

const GS1_ENDPOINT_BASE =
  process.env.GS1_API_ENDPOINT?.replace(/\/+$/, '') ??
  'https://api.gs1.dk/gtin/v1/lookup';

const OFF_ENDPOINT_BASE = 'https://world.openfoodfacts.org/api/v2/product';

const CONFIDENCE_CACHED = 0.95;
const CONFIDENCE_GS1 = 0.9;
const CONFIDENCE_OFF = 0.6;

// ─────────────────────────────────────────────────────────────
// GTIN-normalisering + validering
// ─────────────────────────────────────────────────────────────

/**
 * Normaliserer en raa stregkode til 14-cifret GTIN (zero-padded, EAN/UPC
 * konverteret). Returnerer null hvis input ikke er en valid stregkode.
 * Validerer check-digit (mod-10, GS1-standard).
 */
export function normalizeGTIN(input: string): string | null {
  if (typeof input !== 'string') return null;
  const clean = input.replace(/[\s-]/g, '');
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(clean)) return null;
  const padded = clean.padStart(14, '0');
  if (!isValidGTINCheckDigit(padded)) return null;
  return padded;
}

function isValidGTINCheckDigit(gtin14: string): boolean {
  // GS1 mod-10: sum af cifre * skiftende vaegte (3,1,3,1,...) fra hoejre
  // (ekskl. checkdigit), afrundes op til naermeste 10; differens = checkdigit.
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = gtin14.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return false;
    // Position 0 (venstre) af 13 cifre => vaegt 3; skifter.
    const weight = (13 - i) % 2 === 0 ? 1 : 3;
    sum += digit * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  const actual = gtin14.charCodeAt(13) - 48;
  return expected === actual;
}

// ─────────────────────────────────────────────────────────────
// Supabase (lazy init, service-role, delt cache)
// ─────────────────────────────────────────────────────────────

let cachedSupabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedSupabase) return cachedSupabase;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedSupabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cirkel-endpoint': 'api/_gs1' } },
  });
  return cachedSupabase;
}

// ─────────────────────────────────────────────────────────────
// Timeout-wrappet fetch (fail-silent)
// ─────────────────────────────────────────────────────────────

interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
}

async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  opts: FetchOptions,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Timeout, network-fejl, JSON-parse-fejl — vi svælger stille og lader
    // caller (chain) falde videre til naeste kilde.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// Kilde 1 — Supabase cache (material_passports)
// ─────────────────────────────────────────────────────────────

interface MaterialPassportRow {
  barcode_id: string;
  product_name: string;
  primary_material: string | null;
  composite_materials: Record<string, unknown> | null;
}

async function lookupFromCache(gtin: string): Promise<ProductLookupResult | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('material_passports')
    .select('barcode_id, product_name, primary_material, composite_materials')
    .eq('barcode_id', gtin)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as MaterialPassportRow;
  const meta = (row.composite_materials ?? {}) as Record<string, unknown>;
  const manufacturer = typeof meta._manufacturer === 'string' ? meta._manufacturer : undefined;
  const packaging =
    typeof meta._packaging_material === 'string' ? meta._packaging_material : undefined;

  return {
    source: 'cached',
    gtin,
    product_name: row.product_name,
    manufacturer,
    primary_material: row.primary_material ?? undefined,
    packaging_material: packaging,
    confidence: CONFIDENCE_CACHED,
  };
}

// ─────────────────────────────────────────────────────────────
// Kilde 2 — GS1 Denmark
// ─────────────────────────────────────────────────────────────

interface GS1LookupResponse {
  gtin?: string;
  productName?: string;
  brandName?: string;
  manufacturer?: string;
  primaryMaterial?: string;
  packagingMaterial?: string;
  // GS1 GEPIR-style fallback (nestede shapes forekommer i praksis)
  product?: {
    name?: string;
    brand?: string;
    manufacturer?: string;
    material?: string;
    packaging?: string;
  };
}

async function lookupFromGS1(gtin: string): Promise<ProductLookupResult | null> {
  const apiKey = process.env.GS1_API_KEY;
  if (!apiKey) return null;

  const url = `${GS1_ENDPOINT_BASE}/${encodeURIComponent(gtin)}`;
  const raw = await fetchJsonWithTimeout<GS1LookupResponse>(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Api-Key': apiKey, // nogle GS1-instanser bruger denne header
    },
    timeoutMs: GS1_TIMEOUT_MS,
  });

  if (!raw) return null;

  const productName =
    raw.productName ?? raw.product?.name ?? undefined;
  if (!productName) return null;

  const manufacturer =
    raw.manufacturer ?? raw.brandName ?? raw.product?.manufacturer ?? raw.product?.brand;
  const primaryMaterial = raw.primaryMaterial ?? raw.product?.material;
  const packagingMaterial = raw.packagingMaterial ?? raw.product?.packaging;

  return {
    source: 'gs1',
    gtin,
    product_name: productName,
    manufacturer: manufacturer || undefined,
    primary_material: primaryMaterial || undefined,
    packaging_material: packagingMaterial || undefined,
    confidence: CONFIDENCE_GS1,
  };
}

// ─────────────────────────────────────────────────────────────
// Kilde 3 — Open Food Facts (fri, crowd-sourced)
// ─────────────────────────────────────────────────────────────

interface OFFResponse {
  status?: number; // 1 = found, 0 = not found
  product?: {
    product_name?: string;
    product_name_da?: string;
    brands?: string;
    packaging?: string;
    packaging_materials_tags?: string[];
    packaging_tags?: string[];
  };
}

async function lookupFromOpenFoodFacts(
  gtin: string,
): Promise<ProductLookupResult | null> {
  // OFF bruger GTIN uden zero-padding (accepterer 8/12/13/14).
  // Vi proever den kanoniske 14-cifrede form foerst; hvis 0 (not found) proever
  // vi den trimmede form for at ramme UPC/EAN-13-poster.
  const candidates = Array.from(new Set([gtin, gtin.replace(/^0+/, '')]))
    .filter(Boolean);

  for (const code of candidates) {
    const url =
      `${OFF_ENDPOINT_BASE}/${encodeURIComponent(code)}.json` +
      `?fields=product_name,product_name_da,brands,packaging,packaging_materials_tags,packaging_tags`;

    const raw = await fetchJsonWithTimeout<OFFResponse>(url, {
      headers: { 'User-Agent': 'Cirkel/1.0 (+https://cirkel.dk)' },
      timeoutMs: OFF_TIMEOUT_MS,
    });

    if (!raw || raw.status !== 1 || !raw.product) continue;

    const p = raw.product;
    const productName = p.product_name_da || p.product_name;
    if (!productName) continue;

    const packagingMaterial = extractOFFPackagingMaterial(p);
    const primaryMaterial = packagingMaterial; // OFF har ikke separat felt

    return {
      source: 'openfoodfacts',
      gtin,
      product_name: productName,
      manufacturer: p.brands ? p.brands.split(',')[0].trim() : undefined,
      primary_material: primaryMaterial,
      packaging_material: packagingMaterial,
      confidence: CONFIDENCE_OFF,
    };
  }

  return null;
}

function extractOFFPackagingMaterial(product: NonNullable<OFFResponse['product']>): string | undefined {
  // Prioritet: strukturerede tags > pakning fritekst.
  const tags = product.packaging_materials_tags ?? product.packaging_tags ?? [];
  if (tags.length > 0) {
    // Tags kommer som "en:plastic", "da:pap" — trim locale-prefix.
    const first = tags[0];
    const stripped = first.includes(':') ? first.split(':')[1] : first;
    return stripped || undefined;
  }
  if (product.packaging && product.packaging.trim().length > 0) {
    return product.packaging.split(',')[0].trim();
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// Cache-writeback (best-effort, non-blocking for chainen)
// ─────────────────────────────────────────────────────────────

async function persistToCache(result: ProductLookupResult): Promise<void> {
  if (result.source === 'cached' || result.source === 'ai-fallback') return;
  const sb = getSupabase();
  if (!sb) return;

  const compositeMeta: Record<string, unknown> = {};
  if (result.manufacturer) compositeMeta._manufacturer = result.manufacturer;
  if (result.packaging_material) compositeMeta._packaging_material = result.packaging_material;
  compositeMeta._source = result.source;
  compositeMeta._confidence = result.confidence;
  compositeMeta._cached_at = new Date().toISOString();

  try {
    await sb
      .from('material_passports')
      .upsert(
        {
          barcode_id: result.gtin,
          product_name: result.product_name,
          primary_material: result.primary_material ?? null,
          composite_materials: compositeMeta,
          // base_reward_points + danish_fraction udfyldes senere af B2B-portal
          // eller manuel kuratering. Vi lader defaults (1 point) staa.
        },
        { onConflict: 'barcode_id', ignoreDuplicates: false },
      );
  } catch {
    // Best-effort: log ikke, skrivning maa ikke degradere lookup-latency.
  }
}

// ─────────────────────────────────────────────────────────────
// Public API — fallback-chain
// ─────────────────────────────────────────────────────────────

/**
 * Slaa en GTIN/EAN/UPC op via kaskade: cached → GS1 → Open Food Facts → null.
 *
 * @param gtin  Raa stregkode (8/12/13/14 cifre, evt. med bindestreger).
 * @returns     Foerste succesfulde match, eller null hvis intet blev fundet
 *              eller input er ugyldigt. Ved null kan caller fallback til AI.
 *
 * Retry-friendly: rene remote-fejl (timeout, 5xx, netvaerk) returnerer null
 * fra den enkelte kilde, chainen fortsaetter, og hele funktionen kan kaldes
 * igen uden bivirkninger (upsert er idempotent).
 */
export async function lookupGTIN(
  gtin: string,
): Promise<ProductLookupResult | null> {
  const normalized = normalizeGTIN(gtin);
  if (!normalized) return null;

  // 1. Cache
  const cached = await lookupFromCache(normalized);
  if (cached) return cached;

  // 2. GS1 Denmark
  const gs1 = await lookupFromGS1(normalized);
  if (gs1) {
    // Fire-and-forget writeback (afventes ikke — men vi await'er alligevel i
    // serverless-kontekst for at sikre ledger-persistens foer function-exit).
    await persistToCache(gs1);
    return gs1;
  }

  // 3. Open Food Facts
  const off = await lookupFromOpenFoodFacts(normalized);
  if (off) {
    await persistToCache(off);
    return off;
  }

  // 4. Ikke fundet — caller haandterer AI-fallback.
  return null;
}

// ─────────────────────────────────────────────────────────────
// Testable exports (kun til unit-tests; ingen public API-forpligtelse)
// ─────────────────────────────────────────────────────────────

export const __test__ = {
  isValidGTINCheckDigit,
  lookupFromCache,
  lookupFromGS1,
  lookupFromOpenFoodFacts,
  persistToCache,
};
