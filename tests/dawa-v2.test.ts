// cirkel-system/tests/dawa-v2.test.ts
//
// Vitest-suite for Modul F4.2-v2 — DAWA-fallback-chain (api/_dawa-v2.ts).
//
// Fokus:
//   - lookupAddress: primary df-v2 -> dawa-legacy -> cached (embedded) chain
//   - lookupAddress: postnr / koordinat / fritekst-adresse-lookups
//   - lookupAddress: embedded 15-kommune fallback når begge remote fejler
//   - lookupAddress: cache-integration (LRU, 24t TTL, LRU touch)
//   - lookupAddress: null når intet kan findes
//   - fetchWithTimeout via mocked global.fetch (fejlkondition/timeout)
//
// Determinisme:
//   * global.fetch mockes med vi.fn() per test.
//   * _debugClearCache() kaldes i beforeEach — ingen state-lækage mellem tests.
//   * Ingen live network-calls.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  lookupAddress,
  _debugCacheSize,
  _debugClearCache,
  _debug,
  type AddressResult,
} from '../api/_dawa-v2.js';

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

// ─── Fixtures ───────────────────────────────────────────────────────────────

const DF_V2_BASE = 'https://api.dataforsyningen.dk';
const DAWA_LEGACY_BASE = 'https://dawa.aws.dk';

const KBH_POSTNR_BODY = {
  nr: '8000',
  kommuner: [{ navn: 'Aarhus', kode: '751' }],
};

// ─── Setup/teardown ─────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _debugClearCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// 1) Postnr-lookup — primary df-v2 vinder
// ============================================================================

describe('lookupAddress — postnr via df-v2 (primary)', () => {
  it('returnerer resultat fra df-v2 uden at ramme legacy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(KBH_POSTNR_BODY));

    const result = await lookupAddress({ postcode: '8000' });

    expect(result).not.toBeNull();
    const r = result as AddressResult;
    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.kommune_kode).toBe('751');
    expect(r.postcode).toBe('8000');
    expect(r.source).toBe('df-v2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(DF_V2_BASE);
    expect(url).toContain('/postnumre/8000');
  });

  it('cacher resultatet så andet kald ikke rammer fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(KBH_POSTNR_BODY));
    await lookupAddress({ postcode: '8000' });
    expect(_debugCacheSize()).toBe(1);

    const cached = await lookupAddress({ postcode: '8000' });
    expect(cached).not.toBeNull();
    expect((cached as AddressResult).source).toBe('df-v2');
    // Ingen ekstra fetch-kald.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 2) Fallback til dawa-legacy når df-v2 fejler
// ============================================================================

describe('lookupAddress — fallback til dawa-legacy', () => {
  it('bruger dawa-legacy når df-v2 svarer 404', async () => {
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())            // df-v2
      .mockResolvedValueOnce(jsonResponse(KBH_POSTNR_BODY)); // dawa-legacy

    const result = await lookupAddress({ postcode: '8000' });

    const r = result as AddressResult;
    expect(r).not.toBeNull();
    expect(r.source).toBe('dawa-legacy');
    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.kommune_kode).toBe('751');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][0] as string)).toContain(DF_V2_BASE);
    expect((fetchMock.mock.calls[1][0] as string)).toContain(DAWA_LEGACY_BASE);
  });

  it('bruger dawa-legacy når df-v2 kaster netværksfejl', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(jsonResponse(KBH_POSTNR_BODY));

    const result = await lookupAddress({ postcode: '8000' });
    expect((result as AddressResult).source).toBe('dawa-legacy');
  });
});

// ============================================================================
// 3) Embedded 15-kommune subset når begge remote-kilder fejler
// ============================================================================

describe('lookupAddress — embedded fallback', () => {
  it('falder tilbage til cached når begge remote er nede for pilot-postnr', async () => {
    fetchMock.mockResolvedValue(notFoundResponse());

    const result = await lookupAddress({ postcode: '8000' });
    const r = result as AddressResult;

    expect(r).not.toBeNull();
    expect(r.source).toBe('cached');
    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.kommune_kode).toBe('0751');
    expect(r.postcode).toBe('8000');
  });

  it('falder tilbage til cached for København 1050', async () => {
    fetchMock.mockResolvedValue(notFoundResponse());
    const r = (await lookupAddress({ postcode: '1050' })) as AddressResult;
    expect(r.source).toBe('cached');
    expect(r.kommune_navn).toBe('København');
    expect(r.kommune_kode).toBe('0101');
  });

  it('returnerer null når postnr ikke er i embedded subset og remote fejler', async () => {
    fetchMock.mockResolvedValue(notFoundResponse());
    // 3000 Helsingør er ikke i pilot-15 subset.
    const result = await lookupAddress({ postcode: '3000' });
    expect(result).toBeNull();
  });
});

// ============================================================================
// 4) Koordinat-lookup — reverse geocode
// ============================================================================

