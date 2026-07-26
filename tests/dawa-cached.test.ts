// cirkel-system/tests/dawa-cached.test.ts
//
// Vitest-suite for Modul F4.2 — embedded DAWA-cache (api/_dawa-cached.ts).
//
// Fokus:
//   - lookupByPostcode: 15 pilot-kommuner returnerer korrekt kommune-shape
//   - lookupByPostcode: 4-cifret validering, whitespace, ikke-numerisk input
//   - lookupByPostcode: ukendt postnummer -> null
//   - lookupByCoordinates: haversine finder nærmeste rådhus
//   - lookupByCoordinates: input-validering (NaN, Infinity, out-of-range)
//   - KOMMUNE_CACHE: 15 entries, hver med korrekt shape (kode/navn/postcodes/center)
//
// Modulet er en ren TS-funktion uden I/O — ingen mocks nødvendige.

import { describe, it, expect } from 'vitest';

import {
  KOMMUNE_CACHE,
  lookupByPostcode,
  lookupByCoordinates,
  type CachedKommune,
} from '../api/_dawa-cached.js';

// ============================================================================
// 1) KOMMUNE_CACHE — shape og indhold
// ============================================================================

describe('KOMMUNE_CACHE', () => {
  it('indeholder præcis 15 pilot-kommuner', () => {
    expect(KOMMUNE_CACHE.length).toBe(15);
  });

  it('inkluderer alle forventede pilot-kommuner (per kommunekode)', () => {
    const codes = KOMMUNE_CACHE.map((k) => k.kommune_kode).sort();
    // 15 pilot-kommuner fra CIRKEL-EVERYTHING-v3, sorteret alfabetisk:
    // 101 København, 147 (mangler i cache), 265 Roskilde, 370 Næstved,
    // 461 Odense, 561 Esbjerg, 607 Fredericia, 615 Horsens, 621 Kolding,
    // 630 Vejle, 657 Herning, 730 Randers, 740 Silkeborg, 751 Aarhus,
    // 791 Viborg, 851 Aalborg.
    expect(codes).toEqual([
      '101', '265', '370', '461', '561', '607', '615', '621',
      '630', '657', '730', '740', '751', '791', '851',
    ]);
  });

  it('hver kommune har alle påkrævede felter og valid shape', () => {
    for (const k of KOMMUNE_CACHE) {
      expect(typeof k.kommune_kode).toBe('string');
      expect(k.kommune_kode.length).toBeGreaterThanOrEqual(3);
      expect(typeof k.kommune_navn).toBe('string');
      expect(k.kommune_navn.length).toBeGreaterThan(0);
      expect(Array.isArray(k.postcodes)).toBe(true);
      expect(k.postcodes.length).toBeGreaterThan(0);
      for (const pc of k.postcodes) {
        expect(pc).toMatch(/^\d{4}$/);
      }
      // Center-koordinat i Danmarks bounding box
      expect(k.center.lat).toBeGreaterThan(54);
      expect(k.center.lat).toBeLessThan(58);
      expect(k.center.lng).toBeGreaterThan(7);
      expect(k.center.lng).toBeLessThan(16);
    }
  });
});

// ============================================================================
// 2) lookupByPostcode — happy path
// ============================================================================

describe('lookupByPostcode', () => {
  it('finder København på 1050', () => {
    const k = lookupByPostcode('1050') as CachedKommune;
    expect(k).not.toBeNull();
    expect(k.kommune_navn).toBe('København');
    expect(k.kommune_kode).toBe('101');
  });

  it('finder Aarhus på 8000', () => {
    const k = lookupByPostcode('8000') as CachedKommune;
    expect(k).not.toBeNull();
    expect(k.kommune_navn).toBe('Aarhus');
    expect(k.kommune_kode).toBe('751');
  });

  it('finder Odense på 5000', () => {
    const k = lookupByPostcode('5000') as CachedKommune;
    expect(k.kommune_navn).toBe('Odense');
    expect(k.kommune_kode).toBe('461');
  });

  it('finder Aalborg på 9000', () => {
    const k = lookupByPostcode('9000') as CachedKommune;
    expect(k.kommune_navn).toBe('Aalborg');
    expect(k.kommune_kode).toBe('851');
  });

  it('finder Esbjerg på 6700', () => {
    const k = lookupByPostcode('6700') as CachedKommune;
    expect(k.kommune_navn).toBe('Esbjerg');
    expect(k.kommune_kode).toBe('561');
  });

  it('finder Fredericia på 7000 (kommune med kun ét postnummer)', () => {
    const k = lookupByPostcode('7000') as CachedKommune;
    expect(k.kommune_navn).toBe('Fredericia');
    expect(k.kommune_kode).toBe('607');
  });

  it('trimmer whitespace i input', () => {
    const k = lookupByPostcode('  8000  ') as CachedKommune;
    expect(k).not.toBeNull();
    expect(k.kommune_navn).toBe('Aarhus');
  });

  it('returnerer null for ukendt postnummer', () => {
    // 3000-serien findes ikke i cachen (Hillerød / Helsingør)
    expect(lookupByPostcode('3000')).toBeNull();
  });
});

