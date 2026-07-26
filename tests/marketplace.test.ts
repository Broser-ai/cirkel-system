// cirkel-system/tests/marketplace.test.ts
//
// Vitest-suite for marketplace-endpoints:
//   1. api/marketplace/list.ts         - GET (search) + POST (opret listing)
//   2. api/marketplace/verify-claim.ts - POST NFC-handshake ved pickup
//
// Fokus (per opgavespec):
//   - List/verify-claim happy-path + input-validering + method-guard.
//   - Haversine-distance rejection > 15m er kernefokus for verify-claim.
//
// Strategi:
//   - vi.mock('@supabase/supabase-js') override'r setup.ts's globale stub med
//     en fuldt kontrollerbar chainable client. Hver test pre-queue'r praecise
//     data/error-resultater per tabel og per RPC.
//   - vi.mock('../api/_verify-firebase-token.js') giver os fuld kontrol over
//     verifyFirebaseToken og resolveTrustedUid uden at ramme rigtig Firebase.
//   - Ingen live network-calls; Date.now() bruges ikke til assertions.
//   - Deterministic: alle mocks har faste vaerdier.
//
// Haversine-fixtures (Aarhus WGS84, 1 deg lat = 111.32km):
//   - ITEM_LAT=56.1567, ITEM_LON=10.2108
//   - DEVICE_NEAR   (56.15675, 10.2108) -> ~5.57m   (<=15m -> OK)
//   - DEVICE_FAR    (56.1569,  10.2108) -> ~22.26m  (>15m  -> REJECT)
//   - DEVICE_VERY_FAR (56.1577, 10.2108) -> ~111.3m (>15m  -> REJECT)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ----------------------------------------------------------------------------
// Kontrollerbar Supabase-mock (override af setup.ts)
// ----------------------------------------------------------------------------
// vi.hoisted() sikrer at state-holderen findes FOER vi.mock-factoryen loeber.

const { mockState, queueTable, queueRpc, resetSupabaseMock, getCaptured } =
  vi.hoisted(() => {
    interface SbResult {
      data: unknown;
      error: unknown;
    }
    const state = {
      tableQueues: new Map<string, SbResult[]>(),
      rpcQueue: [] as SbResult[],
      captured: [] as Array<{ table: string; method: string; args: unknown[] }>,
    };
    const queueTable = (table: string, result: SbResult): void => {
      const q = state.tableQueues.get(table) ?? [];
      q.push(result);
      state.tableQueues.set(table, q);
    };
    const queueRpc = (result: SbResult): void => {
      state.rpcQueue.push(result);
    };
    const resetSupabaseMock = (): void => {
      state.tableQueues.clear();
      state.rpcQueue.length = 0;
      state.captured.length = 0;
    };
    const getCaptured = () => state.captured;
    return { mockState: state, queueTable, queueRpc, resetSupabaseMock, getCaptured };
  });

vi.mock('@supabase/supabase-js', () => {
  const popTable = (t: string) => {
    const q = mockState.tableQueues.get(t);
    if (!q || q.length === 0) return { data: null, error: null };
    return q.shift()!;
  };
  const popRpc = () =>
    mockState.rpcQueue.shift() ?? { data: null, error: null };

  const makeBuilder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const chainableMethods = [
      'select',
      'insert',
      'update',
      'upsert',
      'delete',
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'is',
      'ilike',
      'like',
      'order',
      'range',
      'limit',
      'match',
    ];
    for (const m of chainableMethods) {
      (chain as any)[m] = (...args: unknown[]) => {
        mockState.captured.push({ table, method: m, args });
        return chain;
      };
    }
    (chain as any).single = async () => popTable(table);
    (chain as any).maybeSingle = async () => popTable(table);
    (chain as any).then = (
      resolve: (r: unknown) => void,
      reject?: (e: unknown) => void,
    ) => {
      try {
        resolve(popTable(table));
      } catch (e) {
        if (reject) reject(e);
        else resolve({ data: null, error: e });
      }
    };
    return chain;
  };

  return {
    createClient: vi.fn(() => ({
      from: (table: string) => makeBuilder(table),
      rpc: vi.fn(async (_fn: string, _args?: unknown) => popRpc()),
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    })),
  };
});

