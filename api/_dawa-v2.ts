// F4.2-v2 — DAWA-fallback til Dataforsyningens post-shutdown API.
// Kontekst: dawa.aws.dk lukker 17. august 2026. Primær kilde er nu
// api.dataforsyningen.dk. Legacy holdes som fallback frem til shutdown-datoen;
// derefter fungerer den som "død" node og chainen falder videre til embedded cache.
//
// Fallback-chain (pr. lookup):
//   1. api.dataforsyningen.dk      (df-v2)      — primær, moderne DAWA-endpoint
//   2. dawa.aws.dk                 (dawa-legacy) — legacy, forsvinder efter 2026-08-17
//   3. embedded JSON               (cached)      — 15-kommune subset (Cirkel-pilot)
//
// Timeout: 1500 ms pr. remote source, sekventiel retry-chain.
// Cache: 24 t TTL i in-memory Map (LRU, max 1000 entries).
// Ingen 3rd-party deps. Native fetch + AbortController (Node 18+ / Vercel Edge).

export interface AddressLookup {
  latitude?: number;
  longitude?: number;
  postcode?: string;
  address?: string;
}

export interface AddressResult {
  kommune_navn: string;
  kommune_kode: string;
  postcode: string;
  source: "df-v2" | "dawa-legacy" | "cached";
}

// ---------- Cache (LRU, 24h TTL, max 1000) ----------

type CacheEntry = { value: AddressResult | null; expiresAt: number };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const cache: Map<string, CacheEntry> = new Map();

