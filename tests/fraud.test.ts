// cirkel-system/tests/fraud.test.ts
//
// Vitest-suite for api/_fraud.ts — Cirkel fraud-detection engine.
//
// Fokus:
//   1) calculateRiskScore — duplicate_image (rullende 24h-vindue, cross-user)
//   2) calculateRiskScore — implausible_geo_speed (haversine < 10m + dt < 30s,
//                            kun samme bruger, kun seneste tidligere geo-scan)
//   3) calculateRiskScore — excessive_frequency (10+ scans/rullende time,
//                            inklusiv aktuelt scan, kun samme bruger)
//   4) Score/threshold-gates (accept / review / reject) og kombinerede flags
//   5) Input-validering (user_id, scan_ts_ms)
//   6) generateImageHash — data-URI-stripping, empty/non-string throw, SHA-256
//   7) haversineMeters — identitet, symmetri, kendt ækvatorial 1°-afstand
//
// Alle assertions bruger præcise expected values. Ingen Date.now() uden mock:
// calculateRiskScore modtager scan_ts_ms eksplicit, så tests er deterministiske
// uden at røre systemuret.
//
// Supabase/Firebase er mocket globalt via tests/setup.ts (importeret automatisk
// via vitest.config.ts -> setupFiles). Denne suite kalder ingen af dem — det
// testede modul er ren, ikke-IO — men vi holder mocken aktiv så eventuelle
// utilsigtede imports ikke rammer live-infra.
//
// Ingen HTTP-handler her ⇒ ingen supertest (kravet var "hvor relevant").
// Ingen skip.only. Ingen TODO. Ingen live network-calls.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

import {
  calculateRiskScore,
  generateImageHash,
  haversineMeters,
  FRAUD_WEIGHTS,
  FRAUD_THRESHOLDS,
  type FraudSignals,
  type HistoricalScan,
} from '../api/_fraud.js';

// ─── Deterministiske fixtures ────────────────────────────────────────────────

const USER_A = 'user-A-11111111-1111-4111-8111-111111111111';
const USER_B = 'user-B-22222222-2222-4222-8222-222222222222';

// Frosset "nu" for alle scan-timestamps. Vi bruger scan_ts_ms eksplicit
// i signals/history — så Date.now() aldrig kaldes af selve engine'n.
const NOW_MS = Date.UTC(2026, 6, 22, 12, 0, 0); // 2026-07-22T12:00:00.000Z

const HASH_ALPHA = 'a'.repeat(64);
const HASH_BETA = 'b'.repeat(64);

const AARHUS: { lat: number; lng: number } = { lat: 56.1567, lng: 10.2109 };
const AARHUS_2M_EAST: { lat: number; lng: number } = {
  lat: AARHUS.lat,
  lng: AARHUS.lng + 0.00002, // ~1.2m ved denne breddegrad → sikkert < 10m
};
const AARHUS_50M_EAST: { lat: number; lng: number } = {
  lat: AARHUS.lat,
  lng: AARHUS.lng + 0.00081, // ~50m ved denne breddegrad → sikkert > 10m
};

function baseSignals(overrides: Partial<FraudSignals> = {}): FraudSignals {
  return {
    user_id: USER_A,
    scan_ts_ms: NOW_MS,
    ...overrides,
  };
}