// ----------------------------------------------------------------------------
// Kontrollerbar Firebase-verify-mock
// ----------------------------------------------------------------------------

vi.mock('../api/_verify-firebase-token.js', () => ({
  verifyFirebaseToken: vi.fn(),
  resolveTrustedUid: vi.fn(),
}));

// ----------------------------------------------------------------------------
// Imports (efter vi.mock; hoisting sikrer at target-modulerne ogsaa faar mocks)
// ----------------------------------------------------------------------------

import listHandler from '../api/marketplace/list.js';
import verifyClaimHandler from '../api/marketplace/verify-claim.js';
import {
  verifyFirebaseToken,
  resolveTrustedUid,
} from '../api/_verify-firebase-token.js';
import { testUser } from './setup.js';

// ----------------------------------------------------------------------------
// Test-app wrappers (supertest -> express -> handler)
// ----------------------------------------------------------------------------

function buildListApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/marketplace/list', (req, res) =>
    listHandler(req as any, res as any),
  );
  return app;
}

function buildVerifyClaimApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/marketplace/verify-claim', (req, res) =>
    verifyClaimHandler(req as any, res as any),
  );
  return app;
}

// ----------------------------------------------------------------------------
// Deterministiske fixtures
// ----------------------------------------------------------------------------

const ITEM_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const COLLECTOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const OWNER_PROFILE_ID = testUser.id;
const BOUNTY_ID = 'cccccccc-3333-4333-8333-333333333333';
const STRANGER_ID = 'dddddddd-4444-4444-8444-444444444444';

const ITEM_LAT = 56.1567;
const ITEM_LON = 10.2108;
// 0.00005 deg lat = ~5.57m (indenfor 15m graensen)
const DEVICE_LAT_NEAR = 56.15675;
const DEVICE_LON_NEAR = 10.2108;
// 0.00020 deg lat = ~22.26m (udenfor 15m graensen)
const DEVICE_LAT_FAR = 56.1569;
const DEVICE_LON_FAR = 10.2108;
// 0.00100 deg lat = ~111.32m (langt udenfor)
const DEVICE_LAT_VERY_FAR = 56.1577;
const DEVICE_LON_VERY_FAR = 10.2108;

interface RawItemRow {
  item_id: string;
  user_id: string;
  collector_user_id: string | null;
  handling_type: 'free_giveaway' | 'municipal_pickup' | 'paid_collection';
  current_status: 'available' | 'reserved' | 'claimed' | 'collected' | 'expired';
  latitude: string | number;
  longitude: string | number;
}

const HAPPY_ITEM_ROW: RawItemRow = {
  item_id: ITEM_ID,
  user_id: OWNER_PROFILE_ID,
  collector_user_id: COLLECTOR_ID,
  handling_type: 'free_giveaway',
  current_status: 'reserved',
  latitude: ITEM_LAT,
  longitude: ITEM_LON,
};

const HAPPY_UPDATED_ROW = {
  item_id: ITEM_ID,
  current_status: 'collected' as const,
  collector_user_id: COLLECTOR_ID,
  handling_type: 'free_giveaway' as const,
  updated_at: '2026-07-22T10:00:00.000Z',
};

// ----------------------------------------------------------------------------
// Globale defaults pr. test
// ----------------------------------------------------------------------------

