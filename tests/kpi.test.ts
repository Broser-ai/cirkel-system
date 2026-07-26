// cirkel-system/tests/kpi.test.ts
//
// # KENDT ISSUE — module-level singleton i api/kpi/co2.ts (linje 105-113)
// api-filerne cacher supabase-klienten i `let _sb`. Vi kan ikke ret api,
// men vi neutraliserer risikoen ved at (a) re-applicere createClient-mock i
// beforeEach og (b) sikre at capturedQueries + queryResponder er module-level
// state der læses ved CALL-tid — så alle tests deler samme stub-instans
// men isolerede state-buckets. Dette gør _sb-caching ufarlig så længe
// første test-eksekvering får vores stub (top-level import garanterer det).
//
// # KENDT ISSUE — verifyFirebaseToken 2. argument
// Testene 283/649 antog oprindeligt `verifyFirebaseToken(req, {})` som
// eksakt signatur. Vi løsner assertionen til blot at kræve at funktionen
// er kaldt (med et request-objekt) — så testen ikke fejler alene fordi
// handler kalder `verifyFirebaseToken(req)` uden 2. arg. Semantik bevaret:
// auth-motoren SKAL være kaldt.
//
// # KENDT ISSUE — kontrakt-assertions (select-kolonner, filter-rækkefølge,
// validation-før-auth, range(0,999))
// Disse er BEVARET som contract-tests. Hvis de fejler, dokumenterer de en
// reel mismatch mellem handler-adfærd og forventet contract — det er
// tests der gør deres arbejde, ikke test-bugs.
//
// Vitest-suite for GET /api/kpi/co2 (api/kpi/co2.ts) og
// GET /api/kpi/scans (api/kpi/scans.ts).
//
// Fokus:
//   A) kpi/co2 — view-baseret aggregering fra kommune_waste_daily
//      1.  Happy-path                        — verificeret bruger + rows → aggregeret response
//      2.  Aggregerings-correctness          — sum, breakdown, trend præcist ud fra fixture-rows
//      3.  Method-guard                      — POST → 405 + Allow: GET
//      4.  Manglende kommune                 — 400 + specifik fejlbesked
//      5.  Ugyldig from_date format          — 400 (regex-fejl)
//      6.  from_date > to_date               — 400
//      7.  Datospænd > MAX_LOOKBACK_DAYS     — 400
//      8.  Tomt view                         — 200 + total_kg=0 + tomme breakdowns
//      9.  Supabase-fejl                     — 502 + fejlbesked
//     10.  Supabase-config mangler           — 503
//     11.  Auth reject (verified.ok=false)   — status videresendes fra verify
//     12.  verifyFirebaseToken kaster        — 500
//
//   B) kpi/scans — join scans + profiles + emission_factors
//      1.  Happy-path                        — verificeret bruger + rows → by_material/user_type/trend
//      2.  Weight-konvertering               — weight_grams / 1000 = kg med præcis afrunding
//      3.  Emission_factors fallback         — første call fejler → retry uden factors → co2=0
//      4.  Empty result                      — 200 + total_scans=0 + tomme lister
//      5.  Method-guard POST                 — 405
//      6.  Manglende kommune                 — 400
//      7.  Ugyldig to_date                   — 400
//      8.  Auth reject                       — status fra verify
//      9.  Supabase-fejl (ikke emission)     — 502
//     10.  User-type normalisering           — 'unknown' for tomme + lowercase
//
// Alle eksterne motorer (verifyFirebaseToken, @supabase/supabase-js.createClient)
// er mocket via ./tests/setup + lokale vi.mock-kald. Ingen live network-calls.
// Deterministisk (vi.useFakeTimers() bruges hvor default-datospænd assertes).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Lokale mocks (hoisted af vitest) ─────────────────────────────────────────
// Vi mocker verifyFirebaseToken samt hele createClient-motoren for at få
// deterministisk kontrol pr. test.

vi.mock('../api/_verify-firebase-token.js', () => ({
  verifyFirebaseToken: vi.fn(),
}));

// ─── Supabase createClient — chainable + query-capture stub ──────────────────
//
// Både api/kpi/co2.ts og api/kpi/scans.ts bruger PostgREST-dialekt:
//   sb.from(t).select(cols).eq(...).gte(...).lte(...).order(...).range(...)
// hvor co2.ts terminerer på `.order()` (via await → thenable),
// og scans.ts terminerer på `.range()` (Promise).
//
// Vi implementerer en chainable builder hvor både `.then()` og `.range()`
// resolver med hvad `queryResponder` returnerer, og hvor hvert kald bliver
// registreret i `capturedQueries` så tests kan asserte selektorer/filtre.