beforeEach(() => {
  // Sørg for at eventuel forudgående fake-timer-tilstand er ryddet.
  // Engine'n bruger ikke Date.now(), men vi holder testen streng.
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1) DUPLICATE_IMAGE
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateRiskScore — duplicate_image rule', () => {
  it('happy path: fresh image, no history → no flag, score 0, recommend accept', () => {
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA }),
      [],
    );
    expect(result).toEqual({
      score: 0,
      flags: [],
      recommend: 'accept',
    });
  });

  it('same image_hash within the 24h window → flag + score 50 + review', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 60 * 60 * 1000, // 1 time siden
        image_hash: HASH_ALPHA,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA }),
      history,
    );
    expect(result.flags).toEqual(['duplicate_image']);
    expect(result.score).toBe(FRAUD_WEIGHTS.duplicate_image);
    expect(result.score).toBe(50);
    expect(result.recommend).toBe('review');
  });

  it('duplicate hash owned by a DIFFERENT user still triggers (cross-user detection)', () => {
    // ruleDuplicateImage iterer hele history (ikke kun userHistory) —
    // en genbrugt billed-hash på tværs af brugere er et stærkt fraud-signal.
    const history: HistoricalScan[] = [
      {
        user_id: USER_B,
        scan_ts_ms: NOW_MS - 5 * 60 * 1000, // 5 min siden hos anden bruger
        image_hash: HASH_ALPHA,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA }),
      history,
    );
    expect(result.flags).toEqual(['duplicate_image']);
    expect(result.score).toBe(50);
    expect(result.recommend).toBe('review');
  });

  it('same image_hash but exactly 24h ago → INCLUDED (inclusive lower bound)', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - FRAUD_THRESHOLDS.duplicate_window_ms,
        image_hash: HASH_ALPHA,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA }),
      history,
    );
    expect(result.flags).toContain('duplicate_image');
    expect(result.score).toBe(50);
  });

  it('same image_hash but 24h + 1ms ago → EXCLUDED (outside window)', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - FRAUD_THRESHOLDS.duplicate_window_ms - 1,
        image_hash: HASH_ALPHA,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA }),
      history,
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
    expect(result.recommend).toBe('accept');
  });

  it('different image_hash in window → no flag', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 10 * 60 * 1000,
        image_hash: HASH_BETA,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA }),
      history,
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('missing image_hash on signals → rule silently no-ops', () => {
    const history: HistoricalScan[] = [
      { user_id: USER_A, scan_ts_ms: NOW_MS - 1000, image_hash: HASH_ALPHA },
    ];
    const result = calculateRiskScore(baseSignals({ image_hash: undefined }), history);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
    expect(result.recommend).toBe('accept');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2) IMPLAUSIBLE_GEO_SPEED
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateRiskScore — implausible_geo_speed rule', () => {
  it('close geo (<10m) and short delta (<30s) → flag + score 40 + review', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 10_000, // 10 sekunder siden
        geo: AARHUS,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ geo: AARHUS_2M_EAST }),
      history,
    );
    expect(result.flags).toEqual(['implausible_geo_speed']);
    expect(result.score).toBe(FRAUD_WEIGHTS.implausible_geo_speed);
    expect(result.score).toBe(40);
    expect(result.recommend).toBe('review');
  });

  it('same coord, dt = 29_999ms (just under 30s) → flag triggers', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 29_999,
        geo: AARHUS,
      },
    ];
    const result = calculateRiskScore(baseSignals({ geo: AARHUS }), history);
    expect(result.flags).toContain('implausible_geo_speed');
    expect(result.score).toBe(40);
  });

  it('same coord, dt = 30_000ms exactly → NO flag (strict <30s)', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - FRAUD_THRESHOLDS.geo_min_delta_ms,
        geo: AARHUS,
      },
    ];
    const result = calculateRiskScore(baseSignals({ geo: AARHUS }), history);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
    expect(result.recommend).toBe('accept');
  });

  it('close in time but ~50m apart → NO flag (distance ≥ 10m)', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 5_000, // 5s siden
        geo: AARHUS,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ geo: AARHUS_50M_EAST }),
      history,
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('missing signals.geo OR no user geo history → no flag', () => {
    // Case A: signals mangler geo helt
    expect(
      calculateRiskScore(baseSignals({ geo: undefined }), [
        { user_id: USER_A, scan_ts_ms: NOW_MS - 1000, geo: AARHUS },
      ]).flags,
    ).toEqual([]);

    // Case B: signals har geo, men brugerens historik har ingen geo-scans
    expect(
      calculateRiskScore(baseSignals({ geo: AARHUS }), [
        { user_id: USER_A, scan_ts_ms: NOW_MS - 1000 /* ingen geo */ },
      ]).flags,
    ).toEqual([]);
  });

  it('a different user has geo history but same user does not → no flag', () => {
    // ruleImplausibleGeoSpeed bruger userHistory — kun samme bruger tæller.
    const history: HistoricalScan[] = [
      { user_id: USER_B, scan_ts_ms: NOW_MS - 1_000, geo: AARHUS },
    ];
    const result = calculateRiskScore(
      baseSignals({ user_id: USER_A, geo: AARHUS_2M_EAST }),
      history,
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('rule ignores future/current entries and picks the LATEST prior geo-scan', () => {
    // Ældre scan sidder tæt+kort tid = triggerbart, men nyere scan er
    // både længere væk og længere tilbage → rule skal bruge det NYESTE.
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 10 * 60 * 1000, // 10 min siden — langt væk
        geo: AARHUS_50M_EAST,
      },
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 1_000, // 1s siden — tæt på
        geo: AARHUS_2M_EAST,
      },
      // "Fremtidigt" scan skal ignoreres (scan_ts_ms >= aktuelt)
      { user_id: USER_A, scan_ts_ms: NOW_MS + 500, geo: AARHUS },
    ];
    const result = calculateRiskScore(baseSignals({ geo: AARHUS }), history);
    expect(result.flags).toContain('implausible_geo_speed');
    expect(result.score).toBe(40);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3) EXCESSIVE_FREQUENCY
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateRiskScore — excessive_frequency rule', () => {
  /** Bygger N scans jævnt fordelt i det seneste vindue for USER_A. */
  function makeFreqHistory(count: number, spacingMs = 5 * 60 * 1000): HistoricalScan[] {
    return Array.from({ length: count }, (_, i) => ({
      user_id: USER_A,
      scan_ts_ms: NOW_MS - (i + 1) * spacingMs,
    }));
  }

  it('8 prior scans in window (+ current = 9) → no flag, score 0', () => {
    // 8*5min = 40 min tilbage — alle inden for 1t-vinduet.
    const result = calculateRiskScore(baseSignals(), makeFreqHistory(8));
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
    expect(result.recommend).toBe('accept');
  });

  it('9 prior scans in window (+ current = 10) → flag + score 30 + accept', () => {
    // Precise boundary: count+1 >= 10 → true.
    // Score 30 < review_at (40) → recommend forbliver 'accept'.
    const result = calculateRiskScore(baseSignals(), makeFreqHistory(9));
    expect(result.flags).toEqual(['excessive_frequency']);
    expect(result.score).toBe(FRAUD_WEIGHTS.excessive_frequency);
    expect(result.score).toBe(30);
    expect(result.recommend).toBe('accept');
  });

  it('20 prior scans in window → still exactly one flag, still score 30', () => {
    // 20 * 2min = 40 min — alle inden for vinduet.
    const result = calculateRiskScore(baseSignals(), makeFreqHistory(20, 2 * 60 * 1000));
    expect(result.flags).toEqual(['excessive_frequency']);
    expect(result.score).toBe(30);
  });

  it('scans older than 1h window are excluded', () => {
    // 15 scans, hver 10 min → tidsstempler går 10, 20, ..., 150 min tilbage.
    // Kun de første 5 (10..50 min) er inden for 60-min-vinduet →
    // count = 5, count+1 = 6 → ingen flag.
    const result = calculateRiskScore(baseSignals(), makeFreqHistory(15, 10 * 60 * 1000));
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('scans from other users do not contribute to the current user count', () => {
    const otherUsers: HistoricalScan[] = Array.from({ length: 30 }, (_, i) => ({
      user_id: USER_B,
      scan_ts_ms: NOW_MS - (i + 1) * 60 * 1000, // hvert minut
    }));
    const mine = makeFreqHistory(5); // kun 5 for USER_A i vinduet
    const result = calculateRiskScore(baseSignals(), [...otherUsers, ...mine]);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('boundary: prior scan exactly at cutoff (1h ago) is counted', () => {
    // 8 nyere scans + 1 præcis på cutoff = 9 → +1 aktuelt = 10 → flag.
    const history: HistoricalScan[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        user_id: USER_A,
        scan_ts_ms: NOW_MS - (i + 1) * 60 * 1000,
      })),
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - FRAUD_THRESHOLDS.frequency_window_ms,
      },
    ];
    const result = calculateRiskScore(baseSignals(), history);
    expect(result.flags).toEqual(['excessive_frequency']);
    expect(result.score).toBe(30);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4) KOMBINEREDE FLAGS + RECOMMENDATION-GATES
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateRiskScore — combined flags and recommendation gates', () => {
  it('duplicate + geo → score 90 (50+40), recommend reject (>= 70)', () => {
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 5_000,
        image_hash: HASH_ALPHA,
        geo: AARHUS,
      },
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA, geo: AARHUS_2M_EAST }),
      history,
    );
    expect(result.flags).toEqual(['duplicate_image', 'implausible_geo_speed']);
    expect(result.score).toBe(90);
    expect(result.recommend).toBe('reject');
  });

  it('duplicate + geo + frequency → score 120, all flags, reject', () => {
    // Byg 9 scans i vinduet (frekvens) hvor det seneste også har match
    // på både image_hash og geo (duplicate + geo).
    const history: HistoricalScan[] = [
      {
        user_id: USER_A,
        scan_ts_ms: NOW_MS - 5_000, // seneste
        image_hash: HASH_ALPHA,
        geo: AARHUS,
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        user_id: USER_A,
        // 2..9 min siden — alle indenfor vinduet, alle EFTER at have
        // etableret det tætte scan ovenfor er irrelevant for frekvens.
        scan_ts_ms: NOW_MS - (i + 2) * 60 * 1000,
      })),
    ];
    const result = calculateRiskScore(
      baseSignals({ image_hash: HASH_ALPHA, geo: AARHUS_2M_EAST }),
      history,
    );
    expect(result.flags).toEqual([
      'duplicate_image',
      'implausible_geo_speed',
      'excessive_frequency',
    ]);
    expect(result.score).toBe(120);
    expect(result.recommend).toBe('reject');
  });

  it('score exactly 40 → recommend "review" (boundary review_at)', () => {
    // Vi rammer 40 via geo-flag alene (weight = 40).
    const history: HistoricalScan[] = [
      { user_id: USER_A, scan_ts_ms: NOW_MS - 5_000, geo: AARHUS },
    ];
    const result = calculateRiskScore(baseSignals({ geo: AARHUS_2M_EAST }), history);
    expect(result.score).toBe(40);
    expect(result.recommend).toBe('review');
  });

  it('score exactly 70 → recommend "reject" (boundary reject_at)', () => {
    // duplicate (50) + high_value_unverified (20) = 70
    const history: HistoricalScan[] = [
      { user_id: USER_A, scan_ts_ms: NOW_MS - 60_000, image_hash: HASH_ALPHA },
    ];
    const result = calculateRiskScore(
      baseSignals({
        image_hash: HASH_ALPHA,
        verification_tier: 'standard',
        payout_dkk: 100,
      }),
      history,
    );
    expect(result.score).toBe(70);
    expect(result.flags).toEqual(['duplicate_image', 'high_value_unverified']);
    expect(result.recommend).toBe('reject');
  });

  it('no flags at all → score 0, recommend "accept"', () => {
    const result = calculateRiskScore(baseSignals(), []);
    expect(result).toEqual({ score: 0, flags: [], recommend: 'accept' });
  });

  it('constants are stable and match the documented weights/gates', () => {
    // Vagt mod utilsigtet ændring af threshold-kontrakten.
    expect(FRAUD_WEIGHTS).toEqual({
      duplicate_image: 50,
      implausible_geo_speed: 40,
      excessive_frequency: 30,
      high_value_unverified: 20,
    });
    expect(FRAUD_THRESHOLDS.duplicate_window_ms).toBe(24 * 60 * 60 * 1000);
    expect(FRAUD_THRESHOLDS.geo_max_distance_m).toBe(10);
    expect(FRAUD_THRESHOLDS.geo_min_delta_ms).toBe(30 * 1000);
    expect(FRAUD_THRESHOLDS.frequency_window_ms).toBe(60 * 60 * 1000);
    expect(FRAUD_THRESHOLDS.frequency_max_scans).toBe(10);
    expect(FRAUD_THRESHOLDS.review_at).toBe(40);
    expect(FRAUD_THRESHOLDS.reject_at).toBe(70);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5) INPUT-VALIDERING (error-paths)
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateRiskScore — input validation', () => {
  it('throws when signals.user_id is missing', () => {
    // @ts-expect-error — bevidst ugyldig payload for at ramme validerings-grenen
    expect(() => calculateRiskScore({ scan_ts_ms: NOW_MS }, [])).toThrow(
      /signals\.user_id is required/,
    );
  });

  it('throws when signals.user_id is empty string', () => {
    expect(() =>
      calculateRiskScore({ user_id: '', scan_ts_ms: NOW_MS } as FraudSignals, []),
    ).toThrow(/signals\.user_id is required/);
  });

  it('throws when signals.scan_ts_ms is not finite', () => {
    expect(() =>
      calculateRiskScore(
        { user_id: USER_A, scan_ts_ms: Number.NaN } as FraudSignals,
        [],
      ),
    ).toThrow(/scan_ts_ms must be a finite number/);
  });

  it('accepts an empty history array without throwing (default parameter path)', () => {
    // Kaldes uden 2. argument → default [] anvendes; ingen throws.
    const result = calculateRiskScore(baseSignals());
    expect(result).toEqual({ score: 0, flags: [], recommend: 'accept' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6) generateImageHash — helper
// ═════════════════════════════════════════════════════════════════════════════

describe('generateImageHash — helper', () => {
  it('returns the SHA-256 hex-digest of the decoded base64 payload', () => {
    // 'aGVsbG8=' er base64 for "hello" → SHA-256("hello") =
    // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const hash = generateImageHash('aGVsbG8=');
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    // Ekstra kryds-verifikation mod runtime crypto (deterministisk).
    const expected = createHash('sha256').update(Buffer.from('aGVsbG8=', 'base64')).digest('hex');
    expect(hash).toBe(expected);
  });

  it('strips a data-URI prefix and returns the same hash as the raw payload', () => {
    const raw = 'aGVsbG8=';
    const dataUri = `data:image/png;base64,${raw}`;
    expect(generateImageHash(dataUri)).toBe(generateImageHash(raw));
  });

  it('is deterministic — same input yields byte-identical output', () => {
    const a = generateImageHash('YWxwaGE='); // "alpha"
    const b = generateImageHash('YWxwaGE=');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws on empty string', () => {
    expect(() => generateImageHash('')).toThrow(/non-empty string/);
  });

  it('throws on non-string input', () => {
    // @ts-expect-error — bevidst forkert type
    expect(() => generateImageHash(null)).toThrow(/non-empty string/);
    // @ts-expect-error — bevidst forkert type
    expect(() => generateImageHash(undefined)).toThrow(/non-empty string/);
    // @ts-expect-error — bevidst forkert type
    expect(() => generateImageHash(12345)).toThrow(/non-empty string/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7) haversineMeters — helper
// ═════════════════════════════════════════════════════════════════════════════

describe('haversineMeters — helper', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(AARHUS, AARHUS)).toBe(0);
  });

  it('is symmetric: d(a,b) === d(b,a)', () => {
    const ab = haversineMeters(AARHUS, AARHUS_50M_EAST);
    const ba = haversineMeters(AARHUS_50M_EAST, AARHUS);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('yields ~111.195 km for 1° longitude difference at the equator', () => {
    // Kanonisk sanity-check: 1° langs ækvator ≈ 111 194.93 m
    // (2πR/360 med R = 6 371 000).
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(d).toBeCloseTo(111_194.9, 0); // ±0.5 m
  });

  it('agrees with fraud-thresholds: AARHUS ↔ AARHUS_2M_EAST < 10m; ↔ AARHUS_50M_EAST > 10m', () => {
    expect(haversineMeters(AARHUS, AARHUS_2M_EAST)).toBeLessThan(
      FRAUD_THRESHOLDS.geo_max_distance_m,
    );
    expect(haversineMeters(AARHUS, AARHUS_50M_EAST)).toBeGreaterThan(
      FRAUD_THRESHOLDS.geo_max_distance_m,
    );
  });

  it('produces monotonically increasing distances for increasing longitude offsets', () => {
    const d1 = haversineMeters(AARHUS, { lat: AARHUS.lat, lng: AARHUS.lng + 0.0001 });
    const d2 = haversineMeters(AARHUS, { lat: AARHUS.lat, lng: AARHUS.lng + 0.0010 });
    const d3 = haversineMeters(AARHUS, { lat: AARHUS.lat, lng: AARHUS.lng + 0.0100 });
    expect(d1).toBeLessThan(d2);
    expect(d2).toBeLessThan(d3);
  });
});