beforeEach(() => {
  resetSupabaseMock();

  // Standard: token gyldig, uid matcher body-uid.
  vi.mocked(verifyFirebaseToken).mockResolvedValue({
    ok: true,
    uid: testUser.firebase_uid,
    verified: true,
    mode: 'enforce',
    status: 200,
    reason: 'F3.8: token verified',
  } as any);
  vi.mocked(resolveTrustedUid).mockResolvedValue({
    trusted_uid: testUser.firebase_uid,
    verified: true,
    spoofed: false,
    reason: 'F3.8: token verified + uid match',
  } as any);

  // Env skal vaere sat for at getSupabase() ikke returnerer null.
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// ============================================================================
// POST /api/marketplace/verify-claim
// ============================================================================
describe('POST /api/marketplace/verify-claim', () => {
  // ---------------------------------------------------------------------------
  // KERNETEST: Haversine-distance
  // ---------------------------------------------------------------------------
  describe('Haversine-distance', () => {
    it('happy-path: 200 collected naar device er ~5.57m fra item (<=15m)', async () => {
      queueTable('bulky_waste_marketplace', { data: HAPPY_ITEM_ROW, error: null });
      queueTable('bulky_waste_marketplace', {
        data: HAPPY_UPDATED_ROW,
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.item_id).toBe(ITEM_ID);
      expect(res.body.data.collector_user_id).toBe(COLLECTOR_ID);
      expect(res.body.data.previous_status).toBe('reserved');
      expect(res.body.data.new_status).toBe('collected');
      expect(res.body.data.handling_type).toBe('free_giveaway');
      // Distance skal vaere >0 (device og item er ikke identiske) og <=15m.
      expect(res.body.data.distance_meters).toBeGreaterThan(0);
      expect(res.body.data.distance_meters).toBeLessThanOrEqual(15);
      // Praecis afstand: ~5.57m, tolerance 0.5m.
      expect(res.body.data.distance_meters).toBeCloseTo(5.57, 0);
      // Claim-receipt-id har formen CLAIM-<uuid>.
      expect(res.body.data.claim_receipt_id).toMatch(
        /^CLAIM-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(res.body.data.handshake_verified_at).toBe(
        '2026-07-22T10:00:00.000Z',
      );
      // free_giveaway udloeser INGEN payout.
      expect(res.body.data.payout).toEqual({
        eligible: false,
        amount_dkk: 0,
        bounty_id: null,
        bounty_completed: false,
        reason: 'handling_type=free_giveaway udloeser ingen payout',
      });
      // Auth-info reflekterer mocked verify.
      expect(res.body.data.auth).toEqual({
        firebase_verified: true,
        firebase_uid: testUser.firebase_uid,
        mode: 'enforce',
      });
    });

    it('happy-path: 200 collected naar device er identisk med item (0m)', async () => {
      queueTable('bulky_waste_marketplace', { data: HAPPY_ITEM_ROW, error: null });
      queueTable('bulky_waste_marketplace', {
        data: HAPPY_UPDATED_ROW,
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: ITEM_LAT,
          device_long: ITEM_LON,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.distance_meters).toBe(0);
      expect(res.body.data.new_status).toBe('collected');
    });

    it('reject: 422 geo_out_of_range naar device er ~22.26m fra item', async () => {
      queueTable('bulky_waste_marketplace', { data: HAPPY_ITEM_ROW, error: null });
      // Ingen UPDATE-result queue'et - update maa IKKE naas.

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_FAR,
          device_long: DEVICE_LON_FAR,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('geo_out_of_range');
      // Detail har formatet: distance=<n>.NNm > max=15m
      expect(res.body.detail).toMatch(/^distance=\d+\.\d{2}m > max=15m$/);
      // Uddrag distancen og verificer den er lige over 15m.
      const distMatch = res.body.detail.match(/distance=(\d+\.\d{2})m/);
      expect(distMatch).not.toBeNull();
      const dist = parseFloat(distMatch![1]);
      expect(dist).toBeGreaterThan(15);
      expect(dist).toBeCloseTo(22.26, 0);
      // UPDATE maa aldrig kaldes ved geo-reject.
      const updateCalls = getCaptured().filter(
        (c) => c.table === 'bulky_waste_marketplace' && c.method === 'update',
      );
      expect(updateCalls).toHaveLength(0);
      // logistics_bounties maa heller aldrig roeres.
      const bountyCalls = getCaptured().filter(
        (c) => c.table === 'logistics_bounties',
      );
      expect(bountyCalls).toHaveLength(0);
    });

    it('reject: 422 geo_out_of_range naar device er ~111.32m fra item', async () => {
      queueTable('bulky_waste_marketplace', { data: HAPPY_ITEM_ROW, error: null });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_VERY_FAR,
          device_long: DEVICE_LON_VERY_FAR,
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('geo_out_of_range');
      const distMatch = res.body.detail.match(/distance=(\d+\.\d{2})m/);
      expect(distMatch).not.toBeNull();
      const dist = parseFloat(distMatch![1]);
      expect(dist).toBeGreaterThan(100);
      expect(dist).toBeCloseTo(111.32, 0);
    });

    it('reject: haandterer NUMERIC-lat/lon som strings fra Postgres', async () => {
      // Postgres NUMERIC-kolonner returneres typisk som string i JS-driveren;
      // handleren skal coerce'e til number FOER Haversine-beregning.
      queueTable('bulky_waste_marketplace', {
        data: {
          ...HAPPY_ITEM_ROW,
          latitude: '56.1567',
          longitude: '10.2108',
        },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_FAR,
          device_long: DEVICE_LON_FAR,
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('geo_out_of_range');
    });
  });

  // ---------------------------------------------------------------------------
  // Body-validering (input-guard FOER DB-kald)
  // ---------------------------------------------------------------------------
  describe('body-validering', () => {
    it('400 invalid_item_id naar item_id ikke matcher UUID-regex', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: 'not-a-uuid',
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'invalid_item_id' });
      // DB maa aldrig kaldes ved input-fejl.
      expect(getCaptured()).toHaveLength(0);
    });

    it('400 invalid_collector_user_id naar collector-uuid mangler', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'invalid_collector_user_id',
      });
    });

    it('400 invalid_device_lat naar device_lat < -90', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: -100,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_device_lat');
    });

    it('400 invalid_device_long naar device_long > 180', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: 200,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_device_long');
    });

    it('400 invalid_device_lat naar device_lat er NaN', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: 'not-a-number',
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_device_lat');
    });
  });

  // ---------------------------------------------------------------------------
  // State-maskine + kollektor-guard (verifikation FOER Haversine)
  // ---------------------------------------------------------------------------
  describe('state-maskine + kollektor-guard', () => {
    it('404 item_not_found naar SELECT returnerer null', async () => {
      queueTable('bulky_waste_marketplace', { data: null, error: null });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'item_not_found' });
    });

    it('409 invalid_status_transition naar current_status=available', async () => {
      queueTable('bulky_waste_marketplace', {
        data: {
          ...HAPPY_ITEM_ROW,
          current_status: 'available',
          collector_user_id: null,
        },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('invalid_status_transition');
      expect(res.body.detail).toContain('current_status=available');
    });

    it('409 invalid_status_transition naar current_status=collected', async () => {
      queueTable('bulky_waste_marketplace', {
        data: { ...HAPPY_ITEM_ROW, current_status: 'collected' },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('invalid_status_transition');
    });

    it('403 collector_mismatch naar body.collector_user_id != row.collector_user_id', async () => {
      queueTable('bulky_waste_marketplace', {
        data: { ...HAPPY_ITEM_ROW, collector_user_id: STRANGER_ID },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('collector_mismatch');
      expect(res.body.detail).toContain('collector_user_id');
    });

    it('403 collector_mismatch naar row.collector_user_id er null', async () => {
      queueTable('bulky_waste_marketplace', {
        data: {
          ...HAPPY_ITEM_ROW,
          current_status: 'reserved',
          collector_user_id: null,
        },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('collector_mismatch');
    });

    it('409 invalid_status_transition naar UPDATE-guard taber race (returns null)', async () => {
      queueTable('bulky_waste_marketplace', { data: HAPPY_ITEM_ROW, error: null });
      // UPDATE returnerer null data (row-guard afviste) => 409.
      queueTable('bulky_waste_marketplace', { data: null, error: null });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('invalid_status_transition');
      expect(res.body.detail).toContain('row-guard afviste UPDATE');
    });
  });

  // ---------------------------------------------------------------------------
  // Payout: municipal_pickup + logistics_bounties best-effort
  // ---------------------------------------------------------------------------
  describe('payout (municipal_pickup)', () => {
    it('completer bounty og eligible=true + 75 DKK ved municipal_pickup', async () => {
      const munItem = {
        ...HAPPY_ITEM_ROW,
        handling_type: 'municipal_pickup' as const,
      };
      const munUpdated = {
        ...HAPPY_UPDATED_ROW,
        handling_type: 'municipal_pickup' as const,
      };
      queueTable('bulky_waste_marketplace', { data: munItem, error: null });
      queueTable('bulky_waste_marketplace', { data: munUpdated, error: null });
      // Bounty-SELECT: eksisterer, status=claimed, claimed_by=COLLECTOR_ID.
      queueTable('logistics_bounties', {
        data: {
          bounty_id: BOUNTY_ID,
          payout_dkk: 75,
          status: 'claimed',
          claimed_by: COLLECTOR_ID,
        },
        error: null,
      });
      // Bounty-UPDATE: overgang til completed.
      queueTable('logistics_bounties', {
        data: {
          bounty_id: BOUNTY_ID,
          payout_dkk: 75,
          status: 'completed',
          claimed_by: COLLECTOR_ID,
        },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.handling_type).toBe('municipal_pickup');
      expect(res.body.data.payout).toEqual({
        eligible: true,
        amount_dkk: 75,
        bounty_id: BOUNTY_ID,
        bounty_completed: true,
        reason: 'bounty_completed',
      });
    });

    it('best-effort: eligible=true men not completed naar bounty mangler', async () => {
      const munItem = {
        ...HAPPY_ITEM_ROW,
        handling_type: 'municipal_pickup' as const,
      };
      const munUpdated = {
        ...HAPPY_UPDATED_ROW,
        handling_type: 'municipal_pickup' as const,
      };
      queueTable('bulky_waste_marketplace', { data: munItem, error: null });
      queueTable('bulky_waste_marketplace', { data: munUpdated, error: null });
      // Ingen bounty i DB.
      queueTable('logistics_bounties', { data: null, error: null });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.payout).toEqual({
        eligible: true,
        amount_dkk: 75,
        bounty_id: null,
        bounty_completed: false,
        reason: 'no_coupled_bounty',
      });
    });

    it('best-effort: bounty_claimer_mismatch naar claimed_by er en anden', async () => {
      const munItem = {
        ...HAPPY_ITEM_ROW,
        handling_type: 'municipal_pickup' as const,
      };
      const munUpdated = {
        ...HAPPY_UPDATED_ROW,
        handling_type: 'municipal_pickup' as const,
      };
      queueTable('bulky_waste_marketplace', { data: munItem, error: null });
      queueTable('bulky_waste_marketplace', { data: munUpdated, error: null });
      // Bounty findes, men claimed_by er en fremmed.
      queueTable('logistics_bounties', {
        data: {
          bounty_id: BOUNTY_ID,
          payout_dkk: 75,
          status: 'claimed',
          claimed_by: STRANGER_ID,
        },
        error: null,
      });

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.payout.eligible).toBe(true);
      expect(res.body.data.payout.bounty_completed).toBe(false);
      expect(res.body.data.payout.reason).toBe('bounty_claimer_mismatch');
      expect(res.body.data.payout.bounty_id).toBe(BOUNTY_ID);
      expect(res.body.data.payout.amount_dkk).toBe(75);
    });
  });

  // ---------------------------------------------------------------------------
  // Firebase-token guard
  // ---------------------------------------------------------------------------
  describe('firebase-token guard', () => {
    it('401 firebase_token_invalid naar verify returnerer status=401', async () => {
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: false,
        uid: null,
        verified: false,
        mode: 'enforce',
        status: 401,
        reason: 'verifyIdToken fejlede: token expired',
      } as any);

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('firebase_token_invalid');
      expect(res.body.detail).toContain('token expired');
      // Ingen DB-kald efter verify-fejl.
      expect(getCaptured()).toHaveLength(0);
    });

    it('403 firebase_uid_spoof naar verify returnerer status=403', async () => {
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: false,
        uid: 'attacker-uid',
        verified: true,
        mode: 'enforce',
        status: 403,
        reason: 'UID_SPOOF_DETECTED',
      } as any);

      const app = buildVerifyClaimApp();
      const res = await request(app)
        .post('/api/marketplace/verify-claim')
        .send({
          item_id: ITEM_ID,
          collector_user_id: COLLECTOR_ID,
          device_lat: DEVICE_LAT_NEAR,
          device_long: DEVICE_LON_NEAR,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('firebase_uid_spoof');
      expect(res.body.detail).toBe('UID_SPOOF_DETECTED');
    });
  });

  // ---------------------------------------------------------------------------
  // Method-guard
  // ---------------------------------------------------------------------------
  describe('method-guard', () => {
    it('405 method_not_allowed for GET', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app).get('/api/marketplace/verify-claim');

      expect(res.status).toBe(405);
      expect(res.body).toEqual({ success: false, error: 'method_not_allowed' });
      expect(res.headers['allow']).toBe('POST');
      // Ingen DB eller verify-kald ved method-guard.
      expect(getCaptured()).toHaveLength(0);
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
    });

    it('405 method_not_allowed for DELETE', async () => {
      const app = buildVerifyClaimApp();
      const res = await request(app).delete('/api/marketplace/verify-claim');

      expect(res.status).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
    });
  });
});

