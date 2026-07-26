// cirkel-system/tests/bins.test.ts
//
// Vitest-suite for smart-bins endpoints + domaene-utils:
//   * POST /api/bins/ingest      (api/bins/ingest.ts)  — Modul 11.1 IoT weight-ingest
//   * POST /api/bins/ping        (api/bins/ping.ts)    — Modul 12.1 heartbeat
//   * GET  /api/bins/proximity   (api/bins/proximity.ts) — Modul 13.2 proximity grid
//   * GET  /api/bins             (api/bins/index.ts)   — RLS public-read listing
//
// Fokus:
//   1. Ingest weight              — token, body, weight-delta, fill-level, status
//   2. Ping heartbeat             — computeOperatingStatus + persistence
//   3. Proximity grid             — haversineKm + routing_directive + sortering
//   4. RLS public-read            — /api/bins uden Firebase-token
//
// Alle eksterne motorer er isoleret:
//   * @supabase/supabase-js       — lokal mock med queue-baseret QB
//   * verify-firebase-token       — mocket til warn_only pass-through
//   * global.fetch (DAWA)         — stubbet pr. test hvor lat/lon sendes
//   * IOT_INGEST_TOKEN            — sat i beforeEach
//
// Ingen live network-calls. Deterministisk — fake timers sat til fast ISO.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoisted mocks (delte instanser mellem test-fil og vi.mock-factory) ──────
// QB-klassen defineres inde i vi.hoisted() saa den er tilgaengelig baade for
// mock-factory'en (som hoistes over imports) og for test-koden nedenfor.
const mocks = vi.hoisted(() => {
  const dbQueue: Array<{ data: any; error: any }> = [];

  class QB {
    private _shift(): Promise<{ data: any; error: any }> {
      const next = dbQueue.shift();
      if (!next) return Promise.resolve({ data: null, error: null });
      return Promise.resolve(next);
    }
    select(): this { return this; }
    insert(): this { return this; }
    update(): this { return this; }
    upsert(): this { return this; }
    delete(): this { return this; }
    eq(): this { return this; }
    neq(): this { return this; }
    in(): this { return this; }
    is(): this { return this; }
    not(): this { return this; }
    gt(): this { return this; }
    gte(): this { return this; }
    lt(): this { return this; }
    lte(): this { return this; }
    like(): this { return this; }
    ilike(): this { return this; }
    filter(): this { return this; }
    match(): this { return this; }
    contains(): this { return this; }
    containedBy(): this { return this; }
    overlaps(): this { return this; }
    textSearch(): this { return this; }
    or(): this { return this; }
    order(): this { return this; }
    limit(): this { return this; }
    range(): this { return this; }
    returns(): this { return this; }
    throwOnError(): this { return this; }
    abortSignal(): this { return this; }
    single(): Promise<{ data: any; error: any }> { return this._shift(); }
    maybeSingle(): Promise<{ data: any; error: any }> { return this._shift(); }
    csv(): Promise<{ data: any; error: any }> { return this._shift(); }
    geojson(): Promise<{ data: any; error: any }> { return this._shift(); }
    explain(): Promise<{ data: any; error: any }> { return this._shift(); }
    then<TResolve = { data: any; error: any }, TReject = never>(
      onFulfilled?:
        | ((v: { data: any; error: any }) => TResolve | PromiseLike<TResolve>)
        | null,
      onRejected?: ((r: unknown) => TReject | PromiseLike<TReject>) | null,
    ): Promise<TResolve | TReject> {
      return this._shift().then(
        onFulfilled ?? undefined,
        onRejected ?? undefined,
      );
    }
  }

  return {
    fromMock: vi.fn(),
    verifyMock: vi.fn(),
    dbQueue,
    QB,
  };
});

// Override setup.ts's supabase-stub. Queue-baseret QB — hvert kald til en
// terminal-metode (then/single/maybeSingle) shifter naeste resultat af koeen.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mocks.fromMock,
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: { from: vi.fn() },
  })),
}));

