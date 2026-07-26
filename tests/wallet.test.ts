// cirkel-system/tests/wallet.test.ts
//
// Vitest-suite for JUDGE-02 Wallet-endpoints:
//   * GET  /api/wallet/balance         (api/wallet/balance.ts)
//   * POST /api/wallet/request-payout  (api/wallet/request-payout.ts)
//
// Fokus (jvf. Superflow-ordre):
//   A) Balance query    — happy, empty, formattering, fallback, method-guard,
//                          auth-guard, DB-error.
//   B) Payout request   — happy-path (pulje sovereign → 200 + reference).
//   C) Pool-guard       — divert (DIVERT_TO_BRAND_VOUCHERS → 200 status="diverted")
//                          + block (BLOCK_INSUFFICIENT → 402).
//
// Alle eksterne motorer er isoleret:
//   * @supabase/supabase-js       — mocket lokalt her (vi.hoisted), styret
//                                    pr. tabel via `tableResults` og pr. RPC
//                                    via `rpcResults` maps.
//   * ../api/_verify-firebase-token — resolveTrustedUid mocket (F3.8).
//   * ../api/_pool-guard             — evaluatePoolSovereignty mocket (Modul 1.3).
//
// Ingen live network-calls. Ingen Date.now() uden mock — vitest fake-timers
// er sat til 2026-07-22T10:00:00.000Z før hver test.
//
// ─── KENDT ISSUE (2026-07-24) ───────────────────────────────────────────────
// Fallback-test "bruger session.sub_hash som producerId når trusted_uid er null"
// afhænger af request-payout.ts's præcise håndtering af verified=false. Hvis
// endpoint blocker på verified=false før fallback-stien, vil testen fejle med
// 401 i stedet for 200. Mock er sat til verified:true + trusted_uid:'' for at
// isolere fallback-logikken på tom-uid-branchen. Hvis endpoint kræver
// non-empty trusted_uid når verified=true (type-invariant), skal endpoint's
// fallback-logik justeres — det ligger uden for denne test-fils scope.

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

// ─── PoolGuardInputError uden for factory (stabil class-identitet) ──────────
// Defineres FØR vi.mock så samme reference bruges på tværs af re-imports.
class PoolGuardInputError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'PoolGuardInputError';
  }
}

// ─── Hoisted mocks (delte instanser mellem test-fil og vi.mock-factory) ──────
const mocks = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

// Unmock først for at nulstille setup.ts's globale supabase-mock, så
// test-filens vi.mock nedenfor vinder deterministisk over setup-hoisting.
vi.unmock('@supabase/supabase-js');

// Override setup.ts's supabase-stub så vi kan styre resultater pr. tabel/RPC.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mocks.fromMock,
    rpc: mocks.rpcMock,
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    storage: { from: vi.fn() },
  })),
}));

vi.mock('../api/_verify-firebase-token.js', () => ({
  resolveTrustedUid: vi.fn(),
}));

vi.mock('../api/_pool-guard.js', () => ({
  evaluatePoolSovereignty: vi.fn(),
  MINIMUM_SAFE_BUFFER_PCT: 0.15,
  SAFETY_BUFFER_CEILING: 1500.0,
  PoolGuardInputError,
}));

// ─── Imports (efter vi.mock; hoisting sikrer at handlers også får mocks) ────
import balanceHandler from '../api/wallet/balance.js';
import payoutHandler from '../api/wallet/request-payout.js';
import { issueSession } from '../src/lib/session.js';
import { resolveTrustedUid } from '../api/_verify-firebase-token.js';
import { evaluatePoolSovereignty } from '../api/_pool-guard.js';
import { testUser } from './setup.js';

// ─── Konstanter (deterministiske fixtures) ──────────────────────────────────
const SESSION_SECRET = 'a'.repeat(64);                 // ≥32 tegn krav
const SUB_HASH = 'ab'.repeat(32);                      // 64 hex chars
const HASH_BYTEA = `\\x${SUB_HASH}`;                   // som endpoint bygger
const FIREBASE_UID = testUser.firebase_uid;
const FIXED_NOW = new Date('2026-07-22T10:00:00.000Z');

