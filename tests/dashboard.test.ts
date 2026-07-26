// cirkel-system/tests/dashboard.test.ts
//
// Vitest-suite for GET/POST /api/dashboard (api/dashboard.ts).
//
// Fokus:
//   1. GET happy-path            — verificeret bruger + query firebaseUid → 200 med profile + scans + kpi
//   2. POST happy-path           — body firebaseUid → 200 med samme payload
//   3. Input-validering          — manglende firebaseUid → 400
//   4. F3.8 enforce spoof-reject — resolveTrustedUid kaster → 401 UID_SPOOF_DETECTED
//   5. F3.8 enforce custom-status — kaster med status=403 → 403 propageres
//   6. F3.8 warn_only spoof      — verified=true + spoofed=true → data-fetch bruger TOKEN-uid
//   7. F3.8 warn_only unverified — verified=false → data-fetch bruger KLIENT-uid (backward-compat)
//   8. F3.8 fallback             — resolveTrustedUid returnerer intet trusted_uid → falder til klient-uid
//   9. Aggregation-correctness   — kpi-værdier fra RPC videresendes UÆNDRET til response
//  10. 500 ved getDashboard-fejl — RPC-fejl i getDashboard → 500 med besked
//  11. 503 uden Supabase-config  — VITE_SUPABASE_URL/SERVICE_ROLE_KEY mangler → 503
//  12. Wire-orden                — resolveTrustedUid kaldes FØR getDashboard; getDashboard får trusted_uid
//
// Alle eksterne afhængigheder (Supabase, Firebase, resolveTrustedUid,
// getDashboard) er mocket via ./tests/setup + lokale vi.mock-kald.
// Ingen live network-calls. Deterministisk — ingen Date.now() uden mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Lokale mocks (hoisted af vitest) ─────────────────────────────────────────
// Vi mocker hele modul-grænsefladen for 100% deterministisk kontrol pr. test.

vi.mock('../lib/cirkel.js', () => ({
  getDashboard: vi.fn(),
}));

vi.mock('../api/_verify-firebase-token.js', () => ({
  resolveTrustedUid: vi.fn(),
}));

// ─── Imports (efter vi.mock; hoisting sikrer at dashboard.ts også får mocks) ──
import handler from '../api/dashboard.js';
import { getDashboard } from '../lib/cirkel.js';
import { resolveTrustedUid } from '../api/_verify-firebase-token.js';
import { testUser, testScan } from './setup.js';

// ─── Test-app wrapper (supertest → express → handler) ─────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.all('/api/dashboard', (req, res) => handler(req as any, res as any));
  return app;
}

// ─── Deterministiske fixtures ────────────────────────────────────────────────
const HAPPY_DASHBOARD_PAYLOAD = {
  profile: {
    id: testUser.id,
    firebase_uid: testUser.firebase_uid,
    full_name: testUser.full_name,
    email: testUser.email,
    municipality: testUser.municipality,
    balance: testUser.balance,
    points: testUser.points,
    scans_count: testUser.scans_count,
    co2_saved_kg: testUser.co2_saved_kg,
    streak_days: testUser.streak_days,
    level: testUser.level,
    member_status: testUser.member_status,
    verification_tier: testUser.verification_tier,
  },
  recent_scans: [
    {
      id: testScan.id,
      user_id: testUser.id,
      barcode: testScan.barcode,
      material: testScan.material,
      weight_grams: testScan.weight_grams,
      sorting_compliance: testScan.sorting_compliance,
      points_earned: testScan.points_earned,
      kroner_earned: testScan.kroner_earned,
      is_processed: true,
      created_at: testScan.created_at,
    },
  ],
  kpi: {
    total_scans: 17,
    total_points: 425,
    total_kroner: 42.5,
    total_co2_kg: 3.14,
  },
  achievements: [
    { code: 'first_scan', unlocked_at: '2026-07-01T10:00:00.000Z' },
    { code: 'streak_3', unlocked_at: '2026-07-10T10:00:00.000Z' },
  ],
  leaderboard_rank: 42,
};

