// cirkel-system/tests/gs1.test.ts
//
// Vitest-suite for Modul 2 — GS1/GTIN produkt-opslag (api/_gs1.ts).
//
// Fokus:
//   - normalizeGTIN: 8/12/13/14-cifrede stregkoder → 14-cifret zero-padded
//   - normalizeGTIN: check-digit validering (GS1 mod-10 med weights 3,1,3,1,…)
//   - normalizeGTIN: whitespace/bindestreg-stripping, afvisning af ugyldigt input
//   - lookupGTIN: fallback-chain cached → gs1 → openfoodfacts → null
//   - lookupGTIN: cache-hit fra material_passports med confidence 0.95
//   - lookupGTIN: GS1 kræver GS1_API_KEY (return null uden)
//   - lookupGTIN: OpenFoodFacts crowd-sourced med confidence 0.6
//   - lookupGTIN: persistToCache best-effort — upsert til material_passports
//   - lookupGTIN: invalid input returnerer null
//
// Determinisme:
//   * global.fetch mockes med vi.fn().
//   * Supabase-mocken fra tests/setup.ts leverer in-memory material_passports.
//   * process.env.GS1_API_KEY sættes/rives ned pr. testblok.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  normalizeGTIN,
  lookupGTIN,
  __test__,
  type ProductLookupResult,
} from '../api/_gs1.js';

import { _seedStore, _getStore } from './setup.js';

// ─── Fetch-mock helpers ─────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
    headers: new Headers(),
  } as unknown as Response;
}

// ─── Kanoniske test-GTINs (check-digits beregnet via GS1 mod-10) ────────────

// Alle beregnet med implementationens algoritme (weight-scheme 3,1,3,1,…
// fra rightmost data-digit før check-digit).
const VALID_EAN13   = '5701234567899';   // 13-digit EAN → padded "05701234567899"
const VALID_EAN13_B = '4006381333931';   // 13-digit EAN → padded "04006381333931"
const VALID_UPC12   = '012345678905';    // 12-digit UPC-A → padded "00012345678905"
const VALID_EAN8    = '50011230';        // 8-digit EAN-8 → padded "00000050011230"
const VALID_GTIN14  = '49012345678904';  // 14-digit GTIN

const PADDED_EAN13   = '05701234567899';
const PADDED_EAN13_B = '04006381333931';

// Same underlying but wrong check-digit.
const INVALID_CHECK = '5701234567890';

// ─── Fetch stub ─────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GS1_API_KEY;
  vi.restoreAllMocks();
});

// ============================================================================
// 1) normalizeGTIN — pad + validering
// ============================================================================

describe('normalizeGTIN', () => {
  it('padder 13-cifret EAN til 14 cifre', () => {
    expect(normalizeGTIN(VALID_EAN13)).toBe(PADDED_EAN13);
  });

  it('padder 12-cifret UPC-A til 14 cifre', () => {
    expect(normalizeGTIN(VALID_UPC12)).toBe('00012345678905');
  });

  it('padder 8-cifret EAN-8 til 14 cifre', () => {
    expect(normalizeGTIN(VALID_EAN8)).toBe('00000050011230');
  });

  it('returnerer 14-cifret GTIN uændret', () => {
    expect(normalizeGTIN(VALID_GTIN14)).toBe(VALID_GTIN14);
  });

  it('stripper whitespace og bindestreger', () => {
    expect(normalizeGTIN('5-701-234 567-899')).toBe(PADDED_EAN13);
    expect(normalizeGTIN('  5701234567899  ')).toBe(PADDED_EAN13);
  });

  it('afviser stregkoder med forkert check-digit', () => {
    expect(normalizeGTIN(INVALID_CHECK)).toBeNull();
  });

  it('afviser stregkoder med ulovlig længde (fx 9, 10, 11, 15 cifre)', () => {
    expect(normalizeGTIN('123456789')).toBeNull();       // 9
    expect(normalizeGTIN('1234567890')).toBeNull();      // 10
    expect(normalizeGTIN('12345678901')).toBeNull();     // 11
    expect(normalizeGTIN('123456789012345')).toBeNull(); // 15
  });

  it('afviser ikke-numeriske strings', () => {
    expect(normalizeGTIN('abcdefghijklmn')).toBeNull();
    expect(normalizeGTIN('570123456789A')).toBeNull();
    expect(normalizeGTIN('')).toBeNull();
  });

  it('afviser ikke-string input', () => {
    // @ts-expect-error — bevidst forkert type
    expect(normalizeGTIN(null)).toBeNull();
    // @ts-expect-error — bevidst forkert type
    expect(normalizeGTIN(undefined)).toBeNull();
    // @ts-expect-error — bevidst forkert type
    expect(normalizeGTIN(5701234567899)).toBeNull();
  });
});

