// cirkel-system/tests/scan.test.ts
//
// Vitest-suite for POST /api/scan (api/scan.ts).
//
// Fokus:
//   1. Happy-path             — verificeret bruger + gyldigt AI-svar → persist + saved-payload
//   2. Anonymt scan           — ingen firebaseUid → success + data uden saved
//   3. Method-guard           — GET → 405
//   4. Input-validering       — hverken image eller productName → 400
//   5. F3.8 spoof-reject      — resolveTrustedUid kaster (enforce-mode) → 401 UID_SPOOF_DETECTED
//   6. Fraud-flag path        — calculateRiskScore ≥ 70 → saved.fraud_rejected=true, ingen processScan
//   7. Provider-fallback      — Gemini throw → Claude succeeder → svaret bygges fra Claude
//   8. Bad AI-payload         — parseNumeric returnerer null → success + data uden saved
//
// Alle eksterne motorer (Gemini, Claude, Roboflow, Supabase, Firebase, fraud-engine,
// resolveTrustedUid, processScan) er mocket via ./tests/setup + lokale vi.mock-kald.
// Ingen live network-calls. Deterministisk (Date.now er ikke brugt til assertions,
// og fraud-mocks er faste værdier).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Lokale mocks (hoisted af vitest) ─────────────────────────────────────────
// Vi mocker hele modul-grænsefladen for at få 100% deterministisk kontrol pr. test.

vi.mock('../api/_gemini.js', () => ({
  getAI: vi.fn(),
}));

vi.mock('../api/_claude.js', () => ({
  getClaude: vi.fn(),
  claudeJSON: vi.fn(),
  CLAUDE_MODEL: 'claude-sonnet-4-6',
}));

vi.mock('../api/_ai.js', () => ({
  providerOrder: vi.fn(),
}));

vi.mock('../api/_rules.js', () => ({
  runRules: vi.fn(),
}));

vi.mock('../lib/cirkel.js', () => ({
  processScan: vi.fn(),
}));

vi.mock('../api/roboflow-fallback.js', () => ({
  callWorkflow: vi.fn(),
  stubResponse: vi.fn(() => ({
    material_type: 'UNKNOWN',
    material_confidence: 0,
    quantity_kg_estimate: null,
    contamination_pct: null,
    purity_score: null,
    source: 'stub_no_api_key',
    raw_workflow_response: { stub: true },
  })),
}));

vi.mock('../api/_verify-firebase-token.js', () => ({
  resolveTrustedUid: vi.fn(),
}));

vi.mock('../api/_fraud.js', () => ({
  calculateRiskScore: vi.fn(),
  generateImageHash: vi.fn(() => 'sha256-deterministic-hash-000000000000'),
}));

vi.mock('../api/_pool-guard.js', () => ({
  evaluatePoolSovereignty: vi.fn(),
  MINIMUM_SAFE_BUFFER_PCT: 0.15,
  SAFETY_BUFFER_CEILING: 1500.0,
}));

// ─── Imports (efter vi.mock; hoisting sikrer at scan.ts også får mocks) ───────
import handler from '../api/scan.js';
import { getAI } from '../api/_gemini.js';
import { getClaude, claudeJSON } from '../api/_claude.js';
import { providerOrder } from '../api/_ai.js';
import { runRules } from '../api/_rules.js';
import { processScan } from '../lib/cirkel.js';
import { callWorkflow as callRoboflowWorkflow } from '../api/roboflow-fallback.js';
import { resolveTrustedUid } from '../api/_verify-firebase-token.js';
import { calculateRiskScore } from '../api/_fraud.js';
import { evaluatePoolSovereignty } from '../api/_pool-guard.js';
import { testUser } from './setup.js';

// ─── Test-app wrapper (supertest → express → handler) ─────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.all('/api/scan', (req, res) => handler(req as any, res as any));
  return app;
}

// ─── Deterministiske fixtures ────────────────────────────────────────────────
const HAPPY_AI_PAYLOAD = {
  productName: 'Arla® Skyr Naturel 450g',
  materialShort: 'PP5 plast · EAN: 5711953068515',
  grade: 'A+',
  co2Saved: '42g',
  waterSaved: '1.2L',
  energySaved: '0.8kWh',
  pantValue: '1.50',
  materialType: 'Polypropylen PP5',
  recyclablePercent: '100%',
  manufacturer: 'Arla Foods, Viby',
  packagingWeight: '20g',
  circularScore: '92',
  eprStatus: 'Registreret ✓',
  sortingType: '♻️ Plast (Hård plastik)',
  sortingInstructions: 'Skyl kort og læg i plast-beholder.',
  didYouKnow: 'PP5 kan genanvendes 100% i Danmark.',
};