// ============================================================================
// GET/POST /api/marketplace/list
// ============================================================================
describe('/api/marketplace/list', () => {
  // ---------------------------------------------------------------------------
  // GET (search)
  // ---------------------------------------------------------------------------
  describe('GET (search)', () => {
    it('happy-path: 200 med items[] og default filters.status=available', async () => {
      // Warn-only verify: ingen token pass-through.
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: true,
        uid: null,
        verified: false,
        mode: 'warn_only',
        status: 200,
        reason: 'Ingen token - warn_only pass-through.',
      } as any);
      const row = {
        item_id: ITEM_ID,
        user_id: OWNER_PROFILE_ID,
        item_title: 'IKEA sofa 3-personers',
        description: 'God stand, sort laeder',
        volumetric_profile: { h_m: 0.8, w_m: 2.0, d_m: 0.9 },
        handling_type: 'free_giveaway',
        latitude: '56.1567',
        longitude: '10.2108',
        current_status: 'available',
        claim_deadline: null,
        collector_user_id: null,
        image_urls: ['https://example.dk/img1.jpg'],
        created_at: '2026-07-20T12:00:00.000Z',
        updated_at: '2026-07-20T12:00:00.000Z',
      };
      queueTable('bulky_waste_marketplace', { data: [row], error: null });

      const app = buildListApp();
      const res = await request(app).get('/api/marketplace/list');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toEqual({
        item_id: ITEM_ID,
        user_id: OWNER_PROFILE_ID,
        item_title: 'IKEA sofa 3-personers',
        description: 'God stand, sort laeder',
        volumetric_profile: { h_m: 0.8, w_m: 2.0, d_m: 0.9 },
        handling_type: 'free_giveaway',
        latitude: 56.1567,
        longitude: 10.2108,
        current_status: 'available',
        claim_deadline: null,
        collector_user_id: null,
        image_urls: ['https://example.dk/img1.jpg'],
        created_at: '2026-07-20T12:00:00.000Z',
        updated_at: '2026-07-20T12:00:00.000Z',
      });
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.filters.status).toBe('available');
      expect(res.body.data.filters.handling).toBeNull();
      expect(res.body.data.filters.limit).toBe(50);
      expect(res.body.data.filters.offset).toBe(0);
      expect(res.body.data.auth.firebase_verified).toBe(false);
      // DB-kald skal have current_status=available filter.
      const eqCalls = getCaptured().filter(
        (c) => c.table === 'bulky_waste_marketplace' && c.method === 'eq',
      );
      const statusEq = eqCalls.find(
        (c) => (c.args as unknown[])[0] === 'current_status',
      );
      expect(statusEq).toBeDefined();
      expect((statusEq!.args as unknown[])[1]).toBe('available');
    });

    it('happy-path: 200 med tom items[] naar DB returnerer []', async () => {
      queueTable('bulky_waste_marketplace', { data: [], error: null });

      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?status=reserved&handling=municipal_pickup',
      );

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.count).toBe(0);
      expect(res.body.data.filters.status).toBe('reserved');
      expect(res.body.data.filters.handling).toBe('municipal_pickup');
    });

    it('400 invalid_status ved ugyldig status-query', async () => {
      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?status=unknown-status',
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'invalid_status' });
    });

    it('400 invalid_handling_type ved ugyldig handling-query', async () => {
      const app = buildListApp();
      const res = await request(app).get('/api/marketplace/list?handling=nope');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_handling_type');
    });

    it('400 invalid_bbox ved malformed bbox (kun 3 vaerdier)', async () => {
      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?bbox=10.0,55.0,11.0',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_bbox');
    });

    it('400 invalid_bbox naar minLon >= maxLon', async () => {
      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?bbox=11.0,55.0,10.0,56.0',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_bbox');
    });

    it('400 radius_requires_lat_lon_radius_km ved kun lat sat', async () => {
      const app = buildListApp();
      const res = await request(app).get('/api/marketplace/list?lat=56.1567');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('radius_requires_lat_lon_radius_km');
    });

    it('400 invalid_radius_km naar radius > 500km', async () => {
      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?lat=56.1567&lon=10.2108&radius_km=600',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_radius_km');
    });

    it('400 invalid_limit naar limit > 200', async () => {
      const app = buildListApp();
      const res = await request(app).get('/api/marketplace/list?limit=201');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_limit');
    });

    it('200 med tom items[] naar owner_firebase_uid ikke findes i profiles', async () => {
      // get_dashboard RPC returnerer null profile.
      queueRpc({ data: null, error: null });
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: true,
        uid: null,
        verified: false,
        mode: 'warn_only',
        status: 200,
        reason: 'no token',
      } as any);

      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?owner_firebase_uid=ghost-uid-does-not-exist',
      );

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.count).toBe(0);
      // Ingen SELECT paa bulky_waste_marketplace efter tomt owner-resolve.
      const marketplaceCalls = getCaptured().filter(
        (c) => c.table === 'bulky_waste_marketplace',
      );
      expect(marketplaceCalls).toHaveLength(0);
    });

    it('200 propagerer radius -> bbox som gte/lte-filtre paa lat/lon', async () => {
      queueTable('bulky_waste_marketplace', { data: [], error: null });
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: true,
        uid: null,
        verified: false,
        mode: 'warn_only',
        status: 200,
        reason: 'no token',
      } as any);

      const app = buildListApp();
      const res = await request(app).get(
        '/api/marketplace/list?lat=56.1567&lon=10.2108&radius_km=5',
      );

      expect(res.status).toBe(200);
      // gte og lte skal vaere kaldt paa latitude/longitude.
      const gteCols = getCaptured()
        .filter(
          (c) => c.table === 'bulky_waste_marketplace' && c.method === 'gte',
        )
        .map((c) => (c.args as unknown[])[0]);
      const lteCols = getCaptured()
        .filter(
          (c) => c.table === 'bulky_waste_marketplace' && c.method === 'lte',
        )
        .map((c) => (c.args as unknown[])[0]);
      expect(gteCols).toContain('latitude');
      expect(gteCols).toContain('longitude');
      expect(lteCols).toContain('latitude');
      expect(lteCols).toContain('longitude');
    });
  });

  // ---------------------------------------------------------------------------
  // POST (opret listing)
  // ---------------------------------------------------------------------------
  describe('POST (opret listing)', () => {
    it('201 med item + auth ved gyldig body', async () => {
      // resolveProfileId RPC returnerer profil.
      queueRpc({
        data: { profile: { id: OWNER_PROFILE_ID } },
        error: null,
      });
      // INSERT returnerer den oprettede row.
      const insertedRow = {
        item_id: ITEM_ID,
        user_id: OWNER_PROFILE_ID,
        item_title: 'IKEA sofa 3-personers',
        description: null,
        volumetric_profile: {},
        handling_type: 'free_giveaway',
        latitude: '56.1567',
        longitude: '10.2108',
        current_status: 'available',
        claim_deadline: null,
        collector_user_id: null,
        image_urls: [],
        created_at: '2026-07-22T10:00:00.000Z',
        updated_at: '2026-07-22T10:00:00.000Z',
      };
      queueTable('bulky_waste_marketplace', { data: insertedRow, error: null });

      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa 3-personers',
          latitude: 56.1567,
          longitude: 10.2108,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.item).toEqual({
        item_id: ITEM_ID,
        user_id: OWNER_PROFILE_ID,
        item_title: 'IKEA sofa 3-personers',
        description: null,
        volumetric_profile: {},
        handling_type: 'free_giveaway',
        latitude: 56.1567,
        longitude: 10.2108,
        current_status: 'available',
        claim_deadline: null,
        collector_user_id: null,
        image_urls: [],
        created_at: '2026-07-22T10:00:00.000Z',
        updated_at: '2026-07-22T10:00:00.000Z',
      });
      expect(res.body.data.auth).toEqual({
        firebase_verified: true,
        firebase_uid: testUser.firebase_uid,
        mode: 'enforce',
      });
      // resolveTrustedUid blev kaldt med body-uid.
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(resolveTrustedUid).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );
      // INSERT-payload indeholder den forventede row.
      const insertCall = getCaptured().find(
        (c) => c.table === 'bulky_waste_marketplace' && c.method === 'insert',
      );
      expect(insertCall).toBeDefined();
      const insertedPayload = (insertCall!.args as unknown[])[0] as Record<
        string,
        unknown
      >;
      expect(insertedPayload.user_id).toBe(OWNER_PROFILE_ID);
      expect(insertedPayload.item_title).toBe('IKEA sofa 3-personers');
      expect(insertedPayload.current_status).toBe('available');
      expect(insertedPayload.collector_user_id).toBeNull();
      expect(insertedPayload.handling_type).toBe('free_giveaway');
    });

    it('400 firebaseUid_required naar uid mangler', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          item_title: 'IKEA sofa',
          latitude: 56.1567,
          longitude: 10.2108,
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'firebaseUid_required' });
      // Verify og DB maa ikke roeres.
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(getCaptured()).toHaveLength(0);
    });

    it('400 invalid_item_title_length naar title er 2 tegn (< min 3)', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'ab',
          latitude: 56.1567,
          longitude: 10.2108,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_item_title_length');
    });

    it('400 item_title_required naar title er tom streng', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: '   ',
          latitude: 56.1567,
          longitude: 10.2108,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('item_title_required');
    });

    it('400 invalid_latitude naar lat mangler', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          longitude: 10.2108,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_latitude');
    });

    it('400 invalid_longitude naar lon > 180', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          latitude: 56.1567,
          longitude: 200,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_longitude');
    });

    it('400 invalid_handling_type ved ukendt handling', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          handling_type: 'not-a-real-type',
          latitude: 56.1567,
          longitude: 10.2108,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_handling_type');
    });

    it('400 too_many_image_urls naar image_urls har > 10 elementer', async () => {
      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          latitude: 56.1567,
          longitude: 10.2108,
          image_urls: Array.from(
            { length: 11 },
            (_, i) => `https://cdn.example.dk/img${i}.jpg`,
          ),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('too_many_image_urls');
    });

    it('404 profile_not_found naar RPC returnerer null profile', async () => {
      queueRpc({ data: null, error: null });

      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          latitude: 56.1567,
          longitude: 10.2108,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('profile_not_found');
      expect(res.body.detail).toContain(testUser.firebase_uid);
      // INSERT maa aldrig kaldes uden profil.
      const insertCall = getCaptured().find(
        (c) => c.table === 'bulky_waste_marketplace' && c.method === 'insert',
      );
      expect(insertCall).toBeUndefined();
    });

    it('401 firebase_token_invalid naar resolveTrustedUid kaster status=401', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error('token expired');
        err.status = 401;
        err.reason = 'token expired';
        throw err;
      });

      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          latitude: 56.1567,
          longitude: 10.2108,
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('firebase_token_invalid');
      expect(res.body.detail).toBe('token expired');
      expect(getCaptured()).toHaveLength(0);
    });

    it('403 firebase_uid_spoof naar resolveTrustedUid kaster status=403', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error('UID_SPOOF_DETECTED');
        err.status = 403;
        err.reason = 'UID_SPOOF_DETECTED';
        throw err;
      });

      const app = buildListApp();
      const res = await request(app)
        .post('/api/marketplace/list')
        .send({
          firebaseUid: testUser.firebase_uid,
          item_title: 'IKEA sofa',
          latitude: 56.1567,
          longitude: 10.2108,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('firebase_uid_spoof');
    });
  });

  // ---------------------------------------------------------------------------
  // Method-guard
  // ---------------------------------------------------------------------------
  describe('method-guard', () => {
    it('405 method_not_allowed for PUT', async () => {
      const app = buildListApp();
      const res = await request(app).put('/api/marketplace/list');

      expect(res.status).toBe(405);
      expect(res.body).toEqual({ success: false, error: 'method_not_allowed' });
      expect(res.headers['allow']).toBe('GET, POST');
    });

    it('405 method_not_allowed for DELETE', async () => {
      const app = buildListApp();
      const res = await request(app).delete('/api/marketplace/list');

      expect(res.status).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
    });
  });
});