// ============================================================================
// 2) __test__.isValidGTINCheckDigit — direkte
// ============================================================================

describe('isValidGTINCheckDigit (via __test__)', () => {
  it('godkender kanoniske GTIN-14', () => {
    expect(__test__.isValidGTINCheckDigit(PADDED_EAN13)).toBe(true);
    expect(__test__.isValidGTINCheckDigit(PADDED_EAN13_B)).toBe(true);
    expect(__test__.isValidGTINCheckDigit('00012345678905')).toBe(true);
    expect(__test__.isValidGTINCheckDigit(VALID_GTIN14)).toBe(true);
  });

  it('afviser GTIN-14 med forkert check-digit', () => {
    // Ændr sidste ciffer 9 → 8
    expect(__test__.isValidGTINCheckDigit('05701234567898')).toBe(false);
    expect(__test__.isValidGTINCheckDigit('04006381333932')).toBe(false);
  });

  it('afviser strings med ikke-numeriske tegn', () => {
    expect(__test__.isValidGTINCheckDigit('0570123456789X')).toBe(false);
    expect(__test__.isValidGTINCheckDigit('A5701234567899')).toBe(false);
  });
});

// ============================================================================
// 3) lookupGTIN — invalid input
// ============================================================================

describe('lookupGTIN — invalid input', () => {
  it('returnerer null uden fetch-kald når GTIN ikke kan normaliseres', async () => {
    const r = await lookupGTIN('invalid-input');
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returnerer null når check-digit er forkert', async () => {
    const r = await lookupGTIN(INVALID_CHECK);
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 4) lookupGTIN — cache hit (material_passports)
// ============================================================================

describe('lookupGTIN — cached (Supabase material_passports)', () => {
  it('returnerer cached-resultat med confidence 0.95 og springer remote over', async () => {
    _seedStore({
      material_passports: [
        {
          barcode_id: PADDED_EAN13,
          product_name: 'Carlsberg Pilsner 33cl',
          primary_material: 'Clear_PET_Plastic',
          composite_materials: {
            _manufacturer: 'Carlsberg A/S',
            _packaging_material: 'Clear_PET_Plastic',
          },
        },
      ],
    });

    const r = (await lookupGTIN(VALID_EAN13)) as ProductLookupResult;
    expect(r).not.toBeNull();
    expect(r.source).toBe('cached');
    expect(r.gtin).toBe(PADDED_EAN13);
    expect(r.product_name).toBe('Carlsberg Pilsner 33cl');
    expect(r.primary_material).toBe('Clear_PET_Plastic');
    expect(r.manufacturer).toBe('Carlsberg A/S');
    expect(r.packaging_material).toBe('Clear_PET_Plastic');
    expect(r.confidence).toBe(0.95);

    // Cache-hit — ingen fetch-kald til GS1/OFF
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cached uden composite_materials returnerer undefined for manufacturer/packaging', async () => {
    _seedStore({
      material_passports: [
        {
          barcode_id: PADDED_EAN13,
          product_name: 'Ukendt Produkt',
          primary_material: 'Corrugated_Cardboard',
          composite_materials: null,
        },
      ],
    });

    const r = (await lookupGTIN(VALID_EAN13)) as ProductLookupResult;
    expect(r.source).toBe('cached');
    expect(r.manufacturer).toBeUndefined();
    expect(r.packaging_material).toBeUndefined();
    expect(r.primary_material).toBe('Corrugated_Cardboard');
  });
});

// ============================================================================
// 5) lookupGTIN — GS1 fallback
// ============================================================================

describe('lookupGTIN — GS1 Denmark fallback', () => {
  it('rammer GS1 når cache er tom OG GS1_API_KEY er sat', async () => {
    process.env.GS1_API_KEY = 'test-gs1-key';
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        productName: 'Arla Skummetmælk 1L',
        manufacturer: 'Arla Foods amba',
        primaryMaterial: 'HDPE',
        packagingMaterial: 'HDPE_Milk_Carton',
      }),
    );

    const r = (await lookupGTIN(VALID_EAN13_B)) as ProductLookupResult;
    expect(r).not.toBeNull();
    expect(r.source).toBe('gs1');
    expect(r.gtin).toBe(PADDED_EAN13_B);
    expect(r.product_name).toBe('Arla Skummetmælk 1L');
    expect(r.manufacturer).toBe('Arla Foods amba');
    expect(r.primary_material).toBe('HDPE');
    expect(r.packaging_material).toBe('HDPE_Milk_Carton');
    expect(r.confidence).toBe(0.9);

    // Bekræft Authorization / X-Api-Key headers
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const opts = call[1] as RequestInit;
    expect(url).toContain(PADDED_EAN13_B);
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-gs1-key');
    expect(headers['X-Api-Key']).toBe('test-gs1-key');
  });

  it('parser GS1 nested "product"-shape', async () => {
    process.env.GS1_API_KEY = 'test-gs1-key';
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        product: {
          name: 'Nested Product Name',
          brand: 'Nested Brand',
          material: 'PP',
          packaging: 'PP_Tub',
        },
      }),
    );

    const r = (await lookupGTIN(VALID_EAN13_B)) as ProductLookupResult;
    expect(r.source).toBe('gs1');
    expect(r.product_name).toBe('Nested Product Name');
    expect(r.manufacturer).toBe('Nested Brand');
    expect(r.primary_material).toBe('PP');
    expect(r.packaging_material).toBe('PP_Tub');
  });

  it('springer GS1 over når GS1_API_KEY ikke er sat', async () => {
    // Ingen GS1-nøgle. GS1 → null, OFF prøves derefter.
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0 })); // OFF miss

    const r = await lookupGTIN(VALID_EAN13_B);
    expect(r).toBeNull();
    // GS1 kaldes IKKE — kun OFF prøves.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('openfoodfacts.org');
  });

  it('afviser GS1-svar uden productName og falder videre til OFF', async () => {
    process.env.GS1_API_KEY = 'test-gs1-key';
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ /* ingen productName */ }))
      .mockResolvedValueOnce(jsonResponse({ status: 0 })); // OFF miss

    const r = await lookupGTIN(VALID_EAN13_B);
    expect(r).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// 6) lookupGTIN — Open Food Facts fallback