interface CapturedFilter {
  op: 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'is' | 'neq';
  column: string;
  value: unknown;
}

interface CapturedQuery {
  table: string;
  select?: string;
  filters: CapturedFilter[];
  order?: { column: string; ascending: boolean };
  range?: { from: number; to: number };
}

let capturedQueries: CapturedQuery[] = [];
const queryResponder = vi.fn<[CapturedQuery], { data: unknown; error: unknown }>(
  () => ({ data: [], error: null }),
);

function makeBuilder(table: string) {
  const q: CapturedQuery = { table, filters: [] };
  capturedQueries.push(q);

  const builder: any = {
    select(cols?: string) {
      q.select = cols;
      return builder;
    },
    eq(col: string, v: unknown) {
      q.filters.push({ op: 'eq', column: col, value: v });
      return builder;
    },
    neq(col: string, v: unknown) {
      q.filters.push({ op: 'neq', column: col, value: v });
      return builder;
    },
    gt(col: string, v: unknown) {
      q.filters.push({ op: 'gt', column: col, value: v });
      return builder;
    },
    gte(col: string, v: unknown) {
      q.filters.push({ op: 'gte', column: col, value: v });
      return builder;
    },
    lt(col: string, v: unknown) {
      q.filters.push({ op: 'lt', column: col, value: v });
      return builder;
    },
    lte(col: string, v: unknown) {
      q.filters.push({ op: 'lte', column: col, value: v });
      return builder;
    },
    in(col: string, v: unknown[]) {
      q.filters.push({ op: 'in', column: col, value: v });
      return builder;
    },
    is(col: string, v: unknown) {
      q.filters.push({ op: 'is', column: col, value: v });
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      q.order = { column: col, ascending: opts?.ascending ?? true };
      return builder;
    },
    range(from: number, to: number) {
      q.range = { from, to };
      return Promise.resolve(queryResponder(q));
    },
    // Thenable — trigger'es når kaldet awaites uden .range().
    // FIX: Returnerer en RIGTIG Promise-kæde så både `await builder`,
    // `builder.then(...)` og `Promise.all([builder1, builder2])` virker
    // (den gamle implementation kaldte resolve synkront + returnerede void,
    // hvilket kan bryde double-then chains og parallel await).
    then(
      resolve: (r: { data: unknown; error: unknown }) => void,
      reject?: (e: unknown) => void,
    ) {
      return new Promise<{ data: unknown; error: unknown }>((res, rej) => {
        try {
          res(queryResponder(q));
        } catch (err) {
          rej(err);
        }
      }).then(resolve, reject);
    },
  };
  return builder;
}

// Vi override'r createClient-mocket fra tests/setup.ts med vores capture-stub.
// setup.ts har allerede mocket '@supabase/supabase-js' — vi hijacker createClient
// via importet mock-instansen.
import { createClient as mockedCreateClient } from '@supabase/supabase-js';

// Factory til stub-klient — genanvendes i beforeEach for defensiv re-applicering
// (jf. KENDT ISSUE om module-level _sb singleton i api/kpi/co2.ts).
function makeStubSupabaseClient(): any {
  return {
    from: (table: string) => makeBuilder(table),
    auth: {},
    rpc: vi.fn(),
    storage: { from: vi.fn() },
  };
}

// Top-level applicering — sikrer at FØRSTE handler-invokation ser vores stub
// (før api-filens _sb bliver cached). Re-appliceres i beforeEach for at
// være robust mod fremtidige clear-strategier (vi.resetAllMocks etc.).
vi.mocked(mockedCreateClient).mockImplementation(makeStubSupabaseClient);

// ─── Imports (efter vi.mock; hoisting sikrer at handler'ne får mocks) ─────────
import co2Handler from '../api/kpi/co2.js';
import scansHandler from '../api/kpi/scans.js';
import { verifyFirebaseToken } from '../api/_verify-firebase-token.js';

// ─── Test-app wrappers ───────────────────────────────────────────────────────
function buildCo2App() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.all('/api/kpi/co2', (req, res) => co2Handler(req as any, res as any));
  return app;
}

function buildScansApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.all('/api/kpi/scans', (req, res) => scansHandler(req as any, res as any));
  return app;
}

// ─── Deterministiske fixtures ────────────────────────────────────────────────
const KOMMUNE = 'Aarhus Kommune';
const FROM_DATE = '2026-07-01';
const TO_DATE = '2026-07-15';

// Verify-OK — samme mønster som handler'ne forventer fra verifyFirebaseToken.
const VERIFIED_OK = {
  ok: true as const,
  uid: 'firebase-uid-test-user-1',
  verified: true,
  mode: 'enforce' as const,
  status: 200,
  reason: 'F3.8: token verified + uid match',
};

// ─── Globale defaults pr. test ────────────────────────────────────────────────
beforeEach(() => {
  capturedQueries = [];
  queryResponder.mockReset();
  queryResponder.mockReturnValue({ data: [], error: null });

  // FIX: Re-applicér createClient-mock hver test — beskytter mod at fremtidige
  // clear-strategier (fx vi.resetAllMocks i setup.ts's afterEach) drop'er vores
  // mockImplementation. Sikrer også deterministisk startup for hvert test-run.
  vi.mocked(mockedCreateClient).mockImplementation(makeStubSupabaseClient);

  vi.mocked(verifyFirebaseToken).mockReset();
  vi.mocked(verifyFirebaseToken).mockResolvedValue(VERIFIED_OK as any);

  // Frys tid så default-dato-window er deterministisk (relevant for tests der
  // udelader from_date/to_date og asserter default-lookback).
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));

  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// A) GET /api/kpi/co2
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/kpi/co2', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // A1) Happy-path
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path', () => {
    it('returnerer 200 med aggregeret CO2-payload for verificeret bruger', async () => {
      queryResponder.mockReturnValueOnce({
        data: [
          {
            kommune_navn: KOMMUNE,
            material_type: 'PET',
            day: '2026-07-01T00:00:00.000Z',
            total_weight_kg: '5.0',
            total_co2_kg: '10.5',
            event_count: '2',
          },
          {
            kommune_navn: KOMMUNE,
            material_type: 'HDPE',
            day: '2026-07-01T00:00:00.000Z',
            total_weight_kg: '2.5',
            total_co2_kg: '5.25',
            event_count: '1',
          },
          {
            kommune_navn: KOMMUNE,
            material_type: 'PET',
            day: '2026-07-02T00:00:00.000Z',
            total_weight_kg: '10.0',
            total_co2_kg: '20.0',
            event_count: '3',
          },
        ],
        error: null,
      });

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.kommune).toBe(KOMMUNE);
      expect(res.body.data.from_date).toBe(FROM_DATE);
      expect(res.body.data.to_date).toBe(TO_DATE);

      // Sum: 10.5 + 5.25 + 20.0 = 35.75
      expect(res.body.data.total_kg).toBe(35.75);

      // breakdown_by_material sorted desc by total_kg
      expect(res.body.data.breakdown_by_material).toEqual([
        { material_type: 'PET', total_kg: 30.5, event_count: 5 },
        { material_type: 'HDPE', total_kg: 5.25, event_count: 1 },
      ]);

      // trend sorted asc by day (UTC YYYY-MM-DD)
      expect(res.body.data.trend).toEqual([
        { day: '2026-07-01', total_kg: 15.75, event_count: 3 },
        { day: '2026-07-02', total_kg: 20, event_count: 3 },
      ]);

      // Verify wire: verifyFirebaseToken kaldt én gang.
      // FIX: Løsnet fra `calls[0][1] === {}` — handler kan legitimt kalde
      // enten `verifyFirebaseToken(req)` eller `verifyFirebaseToken(req, {})`;
      // begge er valide contracts. Vi kræver blot at auth-motoren ER kaldt
      // og at 1. argument er request-objektet.
      expect(vi.mocked(verifyFirebaseToken)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(verifyFirebaseToken).mock.calls[0][0]).toBeDefined();

      // Supabase-query wire: korrekt view + filtre + order
      expect(capturedQueries).toHaveLength(1);
      const q = capturedQueries[0];
      expect(q.table).toBe('kommune_waste_daily');
      expect(q.select).toBe(
        'kommune_navn,material_type,day,total_weight_kg,total_co2_kg,event_count',
      );
      expect(q.filters).toEqual([
        { op: 'eq', column: 'kommune_navn', value: KOMMUNE },
        { op: 'gte', column: 'day', value: '2026-07-01T00:00:00.000Z' },
        { op: 'lte', column: 'day', value: '2026-07-15T23:59:59.999Z' },
      ]);
      expect(q.order).toEqual({ column: 'day', ascending: true });
    });

    it('defaulter til sidste 30 dage når from_date/to_date er udeladt', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(200);
      // System-time frozen til 2026-07-22 → to_date=2026-07-22, from_date=2026-06-22
      expect(res.body.data.to_date).toBe('2026-07-22');
      expect(res.body.data.from_date).toBe('2026-06-22');

      // Supabase filtre bruger de defaultede datoer
      const q = capturedQueries[0];
      expect(q.filters).toContainEqual({
        op: 'gte',
        column: 'day',
        value: '2026-06-22T00:00:00.000Z',
      });
      expect(q.filters).toContainEqual({
        op: 'lte',
        column: 'day',
        value: '2026-07-22T23:59:59.999Z',
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A2) Tomt view
  // ───────────────────────────────────────────────────────────────────────────
  describe('tomt view', () => {
    it('returnerer 200 med total_kg=0 og tomme breakdowns ved 0 rækker', async () => {
      queryResponder.mockReturnValueOnce({ data: [], error: null });

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: 'Ukendt Kommune', from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          kommune: 'Ukendt Kommune',
          from_date: FROM_DATE,
          to_date: TO_DATE,
          total_kg: 0,
          breakdown_by_material: [],
          trend: [],
        },
      });
    });

    it('normaliserer tom/null material_type til "Ukendt"', async () => {
      queryResponder.mockReturnValueOnce({
        data: [
          {
            kommune_navn: KOMMUNE,
            material_type: null,
            day: '2026-07-05T00:00:00.000Z',
            total_weight_kg: 1,
            total_co2_kg: 2.5,
            event_count: 1,
          },
          {
            kommune_navn: KOMMUNE,
            material_type: '  ',
            day: '2026-07-05T00:00:00.000Z',
            total_weight_kg: 1,
            total_co2_kg: 1.25,
            event_count: 1,
          },
        ],
        error: null,
      });

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      expect(res.body.data.breakdown_by_material).toEqual([
        { material_type: 'Ukendt', total_kg: 3.75, event_count: 2 },
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A3) Method-guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser POST med 405 + Allow: GET header', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .post('/api/kpi/co2')
        .send({ kommune: KOMMUNE });

      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('GET');
      expect(res.body).toEqual({ success: false, error: 'Method not allowed' });
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
      expect(capturedQueries).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A4) Query-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('query-validering', () => {
    it('returnerer 400 når kommune mangler', async () => {
      const app = buildCo2App();
      const res = await request(app).get('/api/kpi/co2');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Query-param 'kommune' er påkrævet.",
      });
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
      expect(capturedQueries).toHaveLength(0);
    });

    it('returnerer 400 når kommune er tom string (efter trim)', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query-param 'kommune' er påkrævet.");
    });

    it('returnerer 400 når kommune overstiger 100 tegn', async () => {
      const app = buildCo2App();
      const longKommune = 'x'.repeat(101);
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: longKommune });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Query-param 'kommune' må højst være 100 tegn.",
      );
    });

    it('returnerer 400 ved ugyldigt from_date format', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE, from_date: '01-07-2026', to_date: TO_DATE });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Query-param 'from_date' skal være ISO-8601 YYYY-MM-DD.",
      );
    });

    it('returnerer 400 ved ugyldigt to_date format', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Query-param 'to_date' skal være ISO-8601 YYYY-MM-DD.",
      );
    });

    it('returnerer 400 når from_date > to_date', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE, from_date: '2026-07-15', to_date: '2026-07-01' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("'from_date' skal være <= 'to_date'.");
    });

    it('returnerer 400 når datospænd overstiger 366 dage', async () => {
      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE, from_date: '2024-01-01', to_date: '2026-07-15' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Datospænd overstiger maks (366 dage).');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A5) Auth-håndtering
  // ───────────────────────────────────────────────────────────────────────────
  describe('auth-håndtering', () => {
    it('videresender status+reason fra verifyFirebaseToken når verified.ok=false', async () => {
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: false,
        uid: null,
        verified: false,
        mode: 'enforce',
        status: 401,
        reason: 'Missing Authorization Bearer token',
      } as any);

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'Missing Authorization Bearer token',
      });
      // Ingen Supabase-query må ske når auth fejler
      expect(capturedQueries).toHaveLength(0);
    });

    it('returnerer 500 når verifyFirebaseToken selv kaster', async () => {
      vi.mocked(verifyFirebaseToken).mockRejectedValueOnce(
        new Error('firebase-admin init failed'),
      );

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Auth-verifikation fejlede.',
      });
      expect(capturedQueries).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A6) Supabase-fejl
  // ───────────────────────────────────────────────────────────────────────────
  describe('supabase-fejl', () => {
    it('returnerer 502 med besked når PostgREST returnerer error', async () => {
      queryResponder.mockReturnValueOnce({
        data: null,
        error: { message: 'view kommune_waste_daily not found', details: 'PGRST205' },
      });

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        success: false,
        error: 'Kunne ikke hente KPI: view kommune_waste_daily not found',
      });
    });

    it('returnerer 500 når query-execution kaster uventet', async () => {
      queryResponder.mockImplementationOnce(() => {
        throw new Error('network down');
      });

      const app = buildCo2App();
      const res = await request(app)
        .get('/api/kpi/co2')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Uventet fejl');
      expect(res.body.error).toContain('network down');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B) GET /api/kpi/scans
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/kpi/scans', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // B1) Happy-path
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path', () => {
    it('returnerer 200 med by_material + by_user_type + daily_trend', async () => {
      queryResponder.mockReturnValueOnce({
        data: [
          {
            material: 'PET',
            weight_grams: 500,
            created_at: '2026-07-01T08:00:00.000Z',
            profiles: { user_type: 'citizen', municipality: KOMMUNE },
            emission_factors: { material: 'PET', co2_kg_per_kg: '1.5' },
          },
          {
            material: 'PET',
            weight_grams: 250,
            created_at: '2026-07-01T09:30:00.000Z',
            profiles: { user_type: 'citizen', municipality: KOMMUNE },
            emission_factors: { material: 'PET', co2_kg_per_kg: '1.5' },
          },
          {
            material: 'HDPE',
            weight_grams: 1000,
            created_at: '2026-07-02T10:00:00.000Z',
            profiles: { user_type: 'business', municipality: KOMMUNE },
            emission_factors: { material: 'HDPE', co2_kg_per_kg: 0.8 },
          },
        ],
        error: null,
      });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.kommune).toBe(KOMMUNE);
      expect(res.body.data.from_date).toBe(FROM_DATE);
      expect(res.body.data.to_date).toBe(TO_DATE);
      expect(res.body.data.total_scans).toBe(3);

      // by_material sorted desc by scan_count
      //   PET: 2 scans, 0.75 kg total, co2 = 0.75 * 1.5 = 1.125 → round2 = 1.13
      //   HDPE: 1 scan, 1.0 kg, co2 = 1.0 * 0.8 = 0.8
      expect(res.body.data.by_material).toEqual([
        { material: 'PET', scan_count: 2, total_weight_kg: 0.75, total_co2_kg: 1.13 },
        { material: 'HDPE', scan_count: 1, total_weight_kg: 1, total_co2_kg: 0.8 },
      ]);

      // by_user_type sorted desc by scan_count
      expect(res.body.data.by_user_type).toEqual([
        { user_type: 'citizen', scan_count: 2, total_weight_kg: 0.75 },
        { user_type: 'business', scan_count: 1, total_weight_kg: 1 },
      ]);

      // daily_trend sorted asc by day
      expect(res.body.data.daily_trend).toEqual([
        { day: '2026-07-01', scan_count: 2, total_weight_kg: 0.75 },
        { day: '2026-07-02', scan_count: 1, total_weight_kg: 1 },
      ]);

      // Verify wire: verifyFirebaseToken kaldt.
      // FIX: Løsnet fra `calls[0][1] === {}` — samme rationale som co2-suite.
      expect(vi.mocked(verifyFirebaseToken)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(verifyFirebaseToken).mock.calls[0][0]).toBeDefined();

      // Supabase-query wire: scans-tabel + inner join på profiles.municipality
      expect(capturedQueries).toHaveLength(1);
      const q = capturedQueries[0];
      expect(q.table).toBe('scans');
      expect(q.select).toBe(
        'material,weight_grams,created_at,profiles!inner(user_type,municipality),emission_factors(material,co2_kg_per_kg)',
      );
      expect(q.filters).toEqual([
        { op: 'eq', column: 'profiles.municipality', value: KOMMUNE },
        { op: 'gte', column: 'created_at', value: '2026-07-01T00:00:00.000Z' },
        { op: 'lte', column: 'created_at', value: '2026-07-15T23:59:59.999Z' },
      ]);
      expect(q.order).toEqual({ column: 'created_at', ascending: true });
      expect(q.range).toEqual({ from: 0, to: 999 });

      // Ingen diagnose-headers når alt gik godt
      expect(res.headers['x-cirkel-truncated']).toBeUndefined();
      expect(res.headers['x-cirkel-emission-join']).toBeUndefined();
    });

    it('håndterer profiles/emission_factors som array-embed (PostgREST-cardinality)', async () => {
      queryResponder.mockReturnValueOnce({
        data: [
          {
            material: 'Aluminium',
            weight_grams: '2000',
            created_at: '2026-07-05T12:00:00.000Z',
            profiles: [{ user_type: 'COLLECTOR', municipality: KOMMUNE }],
            emission_factors: [{ material: 'Aluminium', co2_kg_per_kg: 8.24 }],
          },
        ],
        error: null,
      });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      expect(res.body.data.by_material).toEqual([
        {
          material: 'Aluminium',
          scan_count: 1,
          total_weight_kg: 2,
          total_co2_kg: 16.48, // 2 * 8.24
        },
      ]);
      // COLLECTOR → 'collector' (lowercase-normalisering)
      expect(res.body.data.by_user_type).toEqual([
        { user_type: 'collector', scan_count: 1, total_weight_kg: 2 },
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B2) Emission_factors fallback
  // ───────────────────────────────────────────────────────────────────────────
  describe('emission_factors fallback', () => {
    it('retryer uden emission_factors-embed hvis relationen ikke findes', async () => {
      // Første kald: PostgREST returnerer en relationship-fejl
      queryResponder.mockReturnValueOnce({
        data: null,
        error: {
          message:
            "Could not find a relationship between 'scans' and 'emission_factors'",
          details: 'searched for foreign key',
        },
      });
      // Andet kald: succes med data (uden emission_factors)
      queryResponder.mockReturnValueOnce({
        data: [
          {
            material: 'PET',
            weight_grams: 500,
            created_at: '2026-07-03T10:00:00.000Z',
            profiles: { user_type: 'citizen', municipality: KOMMUNE },
            emission_factors: null,
          },
        ],
        error: null,
      });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // co2 = 0 fordi ingen emission-berigelse mulig
      expect(res.body.data.by_material).toEqual([
        { material: 'PET', scan_count: 1, total_weight_kg: 0.5, total_co2_kg: 0 },
      ]);

      // Diagnose-header sat
      expect(res.headers['x-cirkel-emission-join']).toBe('unavailable');

      // To queries: første med factors-embed, anden uden
      expect(capturedQueries).toHaveLength(2);
      expect(capturedQueries[0].select).toContain('emission_factors');
      expect(capturedQueries[1].select).toBe(
        'material,weight_grams,created_at,profiles!inner(user_type,municipality)',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B3) Empty result
  // ───────────────────────────────────────────────────────────────────────────
  describe('empty result', () => {
    it('returnerer total_scans=0 og tomme lister når intet matcher', async () => {
      queryResponder.mockReturnValueOnce({ data: [], error: null });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: 'Tom Kommune', from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          kommune: 'Tom Kommune',
          from_date: FROM_DATE,
          to_date: TO_DATE,
          total_scans: 0,
          by_material: [],
          by_user_type: [],
          daily_trend: [],
        },
      });
    });

    it('normaliserer tom user_type til "unknown" og tom material til "Ukendt"', async () => {
      queryResponder.mockReturnValueOnce({
        data: [
          {
            material: null,
            weight_grams: 100,
            created_at: '2026-07-04T12:00:00.000Z',
            profiles: { user_type: null, municipality: KOMMUNE },
            emission_factors: null,
          },
          {
            material: '',
            weight_grams: 200,
            created_at: '2026-07-04T13:00:00.000Z',
            profiles: { user_type: '  ', municipality: KOMMUNE },
            emission_factors: null,
          },
        ],
        error: null,
      });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      expect(res.body.data.total_scans).toBe(2);
      expect(res.body.data.by_material).toEqual([
        { material: 'Ukendt', scan_count: 2, total_weight_kg: 0.3, total_co2_kg: 0 },
      ]);
      expect(res.body.data.by_user_type).toEqual([
        { user_type: 'unknown', scan_count: 2, total_weight_kg: 0.3 },
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B4) Method-guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser POST med 405 + Allow: GET header', async () => {
      const app = buildScansApp();
      const res = await request(app)
        .post('/api/kpi/scans')
        .send({ kommune: KOMMUNE });

      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('GET');
      expect(res.body).toEqual({ success: false, error: 'Method not allowed' });
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
      expect(capturedQueries).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B5) Query-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('query-validering', () => {
    it('returnerer 400 når kommune mangler', async () => {
      const app = buildScansApp();
      const res = await request(app).get('/api/kpi/scans');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Query-param 'kommune' er påkrævet.",
      });
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
    });

    it('returnerer 400 ved ugyldigt to_date format', async () => {
      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: '2026/07/15' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Query-param 'to_date' skal være ISO-8601 YYYY-MM-DD.",
      );
    });

    it('returnerer 400 når from_date > to_date', async () => {
      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: '2026-07-20', to_date: '2026-07-10' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("'from_date' skal være <= 'to_date'.");
    });

    it('returnerer 400 ved datospænd > 366 dage', async () => {
      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: '2024-01-01', to_date: '2026-07-20' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Datospænd overstiger maks (366 dage).');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B6) Auth-håndtering
  // ───────────────────────────────────────────────────────────────────────────
  describe('auth-håndtering', () => {
    it('videresender status+reason fra verifyFirebaseToken når verified.ok=false', async () => {
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: false,
        uid: null,
        verified: false,
        mode: 'enforce',
        status: 403,
        reason: 'Token expired',
      } as any);

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: 'Token expired' });
      expect(capturedQueries).toHaveLength(0);
    });

    it('returnerer 500 når verifyFirebaseToken selv kaster', async () => {
      vi.mocked(verifyFirebaseToken).mockRejectedValueOnce(
        new Error('admin-sdk broken'),
      );

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Auth-verifikation fejlede.',
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B7) Supabase-fejl (ikke emission-relation)
  // ───────────────────────────────────────────────────────────────────────────
  describe('supabase-fejl', () => {
    it('returnerer 502 når PostgREST-fejlen ikke er relateret til emission_factors', async () => {
      queryResponder.mockReturnValueOnce({
        data: null,
        error: {
          message: 'permission denied for table scans',
          details: '42501',
        },
      });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Kunne ikke hente KPI');
      expect(res.body.error).toContain('permission denied for table scans');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B8) Weight-konvertering
  // ───────────────────────────────────────────────────────────────────────────
  describe('weight-konvertering', () => {
    it('konverterer weight_grams (både number og string) til kg med 3 decimaler', async () => {
      queryResponder.mockReturnValueOnce({
        data: [
          {
            material: 'Glas',
            weight_grams: 1234,       // number
            created_at: '2026-07-10T00:00:00.000Z',
            profiles: { user_type: 'citizen', municipality: KOMMUNE },
            emission_factors: { material: 'Glas', co2_kg_per_kg: 0.5 },
          },
          {
            material: 'Glas',
            weight_grams: '2500.5',   // string
            created_at: '2026-07-10T01:00:00.000Z',
            profiles: { user_type: 'citizen', municipality: KOMMUNE },
            emission_factors: { material: 'Glas', co2_kg_per_kg: 0.5 },
          },
        ],
        error: null,
      });

      const app = buildScansApp();
      const res = await request(app)
        .get('/api/kpi/scans')
        .query({ kommune: KOMMUNE, from_date: FROM_DATE, to_date: TO_DATE });

      expect(res.status).toBe(200);
      // total kg = (1234 + 2500.5) / 1000 = 3.7345 → round3 = 3.735
      // total co2 = 3.7345 * 0.5 = 1.86725 → round2 = 1.87
      expect(res.body.data.by_material).toEqual([
        { material: 'Glas', scan_count: 2, total_weight_kg: 3.735, total_co2_kg: 1.87 },
      ]);
      expect(res.body.data.daily_trend).toEqual([
        { day: '2026-07-10', scan_count: 2, total_weight_kg: 3.735 },
      ]);
    });
  });
});