vi.mock('../api/_verify-firebase-token.js', () => ({
  verifyFirebaseToken: mocks.verifyMock,
  resolveTrustedUid: vi.fn(),
}));

// ─── Imports (efter vi.mock; hoisting sikrer at handlers ogsaa faar mocks) ──
import ingestHandler from '../api/bins/ingest.js';
import pingHandler, { computeOperatingStatus } from '../api/bins/ping.js';
import proximityHandler, {
  haversineKm,
  computeRoutingDirective,
} from '../api/bins/proximity.js';
import binsIndexHandler from '../api/bins/index.js';

// ─── Konstanter ─────────────────────────────────────────────────────────────
const IOT_TOKEN = 'iot-token-fixture-abc123XYZ';
const FIXED_NOW = new Date('2026-07-22T12:00:00.000Z');

// ─── Test-app wrappers (supertest → express → handler) ──────────────────────
function buildIngestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/bins/ingest', (req, res) =>
    ingestHandler(req as any, res as any),
  );
  return app;
}

function buildPingApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/bins/ping', (req, res) =>
    pingHandler(req as any, res as any),
  );
  return app;
}

function buildProximityApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/bins/proximity', (req, res) =>
    proximityHandler(req as any, res as any),
  );
  return app;
}

function buildBinsIndexApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/bins', (req, res) =>
    binsIndexHandler(req as any, res as any),
  );
  return app;
}

// ─── Queue-helpere ──────────────────────────────────────────────────────────
function enqueue(result: { data: any; error: any }): void {
  mocks.dbQueue.push(result);
}