// ─── Query-builder til per-tabel resultat-styring ──────────────────────────
type Result = { data: any; error: any };

class QB {
  private readonly _result: Result;
  constructor(result: Result) {
    this._result = result;
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
  gt(): this { return this; }
  gte(): this { return this; }
  lt(): this { return this; }
  lte(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  single(): Promise<Result> { return Promise.resolve(this._result); }
  maybeSingle(): Promise<Result> { return Promise.resolve(this._result); }
  // Gør QB awaitable direkte (fx `await supabase.from('x').insert({...})`)
  then<TResolve = Result, TReject = never>(
    onFulfilled?: ((v: Result) => TResolve | PromiseLike<TResolve>) | null,
    onRejected?: ((r: unknown) => TReject | PromiseLike<TReject>) | null,
  ): Promise<TResolve | TReject> {
    return Promise.resolve(this._result).then(
      onFulfilled ?? undefined,
      onRejected ?? undefined,
    );
  }
}

const tableResults = new Map<string, Result>();
const rpcResults = new Map<string, Result>();

// ─── Test-app wrappere (supertest → express → handler) ──────────────────────
function buildBalanceApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/wallet/balance', (req, res) =>
    balanceHandler(req as any, res as any),
  );
  return app;
}

function buildPayoutApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/wallet/request-payout', (req, res) =>
    payoutHandler(req as any, res as any),
  );
  return app;
}

function cookieFor(subHash: string = SUB_HASH): string {
  const token = issueSession(subHash, 'mitid');
  return `cirkel_session=${token}`;
}

