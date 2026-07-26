/**
 * IoT Mock Layer
 * ----------------
 * Genererer realistisk mock-data for bin-monitor UI når backend/hardware
 * ikke er tilgængeligt. Bruges som fallback så dashboardet kan udvikles
 * og demonstreres helt offline.
 *
 * Alle funktioner er deterministisk-nok til demo, men indeholder let
 * randomisering så visualiseringer ikke ser statiske ud.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockBin {
  bin_id: string;
  kommune: string;
  lat: number;
  lng: number;
  /** Fyldeprocent 0-100 */
  fill_pct: number;
  /** Batterispænding i millivolt (typisk 3000-4200 for Li-Ion) */
  battery_mv: number;
  /** ISO-8601 timestamp for sidste heartbeat */
  last_seen: string;
  status: 'ok' | 'full' | 'offline';
}

// ---------------------------------------------------------------------------
// Demo-mode badge (UI-flag)
// ---------------------------------------------------------------------------

export const DEMO_MODE_BADGE = {
  visible: true,
  text: '🔧 DEMO MODE — Live IoT-data endnu ikke tilgængelig',
  color: 'orange',
} as const;

// ---------------------------------------------------------------------------
// Aarhus centrum default-koordinater
// ---------------------------------------------------------------------------

const AARHUS_CENTER = { lat: 56.1572, lng: 10.2107 };

/** Faste referencepunkter i Aarhus centrum for de 3 default-mockbins. */
const AARHUS_DEFAULT_SPOTS: Array<{
  bin_id: string;
  lat: number;
  lng: number;
}> = [
  // Store Torv
  { bin_id: 'AAR-CTR-001', lat: 56.1567, lng: 10.2108 },
  // Bispetorvet ved Domkirken
  { bin_id: 'AAR-CTR-002', lat: 56.1583, lng: 10.2116 },
  // Klostertorvet
  { bin_id: 'AAR-CTR-003', lat: 56.1559, lng: 10.2075 },
];

// ---------------------------------------------------------------------------
// Intern state til simulateBinFill (holder styr på "fyldning over tid")
// ---------------------------------------------------------------------------

/**
 * Antaget maks kapacitet pr bin i gram. Bruges til at oversætte deltaGrams
 * til en fill_pct-ændring. 60 kg ~ typisk offentlig affaldsbeholder.
 */
const DEFAULT_BIN_CAPACITY_GRAMS = 60_000;

const binStateCache: Map<string, MockBin> = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

/** Vælger status baseret på fyldeprocent + batteri. */
function deriveStatus(fill_pct: number, battery_mv: number): MockBin['status'] {
  if (battery_mv < 3200) return 'offline';
  if (fill_pct >= 90) return 'full';
  return 'ok';
}

/** Random ISO-timestamp inden for de sidste `maxMinutes` minutter. */
function recentTimestamp(maxMinutes = 15): string {
  const now = Date.now();
  const offsetMs = randomInt(0, maxMinutes * 60_000);
  return new Date(now - offsetMs).toISOString();
}