// ─── Global lifecycle ───────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  process.env.IOT_INGEST_TOKEN = IOT_TOKEN;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.BIN_MAX_DEPTH_CM = '100';

  mocks.dbQueue.length = 0;
  mocks.fromMock.mockReset();
  mocks.fromMock.mockImplementation(() => new mocks.QB());

  mocks.verifyMock.mockReset();
  mocks.verifyMock.mockResolvedValue({
    ok: true,
    verified: false,
    uid: null,
    mode: 'warn_only',
    status: 200,
    reason: 'warn_only pass-through',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================================
// A) POST /api/bins/ingest — Modul 11.1 weight-ingest
// ============================================================================
describe('POST /api/bins/ingest', () => {
  const BIN_ID = 'AAR-0001';

  const validBody = {
    bin_id: BIN_ID,
    added_weight_grams: 2000, // 2 kg delta
    volumetric_depth_cm: 25, // → fill = (100-25)/100 = 75%
  };

  const existingBinRow = {
    bin_id: BIN_ID,
    kommune_navn: 'Aarhus Kommune',
    latitude: 56.15,
    longitude: 10.2,
    current_weight_kg: 3.0,
    fill_level_percentage: 30,
    operating_status: 'Operational',
    is_active: true,
  };

  // ─────────────────────────────────────────────────────────────────────────
  describe('happy-path', () => {
    it('returnerer 200 med korrekt weight-delta, fill-level og status', async () => {
      // Kø: select (bin), update (bin), insert (stats)
      enqueue({ data: existingBinRow, error: null });
      enqueue({
        data: [
          {
            bin_id: BIN_ID,
            kommune_navn: 'Aarhus Kommune',
            current_weight_kg: 5.0,
            fill_level_percentage: 75,
            operating_status: 'Operational',
            last_iot_ping: FIXED_NOW.toISOString(),
          },
        ],
        error: null,
      });
      enqueue({ data: { stat_id: 'stat-uuid-1' }, error: null });

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bin_id).toBe(BIN_ID);
      expect(res.body.data.kommune_navn).toBe('Aarhus Kommune');
      // 3.0 kg (eksisterende) + 2.0 kg (delta) = 5.000 kg
      expect(res.body.data.current_weight_kg).toBe(5.0);
      expect(res.body.data.weight_delta_kg).toBe(2.0);
      // fill = (100-25)/100 = 75 (afrundet heltal)
      expect(res.body.data.fill_level_percentage).toBe(75);
      // status: 75 < 95 → forbliver Operational
      expect(res.body.data.operating_status).toBe('Operational');
      expect(res.body.data.stat_id).toBe('stat-uuid-1');
      expect(res.body.data.last_iot_ping).toBe(FIXED_NOW.toISOString());
      expect(res.body.data.dawa.lookup_used).toBe(false);
      expect(res.body.data.auth.iot_token_verified).toBe(true);
      expect(res.headers['x-cirkel-bin-id']).toBe(BIN_ID);
      expect(res.headers['x-cirkel-fill-pct']).toBe('75');
    });

    it('flipper operating_status til Full ved fill-level >= 95', async () => {
      enqueue({ data: existingBinRow, error: null });
      enqueue({
        data: [{ bin_id: BIN_ID }],
        error: null,
      });
      enqueue({ data: { stat_id: 'stat-uuid-2' }, error: null });

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({
          bin_id: BIN_ID,
          added_weight_grams: 500,
          volumetric_depth_cm: 4, // fill = (100-4)/100 = 96 → Full
        });

      expect(res.status).toBe(200);
      expect(res.body.data.fill_level_percentage).toBe(96);
      expect(res.body.data.operating_status).toBe('Full');
    });

    it('bruger DAWA-reverse-lookup naar lat/lon sendes med body', async () => {
      // Stub fetch → DAWA returnerer kommune-navn
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ navn: 'Koebenhavns Kommune' }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      enqueue({ data: existingBinRow, error: null });
      enqueue({ data: [{ bin_id: BIN_ID }], error: null });
      enqueue({ data: { stat_id: 'stat-uuid-3' }, error: null });

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({
          ...validBody,
          latitude: 55.6761,
          longitude: 12.5683,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.dawa.lookup_used).toBe(true);
      expect(res.body.data.dawa.resolved_kommune).toBe('Koebenhavns Kommune');
      expect(res.body.data.kommune_navn).toBe('Koebenhavns Kommune');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        'api.dataforsyningen.dk/kommuner/reverse',
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('auth-guard (IoT-token timing-safe)', () => {
    it('returnerer 401 iot_token_missing naar header mangler', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .send(validBody);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'iot_token_missing',
        detail: "Header 'x-cirkel-iot-token' paakraevet.",
      });
      expect(mocks.fromMock).not.toHaveBeenCalled();
    });

    it('returnerer 401 iot_token_mismatch ved forkert token af samme laengde', async () => {
      const wrongSameLength = 'x'.repeat(IOT_TOKEN.length);
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', wrongSameLength)
        .send(validBody);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'iot_token_mismatch',
      });
      expect(mocks.fromMock).not.toHaveBeenCalled();
    });

    it('returnerer 401 iot_token_mismatch ved token af anden laengde', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', 'short')
        .send(validBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('iot_token_mismatch');
    });

    it('returnerer 503 iot_token_not_configured naar env mangler', async () => {
      delete process.env.IOT_INGEST_TOKEN;
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send(validBody);

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('iot_token_not_configured');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('body-validering', () => {
    it('returnerer 400 invalid_bin_id ved tom bin_id', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({ ...validBody, bin_id: '' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'invalid_bin_id' });
    });

    it('returnerer 400 invalid_bin_id ved bin_id med forbudte tegn', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({ ...validBody, bin_id: 'AAR/0001;DROP' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_bin_id');
    });

    it('returnerer 400 invalid_added_weight_grams ved negativ vaerdi', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({ ...validBody, added_weight_grams: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_added_weight_grams');
    });

    it('returnerer 400 invalid_added_weight_grams ved vaerdi over 50 kg loft', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({ ...validBody, added_weight_grams: 60_000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_added_weight_grams');
    });

    it('returnerer 400 invalid_coordinate_pair ved kun lat uden lon', async () => {
      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send({ ...validBody, latitude: 56.15 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_coordinate_pair');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('method-guard & DB-error paths', () => {
    it('afviser GET med 405 method_not_allowed', async () => {
      const app = buildIngestApp();
      const res = await request(app).get('/api/bins/ingest');
      expect(res.status).toBe(405);
      expect(res.body).toEqual({
        success: false,
        error: 'method_not_allowed',
      });
    });

    it('returnerer 404 bin_not_found naar smart_bins lookup returnerer null', async () => {
      enqueue({ data: null, error: null }); // select → ingen bin

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'bin_not_found' });
    });

    it('returnerer 409 bin_inactive naar bin er markeret inaktiv', async () => {
      enqueue({
        data: { ...existingBinRow, is_active: false },
        error: null,
      });

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ success: false, error: 'bin_inactive' });
    });

    it('returnerer 500 database_error naar smart_bins select fejler', async () => {
      enqueue({
        data: null,
        error: { message: 'connection refused', code: 'PGRST500' },
      });

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('database_error');
      expect(res.body.detail).toBe('connection refused');
    });

    it('returnerer 500 stats_insert_failed naar stats-insert fejler efter update', async () => {
      enqueue({ data: existingBinRow, error: null });
      enqueue({ data: [{ bin_id: BIN_ID }], error: null });
      enqueue({
        data: null,
        error: { message: 'unique violation', code: '23505' },
      });

      const app = buildIngestApp();
      const res = await request(app)
        .post('/api/bins/ingest')
        .set('x-cirkel-iot-token', IOT_TOKEN)
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('stats_insert_failed');
      expect(res.body.detail).toBe('unique violation');
    });
  });
});

// ============================================================================
// B) POST /api/bins/ping — Modul 12.1 heartbeat
// ============================================================================
describe('POST /api/bins/ping', () => {
  const BIN_ID = 'SB-AAR-0142';
  const validBody = {
    bin_id: BIN_ID,
    current_weight_kg: 12.4,
    fill_level_percentage: 70,
    battery_voltage_mv: 3720,
    tilt_sensor_triggered: false,
  };

  // ─────────────────────────────────────────────────────────────────────────
  describe('computeOperatingStatus (unit)', () => {
    it('returnerer Full ved fill >= 85', () => {
      expect(
        computeOperatingStatus({
          fill_level_percentage: 85,
          tilt_sensor_triggered: false,
        }),
      ).toBe('Full');
      expect(
        computeOperatingStatus({
          fill_level_percentage: 99,
          tilt_sensor_triggered: false,
        }),
      ).toBe('Full');
    });

    it('returnerer Maintenance ved tilt uden Full', () => {
      expect(
        computeOperatingStatus({
          fill_level_percentage: 40,
          tilt_sensor_triggered: true,
        }),
      ).toBe('Maintenance');
    });

    it('returnerer Operational som default', () => {
      expect(
        computeOperatingStatus({
          fill_level_percentage: 20,
          tilt_sensor_triggered: false,
        }),
      ).toBe('Operational');
    });

    it('Full vinder over Maintenance (spec-bogstavelig raekkefoelge)', () => {
      expect(
        computeOperatingStatus({
          fill_level_percentage: 90,
          tilt_sensor_triggered: true,
        }),
      ).toBe('Full');
    });

    it('returnerer Operational lige under threshold (84.999)', () => {
      expect(
        computeOperatingStatus({
          fill_level_percentage: 84.999,
          tilt_sensor_triggered: false,
        }),
      ).toBe('Operational');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('happy-path (POST → 200)', () => {
    it('persisterer heartbeat, opdaterer smart_bins og returnerer log_persisted=true', async () => {
      enqueue({
        data: { id: BIN_ID, status: 'Operational' },
        error: null,
      }); // select
      enqueue({ data: null, error: null }); // update
      enqueue({ data: null, error: null }); // insert bin_heartbeats

      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bin_id).toBe(BIN_ID);
      expect(res.body.data.operating_status).toBe('Operational');
      expect(res.body.data.previous_status).toBe('Operational');
      expect(res.body.data.fill_level_percentage).toBe(70);
      expect(res.body.data.battery_voltage_mv).toBe(3720);
      expect(res.body.data.tilt_sensor_triggered).toBe(false);
      expect(res.body.data.current_weight_kg).toBe(12.4);
      expect(res.body.data.heartbeat_at).toBe(FIXED_NOW.toISOString());
      expect(res.body.data.log_persisted).toBe(true);
      expect(res.body.data.auth.verified).toBe(false);
      expect(res.body.data.auth.uid).toBeNull();
      expect(res.headers['x-bin-status']).toBe('Operational');
      expect(mocks.fromMock).toHaveBeenCalledTimes(3);
    });

    it('returnerer log_persisted=false naar heartbeat-log-insert fejler (main-update stadig 200)', async () => {
      enqueue({
        data: { id: BIN_ID, status: 'Operational' },
        error: null,
      });
      enqueue({ data: null, error: null }); // update ok
      enqueue({
        data: null,
        error: { message: 'relation does not exist', code: '42P01' },
      }); // log-insert fejler

      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.data.log_persisted).toBe(false);
      expect(res.body.data.operating_status).toBe('Operational');
    });

    it('flipper til Full status ved fill >= 85 og skriver previous_status', async () => {
      enqueue({
        data: { id: BIN_ID, status: 'Operational' },
        error: null,
      });
      enqueue({ data: null, error: null });
      enqueue({ data: null, error: null });

      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send({ ...validBody, fill_level_percentage: 92 });

      expect(res.status).toBe(200);
      expect(res.body.data.operating_status).toBe('Full');
      expect(res.body.data.previous_status).toBe('Operational');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('validation & error-paths', () => {
    it('afviser GET med 405 method_not_allowed', async () => {
      const app = buildPingApp();
      const res = await request(app).get('/api/bins/ping');
      expect(res.status).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
    });

    it('afviser 400 invalid_body naar body er array (ikke plain object)', async () => {
      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .set('Content-Type', 'application/json')
        .send([1, 2, 3] as any);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_body');
    });

    it('afviser 400 invalid_bin_id ved format-brud', async () => {
      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send({ ...validBody, bin_id: 'ab' }); // < 4 tegn

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_bin_id');
    });

    it('afviser 400 invalid_fill_level_percentage ved > 100', async () => {
      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send({ ...validBody, fill_level_percentage: 101 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_fill_level_percentage');
    });

    it('afviser 400 invalid_tilt_sensor_triggered ved non-boolean', async () => {
      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send({ ...validBody, tilt_sensor_triggered: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_tilt_sensor_triggered');
    });

    it('returnerer 404 bin_not_found naar smart_bins lookup returnerer null', async () => {
      enqueue({ data: null, error: null });

      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('bin_not_found');
    });

    it('returnerer 500 database_error naar update fejler', async () => {
      enqueue({
        data: { id: BIN_ID, status: 'Operational' },
        error: null,
      });
      enqueue({
        data: null,
        error: { message: 'deadlock detected', code: '40P01' },
      });

      const app = buildPingApp();
      const res = await request(app)
        .post('/api/bins/ping')
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('database_error');
      expect(res.body.detail).toBe('deadlock detected');
    });
  });
});

// ============================================================================
// C) GET /api/bins/proximity — Modul 13.2 proximity grid
// ============================================================================
describe('GET /api/bins/proximity', () => {
  // ─────────────────────────────────────────────────────────────────────────
  describe('haversineKm (unit)', () => {
    it('returnerer 0 for identiske punkter', () => {
      expect(haversineKm(56.1567, 10.2107, 56.1567, 10.2107)).toBeCloseTo(0, 3);
    });

    it('Aarhus (56.1567,10.2107) → Koebenhavn (55.6761,12.5683) ≈ 157 km', () => {
      const d = haversineKm(56.1567, 10.2107, 55.6761, 12.5683);
      // Kendt afstand ca. 157.2 km (great-circle).
      expect(d).toBeGreaterThan(155);
      expect(d).toBeLessThan(160);
    });

    it('nord-syd 1 breddegrad ≈ 111.19 km', () => {
      const d = haversineKm(0, 0, 1, 0);
      expect(d).toBeGreaterThan(111);
      expect(d).toBeLessThan(112);
    });

    it('symmetrisk (a→b == b→a)', () => {
      const d1 = haversineKm(56.15, 10.2, 55.67, 12.56);
      const d2 = haversineKm(55.67, 12.56, 56.15, 10.2);
      expect(d1).toBeCloseTo(d2, 6);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('computeRoutingDirective (unit)', () => {
    it('DIVERT_CONSUMER_ROUTING for Full', () => {
      expect(computeRoutingDirective('Full')).toBe('DIVERT_CONSUMER_ROUTING');
    });

    it('DIVERT_CONSUMER_ROUTING for Blocked', () => {
      expect(computeRoutingDirective('Blocked')).toBe('DIVERT_CONSUMER_ROUTING');
    });

    it('PROCEED_DIRECT for Operational', () => {
      expect(computeRoutingDirective('Operational')).toBe('PROCEED_DIRECT');
    });

    it('PROCEED_DIRECT for Maintenance (spec: kun Full/Blocked divertere)', () => {
      expect(computeRoutingDirective('Maintenance')).toBe('PROCEED_DIRECT');
    });

    it('PROCEED_DIRECT for null status (konservativ default)', () => {
      expect(computeRoutingDirective(null)).toBe('PROCEED_DIRECT');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('happy-path (GET → 200)', () => {
    it('filtrerer paa max_distance_km, sorterer stigende og markerer Full som DIVERT', async () => {
      // 3 bins: naer (0.3 km, Operational), mellem (1.2 km, Full), fjern (5 km, Operational)
      // Bruger-position: Aarhus C (56.1567, 10.2107). Vi lader haversine gøre arbejdet.
      const bins = [
        {
          id: 'bin-far',
          kommune: 'Aarhus Kommune',
          status: 'Operational',
          location: 'Fjern lokation',
          latitude: 56.20, // ca. 5 km nord
          longitude: 10.2107,
          capacity_liters: 240,
          fill_level_percent: 30,
          material_type: 'Plast',
          last_seen: FIXED_NOW.toISOString(),
        },
        {
          id: 'bin-near',
          kommune: 'Aarhus Kommune',
          status: 'Operational',
          location: 'Naer lokation',
          latitude: 56.1594, // ca. 0.3 km nord
          longitude: 10.2107,
          capacity_liters: 240,
          fill_level_percent: 20,
          material_type: 'Plast',
          last_seen: FIXED_NOW.toISOString(),
        },
        {
          id: 'bin-mid-full',
          kommune: 'Aarhus Kommune',
          status: 'Full',
          location: 'Mellem lokation',
          latitude: 56.1675, // ca. 1.2 km nord
          longitude: 10.2107,
          capacity_liters: 240,
          fill_level_percent: 98,
          material_type: 'Plast',
          last_seen: FIXED_NOW.toISOString(),
        },
      ];
      enqueue({ data: bins, error: null });

      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=56.1567&user_long=10.2107&max_distance_km=2.5',
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Fjern-bin er > 2.5 km og skal filtreres væk.
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.bins).toHaveLength(2);
      // Sortering: naer først, mid-full efter.
      expect(res.body.data.bins[0].id).toBe('bin-near');
      expect(res.body.data.bins[1].id).toBe('bin-mid-full');
      // Distance-felt er afrundet til 3 decimaler.
      expect(res.body.data.bins[0].distance_km).toBeGreaterThanOrEqual(0);
      expect(res.body.data.bins[0].distance_km).toBeLessThan(0.5);
      expect(res.body.data.bins[1].distance_km).toBeGreaterThan(1);
      expect(res.body.data.bins[1].distance_km).toBeLessThan(1.5);
      // Routing-direktiv
      expect(res.body.data.bins[0].routing_directive).toBe('PROCEED_DIRECT');
      expect(res.body.data.bins[1].routing_directive).toBe(
        'DIVERT_CONSUMER_ROUTING',
      );
      // Query echo
      expect(res.body.data.query.user_lat).toBe(56.1567);
      expect(res.body.data.query.user_long).toBe(10.2107);
      expect(res.body.data.query.max_distance_km).toBe(2.5);
      // Response header
      expect(res.headers['x-result-count']).toBe('2');
    });

    it('returnerer tom liste naar ingen bins er inden for radius', async () => {
      enqueue({
        data: [
          {
            id: 'bin-far',
            kommune: 'Aarhus Kommune',
            status: 'Operational',
            location: 'Fjern',
            latitude: 56.30,
            longitude: 10.5,
            capacity_liters: 240,
            fill_level_percent: 10,
            material_type: 'Plast',
            last_seen: FIXED_NOW.toISOString(),
          },
        ],
        error: null,
      });

      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=56.1567&user_long=10.2107&max_distance_km=1',
      );

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(0);
      expect(res.body.data.bins).toEqual([]);
    });

    it('respekterer limit-parameter efter distance-sortering', async () => {
      const bins = Array.from({ length: 10 }, (_, i) => ({
        id: `bin-${i}`,
        kommune: 'Aarhus Kommune',
        status: 'Operational',
        location: `Loc ${i}`,
        latitude: 56.1567 + i * 0.001,
        longitude: 10.2107,
        capacity_liters: 240,
        fill_level_percent: 10,
        material_type: 'Plast',
        last_seen: FIXED_NOW.toISOString(),
      }));
      enqueue({ data: bins, error: null });

      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=56.1567&user_long=10.2107&max_distance_km=5&limit=3',
      );

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(3);
      // De naermeste 3 bins skal være bin-0, bin-1, bin-2.
      expect(res.body.data.bins.map((b: any) => b.id)).toEqual([
        'bin-0',
        'bin-1',
        'bin-2',
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('validation & error-paths', () => {
    it('returnerer 400 invalid_user_lat naar user_lat mangler', async () => {
      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_long=10.2107&max_distance_km=2',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_user_lat');
    });

    it('returnerer 400 invalid_user_lat ved out-of-range', async () => {
      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=91&user_long=10&max_distance_km=1',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_user_lat');
    });

    it('returnerer 400 invalid_max_distance_km ved 0', async () => {
      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=56&user_long=10&max_distance_km=0',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_max_distance_km');
    });

    it('returnerer 400 invalid_status ved ukendt status', async () => {
      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=56&user_long=10&max_distance_km=1&status=Explosion',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_status');
    });

    it('afviser POST med 405 method_not_allowed', async () => {
      const app = buildProximityApp();
      const res = await request(app)
        .post('/api/bins/proximity')
        .send({});
      expect(res.status).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
    });

    it('returnerer 500 database_error naar Supabase-select fejler', async () => {
      enqueue({
        data: null,
        error: { message: 'timeout', code: '57014' },
      });

      const app = buildProximityApp();
      const res = await request(app).get(
        '/api/bins/proximity?user_lat=56.15&user_long=10.21&max_distance_km=2',
      );
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('database_error');
      expect(res.body.detail).toBe('timeout');
    });
  });
});

// ============================================================================
// D) GET /api/bins — RLS public-read listing
// ============================================================================
describe('GET /api/bins (RLS public-read)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  describe('happy-path (public listing)', () => {
    it('returnerer 200 med bins-liste uden Firebase-Authorization-header', async () => {
      const bins = [
        {
          id: 'bin-a',
          kommune: 'Aarhus Kommune',
          status: 'Operational',
          location: 'Rådhuspladsen',
          latitude: 56.1567,
          longitude: 10.2107,
          capacity_liters: 240,
          fill_level_percent: 25,
          material_type: 'Plast',
          last_seen: FIXED_NOW.toISOString(),
          installed_at: '2026-01-01T00:00:00.000Z',
          updated_at: FIXED_NOW.toISOString(),
        },
        {
          id: 'bin-b',
          kommune: 'Aarhus Kommune',
          status: 'Operational',
          location: 'Banegårdspladsen',
          latitude: 56.1502,
          longitude: 10.2044,
          capacity_liters: 240,
          fill_level_percent: 60,
          material_type: 'Plast',
          last_seen: FIXED_NOW.toISOString(),
          installed_at: '2026-01-01T00:00:00.000Z',
          updated_at: FIXED_NOW.toISOString(),
        },
      ];
      enqueue({ data: bins, error: null });

      const app = buildBinsIndexApp();
      const res = await request(app).get('/api/bins?kommune=Aarhus%20Kommune');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.bins).toHaveLength(2);
      expect(res.body.data.bins[0].id).toBe('bin-a');
      expect(res.body.data.filters.kommune).toBe('Aarhus Kommune');
      expect(res.body.data.filters.status).toBeNull();
      expect(res.body.data.filters.limit).toBe(100);
      expect(res.body.data.filters.offset).toBe(0);
      // Public listing — auth-flag skal reflektere verify=false, uid=null.
      expect(res.body.data.auth.verified).toBe(false);
      expect(res.body.data.auth.uid).toBeNull();
      // Cache-Control er sat til CDN-venlig varighed.
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('max-age=15');
      expect(res.headers['x-result-count']).toBe('2');
    });

    it('respekterer status-filter og limit/offset uden token', async () => {
      enqueue({ data: [], error: null });

      const app = buildBinsIndexApp();
      const res = await request(app).get(
        '/api/bins?status=Full&limit=50&offset=100',
      );

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(0);
      expect(res.body.data.filters).toEqual({
        kommune: null,
        status: 'Full',
        limit: 50,
        offset: 100,
      });
    });

    it('returnerer bins-liste uden filtre (default limit=100, offset=0)', async () => {
      enqueue({ data: [], error: null });

      const app = buildBinsIndexApp();
      const res = await request(app).get('/api/bins');

      expect(res.status).toBe(200);
      expect(res.body.data.filters).toEqual({
        kommune: null,
        status: null,
        limit: 100,
        offset: 0,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('validation & error-paths', () => {
    it('returnerer 400 invalid_kommune ved kommune med SQL-metategn', async () => {
      const app = buildBinsIndexApp();
      const res = await request(app).get(
        "/api/bins?kommune=Aarhus;%20DROP%20TABLE%20smart_bins",
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_kommune');
    });

    it('returnerer 400 invalid_status ved ukendt status', async () => {
      const app = buildBinsIndexApp();
      const res = await request(app).get('/api/bins?status=NuclearMeltdown');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_status');
    });

    it('returnerer 400 invalid_limit ved limit over MAX_LIMIT (500)', async () => {
      const app = buildBinsIndexApp();
      const res = await request(app).get('/api/bins?limit=9999');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_limit');
    });

    it('returnerer 400 invalid_offset ved negativ offset (regex-brud)', async () => {
      const app = buildBinsIndexApp();
      const res = await request(app).get('/api/bins?offset=-5');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_offset');
    });

    it('afviser POST med 405 method_not_allowed', async () => {
      const app = buildBinsIndexApp();
      const res = await request(app).post('/api/bins').send({});
      expect(res.status).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
    });

    it('returnerer 500 database_error naar Supabase-select fejler', async () => {
      enqueue({
        data: null,
        error: { message: 'RLS violation', code: '42501' },
      });

      const app = buildBinsIndexApp();
      const res = await request(app).get('/api/bins');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('database_error');
      expect(res.body.detail).toBe('RLS violation');
    });
  });
});