describe('lookupAddress — koordinat-lookup', () => {
  it('bruger /kommuner/reverse med x/y og srid=4326', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ navn: 'Aarhus', kode: '751' })) // kommuner/reverse
      .mockResolvedValueOnce(jsonResponse({ postnummer: { nr: '8000' } })); // adgangsadresser/reverse

    const result = await lookupAddress({ latitude: 56.1629, longitude: 10.2039 });
    const r = result as AddressResult;

    expect(r.source).toBe('df-v2');
    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.kommune_kode).toBe('751');
    expect(r.postcode).toBe('8000');

    const kommuneUrl = fetchMock.mock.calls[0][0] as string;
    expect(kommuneUrl).toContain('/kommuner/reverse');
    expect(kommuneUrl).toContain('x=10.2039');
    expect(kommuneUrl).toContain('y=56.1629');
    expect(kommuneUrl).toContain('srid=4326');
  });

  it('returnerer kommune uden postnr hvis adgangsadresser/reverse fejler', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ navn: 'Aarhus', kode: '751' }))
      .mockResolvedValueOnce(notFoundResponse());

    const r = (await lookupAddress({
      latitude: 56.1629,
      longitude: 10.2039,
    })) as AddressResult;

    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.postcode).toBe('');
  });
});

// ============================================================================
// 5) Fritekst-adresse — /adgangsadresser?q=
// ============================================================================

describe('lookupAddress — fritekst-adresse', () => {
  it('slår op via /adgangsadresser?q= når kun adresse er givet', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          postnr: '8000',
          postnrnavn: 'Aarhus C',
          kommunekode: '751',
          kommunenavn: 'Aarhus',
        },
      ]),
    );

    const result = await lookupAddress({ address: 'Store Torv 1' });
    const r = result as AddressResult;

    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.kommune_kode).toBe('751');
    expect(r.postcode).toBe('8000');
    expect(r.source).toBe('df-v2');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/adgangsadresser?q=');
    expect(url).toContain('per_side=1');
    expect(url).toContain('struktur=mini');
  });

  it('trækker postnummer ud af fritekst og bruger postnr-lookup i stedet', async () => {
    // Med et 4-cifret tal i strengen bør _dawa-v2 kalde postnumre-endpoint,
    // ikke /adgangsadresser?q=.
    fetchMock.mockResolvedValueOnce(jsonResponse(KBH_POSTNR_BODY));

    const result = await lookupAddress({ address: 'Store Torv 1, 8000 Aarhus C' });
    const r = result as AddressResult;
    expect(r.kommune_navn).toBe('Aarhus');
    expect(r.postcode).toBe('8000');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/postnumre/8000');
  });
});

// ============================================================================
// 6) Cache-nøgler — normalisering
// ============================================================================

describe('lookupAddress — cache-normalisering', () => {
  it('koordinat-cache bruger 4 decimaler', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ navn: 'Aarhus', kode: '751' }))
      .mockResolvedValueOnce(jsonResponse({ postnummer: { nr: '8000' } }));

    await lookupAddress({ latitude: 56.16290001, longitude: 10.20390001 });
    // Anden call med samme koordinat (rundet ens) skal ramme cache.
    const cached = await lookupAddress({
      latitude: 56.16290002,
      longitude: 10.20390002,
    });
    expect((cached as AddressResult).kommune_navn).toBe('Aarhus');
    // Kun første call ramte fetch (2 calls for reverse-lookup).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adresse-cache-nøgle er case-insensitive (lower-cased)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { postnr: '5000', kommunekode: '461', kommunenavn: 'Odense' },
      ]),
    );

    await lookupAddress({ address: 'Rådhuspladsen 1' });
    const cached = await lookupAddress({ address: 'RÅDHUSPLADSEN 1' });
    expect((cached as AddressResult).kommune_navn).toBe('Odense');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 7) _debug-konstanter
// ============================================================================

describe('_debug metadata', () => {
  it('exposer DF_V2_BASE, DAWA_LEGACY_BASE, SOURCE_TIMEOUT_MS, CACHE_TTL_MS', () => {
    expect(_debug.DF_V2_BASE).toBe(DF_V2_BASE);
    expect(_debug.DAWA_LEGACY_BASE).toBe(DAWA_LEGACY_BASE);
    expect(_debug.SOURCE_TIMEOUT_MS).toBe(1500);
    expect(_debug.CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(_debug.CACHE_MAX).toBe(1000);
  });

  it('EMBEDDED_KOMMUNER_COUNT dækker alle 15 pilot-kommuner (>= 60 postnumre)', () => {
    // Vi har ~90+ embedded postnumre spredt over 15 kommuner.
    expect(_debug.EMBEDDED_KOMMUNER_COUNT).toBeGreaterThan(60);
  });
});

// ============================================================================
// 8) Ingen input — tom lookup
// ============================================================================

describe('lookupAddress — ingen brugbar input', () => {
  it('returnerer null når hverken postnr, koordinat eller adresse er givet', async () => {
    const result = await lookupAddress({});
    expect(result).toBeNull();
    // Ingen fetch-kald forsøgt.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returnerer null når postcode er tom string og intet andet er givet', async () => {
    const result = await lookupAddress({ postcode: '   ' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