// ============================================================================

describe('lookupGTIN — Open Food Facts fallback', () => {
  it('bruger OFF med confidence 0.6 når GS1 mangler', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 1,
        product: {
          product_name_da: 'Coca-Cola 33cl',
          product_name: 'Coca-Cola 33cl English',
          brands: 'Coca-Cola,Coca-Cola Company',
          packaging_materials_tags: ['en:plastic', 'en:pet'],
        },
      }),
    );

    const r = (await lookupGTIN(VALID_EAN13_B)) as ProductLookupResult;
    expect(r).not.toBeNull();
    expect(r.source).toBe('openfoodfacts');
    expect(r.gtin).toBe(PADDED_EAN13_B);
    // OFF: product_name_da foretrækkes over product_name
    expect(r.product_name).toBe('Coca-Cola 33cl');
    // Kun første brand, trimmed.
    expect(r.manufacturer).toBe('Coca-Cola');
    // Tag "en:plastic" → "plastic" efter locale-strip
    expect(r.packaging_material).toBe('plastic');
    expect(r.primary_material).toBe('plastic');
    expect(r.confidence).toBe(0.6);
  });

  it('falder tilbage til packaging-fritekst når packaging_materials_tags mangler', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 1,
        product: {
          product_name: 'Only English Name',
          brands: 'GenericBrand',
          packaging: 'Glass, Aluminum lid',
        },
      }),
    );

    const r = (await lookupGTIN(VALID_EAN13_B)) as ProductLookupResult;
    expect(r.source).toBe('openfoodfacts');
    expect(r.product_name).toBe('Only English Name');
    // Første del før komma, trimmed.
    expect(r.packaging_material).toBe('Glass');
  });

  it('returnerer null når OFF status=0 (not found) og der ikke er andre kilder', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0 }));
    const r = await lookupGTIN(VALID_EAN13_B);
    expect(r).toBeNull();
  });

  it('kalder OFF med både padded og trimmed GTIN (kandidat-liste)', async () => {
    // Første kald (padded) miss, andet kald (trimmed) miss.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 0 }))
      .mockResolvedValueOnce(jsonResponse({ status: 0 }));

    await lookupGTIN(VALID_EAN13_B);

    // OFF prøver først padded, så trimmed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][0] as string)).toContain(PADDED_EAN13_B);
    // Trimmed variant (uden leading zero) er "4006381333931"
    expect((fetchMock.mock.calls[1][0] as string)).toContain('4006381333931.json');
  });
});

