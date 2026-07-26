// cirkel-system/tests/redeem.test.ts
//
// Vitest-suite for POST /api/redeem (api/redeem.ts).
//
// Fokus:
//   1. Happy-path             — verificeret bruger + tilstrækkelig saldo
//                               → 200 { success:true, redemption_id, ...auth }
//   2. Insufficient balance   — redeem_reward RPC kaster
//                               "Insufficient spendable_points" → 400 forward
//   3. F3.8 wire (spoof)      — resolveTrustedUid kaster spoof-fejl → 401
//                               UID_SPOOF_DETECTED + INGEN RPC-kald
//   4. F3.8 wire (warn_only)  — verify returnerer verified=false
//                               → pass-through, RPC kaldes med body-UID
//   5. F3.8 wire (trust prop) — verify returnerer trusted_uid != bodyUID
//                               → RPC KALDES MED trusted_uid (ikke body-uid)
//   6. Method-guard           — GET/PUT/DELETE → 405
//   7. Input-validering       — mangler firebaseUid eller rewardId → 400
//   8. Supabase mangler       — env-vars mangler → 503
//   9. RPC generisk error     — anden fejl fra redeem_reward → 400 forward
//  10. Custom 403 fra verify  — err.status=403 propageres → 403
//
// Alle eksterne motorer (Supabase-client, redeemReward, resolveTrustedUid) er
// mocket via vi.mock på modul-grænseflade. Ingen live network-calls.
// Deterministisk — Date.now er ikke brugt, alle mocks er faste værdier.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Lokale mocks (hoisted af vitest) ────────────────────────────────────────
// Vi mocker hele modul-grænsefladen for at få 100% deterministisk kontrol pr. test.
// NB: setup.ts mocker allerede @supabase/supabase-js på pakke-niveau, så
// createClient returnerer en stub — det er kun redeemReward vi behøver at
// intercepte for at kontrollere RPC-udfaldet.

vi.mock('../lib/cirkel.js', () => ({
  redeemReward: vi.fn(),
}));

vi.mock('../api/_verify-firebase-token.js', () => ({
  resolveTrustedUid: vi.fn(),
}));

// ─── Imports (efter vi.mock; hoisting sikrer at redeem.ts også får mocks) ────
import handler from '../api/redeem.js';
import { redeemReward } from '../lib/cirkel.js';
import { resolveTrustedUid } from '../api/_verify-firebase-token.js';
import { testUser, testRedemption } from './setup.js';

// ─── Test-app wrapper (supertest → express → handler) ────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/redeem', (req, res) => handler(req as any, res as any));
  return app;
}

// ─── Deterministiske fixtures ────────────────────────────────────────────────
const HAPPY_REDEEM_RESULT = {
  redemption_id: testRedemption.id,
  reward: testRedemption.reward_name,
  cost_points: testRedemption.points_spent,
  remaining_points: 325, // 425 (testUser.points) - 100 (cost)
};