// ─── Global lifecycle ──────────────────────────────────────────────────────
beforeEach(() => {
  // Fake KUN Date + interval-timere. Behold real setImmediate/nextTick så
  // supertest+express's async I/O ikke hænger på ventende microtasks.
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  });
  vi.setSystemTime(FIXED_NOW);

  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  delete process.env.USE_CONFIDENTIAL_PAYOUT;

  tableResults.clear();
  rpcResults.clear();

  mocks.fromMock.mockReset();
  mocks.rpcMock.mockReset();

  // Reset også implementations på hoisted vi.mock'ede funktioner så en
  // tidligere test's mockResolvedValueOnce ikke lækker ind i næste beforeEach.
  vi.mocked(resolveTrustedUid).mockReset();
  vi.mocked(evaluatePoolSovereignty).mockReset();

  mocks.fromMock.mockImplementation((table: string) => {
    const result = tableResults.get(table) ?? { data: null, error: null };
    return new QB(result);
  });
  mocks.rpcMock.mockImplementation(async (fn: string) => {
    return rpcResults.get(fn) ?? { data: null, error: null };
  });

  // Default: F3.8 verify OK, trusted_uid matcher body-UID.
  vi.mocked(resolveTrustedUid).mockResolvedValue({
    trusted_uid: FIREBASE_UID,
    verified: true,
    spoofed: false,
    reason: 'F3.8: token verified + uid match',
  });

  // Default: pulje sovereign — EXECUTE_MOBILEPAY_CASH.
  vi.mocked(evaluatePoolSovereignty).mockReturnValue({
    action: 'EXECUTE_MOBILEPAY_CASH',
    warning: false,
    reason:
      'Pool sovereign — remaining 500.00 DKK, payout 100.00 DKK cleared for MobilePay cash payout.',
    producerId: FIREBASE_UID,
    remainingFundsDkk: 500,
    requestedPayoutDkk: 100,
    safetyBufferCeilingDkk: 1500,
    minimumSafeBufferPct: 0.15,
    evaluatedAt: FIXED_NOW.toISOString(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ============================================================================
// A) GET /api/wallet/balance
// ============================================================================

describe('GET /api/wallet/balance', () => {
  // ─────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser POST med 405 method_not_allowed', async () => {
      const app = buildBalanceApp();
      const res = await request(app)
        .post('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'method_not_allowed' });
      // Ingen supabase-kald må ske
      expect(mocks.fromMock).not.toHaveBeenCalled();
    });

    it('afviser PUT med 405 method_not_allowed', async () => {
      const app = buildBalanceApp();
      const res = await request(app)
        .put('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'method_not_allowed' });
    });

    it('afviser DELETE med 405 method_not_allowed', async () => {
      const app = buildBalanceApp();
      const res = await request(app).delete('/api/wallet/balance');
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'method_not_allowed' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('auth-guard', () => {
    it('returnerer 401 not_authenticated når cookie mangler', async () => {
      const app = buildBalanceApp();
      const res = await request(app).get('/api/wallet/balance');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'not_authenticated' });
      expect(mocks.fromMock).not.toHaveBeenCalled();
    });

    it('returnerer 401 når session-token er syntaktisk gyldig men signatur er forkert', async () => {
      // Byg et token med FORKERT SESSION_SECRET så signatur fejler mod det rigtige.
      process.env.SESSION_SECRET = 'z'.repeat(64);
      const forgedToken = issueSession(SUB_HASH, 'mitid');
      // Genindsæt det rigtige secret så verify fejler på signatur-check.
      process.env.SESSION_SECRET = SESSION_SECRET;

      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', `cirkel_session=${forgedToken}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'not_authenticated' });
    });

    it('returnerer 401 for token med færre end 3 dele', async () => {
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', 'cirkel_session=not.a.valid.jwt.token');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'not_authenticated' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('supabase config fallback', () => {
    it('returnerer 200 fallback_no_config med alle-nul balance når SUPABASE_URL mangler', async () => {
      delete process.env.SUPABASE_URL;
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        balance_ore: 0,
        balance_dkk: '0,00 DKK',
        pending_payout_ore: 0,
        lifetime_paid_ore: 0,
        source: 'fallback_no_config',
      });
      // Ingen from()-kald når klient ikke kunne bygges
      expect(mocks.fromMock).not.toHaveBeenCalled();
    });

    it('returnerer 200 fallback_no_config når SUPABASE_SERVICE_ROLE_KEY mangler', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('fallback_no_config');
      expect(res.body.balance_ore).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('happy-path (live source)', () => {
    it('returnerer 200 med præcise felter fra citizen_balance-view', async () => {
      tableResults.set('citizen_balance', {
        data: {
          balance_ore: 12345,
          pending_payout_ore: 2000,
          lifetime_paid_ore: 50000,
          confirmed_reward_count: 7,
          latest_reward_at: '2026-07-21T10:00:00.000Z',
        },
        error: null,
      });

      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        balance_ore: 12345,
        balance_dkk: '123,45 DKK',
        pending_payout_ore: 2000,
        lifetime_paid_ore: 50000,
        confirmed_reward_count: 7,
        latest_reward_at: '2026-07-21T10:00:00.000Z',
        source: 'live',
      });

      // Præcis ét from('citizen_balance')-kald
      expect(mocks.fromMock).toHaveBeenCalledTimes(1);
      expect(mocks.fromMock).toHaveBeenCalledWith('citizen_balance');
    });

    it('coercer numeriske string-værdier fra Postgres (NUMERIC-cast fra view) til Number', async () => {
      // Postgres returnerer ofte NUMERIC som streng — endpoint gør Number(...) på alle felter.
      tableResults.set('citizen_balance', {
        data: {
          balance_ore: '9900',
          pending_payout_ore: '100',
          lifetime_paid_ore: '25000',
          confirmed_reward_count: '3',
          latest_reward_at: '2026-07-20T09:00:00.000Z',
        },
        error: null,
      });

      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());

      expect(res.status).toBe(200);
      expect(res.body.balance_ore).toBe(9900);
      expect(res.body.pending_payout_ore).toBe(100);
      expect(res.body.lifetime_paid_ore).toBe(25000);
      expect(res.body.confirmed_reward_count).toBe(3);
      expect(res.body.balance_dkk).toBe('99,00 DKK');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('øre → DKK formattering', () => {
    it('formatterer 42 øre som "0,42 DKK"', async () => {
      tableResults.set('citizen_balance', {
        data: {
          balance_ore: 42,
          pending_payout_ore: 0,
          lifetime_paid_ore: 0,
          confirmed_reward_count: 0,
          latest_reward_at: null,
        },
        error: null,
      });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(200);
      expect(res.body.balance_ore).toBe(42);
      expect(res.body.balance_dkk).toBe('0,42 DKK');
    });

    it('formatterer 10000 øre (præcis 100 kr) som "100,00 DKK"', async () => {
      tableResults.set('citizen_balance', {
        data: {
          balance_ore: 10000,
          pending_payout_ore: 0,
          lifetime_paid_ore: 0,
          confirmed_reward_count: 0,
          latest_reward_at: null,
        },
        error: null,
      });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.body.balance_dkk).toBe('100,00 DKK');
    });

    it('formatterer 5 øre som "0,05 DKK" (padStart-guard)', async () => {
      tableResults.set('citizen_balance', {
        data: {
          balance_ore: 5,
          pending_payout_ore: 0,
          lifetime_paid_ore: 0,
          confirmed_reward_count: 0,
          latest_reward_at: null,
        },
        error: null,
      });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.body.balance_dkk).toBe('0,05 DKK');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('empty + edge', () => {
    it('returnerer 200 source="empty" med alle-nul når borgeren ikke har row', async () => {
      tableResults.set('citizen_balance', { data: null, error: null });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        balance_ore: 0,
        balance_dkk: '0,00 DKK',
        pending_payout_ore: 0,
        lifetime_paid_ore: 0,
        confirmed_reward_count: 0,
        latest_reward_at: null,
        source: 'empty',
      });
    });

    it('coercer null-felter til 0 og latest_reward_at forbliver null', async () => {
      tableResults.set('citizen_balance', {
        data: {
          balance_ore: null,
          pending_payout_ore: null,
          lifetime_paid_ore: null,
          confirmed_reward_count: null,
          latest_reward_at: null,
        },
        error: null,
      });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(200);
      expect(res.body.balance_ore).toBe(0);
      expect(res.body.pending_payout_ore).toBe(0);
      expect(res.body.lifetime_paid_ore).toBe(0);
      expect(res.body.confirmed_reward_count).toBe(0);
      expect(res.body.latest_reward_at).toBeNull();
      expect(res.body.source).toBe('live'); // data !== null → live
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('DB-error', () => {
    it('returnerer 500 db_error når supabase svarer med error', async () => {
      tableResults.set('citizen_balance', {
        data: null,
        error: { message: 'connection lost' },
      });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'db_error' });
    });

    it('returnerer 500 internal_error når supabase-kald kaster', async () => {
      // Overskriv fromMock til at kaste ved from('citizen_balance').
      mocks.fromMock.mockImplementationOnce(() => {
        throw new Error('boom-from-throws');
      });
      const app = buildBalanceApp();
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Cookie', cookieFor());
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'internal_error' });
    });
  });
});

// ============================================================================
// B) POST /api/wallet/request-payout
// ============================================================================

describe('POST /api/wallet/request-payout', () => {
  // ─── Helpers til at seede en fuld happy-path pipeline ───────────────────
  const seedRateLimitOk = () =>
    rpcResults.set('can_request_payout', { data: true, error: null });

  const seedBalance = (ore: number) =>
    tableResults.set('citizen_balance', {
      data: { balance_ore: ore },
      error: null,
    });

  const seedRewards = (rewards: Array<{ id: string; amount_ore: number }>) =>
    tableResults.set('citizen_rewards', { data: rewards, error: null });

  const seedPayoutInsert = (row: {
    id: string;
    reference: string;
    requested_at: string;
  }) =>
    tableResults.set('payout_requests', { data: row, error: null });

  const seedGovernanceInsert = () =>
    tableResults.set('governance_transactions', {
      data: null,
      error: null,
    });

  // ─────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser GET med 405 method_not_allowed', async () => {
      const app = buildPayoutApp();
      const res = await request(app).get('/api/wallet/request-payout');
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'method_not_allowed' });
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(evaluatePoolSovereignty)).not.toHaveBeenCalled();
    });

    it('afviser PUT med 405 method_not_allowed', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .put('/api/wallet/request-payout')
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(405);
      expect(res.body).toEqual({ error: 'method_not_allowed' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('auth-guard', () => {
    it('returnerer 401 not_authenticated når cookie mangler', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'not_authenticated' });
      // Ingen sikkerhedslag under session-guard må røres
      expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
      expect(vi.mocked(evaluatePoolSovereignty)).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('F3.8 firebase verify', () => {
    it('returnerer 403 uid_spoof_detected når resolveTrustedUid rapporterer spoof', async () => {
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: 'attacker-uid',
        verified: true,
        spoofed: true,
        reason:
          'UID_SPOOF_DETECTED: token.uid="attacker-uid" != body.firebaseUid="victim"',
      });

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: 'victim' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'uid_spoof_detected',
        reason:
          'UID_SPOOF_DETECTED: token.uid="attacker-uid" != body.firebaseUid="victim"',
      });
      // Pool guard MÅ ALDRIG evalueres efter spoof-block
      expect(vi.mocked(evaluatePoolSovereignty)).not.toHaveBeenCalled();
      // Ingen payout-relaterede tabeller må røres
      const tables = mocks.fromMock.mock.calls.map((c) => c[0]);
      expect(tables).not.toContain('payout_requests');
    });

    it('propagerer status og reason når resolveTrustedUid kaster med err.status', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        const err: any = new Error('token expired');
        err.status = 401;
        err.reason = 'firebase_token_expired';
        throw err;
      });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'unauthorized',
        reason: 'firebase_token_expired',
      });
    });

    it('defaulter til 401 med err.message når resolveTrustedUid kaster uden status', async () => {
      vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
        throw new Error('generic-verify-boom');
      });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'unauthorized',
        reason: 'generic-verify-boom',
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('input-validering', () => {
    it('returnerer 400 invalid_amount når amount_ore < 100 (min)', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 50, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'invalid_amount',
        message: 'amount_ore skal være heltal i [100, 50000]',
      });
    });

    it('returnerer 400 invalid_amount når amount_ore > 50000 (max)', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 60000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_amount');
    });

    it('returnerer 400 invalid_amount for ikke-heltals amount_ore', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 500.5, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_amount');
    });

    it('returnerer 400 invalid_amount for NaN amount_ore', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 'ikke-et-tal', method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_amount');
    });

    it('returnerer 400 invalid_method for ukendt method-værdi', async () => {
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'bitcoin', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_method' });
    });

    // Split ud i 3 separate it()-blokke (én pr. method) så hver kører med
    // frisk seed-state og assertion-intent er entydig pr. method.
    for (const method of ['mobilepay', 'bank_transfer', 'manual'] as const) {
      it(`accepterer method="${method}" som gyldig`, async () => {
        seedRateLimitOk();
        seedBalance(50000);
        seedRewards([
          { id: 'r-a', amount_ore: 5000 },
          { id: 'r-b', amount_ore: 5000 },
        ]);
        seedPayoutInsert({
          id: `payout-${method}`,
          reference: `CIRKEL-P-20260722-${method.toUpperCase().slice(0, 8)}`,
          requested_at: '2026-07-22T10:00:00.000Z',
        });
        seedGovernanceInsert();

        const app = buildPayoutApp();
        const res = await request(app)
          .post('/api/wallet/request-payout')
          .set('Cookie', cookieFor())
          .send({ amount_ore: 10000, method, firebaseUid: FIREBASE_UID });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('supabase-config', () => {
    it('returnerer 503 db_unavailable når SUPABASE_URL mangler', async () => {
      delete process.env.SUPABASE_URL;
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'db_unavailable' });
    });

    it('returnerer 503 db_unavailable når SUPABASE_SERVICE_ROLE_KEY mangler', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'db_unavailable' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('rate-limit (RPC can_request_payout)', () => {
    it('returnerer 429 rate_limited når RPC returnerer false', async () => {
      rpcResults.set('can_request_payout', { data: false, error: null });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        error: 'rate_limited',
        message: 'Max 1 payout-anmodning per 24 timer.',
      });
      // Rate-limit RPC skal være kaldt med hashed hash-bytea for borgeren
      expect(mocks.rpcMock).toHaveBeenCalledWith('can_request_payout', {
        p_hash: HASH_BYTEA,
      });
      // Pool guard må ikke evalueres når rate-limitet
      expect(vi.mocked(evaluatePoolSovereignty)).not.toHaveBeenCalled();
    });

    it('returnerer 500 rate_limit_check_failed når RPC returnerer error', async () => {
      mocks.rpcMock.mockImplementationOnce(async () => ({
        data: null,
        error: { message: 'rpc down' },
      }));
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'rate_limit_check_failed' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('balance-check', () => {
    it('returnerer 400 insufficient_balance når saldo < requested amount', async () => {
      seedRateLimitOk();
      seedBalance(500); // 5,00 DKK
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'insufficient_balance',
        balance_ore: 500,
        requested_ore: 1000,
      });
      // Pool guard må ikke evalueres når balancen ikke rækker
      expect(vi.mocked(evaluatePoolSovereignty)).not.toHaveBeenCalled();
    });

    it('returnerer 500 balance_check_failed når balance-query svarer med error', async () => {
      seedRateLimitOk();
      tableResults.set('citizen_balance', {
        data: null,
        error: { message: 'view unavailable' },
      });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'balance_check_failed' });
    });

    it('coercer null balance_ore til 0 og afviser med insufficient_balance', async () => {
      seedRateLimitOk();
      tableResults.set('citizen_balance', {
        data: { balance_ore: null },
        error: null,
      });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 1000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'insufficient_balance',
        balance_ore: 0,
        requested_ore: 1000,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('happy-path — pulje sovereign → 200 + reference', () => {
    it('opretter payout_request, reserverer rewards (FIFO), og returnerer fuldt response-payload', async () => {
      seedRateLimitOk();
      seedBalance(50000); // 500,00 DKK
      seedRewards([
        { id: 'reward-1', amount_ore: 5000 },
        { id: 'reward-2', amount_ore: 5000 },
        { id: 'reward-3', amount_ore: 5000 }, // ikke reserveret (FIFO stopper ved 10000)
      ]);
      seedPayoutInsert({
        id: 'payout-uuid-1',
        reference: 'CIRKEL-P-20260722-ABCDEF01',
        requested_at: '2026-07-22T10:00:00.000Z',
      });
      seedGovernanceInsert();

      vi.mocked(evaluatePoolSovereignty).mockReturnValue({
        action: 'EXECUTE_MOBILEPAY_CASH',
        warning: false,
        reason:
          'Pool sovereign — remaining 500.00 DKK, payout 100.00 DKK cleared for MobilePay cash payout.',
        producerId: FIREBASE_UID,
        remainingFundsDkk: 500,
        requestedPayoutDkk: 100,
        safetyBufferCeilingDkk: 1500,
        minimumSafeBufferPct: 0.15,
        evaluatedAt: FIXED_NOW.toISOString(),
      });

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({
          amount_ore: 10000, // 100,00 DKK
          method: 'mobilepay',
          firebaseUid: FIREBASE_UID,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        reference: 'CIRKEL-P-20260722-ABCDEF01',
        amount_ore: 10000,
        amount_dkk: '100,00 DKK',
        status: 'pending',
        requested_at: '2026-07-22T10:00:00.000Z',
        estimated_settlement: 'næste hverdag',
        pool_guard: {
          action: 'EXECUTE_MOBILEPAY_CASH',
          reason:
            'Pool sovereign — remaining 500.00 DKK, payout 100.00 DKK cleared for MobilePay cash payout.',
          remaining_funds_dkk: 500,
        },
        message:
          'Din anmodning er modtaget. Du får en notifikation når den er udbetalt.',
      });

      // Pool guard blev evalueret præcist én gang med (producerId, remainingDkk, requestedDkk)
      expect(vi.mocked(evaluatePoolSovereignty)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(evaluatePoolSovereignty)).toHaveBeenCalledWith(
        FIREBASE_UID,
        500,
        100,
      );

      // Rate-limit RPC blev kaldt med korrekt hash
      expect(mocks.rpcMock).toHaveBeenCalledWith('can_request_payout', {
        p_hash: HASH_BYTEA,
      });

      // Alle 4 tabeller blev berørt i korrekt rækkefølge
      const tables = mocks.fromMock.mock.calls.map((c) => c[0]);
      expect(tables).toEqual([
        'citizen_balance',
        'citizen_rewards',
        'payout_requests',
        'governance_transactions',
      ]);
    });

    it('bruger session.sub_hash som producerId når trusted_uid er tomt (fallback)', async () => {
      // Behold verified:true så endpoint ikke blocker på verify-guard, men
      // send tomt trusted_uid så fallback til session.sub_hash aktiveres.
      // Se KENDT ISSUE i toppen af filen.
      vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
        trusted_uid: '', // falsy → falder tilbage til session.sub_hash
        verified: true,
        spoofed: false,
        reason: 'warn_only pass-through (empty uid)',
      });

      seedRateLimitOk();
      seedBalance(50000);
      seedRewards([{ id: 'r-x', amount_ore: 10000 }]);
      seedPayoutInsert({
        id: 'payout-fallback',
        reference: 'CIRKEL-P-20260722-FALLBACK',
        requested_at: '2026-07-22T10:00:00.000Z',
      });
      seedGovernanceInsert();

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // producerId = session.sub_hash (SUB_HASH), remaining = 500, requested = 100
      expect(vi.mocked(evaluatePoolSovereignty)).toHaveBeenCalledWith(
        SUB_HASH,
        500,
        100,
      );
    });

    it('formatterer amount_dkk korrekt for odd øre-rest (12345 → "123,45 DKK")', async () => {
      seedRateLimitOk();
      seedBalance(20000);
      seedRewards([{ id: 'r-odd', amount_ore: 12345 }]);
      seedPayoutInsert({
        id: 'payout-odd',
        reference: 'CIRKEL-P-20260722-ODD00001',
        requested_at: '2026-07-22T10:00:00.000Z',
      });
      seedGovernanceInsert();

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 12345, method: 'mobilepay', firebaseUid: FIREBASE_UID });

      expect(res.status).toBe(200);
      expect(res.body.amount_dkk).toBe('123,45 DKK');
      expect(res.body.amount_ore).toBe(12345);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('pool-guard divert (Modul 1.3 → DIVERT_TO_BRAND_VOUCHERS)', () => {
    it('returnerer 200 status="diverted" med action="brand_vouchers" og præcise guard-felter', async () => {
      seedRateLimitOk();
      seedBalance(50000); // borger har saldo, men pulje er lav

      vi.mocked(evaluatePoolSovereignty).mockReturnValue({
        action: 'DIVERT_TO_BRAND_VOUCHERS',
        warning: true,
        reason:
          'Pool below safety threshold — remaining 500.00 DKK < ceiling 1500.00 DKK. Diverting to brand vouchers to preserve pool sovereignty.',
        producerId: FIREBASE_UID,
        remainingFundsDkk: 500,
        requestedPayoutDkk: 100,
        safetyBufferCeilingDkk: 1500,
        minimumSafeBufferPct: 0.15,
        evaluatedAt: FIXED_NOW.toISOString(),
      });

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'diverted',
        action: 'brand_vouchers',
        reason:
          'Pool below safety threshold — remaining 500.00 DKK < ceiling 1500.00 DKK. Diverting to brand vouchers to preserve pool sovereignty.',
        remaining_funds_dkk: 500,
        requested_payout_dkk: 100,
        evaluated_at: FIXED_NOW.toISOString(),
      });

      // Divert-sti må IKKE oprette payout_request eller governance-audit
      const tables = mocks.fromMock.mock.calls.map((c) => c[0]);
      expect(tables).toContain('citizen_balance');
      expect(tables).not.toContain('payout_requests');
      expect(tables).not.toContain('governance_transactions');
      expect(tables).not.toContain('citizen_rewards');

      // Pool guard blev evalueret præcist én gang
      expect(vi.mocked(evaluatePoolSovereignty)).toHaveBeenCalledTimes(1);
    });

    it('returnerer 402 insufficient_pool_funds ved BLOCK_INSUFFICIENT beslutning', async () => {
      seedRateLimitOk();
      seedBalance(50000);

      vi.mocked(evaluatePoolSovereignty).mockReturnValue({
        action: 'BLOCK_INSUFFICIENT',
        warning: true,
        reason: 'Requested payout 100.00 DKK exceeds remaining pool 50.00 DKK.',
        producerId: FIREBASE_UID,
        remainingFundsDkk: 50,
        requestedPayoutDkk: 100,
        safetyBufferCeilingDkk: 1500,
        minimumSafeBufferPct: 0.15,
        evaluatedAt: FIXED_NOW.toISOString(),
      });

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });

      expect(res.status).toBe(402);
      expect(res.body).toEqual({
        error: 'insufficient_pool_funds',
        action: 'blocked',
        reason: 'Requested payout 100.00 DKK exceeds remaining pool 50.00 DKK.',
        remaining_funds_dkk: 50,
        requested_payout_dkk: 100,
        evaluated_at: FIXED_NOW.toISOString(),
      });

      // Block-sti må IKKE oprette payout_request
      const tables = mocks.fromMock.mock.calls.map((c) => c[0]);
      expect(tables).not.toContain('payout_requests');
      expect(tables).not.toContain('governance_transactions');
    });

    it('returnerer 500 pool_guard_failed når evaluatePoolSovereignty kaster', async () => {
      seedRateLimitOk();
      seedBalance(50000);
      vi.mocked(evaluatePoolSovereignty).mockImplementationOnce(() => {
        throw new Error('guard evaluation crashed');
      });

      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'pool_guard_failed' });

      // Ingen payout_request må oprettes efter guard-crash
      const tables = mocks.fromMock.mock.calls.map((c) => c[0]);
      expect(tables).not.toContain('payout_requests');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('post-guard fejlstier (rewards + insert)', () => {
    it('returnerer 500 rewards_query_failed når citizen_rewards-query svarer med error', async () => {
      seedRateLimitOk();
      seedBalance(50000);
      tableResults.set('citizen_rewards', {
        data: null,
        error: { message: 'rewards view down' },
      });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'rewards_query_failed' });
    });

    it('returnerer 500 reservation_shortfall når rewards ikke kan dække amount_ore', async () => {
      seedRateLimitOk();
      seedBalance(50000);
      // Kun 3000 øre confirmed — men request er 10000
      seedRewards([{ id: 'small-reward', amount_ore: 3000 }]);
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'reservation_shortfall',
        accumulated: 3000,
        requested: 10000,
      });
    });

    it('returnerer 500 insert_failed når payout_requests-insert svarer med error', async () => {
      seedRateLimitOk();
      seedBalance(50000);
      seedRewards([{ id: 'r-1', amount_ore: 10000 }]);
      tableResults.set('payout_requests', {
        data: null,
        error: { message: 'unique constraint violation' },
      });
      const app = buildPayoutApp();
      const res = await request(app)
        .post('/api/wallet/request-payout')
        .set('Cookie', cookieFor())
        .send({ amount_ore: 10000, method: 'mobilepay', firebaseUid: FIREBASE_UID });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'insert_failed' });
    });
  });
});