function cacheGet(key: string): AddressResult | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // LRU touch: flyt til slutning (mest-nyligt-brugt).
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: AddressResult | null): void {
  if (cache.size >= CACHE_MAX) {
    // Evict ældste (Map bevarer insertion order).
    const oldest = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------- Timeout wrapper ----------

const SOURCE_TIMEOUT_MS = 1500;

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Embedded 15-kommune subset (Cirkel-pilot 2026) ----------
// Primære postnumre for de 15 pilot-kommuner. Bruges når begge remote-kilder
// er nede (planlagt scenarie efter dawa-shutdown, hvis df-v2 også er ustabil).

const EMBEDDED_KOMMUNER: Record<
  string,
  { kommune_navn: string; kommune_kode: string }
> = {
  // 1. København (0101)
  "1000": { kommune_navn: "København", kommune_kode: "0101" },
  "1050": { kommune_navn: "København", kommune_kode: "0101" },
  "1100": { kommune_navn: "København", kommune_kode: "0101" },
  "1200": { kommune_navn: "København", kommune_kode: "0101" },
  "1300": { kommune_navn: "København", kommune_kode: "0101" },
  "1400": { kommune_navn: "København", kommune_kode: "0101" },
  "1500": { kommune_navn: "København", kommune_kode: "0101" },
  "1600": { kommune_navn: "København", kommune_kode: "0101" },
  "1700": { kommune_navn: "København", kommune_kode: "0101" },
  "1800": { kommune_navn: "København", kommune_kode: "0101" },
  "1900": { kommune_navn: "København", kommune_kode: "0101" },
  "2100": { kommune_navn: "København", kommune_kode: "0101" },
  "2200": { kommune_navn: "København", kommune_kode: "0101" },
  "2300": { kommune_navn: "København", kommune_kode: "0101" },
  "2400": { kommune_navn: "København", kommune_kode: "0101" },
  "2450": { kommune_navn: "København", kommune_kode: "0101" },
  "2500": { kommune_navn: "København", kommune_kode: "0101" },
  // 2. Frederiksberg (0147)
  "1804": { kommune_navn: "Frederiksberg", kommune_kode: "0147" },
  "1809": { kommune_navn: "Frederiksberg", kommune_kode: "0147" },
  "1810": { kommune_navn: "Frederiksberg", kommune_kode: "0147" },
  "2000": { kommune_navn: "Frederiksberg", kommune_kode: "0147" },
  // 3. Aarhus (0751)
  "8000": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8200": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8210": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8220": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8230": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8240": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8250": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8260": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8270": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8310": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8320": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8330": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8340": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8355": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8380": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8462": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8471": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8520": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8530": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  "8541": { kommune_navn: "Aarhus", kommune_kode: "0751" },
  // 4. Odense (0461)
  "5000": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5200": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5210": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5220": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5230": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5240": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5250": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5260": { kommune_navn: "Odense", kommune_kode: "0461" },
  "5270": { kommune_navn: "Odense", kommune_kode: "0461" },
  // 5. Aalborg (0851)
  "9000": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9200": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9210": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9220": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9230": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9260": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9270": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9280": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9310": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9370": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  "9400": { kommune_navn: "Aalborg", kommune_kode: "0851" },
  // 6. Esbjerg (0561)
  "6700": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6705": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6710": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6715": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6720": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6740": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6752": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  "6760": { kommune_navn: "Esbjerg", kommune_kode: "0561" },
  // 7. Randers (0730)
  "8900": { kommune_navn: "Randers", kommune_kode: "0730" },
  "8920": { kommune_navn: "Randers", kommune_kode: "0730" },
  "8930": { kommune_navn: "Randers", kommune_kode: "0730" },
  "8940": { kommune_navn: "Randers", kommune_kode: "0730" },
  "8960": { kommune_navn: "Randers", kommune_kode: "0730" },
  // 8. Kolding (0621)
  "6000": { kommune_navn: "Kolding", kommune_kode: "0621" },
  "6040": { kommune_navn: "Kolding", kommune_kode: "0621" },
  "6051": { kommune_navn: "Kolding", kommune_kode: "0621" },
  "6070": { kommune_navn: "Kolding", kommune_kode: "0621" },
  "6091": { kommune_navn: "Kolding", kommune_kode: "0621" },
  "6093": { kommune_navn: "Kolding", kommune_kode: "0621" },
  // 9. Horsens (0615)
  "8700": { kommune_navn: "Horsens", kommune_kode: "0615" },
  "8721": { kommune_navn: "Horsens", kommune_kode: "0615" },
  "8722": { kommune_navn: "Horsens", kommune_kode: "0615" },
  "8732": { kommune_navn: "Horsens", kommune_kode: "0615" },
  "8740": { kommune_navn: "Horsens", kommune_kode: "0615" },
  "8752": { kommune_navn: "Horsens", kommune_kode: "0615" },
  // 10. Vejle (0630)
  "7100": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7120": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7140": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7160": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7182": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7183": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7300": { kommune_navn: "Vejle", kommune_kode: "0630" },
  "7321": { kommune_navn: "Vejle", kommune_kode: "0630" },
  // 11. Roskilde (0265)
  "4000": { kommune_navn: "Roskilde", kommune_kode: "0265" },
  "4030": { kommune_navn: "Roskilde", kommune_kode: "0265" },
  "4040": { kommune_navn: "Roskilde", kommune_kode: "0265" },
  // 12. Herning (0657)
  "7400": { kommune_navn: "Herning", kommune_kode: "0657" },
  "7430": { kommune_navn: "Herning", kommune_kode: "0657" },
  "7451": { kommune_navn: "Herning", kommune_kode: "0657" },
  "7480": { kommune_navn: "Herning", kommune_kode: "0657" },
  "7490": { kommune_navn: "Herning", kommune_kode: "0657" },
  // 13. Silkeborg (0740)
  "8600": { kommune_navn: "Silkeborg", kommune_kode: "0740" },
  "8620": { kommune_navn: "Silkeborg", kommune_kode: "0740" },
  "8632": { kommune_navn: "Silkeborg", kommune_kode: "0740" },
  // 14. Næstved (0370)
  "4700": { kommune_navn: "Næstved", kommune_kode: "0370" },
  "4736": { kommune_navn: "Næstved", kommune_kode: "0370" },
  // 15. Fredericia (0607)
  "7000": { kommune_navn: "Fredericia", kommune_kode: "0607" },
};

// ---------- Input-normalisering ----------

function normalizeCacheKey(input: AddressLookup): string {
  if (input.postcode) {
    const pc = String(input.postcode).trim();
    if (pc) return `pc:${pc}`;
  }
  if (
    typeof input.latitude === "number" &&
    typeof input.longitude === "number" &&
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude)
  ) {
    // Rundes til 4 decimaler (~11m) for cache-effektivitet.
    return `ll:${input.latitude.toFixed(4)},${input.longitude.toFixed(4)}`;
  }
  if (input.address) {
    const a = input.address.trim().toLowerCase();
    if (a) return `addr:${a}`;
  }
  return "";
}

function extractPostcode(input: AddressLookup): string | null {
  if (input.postcode) {
    const clean = String(input.postcode).trim();
    if (/^\d{4}$/.test(clean)) return clean;
  }
  if (input.address) {
    const m = input.address.match(/\b(\d{4})\b/);
    if (m) return m[1];
  }
  return null;
}

// ---------- Remote-svar-typer (partial, kun det vi bruger) ----------

type DfPostnrResponse = {
  nr?: string;
  kommuner?: Array<{ navn?: string; kode?: string }>;
};

type DfKommuneReverse = {
  navn?: string;
  kode?: string;
};

type DfAdgangsadresseReverse = {
  postnummer?: { nr?: string; navn?: string };
  kommune?: { navn?: string; kode?: string };
};

type DfAdgangsadresseMini = {
  postnr?: string;
  postnrnavn?: string;
  kommunekode?: string;
  kommunenavn?: string;
};

// ---------- Remote-strategier ----------

async function tryPostnrLookup(
  base: string,
  postnr: string,
  source: "df-v2" | "dawa-legacy"
): Promise<AddressResult | null> {
  const r = await fetchWithTimeout(
    `${base}/postnumre/${encodeURIComponent(postnr)}`,
    SOURCE_TIMEOUT_MS
  );
  if (!r || !r.ok) return null;
  try {
    const data = (await r.json()) as DfPostnrResponse;
    const k = data?.kommuner?.[0];
    if (!k?.navn || !k?.kode) return null;
    return {
      kommune_navn: k.navn,
      kommune_kode: k.kode,
      postcode: postnr,
      source,
    };
  } catch {
    return null;
  }
}

async function tryCoordLookup(
  base: string,
  lat: number,
  lon: number,
  source: "df-v2" | "dawa-legacy"
): Promise<AddressResult | null> {
  // DAWA reverse geocoding: x=lon, y=lat, WGS84 = srid 4326.
  const kommuneUrl =
    `${base}/kommuner/reverse?x=${encodeURIComponent(String(lon))}` +
    `&y=${encodeURIComponent(String(lat))}&srid=4326&format=json`;
  const r = await fetchWithTimeout(kommuneUrl, SOURCE_TIMEOUT_MS);
  if (!r || !r.ok) return null;

  let kNavn = "";
  let kKode = "";
  try {
    const k = (await r.json()) as DfKommuneReverse;
    if (!k?.navn || !k?.kode) return null;
    kNavn = k.navn;
    kKode = k.kode;
  } catch {
    return null;
  }

  // Best-effort postnr via adgangsadresser/reverse (må gerne fejle).
  let postcode = "";
  const pcUrl =
    `${base}/adgangsadresser/reverse?x=${encodeURIComponent(String(lon))}` +
    `&y=${encodeURIComponent(String(lat))}&srid=4326&format=json`;
  const pcRes = await fetchWithTimeout(pcUrl, SOURCE_TIMEOUT_MS);
  if (pcRes && pcRes.ok) {
    try {
      const adg = (await pcRes.json()) as DfAdgangsadresseReverse;
      postcode = adg?.postnummer?.nr ?? "";
    } catch {
      // ignorer — postnr er valgfrit her
    }
  }

  return {
    kommune_navn: kNavn,
    kommune_kode: kKode,
    postcode,
    source,
  };
}

async function tryAddressLookup(
  base: string,
  address: string,
  source: "df-v2" | "dawa-legacy"
): Promise<AddressResult | null> {
  const q = encodeURIComponent(address);
  const url = `${base}/adgangsadresser?q=${q}&per_side=1&struktur=mini`;
  const r = await fetchWithTimeout(url, SOURCE_TIMEOUT_MS);
  if (!r || !r.ok) return null;
  try {
    const arr = (await r.json()) as DfAdgangsadresseMini[];
    const first = Array.isArray(arr) ? arr[0] : null;
    if (!first?.kommunekode || !first?.kommunenavn) return null;
    return {
      kommune_navn: first.kommunenavn,
      kommune_kode: first.kommunekode,
      postcode: first.postnr ?? "",
      source,
    };
  } catch {
    return null;
  }
}

// ---------- Cached fallback (embedded subset) ----------

function tryCached(input: AddressLookup): AddressResult | null {
  const pc = extractPostcode(input);
  if (!pc) return null;
  const hit = EMBEDDED_KOMMUNER[pc];
  if (!hit) return null;
  return {
    kommune_navn: hit.kommune_navn,
    kommune_kode: hit.kommune_kode,
    postcode: pc,
    source: "cached",
  };
}

// ---------- Offentligt API ----------

const DF_V2_BASE = "https://api.dataforsyningen.dk";
const DAWA_LEGACY_BASE = "https://dawa.aws.dk";

const REMOTE_CHAIN: ReadonlyArray<
  readonly [base: string, source: "df-v2" | "dawa-legacy"]
> = [
  [DF_V2_BASE, "df-v2"],
  [DAWA_LEGACY_BASE, "dawa-legacy"],
] as const;

export async function lookupAddress(
  input: AddressLookup
): Promise<AddressResult | null> {
  const key = normalizeCacheKey(input);
  if (key) {
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
  }

  const postnr = extractPostcode(input);
  const hasCoords =
    typeof input.latitude === "number" &&
    typeof input.longitude === "number" &&
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude);
  const hasAddress = typeof input.address === "string" && input.address.trim().length > 0;

  let result: AddressResult | null = null;

  // Sekventiel retry-chain: prøv hver remote-kilde med sit foretrukne opslag.
  for (const [base, source] of REMOTE_CHAIN) {
    // 1) Postnr direkte er billigst og mest præcist.
    if (postnr) {
      result = await tryPostnrLookup(base, postnr, source);
      if (result) break;
    }
    // 2) Koordinater → reverse geocode.
    if (hasCoords) {
      result = await tryCoordLookup(
        base,
        input.latitude as number,
        input.longitude as number,
        source
      );
      if (result) break;
    }
    // 3) Fritekst-adresse (kun hvis vi ikke allerede havde postnr).
    if (hasAddress && !postnr) {
      result = await tryAddressLookup(base, (input.address as string).trim(), source);
      if (result) break;
    }
  }

  // Sidste udvej: embedded 15-kommune subset.
  if (!result) {
    result = tryCached(input);
  }

  if (key) cacheSet(key, result);
  return result;
}

// ---------- Diagnostik (tests / debug) ----------

export function _debugCacheSize(): number {
  return cache.size;
}

export function _debugClearCache(): void {
  cache.clear();
}

export const _debug = {
  DF_V2_BASE,
  DAWA_LEGACY_BASE,
  SOURCE_TIMEOUT_MS,
  CACHE_TTL_MS,
  CACHE_MAX,
  EMBEDDED_KOMMUNER_COUNT: Object.keys(EMBEDDED_KOMMUNER).length,
};