// ─── Globale defaults pr. test ────────────────────────────────────────────────
beforeEach(() => {
  // Standard: verify OK og RPC leverer happy-result
  vi.mocked(redeemReward).mockResolvedValue(HAPPY_REDEEM_RESULT);
  vi.mocked(resolveTrustedUid).mockResolvedValue({
    trusted_uid: testUser.firebase_uid,
    verified: true,
    spoofed: false,
    reason: 'F3.8: token verified + uid match',
  });

  // Supabase kan instantieres (setup.ts har stubbed createClient, men handler
  // læser env-vars og returnerer 503 hvis de mangler).
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/redeem', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1) Happy-path
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path', () => {
    it('returnerer 200 med redemption + auth-metadata når verificeret bruger indløser reward', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/redeem')
        .send({
          firebaseUid: testUser.firebase_uid,
          rewardId: testRedemption.reward_id,
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        redemption_id: HAPPY_REDEEM_RESULT.redemption_id,
        reward: HAPPY_REDEEM_RESULT.reward,
        cost_points: HAPPY_REDEEM_RESULT.cost_points,
        remaining_points: HAPPY_REDEEM_RESULT.remaining_points,
        auth: {
          firebase_verified: true,
          trusted_uid: testUser.firebase_uid,
        },
      });

      // F3.8 blev kaldt før RPC
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(resolveTrustedUid).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );

      // RPC kaldt med TRUSTED uid (samme som body, men via verify-wrapperen)
      expect(vi.mocked(redeemReward)).toHaveBeenCalledTimes(1);
      const [_sb, uidArg, rewardArg] = vi.mocked(redeemReward).mock.calls[0];
      expect(uidArg).toBe(testUser.firebase_uid);
      expect(rewardArg).toBe(testRedemption.reward_id);
    });

    it('viderefører præcise numeriske værdier fra RPC (points_spent + remaining_points)', async () => {
      vi.mocked(redeemReward).mockResolvedValueOnce({
        redemption_id: 'redemption-42',
        reward: 'Biograf-billet',
        cost_points: 250,
        remaining_points: 175,
      });

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: 'reward-cinema-01',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cost_points).toBe(250);
      expect(res.body.remaining_points).toBe(175);
      expect(res.body.redemption_id).toBe('redemption-42');
      expect(res.body.reward).toBe('Biograf-billet');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) Insufficient balance rejection
  // ───────────────────────────────────────────────────────────────────────────
  describe('insufficient balance rejection', () => {
    it('returnerer 400 med RPC-fejlbesked når spendable_points ikke rækker', async () => {
      vi.mocked(redeemReward).mockRejectedValueOnce(
        new Error(
          'redeem_reward: Insufficient spendable_points: have 50, need 100',
        ),
      );

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error:
          'redeem_reward: Insufficient spendable_points: have 50, need 100',
      });

      // F3.8 blev stadig kaldt — sikkerhed FØR RPC
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      // RPC blev forsøgt (og fejlede)
      expect(vi.mocked(redeemReward)).toHaveBeenCalledTimes(1);
    });

    it('returnerer 400 når reward ikke findes / er inaktiv', async () => {
      vi.mocked(redeemReward).mockRejectedValueOnce(
        new Error('redeem_reward: reward not found or inactive'),
      );

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: 'reward-does-not-exist',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        'redeem_reward: reward not found or inactive',
      );
    });

    it('returnerer 400 når reward er udsolgt (stock=0)', async () => {
      vi.mocked(redeemReward).mockRejectedValueOnce(
        new Error('redeem_reward: reward out of stock'),
      );

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('redeem_reward: reward out of stock');
      expect(vi.mocked(redeemReward)).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) F3.8 — spoof-reject (enforce-mode)
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 spoof-reject', () => {
    it('blokerer redeem med 401 UID_SPOOF_DETECTED når verify kaster', async () => {
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
        .post('/api/redeem')
        .send({
          firebaseUid: 'victim-uid',
          rewardId: testRedemption.reward_id,
        })
        .set('Authorization', 'Bearer forged-token');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'UID_SPOOF_DETECTED',
        detail:
          'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"',
      });
      // Reward-integritet: RPC MÅ ALDRIG kaldes når F3.8 blokerer
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });

    it('propagerer 403 status fra verify (UID-mismatch-mode)', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error('token.uid mismatch');
        err.status = 403;
        err.reason = 'token.uid mismatch';
        throw err;
      });

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: 'victim',
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UID_SPOOF_DETECTED');
      expect(res.body.detail).toBe('token.uid mismatch');
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });

    it('defaulter til 401 hvis verify kaster uden status-felt', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        throw new Error('boom-no-status');
      });

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UID_SPOOF_DETECTED');
      expect(res.body.detail).toBe('boom-no-status');
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) F3.8 — warn_only pass-through
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 warn_only pass-through', () => {
    it('accepterer redeem når verify returnerer verified=false (warn_only)', async () => {
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: testUser.firebase_uid,
        verified: false,
        spoofed: false,
        reason: 'Ingen token — warn_only pass-through.',
      });

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.auth).toEqual({
        firebase_verified: false,
        trusted_uid: testUser.firebase_uid,
      });
      // RPC kaldt selvom verified=false (warn_only tillader pass-through)
      expect(vi.mocked(redeemReward)).toHaveBeenCalledTimes(1);
    });

    it('bruger TRUSTED uid fra verify — ikke body-uid — når de afviger', async () => {
      // Simulerer at F3.8-verify har opdaget spoof men kører i warn_only:
      // returnerer det RIGTIGE uid fra token, ikke body-UID.
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: 'trusted-uid-from-token',
        verified: true,
        spoofed: true,
        reason: 'warn_only pass-through (spoofed)',
      });

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: 'body-uid-spoofed',
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(200);
      // Auth-metadata i responsen viser det TRUSTED uid
      expect(res.body.auth.trusted_uid).toBe('trusted-uid-from-token');
      expect(res.body.auth.firebase_verified).toBe(true);

      // Vigtigst: RPC blev kaldt med det TRUSTED uid, ikke body-uid'et
      expect(vi.mocked(redeemReward)).toHaveBeenCalledTimes(1);
      const [_sb, uidArg] = vi.mocked(redeemReward).mock.calls[0];
      expect(uidArg).toBe('trusted-uid-from-token');
      expect(uidArg).not.toBe('body-uid-spoofed');
    });

    it('falder tilbage til body-uid når verify-wrapperen returnerer falsy', async () => {
      // Defensiv sti i handler: hvis wrapperen ikke leverer et resultat, brug body-uid.
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce(undefined as any);

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(200);
      expect(res.body.auth).toEqual({
        firebase_verified: false,
        trusted_uid: testUser.firebase_uid,
      });
      expect(vi.mocked(redeemReward)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(redeemReward).mock.calls[0][1]).toBe(
        testUser.firebase_uid,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) Method-guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser GET med 405 Method not allowed', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/redeem');
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'Method not allowed' });
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });

    it('afviser PUT med 405 Method not allowed', async () => {
      const app = buildApp();
      const res = await request(app).put('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'Method not allowed' });
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });

    it('afviser DELETE med 405 Method not allowed', async () => {
      const app = buildApp();
      const res = await request(app).delete('/api/redeem');
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'Method not allowed' });
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) Input-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('input-validering', () => {
    it('returnerer 400 når firebaseUid mangler', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'firebaseUid og rewardId er påkrævet.',
      });
      // Hverken verify eller RPC må røres
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });

    it('returnerer 400 når rewardId mangler', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'firebaseUid og rewardId er påkrævet.',
      });
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(redeemReward)).not.toHaveBeenCalled();
    });

    it('returnerer 400 når body er helt tomt', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'firebaseUid og rewardId er påkrævet.',
      });
    });

    it('returnerer 400 når firebaseUid er tom streng', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: '',
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'firebaseUid og rewardId er påkrævet.',
      });
    });

    it('returnerer 400 når rewardId er tom streng', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: '',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'firebaseUid og rewardId er påkrævet.',
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) Supabase-konfiguration mangler
  //     NB: redeem.ts cacher Supabase-klienten i en modul-scope singleton
  //     (`let _sb`). Én succesful init i en tidligere test ville derfor
  //     forurene disse tests. Vi bruger vi.resetModules() + dynamic import
  //     for at få et frisk handler-modul PER test, så env-fjernelsen faktisk
  //     rammer getSupabase()-vagten.
  // ───────────────────────────────────────────────────────────────────────────
  describe('supabase-konfiguration', () => {
    /** Frisk handler-instans + re-etablerede mocks for et rent modul-scope. */
    async function loadFreshHandler() {
      vi.resetModules();
      // Re-mock efter resetModules — mocks nulstilles også.
      vi.doMock('../lib/cirkel.js', () => ({
        redeemReward: vi.fn().mockResolvedValue(HAPPY_REDEEM_RESULT),
      }));
      vi.doMock('../api/_verify-firebase-token.js', () => ({
        resolveTrustedUid: vi.fn().mockResolvedValue({
          trusted_uid: testUser.firebase_uid,
          verified: true,
          spoofed: false,
          reason: 'F3.8: token verified + uid match',
        }),
      }));
      const mod = await import('../api/redeem.js');
      const cirkelMod = await import('../lib/cirkel.js');
      return {
        handler: mod.default,
        redeemRewardMock: cirkelMod.redeemReward as ReturnType<typeof vi.fn>,
      };
    }

    function buildFreshApp(freshHandler: (req: any, res: any) => any) {
      const app = express();
      app.use(express.json({ limit: '1mb' }));
      app.all('/api/redeem', (req, res) => freshHandler(req, res));
      return app;
    }

    it('returnerer 503 når VITE_SUPABASE_URL mangler', async () => {
      delete process.env.VITE_SUPABASE_URL;

      const { handler: freshHandler, redeemRewardMock } =
        await loadFreshHandler();
      const app = buildFreshApp(freshHandler);
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: 'Supabase service-role-nøgle ikke konfigureret.',
      });
      // RPC må aldrig kaldes uden Supabase-klient
      expect(redeemRewardMock).not.toHaveBeenCalled();
    });

    it('returnerer 503 når SUPABASE_SERVICE_ROLE_KEY mangler', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const { handler: freshHandler, redeemRewardMock } =
        await loadFreshHandler();
      const app = buildFreshApp(freshHandler);
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: 'Supabase service-role-nøgle ikke konfigureret.',
      });
      expect(redeemRewardMock).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8) RPC-fejl propagation (generiske)
  // ───────────────────────────────────────────────────────────────────────────
  describe('RPC-fejl propagation', () => {
    it('videresender generisk RPC-fejl som 400 med error.message', async () => {
      vi.mocked(redeemReward).mockRejectedValueOnce(
        new Error('redeem_reward: database connection lost'),
      );

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: testUser.firebase_uid,
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'redeem_reward: database connection lost',
      });
    });

    it('håndterer profile-ikke-fundet-fejl fra RPC', async () => {
      vi.mocked(redeemReward).mockRejectedValueOnce(
        new Error('redeem_reward: profile not found for firebase_uid'),
      );

      const app = buildApp();
      const res = await request(app).post('/api/redeem').send({
        firebaseUid: 'unknown-uid',
        rewardId: testRedemption.reward_id,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        'redeem_reward: profile not found for firebase_uid',
      );
      // F3.8 fik lov at passere (mock returnerer verified=true som standard)
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
    });
  });
});