// ============================================================================
// 7) lookupGTIN — cache-writeback (best-effort)
// ============================================================================

describe('lookupGTIN — cache-writeback', () => {
  it('persisterer GS1-fund tilbage til material_passports', async () => {
    process.env.GS1_API_KEY = 'test-gs1-key';
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        productName: 'Test Skål',
        manufacturer: 'Test Producer',
        primaryMaterial: 'PP',
        packagingMaterial: 'PP_Tub',
      }),
    );

    await lookupGTIN(VALID_EAN13_B);

    const rows = _getStore().material_passports;
    expect(rows.length).toBeGreaterThan(0);
    const persisted = rows.find((r) => r.barcode_id === PADDED_EAN13_B);
    expect(persisted).toBeDefined();
    expect(persisted?.product_name).toBe('Test Skål');
    expect(persisted?.primary_material).toBe('PP');
    // composite_materials indeholder meta-tags (_source, _confidence, _cached_at)
    const meta = persisted?.composite_materials as Record<string, unknown>;
    expect(meta._source).toBe('gs1');
    expect(meta._confidence).toBe(0.9);
    expect(meta._manufacturer).toBe('Test Producer');
    expect(meta._packaging_material).toBe('PP_Tub');
    expect(typeof meta._cached_at).toBe('string');
  });

  it('persisterer IKKE når resultat er cached (undgår no-op upsert)', async () => {
    _seedStore({
      material_passports: [
        {
          barcode_id: PADDED_EAN13,
          product_name: 'Prækache-produkt',
          primary_material: 'PET',
          composite_materials: null,
        },
      ],
    });
    const before = _getStore().material_passports.length;

    await lookupGTIN(VALID_EAN13);

    // Cached branch → ingen ny upsert.
    expect(_getStore().material_passports.length).toBe(before);
  });
});

// ============================================================================
// 8) lookupGTIN — hele fallback-chain returnerer null
// ============================================================================

describe('lookupGTIN — fuld chain miss', () => {
  it('returnerer null når cache, GS1 og OFF alle er tomme', async () => {
    process.env.GS1_API_KEY = 'test-gs1-key';
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())          // GS1 miss
      .mockResolvedValueOnce(jsonResponse({ status: 0 })); // OFF miss

    const r = await lookupGTIN(VALID_EAN13_B);
    expect(r).toBeNull();
  });

  it('returnerer null når remote-kilder kaster netværksfejl', async () => {
    process.env.GS1_API_KEY = 'test-gs1-key';
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET')) // GS1 crash
      .mockRejectedValueOnce(new Error('ECONNRESET')); // OFF crash

    const r = await lookupGTIN(VALID_EAN13_B);
    expect(r).toBeNull();
  });
});