const VERIFIED_OK = {
  trusted_uid: testUser.firebase_uid,
  verified: true,
  spoofed: false,
  reason: 'F3.8: token verified + uid match',
};

// ─── Globale defaults pr. test ────────────────────────────────────────────────
beforeEach(() => {
  vi.mocked(resolveTrustedUid).mockResolvedValue(VERIFIED_OK);
  vi.mocked(getDashboard).mockResolvedValue(HAPPY_DASHBOARD_PAYLOAD as any);

  // Sørg for at Supabase-klienten kan instantieres i handler'en.
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/dashboard', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1) Happy-path GET
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path GET', () => {
    it('returnerer 200 med success + profile + recent_scans + kpi', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.profile).toEqual(HAPPY_DASHBOARD_PAYLOAD.profile);
      expect(res.body.recent_scans).toEqual(HAPPY_DASHBOARD_PAYLOAD.recent_scans);
      expect(res.body.recent_scans).toHaveLength(1);
      expect(res.body.kpi).toEqual(HAPPY_DASHBOARD_PAYLOAD.kpi);
      expect(res.body.achievements).toEqual(HAPPY_DASHBOARD_PAYLOAD.achievements);
      expect(res.body.leaderboard_rank).toBe(42);

      // F3.8 wire: resolveTrustedUid kaldt med body/query firebaseUid som hint
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(resolveTrustedUid).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );

      // getDashboard modtager det VERIFICEREDE uid
      expect(vi.mocked(getDashboard)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getDashboard).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );
    });

    it('trimmer whitespace omkring query firebaseUid', async () => {
      const app = buildApp();
      const paddedUid = `  ${testUser.firebase_uid}  `;
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: paddedUid });

      expect(res.status).toBe(200);
      // Handler trimmer inden det sendes til resolveTrustedUid som hint
      expect(vi.mocked(resolveTrustedUid).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) Happy-path POST
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path POST', () => {
    it('returnerer 200 når firebaseUid sendes i body', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/dashboard')
        .send({ firebaseUid: testUser.firebase_uid })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.profile.firebase_uid).toBe(testUser.firebase_uid);
      expect(res.body.recent_scans).toHaveLength(1);
      expect(res.body.kpi.total_scans).toBe(17);
      expect(vi.mocked(resolveTrustedUid).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) Input-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('input-validering', () => {
    it('returnerer 400 når firebaseUid mangler i GET query', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/dashboard');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'firebaseUid er påkrævet.' });
      // Ingen data-fetch må ske uden uid
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(getDashboard)).not.toHaveBeenCalled();
    });

    it('returnerer 400 når firebaseUid mangler i POST body', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/dashboard').send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'firebaseUid er påkrævet.' });
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(getDashboard)).not.toHaveBeenCalled();
    });

    it('returnerer 400 når firebaseUid er tom string (efter trim)', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: '   ' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'firebaseUid er påkrævet.' });
      expect(vi.mocked(getDashboard)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) F3.8 — enforce spoof-reject
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 enforce spoof-reject', () => {
    it('blokerer med 401 UID_SPOOF_DETECTED når resolveTrustedUid kaster', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error(
          'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"',
        );
        err.status = 401;
        err.reason =
          'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"';
        throw err;
      });

      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: 'victim-uid' })
        .set('Authorization', 'Bearer forged-token');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UID_SPOOF_DETECTED');
      expect(res.body.detail).toBe(
        'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"',
      );
      // getDashboard må IKKE kaldes når F3.8 blokerer
      expect(vi.mocked(getDashboard)).not.toHaveBeenCalled();
    });

    it('propagerer custom status-kode fra resolveTrustedUid (fx 403)', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error('token.uid mismatch');
        err.status = 403;
        err.reason = 'token.uid mismatch';
        throw err;
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/dashboard')
        .send({ firebaseUid: 'victim' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UID_SPOOF_DETECTED');
      expect(res.body.detail).toBe('token.uid mismatch');
      expect(vi.mocked(getDashboard)).not.toHaveBeenCalled();
    });

    it('defaulter til 401 når fejl ikke har status-felt', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        throw new Error('generic verify-failure');
      });

      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UID_SPOOF_DETECTED');
      expect(res.body.detail).toBe('generic verify-failure');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) F3.8 — warn_only paths
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 warn_only', () => {
    it('bruger TOKEN-uid som trusted når verified=true + spoofed=true', async () => {
      const attackerUid = 'attacker-provided-uid';
      const tokenUid = 'legit-token-uid';
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: tokenUid,
        verified: true,
        spoofed: true,
        reason:
          'UID_SPOOF_DETECTED: token.uid="legit-token-uid" != body.firebaseUid="attacker-provided-uid"',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/dashboard')
        .send({ firebaseUid: attackerUid });

      expect(res.status).toBe(200);
      // getDashboard fik TOKEN-uid, IKKE klient-uid
      expect(vi.mocked(getDashboard)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getDashboard).mock.calls[0][1]).toBe(tokenUid);
      expect(vi.mocked(getDashboard).mock.calls[0][1]).not.toBe(attackerUid);
    });

    it('bruger KLIENT-uid når verified=false (backward-compat)', async () => {
      const clientUid = 'unverified-client-uid';
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: clientUid,
        verified: false,
        spoofed: false,
        reason: 'Ingen token — warn_only pass-through.',
      });

      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: clientUid });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(vi.mocked(getDashboard).mock.calls[0][1]).toBe(clientUid);
    });

    it('falder tilbage til klient-uid når resolveTrustedUid returnerer tomt trusted_uid', async () => {
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: '',
        verified: false,
        spoofed: false,
        reason: 'no uid resolved',
      } as any);

      const app = buildApp();
      const res = await request(app)
        .post('/api/dashboard')
        .send({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(200);
      // Fallback til det klient-oplyste UID
      expect(vi.mocked(getDashboard).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) Aggregation-correctness — KPI-værdier videresendes uændret
  // ───────────────────────────────────────────────────────────────────────────
  describe('aggregation-correctness', () => {
    it('videresender KPI-værdier fra RPC UÆNDRET til response', async () => {
      const preciseKpi = {
        total_scans: 128,
        total_points: 12_875,
        total_kroner: 1_287.5,
        total_co2_kg: 42.777,
      };
      vi.mocked(getDashboard).mockResolvedValueOnce({
        profile: HAPPY_DASHBOARD_PAYLOAD.profile,
        recent_scans: [],
        kpi: preciseKpi,
      } as any);

      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(200);
      expect(res.body.kpi).toEqual(preciseKpi);
      // Præcise numeriske assertions (ingen afrunding foretaget af handler)
      expect(res.body.kpi.total_scans).toBe(128);
      expect(res.body.kpi.total_points).toBe(12_875);
      expect(res.body.kpi.total_kroner).toBeCloseTo(1_287.5, 5);
      expect(res.body.kpi.total_co2_kg).toBeCloseTo(42.777, 5);
    });

    it('håndterer bruger uden scans (kpi-nuller + tom recent_scans)', async () => {
      const emptyPayload = {
        profile: {
          ...HAPPY_DASHBOARD_PAYLOAD.profile,
          balance: 0,
          points: 0,
          scans_count: 0,
          co2_saved_kg: 0,
        },
        recent_scans: [],
        kpi: {
          total_scans: 0,
          total_points: 0,
          total_kroner: 0,
          total_co2_kg: 0,
        },
      };
      vi.mocked(getDashboard).mockResolvedValueOnce(emptyPayload as any);

      const app = buildApp();
      const res = await request(app)
        .post('/api/dashboard')
        .send({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.recent_scans).toEqual([]);
      expect(res.body.kpi).toEqual({
        total_scans: 0,
        total_points: 0,
        total_kroner: 0,
        total_co2_kg: 0,
      });
      expect(res.body.profile.balance).toBe(0);
    });

    it('bevarer optional felter (achievements + leaderboard_rank) fra RPC', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(200);
      expect(res.body.achievements).toHaveLength(2);
      expect(res.body.achievements[0]).toEqual({
        code: 'first_scan',
        unlocked_at: '2026-07-01T10:00:00.000Z',
      });
      expect(res.body.leaderboard_rank).toBe(42);
    });

    it('udelader achievements/leaderboard_rank når RPC ikke leverer dem', async () => {
      vi.mocked(getDashboard).mockResolvedValueOnce({
        profile: HAPPY_DASHBOARD_PAYLOAD.profile,
        recent_scans: HAPPY_DASHBOARD_PAYLOAD.recent_scans,
        kpi: HAPPY_DASHBOARD_PAYLOAD.kpi,
      } as any);

      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(200);
      expect(res.body.achievements).toBeUndefined();
      expect(res.body.leaderboard_rank).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) Error-håndtering — getDashboard fejler
  // ───────────────────────────────────────────────────────────────────────────
  describe('error-håndtering', () => {
    it('returnerer 500 med besked når getDashboard kaster', async () => {
      vi.mocked(getDashboard).mockRejectedValueOnce(
        new Error('get_dashboard: RPC connection reset'),
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe(
        'Kunne ikke hente dashboard: get_dashboard: RPC connection reset',
      );
      // F3.8 blev stadig kaldt FØR getDashboard
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getDashboard)).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8) 503 — Supabase config mangler
  // ───────────────────────────────────────────────────────────────────────────
  describe('503 uden Supabase-config', () => {
    it('returnerer 503 når VITE_SUPABASE_URL/SERVICE_ROLE_KEY mangler', async () => {
      // Handler'ens getSupabase() cacher _sb — vi resetter modul-graf'en
      // og loader handler'en dynamisk med tomme env vars for at ramme null-grenen.
      const originalUrl = process.env.VITE_SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.VITE_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      vi.resetModules();
      // Re-mock efter resetModules — mocks skal genregistreres for det nye modul-tree
      vi.doMock('../lib/cirkel.js', () => ({
        getDashboard: vi.fn(),
      }));
      vi.doMock('../api/_verify-firebase-token.js', () => ({
        resolveTrustedUid: vi.fn(async () => VERIFIED_OK),
      }));

      try {
        const freshHandler = (await import('../api/dashboard.js')).default;
        const app = express();
        app.use(express.json({ limit: '2mb' }));
        app.all('/api/dashboard', (req, res) =>
          freshHandler(req as any, res as any),
        );

        const res = await request(app)
          .get('/api/dashboard')
          .query({ firebaseUid: testUser.firebase_uid });

        expect(res.status).toBe(503);
        expect(res.body).toEqual({
          error: 'Supabase service-role-nøgle ikke konfigureret.',
        });
      } finally {
        // Restore env + modul-graf
        if (originalUrl) process.env.VITE_SUPABASE_URL = originalUrl;
        if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
        vi.doUnmock('../lib/cirkel.js');
        vi.doUnmock('../api/_verify-firebase-token.js');
        vi.resetModules();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9) Wire-orden — F3.8 FØR data-fetch
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 wire-orden', () => {
    it('kalder resolveTrustedUid FØR getDashboard og videregiver trusted_uid', async () => {
      const callOrder: string[] = [];
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        callOrder.push('resolveTrustedUid');
        return VERIFIED_OK;
      });
      vi.mocked(getDashboard).mockImplementationOnce(async () => {
        callOrder.push('getDashboard');
        return HAPPY_DASHBOARD_PAYLOAD as any;
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/dashboard')
        .send({ firebaseUid: testUser.firebase_uid });

      expect(res.status).toBe(200);
      expect(callOrder).toEqual(['resolveTrustedUid', 'getDashboard']);
      // getDashboard fik det VERIFICEREDE uid, ikke det klient-oplyste hint
      expect(vi.mocked(getDashboard).mock.calls[0][1]).toBe(
        VERIFIED_OK.trusted_uid,
      );
    });

    it('springer getDashboard over hvis F3.8 blokerer', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error('blocked');
        err.status = 401;
        err.reason = 'blocked';
        throw err;
      });

      const app = buildApp();
      await request(app)
        .get('/api/dashboard')
        .query({ firebaseUid: testUser.firebase_uid });

      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getDashboard)).not.toHaveBeenCalled();
    });
  });
});