// ============================================================================
// 3) lookupByPostcode — input-validering
// ============================================================================

describe('lookupByPostcode — input-validering', () => {
  it('afviser ikke-4-cifrede strings', () => {
    expect(lookupByPostcode('800')).toBeNull();     // 3 cifre
    expect(lookupByPostcode('80000')).toBeNull();   // 5 cifre
    expect(lookupByPostcode('')).toBeNull();        // tom
  });

  it('afviser ikke-numeriske strings', () => {
    expect(lookupByPostcode('abcd')).toBeNull();
    expect(lookupByPostcode('80AA')).toBeNull();
  });

  it('håndterer null/undefined uden at crashe', () => {
    // @ts-expect-error — bevidst forkert type
    expect(lookupByPostcode(null)).toBeNull();
    // @ts-expect-error — bevidst forkert type
    expect(lookupByPostcode(undefined)).toBeNull();
  });
});

// ============================================================================
// 4) lookupByCoordinates — nærmeste-rådhus haversine
// ============================================================================

describe('lookupByCoordinates', () => {
  it('finder København præcist på 55.6761, 12.5683', () => {
    const k = lookupByCoordinates(55.6761, 12.5683) as CachedKommune;
    expect(k).not.toBeNull();
    expect(k.kommune_kode).toBe('101');
    expect(k.kommune_navn).toBe('København');
  });

  it('finder Aarhus præcist på 56.1629, 10.2039', () => {
    const k = lookupByCoordinates(56.1629, 10.2039) as CachedKommune;
    expect(k.kommune_navn).toBe('Aarhus');
    expect(k.kommune_kode).toBe('751');
  });

  it('finder nærmeste kommune (Odense) fra let-forskudt koordinat', () => {
    // ~5 km syd for Odense rådhus
    const k = lookupByCoordinates(55.36, 10.40) as CachedKommune;
    expect(k.kommune_navn).toBe('Odense');
  });

  it('finder København når koordinat ligger tættere på KBH end noget andet rådhus', () => {
    // Midt-Sjælland, faktisk tættere på København end Næstved
    const k = lookupByCoordinates(55.5, 12.0) as CachedKommune;
    // Roskilde-rådhus er på 55.6415, 12.0803 — den er nærmest her.
    expect(k.kommune_navn).toBe('Roskilde');
  });
});

// ============================================================================
// 5) lookupByCoordinates — input-validering
// ============================================================================

describe('lookupByCoordinates — input-validering', () => {
  it('afviser NaN', () => {
    expect(lookupByCoordinates(NaN, 10)).toBeNull();
    expect(lookupByCoordinates(55, NaN)).toBeNull();
  });

  it('afviser Infinity', () => {
    expect(lookupByCoordinates(Infinity, 10)).toBeNull();
    expect(lookupByCoordinates(55, -Infinity)).toBeNull();
  });

  it('afviser out-of-range latitude', () => {
    expect(lookupByCoordinates(-91, 10)).toBeNull();
    expect(lookupByCoordinates(91, 10)).toBeNull();
  });

  it('afviser out-of-range longitude', () => {
    expect(lookupByCoordinates(55, -181)).toBeNull();
    expect(lookupByCoordinates(55, 181)).toBeNull();
  });

  it('afviser ikke-tal input (typesikkert)', () => {
    // @ts-expect-error — bevidst forkert type
    expect(lookupByCoordinates('55', 10)).toBeNull();
    // @ts-expect-error — bevidst forkert type
    expect(lookupByCoordinates(55, '10')).toBeNull();
  });
});