/** Genererer et bin_id i format `<KOM3>-<seq3>`. */
function makeBinId(kommune: string, seq: number): string {
  const prefix = kommune.slice(0, 3).toUpperCase();
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

/** Bygger et realistisk bin-objekt ud fra basis-parametre. */
function buildBin(params: {
  bin_id: string;
  kommune: string;
  lat: number;
  lng: number;
  fill_pct?: number;
  battery_mv?: number;
}): MockBin {
  const fill_pct = clamp(
    params.fill_pct ?? randomBetween(5, 95),
    0,
    100,
  );
  const battery_mv = Math.round(
    params.battery_mv ?? randomBetween(3300, 4150),
  );
  return {
    bin_id: params.bin_id,
    kommune: params.kommune,
    lat: Number(params.lat.toFixed(6)),
    lng: Number(params.lng.toFixed(6)),
    fill_pct: Math.round(fill_pct * 10) / 10,
    battery_mv,
    last_seen: recentTimestamp(),
    status: deriveStatus(fill_pct, battery_mv),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generér `count` mock-bins. Default kommune er "Aarhus" og placerer
 * de første 3 bins på faste torve i Aarhus centrum for at give en
 * genkendelig demo. Yderligere bins scatteres inden for ~2 km radius
 * omkring centrum.
 *
 * @param count antal bins der ønskes returneret
 * @param kommune kommune-navn (default "Aarhus")
 */
export function generateMockBins(count: number, kommune = 'Aarhus'): MockBin[] {
  if (!Number.isFinite(count) || count <= 0) return [];

  const bins: MockBin[] = [];
  const isAarhus = kommune.toLowerCase() === 'aarhus';

  for (let i = 0; i < count; i++) {
    let lat: number;
    let lng: number;
    let bin_id: string;

    if (isAarhus && i < AARHUS_DEFAULT_SPOTS.length) {
      const spot = AARHUS_DEFAULT_SPOTS[i];
      lat = spot.lat;
      lng = spot.lng;
      bin_id = spot.bin_id;
    } else {
      // ~0.018 grader ≈ 2 km — scatter omkring Aarhus centrum eller
      // (for andre kommuner) omkring et forskudt punkt så koordinater
      // ikke overlapper Aarhus.
      const centerLat = isAarhus
        ? AARHUS_CENTER.lat
        : AARHUS_CENTER.lat + randomBetween(-0.3, 0.3);
      const centerLng = isAarhus
        ? AARHUS_CENTER.lng
        : AARHUS_CENTER.lng + randomBetween(-0.3, 0.3);
      lat = centerLat + randomBetween(-0.018, 0.018);
      lng = centerLng + randomBetween(-0.018, 0.018);
      bin_id = makeBinId(kommune, i + 1);
    }

    const bin = buildBin({ bin_id, kommune, lat, lng });
    bins.push(bin);
    binStateCache.set(bin.bin_id, bin);
  }

  return bins;
}

/**
 * Simulér at en bin får tilført `deltaGrams` gram affald.
 * Opdaterer intern cache og returnerer den nye bin-tilstand.
 *
 * - Positive delta øger fyldeprocent
 * - Negative delta (tømning) reducerer fyldeprocent
 * - Batteri falder mikroskopisk pr tilført kilo (simulerer sensor-load)
 * - `last_seen` opdateres til nu
 *
 * Hvis binId ikke findes i cachen genereres en ny bin on-the-fly i
 * Aarhus centrum, så kalderen aldrig får `null` tilbage.
 */
export function simulateBinFill(binId: string, deltaGrams: number): MockBin {
  let current = binStateCache.get(binId);

  if (!current) {
    current = buildBin({
      bin_id: binId,
      kommune: 'Aarhus',
      lat: AARHUS_CENTER.lat + randomBetween(-0.005, 0.005),
      lng: AARHUS_CENTER.lng + randomBetween(-0.005, 0.005),
      fill_pct: 0,
      battery_mv: 4100,
    });
  }

  const deltaPct = (deltaGrams / DEFAULT_BIN_CAPACITY_GRAMS) * 100;
  const newFill = clamp(current.fill_pct + deltaPct, 0, 100);

  // Batteridræn: ~1 mV pr kg (kun ved positiv tilførsel så tømning
  // ikke oplader batteriet).
  const batteryDrain = deltaGrams > 0 ? Math.round(deltaGrams / 1000) : 0;
  const newBattery = clamp(current.battery_mv - batteryDrain, 3000, 4200);

  const updated: MockBin = {
    ...current,
    fill_pct: Math.round(newFill * 10) / 10,
    battery_mv: newBattery,
    last_seen: new Date().toISOString(),
    status: deriveStatus(newFill, newBattery),
  };

  binStateCache.set(binId, updated);
  return updated;
}