const HAPPY_PROCESS_SCAN_RESULT = {
  user_id: testUser.id,
  scan_id: '00000000-0000-4000-8000-000000000901',
  points_earned: 150,
  kroner_earned: 1.5,
  co2_kg: 0.042,
  new_balance: 44.0,
  new_points: 575,
  streak_days: 5,
  member_status: 'Standard-medlem' as const,
  level: 2,
  ledger_hash: 'a'.repeat(64),
};

const FRAUD_ACCEPT = { score: 0, flags: [], recommend: 'accept' as const };
const FRAUD_REJECT = {
  score: 100,
  flags: ['duplicate_image', 'excessive_frequency'],
  recommend: 'reject' as const,
};

// Fabriker et Gemini-klient-mock hvor generateContent returnerer et givet JSON-payload.
function geminiReturning(payload: Record<string, unknown>) {
  return {
    models: {
      generateContent: vi.fn(async () => ({
        text: JSON.stringify(payload),
      })),
    },
  };
}

// Fabriker et Gemini-klient-mock der kaster.
function geminiThrowing(message: string) {
  return {
    models: {
      generateContent: vi.fn(async () => {
        throw new Error(message);
      }),
    },
  };
}

// ─── Globale defaults pr. test ────────────────────────────────────────────────
beforeEach(() => {
  // Reset alle mock-implementeringer så én test ikke lækker til næste.
  vi.mocked(providerOrder).mockReturnValue(['gemini']);
  vi.mocked(getAI).mockReturnValue(geminiReturning(HAPPY_AI_PAYLOAD) as any);
  vi.mocked(getClaude).mockReturnValue(null as any);
  vi.mocked(claudeJSON).mockResolvedValue(HAPPY_AI_PAYLOAD);
  vi.mocked(runRules).mockResolvedValue(null);
  vi.mocked(processScan).mockResolvedValue(HAPPY_PROCESS_SCAN_RESULT as any);
  vi.mocked(callRoboflowWorkflow).mockResolvedValue({
    material_type: 'PP5',
    material_confidence: 0.5,
    quantity_kg_estimate: null,
    contamination_pct: null,
    purity_score: null,
    source: 'roboflow_michaels_workflow',
    raw_workflow_response: {},
  });
  vi.mocked(resolveTrustedUid).mockResolvedValue({
    trusted_uid: testUser.firebase_uid,
    verified: true,
    spoofed: false,
    reason: 'F3.8: token verified + uid match',
  });
  vi.mocked(calculateRiskScore).mockReturnValue(FRAUD_ACCEPT);
  vi.mocked(evaluatePoolSovereignty).mockReturnValue({
    action: 'EXECUTE_MOBILEPAY_CASH',
    warning: false,
    reason: 'pool healthy',
    producerId: 'test-producer',
    remainingFundsDkk: 10_000,
    requestedPayoutDkk: 1.5,
    safetyBufferCeilingDkk: 1500,
    minimumSafeBufferPct: 0.15,
    evaluatedAt: '2026-07-22T00:00:00.000Z',
  });

  // Sørg for at Supabase-klienten kan instantieres i handler'en.
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  delete process.env.ROBOFLOW_API_KEY;
  delete process.env.SCAN_POOL_ID;
  delete process.env.SCAN_POOL_REMAINING_DKK;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/scan', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1) Happy-path
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path', () => {
    it('returnerer success + data + saved når verificeret bruger sender gyldigt billede', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC123',
          firebaseUid: testUser.firebase_uid,
          email: testUser.email,
          fullName: testUser.full_name,
          municipality: 'Aarhus Kommune',
        })
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        productName: HAPPY_AI_PAYLOAD.productName,
        pantValue: HAPPY_AI_PAYLOAD.pantValue,
        materialType: HAPPY_AI_PAYLOAD.materialType,
      });
      expect(res.body.saved).toBeDefined();
      expect(res.body.saved.user_id).toBe(HAPPY_PROCESS_SCAN_RESULT.user_id);
      expect(res.body.saved.new_balance).toBe(44.0);
      expect(res.body.saved.new_points).toBe(575);
      expect(res.body.saved.ledger_hash).toBe('a'.repeat(64));
      expect(res.body.saved.uid_verified).toBe(true);
      expect(res.body.saved.uid_spoofed).toBe(false);
      expect(res.body.saved.fraud_score).toBe(0);
      expect(res.body.saved.fraud_flags).toEqual([]);
      expect(res.body.saved.fraud_recommend).toBe('accept');
      expect(res.body.saved.payout_diverted_to_vouchers).toBe(false);

      // resolveTrustedUid blev kaldt med body-uid
      expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(resolveTrustedUid).mock.calls[0][1]).toBe(testUser.firebase_uid);

      // processScan blev kaldt med parsede numeriske værdier
      expect(vi.mocked(processScan)).toHaveBeenCalledTimes(1);
      const scanArgs = vi.mocked(processScan).mock.calls[0][1];
      expect(scanArgs.firebaseUid).toBe(testUser.firebase_uid);
      expect(scanArgs.material).toBe('Polypropylen PP5');
      expect(scanArgs.kroner).toBeCloseTo(1.5, 5);
      expect(scanArgs.points).toBe(150);
      expect(scanArgs.co2Kg).toBeCloseTo(0.042, 5);
      expect(scanArgs.weightGrams).toBe(20);
      expect(scanArgs.municipality).toBe('Aarhus Kommune');
    });

    it('bruger body.weight_grams frem for AI-svarets packagingWeight når begge findes', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: testUser.firebase_uid,
          weight_grams: 42,
        });

      expect(vi.mocked(processScan)).toHaveBeenCalledTimes(1);
      const scanArgs = vi.mocked(processScan).mock.calls[0][1];
      expect(scanArgs.weightGrams).toBe(42);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) Anonymt scan (ingen firebaseUid → success uden saved)
  // ───────────────────────────────────────────────────────────────────────────
  describe('anonymt scan', () => {
    it('returnerer success + data uden saved når firebaseUid mangler', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({ productName: 'Cola 0.5L', municipality: 'Aarhus Kommune' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ productName: HAPPY_AI_PAYLOAD.productName });
      expect(res.body.saved).toBeUndefined();

      // resolveTrustedUid må IKKE kaldes uden firebaseUid
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      // processScan må ligeledes IKKE kaldes anonymt
      expect(vi.mocked(processScan)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) Method guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser GET med 405 Method not allowed', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/scan');

      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'Method not allowed' });
      expect(vi.mocked(getAI)).not.toHaveBeenCalled();
      expect(vi.mocked(processScan)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) Input-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('input-validering', () => {
    it('returnerer 400 når hverken image eller productName er sat', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({ municipality: 'Aarhus Kommune' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Enten billede eller produktnavn er påkrævet.',
      });
      // AI må ikke kaldes ved dårlig input
      expect(vi.mocked(getAI)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) F3.8 — spoof-reject (enforce-mode)
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 spoof-reject', () => {
    it('blokerer scan med 401 når resolveTrustedUid kaster spoof-fejl', async () => {
      // Simulér enforce-mode: resolveTrustedUid kaster med status+reason
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error(
          'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"'
        );
        err.status = 401;
        err.reason =
          'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"';
        throw err;
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,SPOOFED',
          firebaseUid: 'victim-uid',
          municipality: 'Aarhus Kommune',
        })
        .set('Authorization', 'Bearer forged-token');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'UID_SPOOF_DETECTED',
        reason:
          'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"',
      });
      // Hverken AI eller persistence må røres når F3.8 blokerer
      expect(vi.mocked(getAI)).not.toHaveBeenCalled();
      expect(vi.mocked(processScan)).not.toHaveBeenCalled();
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
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: 'victim',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UID_SPOOF_DETECTED');
      expect(res.body.reason).toBe('token.uid mismatch');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) Fraud-flag path
  // ───────────────────────────────────────────────────────────────────────────
  describe('fraud-flag path', () => {
    it('returnerer saved.fraud_rejected=true og springer processScan over ved score ≥ 70', async () => {
      vi.mocked(calculateRiskScore).mockReturnValueOnce(FRAUD_REJECT);

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,DUP',
          firebaseUid: testUser.firebase_uid,
          municipality: 'Aarhus Kommune',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // AI-data er stadig returneret til klienten
      expect(res.body.data).toMatchObject({ productName: HAPPY_AI_PAYLOAD.productName });
      // Men saved bærer fraud-afvisningen
      expect(res.body.saved).toEqual({
        fraud_rejected: true,
        fraud_score: FRAUD_REJECT.score,
        fraud_flags: FRAUD_REJECT.flags,
        fraud_recommend: FRAUD_REJECT.recommend,
      });
      // processScan MÅ IKKE kaldes når fraud rejecter
      expect(vi.mocked(processScan)).not.toHaveBeenCalled();
      // calculateRiskScore blev kaldt med korrekte signaler
      expect(vi.mocked(calculateRiskScore)).toHaveBeenCalledTimes(1);
      const [signals, history] = vi.mocked(calculateRiskScore).mock.calls[0];
      expect(signals.user_id).toBe(testUser.firebase_uid);
      expect(signals.payout_dkk).toBeCloseTo(1.5, 5);
      expect(signals.verification_tier).toBe('verified');
      expect(signals.image_hash).toBe('sha256-deterministic-hash-000000000000');
      expect(Array.isArray(history)).toBe(true);
      expect(history).toEqual([]);
    });

    it('fortsætter til processScan når fraud-score < 70', async () => {
      vi.mocked(calculateRiskScore).mockReturnValueOnce({
        score: 50,
        flags: ['high_value_unverified'],
        recommend: 'review',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: testUser.firebase_uid,
        });

      expect(res.status).toBe(200);
      expect(res.body.saved).toBeDefined();
      expect(res.body.saved.fraud_score).toBe(50);
      expect(res.body.saved.fraud_recommend).toBe('review');
      expect(res.body.saved.fraud_flags).toEqual(['high_value_unverified']);
      expect(vi.mocked(processScan)).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) Provider-fallback
  // ───────────────────────────────────────────────────────────────────────────
  describe('provider-fallback', () => {
    it('falder tilbage til Claude når Gemini kaster', async () => {
      // Kør både gemini og claude i chain'en
      vi.mocked(providerOrder).mockReturnValue(['gemini', 'claude', 'rules']);
      // Gemini kaster
      vi.mocked(getAI).mockReturnValue(geminiThrowing('gemini_boom') as any);
      // Claude er tilgængelig og leverer et velformet svar
      vi.mocked(getClaude).mockReturnValue({ __marker: 'anthropic-client' } as any);
      const claudePayload = {
        ...HAPPY_AI_PAYLOAD,
        productName: 'Claude-vare',
        materialType: 'HDPE',
      };
      vi.mocked(claudeJSON).mockResolvedValueOnce(claudePayload);

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: testUser.firebase_uid,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.productName).toBe('Claude-vare');
      expect(res.body.data.materialType).toBe('HDPE');

      // Begge blev forsøgt, men i rækkefølge
      expect(vi.mocked(getAI)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(claudeJSON)).toHaveBeenCalledTimes(1);
      // runRules blev IKKE kaldt fordi Claude allerede leverede
      expect(vi.mocked(runRules)).not.toHaveBeenCalled();
      // processScan kaldt én gang med Claude-materiale
      expect(vi.mocked(processScan)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(processScan).mock.calls[0][1].material).toBe('HDPE');
    });

    it('falder tilbage til runRules når både Gemini og Claude kaster', async () => {
      vi.mocked(providerOrder).mockReturnValue(['gemini', 'claude', 'rules']);
      vi.mocked(getAI).mockReturnValue(geminiThrowing('gemini_boom') as any);
      vi.mocked(getClaude).mockReturnValue({ __marker: 'anthropic' } as any);
      vi.mocked(claudeJSON).mockRejectedValueOnce(new Error('claude_boom'));
      vi.mocked(runRules).mockResolvedValueOnce({
        ...HAPPY_AI_PAYLOAD,
        productName: 'Rules-vare',
        materialType: 'PET',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: testUser.firebase_uid,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.productName).toBe('Rules-vare');
      expect(res.body.data.materialType).toBe('PET');
      expect(vi.mocked(runRules)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(processScan)).toHaveBeenCalledTimes(1);
    });

    it('bruger indbygget mock når alle providers fejler og Roboflow ikke er sat op', async () => {
      vi.mocked(providerOrder).mockReturnValue(['gemini', 'claude', 'rules']);
      vi.mocked(getAI).mockReturnValue(geminiThrowing('down') as any);
      vi.mocked(getClaude).mockReturnValue({ __marker: 'anthropic' } as any);
      vi.mocked(claudeJSON).mockRejectedValueOnce(new Error('down'));
      vi.mocked(runRules).mockResolvedValueOnce(null);
      // Ingen ROBOFLOW_API_KEY sat → falder til mock

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: testUser.firebase_uid,
          municipality: 'Aarhus Kommune',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Handler'ens indbyggede offline-mock
      expect(res.body.data.materialType).toBe('Polypropylen PP5');
      expect(res.body.data.pantValue).toBe('0.35');
      expect(res.body.data.manufacturer).toBe('Arla Foods, Viby');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8) Bad AI-payload (parseNumeric returnerer null)
  // ───────────────────────────────────────────────────────────────────────────
  describe('bad AI-payload', () => {
    it('returnerer success + data uden saved når AI leverer ufuldstændigt svar', async () => {
      // AI returnerer JSON uden pantValue/co2Saved/packagingWeight
      vi.mocked(getAI).mockReturnValue(
        geminiReturning({
          productName: 'Ukendt vare',
          materialShort: 'Ukendt',
          grade: 'D',
          // ← alle numeriske felter mangler
        }) as any
      );

      const app = buildApp();
      const res = await request(app)
        .post('/api/scan')
        .send({
          image: 'data:image/jpeg;base64,ABC',
          firebaseUid: testUser.firebase_uid,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.productName).toBe('Arla® Skyr Naturel 450g');
      // processScan må ikke røres når parseNumeric returnerer null
      expect(vi.mocked(processScan)).not.toHaveBeenCalled();
      expect(res.body.saved).toBeUndefined();
    });
  });
});
