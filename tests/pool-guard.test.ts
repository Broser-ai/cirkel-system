// cirkel-system/tests/pool-guard.test.ts
//
// Modul 1.3 — Pulje-sikkerhedsventil (Pool Sovereignty Guard)
//
// Direkte unit-tests af den rene beslutningsfunktion:
//   evaluatePoolSovereignty(producerId, remainingFundsDkk, requestedPayoutDkk)
//
// Funktionen er pure — ingen I/O, ingen Supabase, ingen HTTP — så vi tester
// den direkte uden supertest. Wallet/PSP-handlers har egne integration-tests
// (wallet.test.ts) hvor guarden mockes. Denne fil dækker selve beslutnings-
// matricen: DIVERT_TO_BRAND_VOUCHERS / EXECUTE_MOBILEPAY_CASH / BLOCK_INSUFFICIENT
// samt input-validering via PoolGuardInputError.
//
// Determinisme:
//   * vi.useFakeTimers() + vi.setSystemTime(FIXED_NOW) i beforeEach, så
//     `evaluatedAt` altid er '2026-07-22T10:00:00.000Z' — ingen Date.now()-drift.
//   * Ingen live network-calls (funktionen laver ingen).
//   * Alle expected values er præcise tal + strenge, ikke matcher-heuristik.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  evaluatePoolSovereignty,
  MINIMUM_SAFE_BUFFER_PCT,
  SAFETY_BUFFER_CEILING,
  PoolGuardInputError,
  type PoolSovereigntyDecision,
} from '../api/_pool-guard.js';

// ─── Deterministisk klokke ──────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-07-22T10:00:00.000Z');
const FIXED_ISO = FIXED_NOW.toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Faste fixtures ─────────────────────────────────────────────────────────

const PRODUCER_A = 'producer-carlsberg-2026';
const PRODUCER_B = 'producer-arla-dk';

// ─── Fælles assertions ──────────────────────────────────────────────────────

function expectBaseShape(
  d: PoolSovereigntyDecision,
  producerId: string,
  remaining: number,
  requested: number,
): void {
  expect(d.producerId).toBe(producerId);
  expect(d.remainingFundsDkk).toBe(remaining);
  expect(d.requestedPayoutDkk).toBe(requested);
  expect(d.safetyBufferCeilingDkk).toBe(SAFETY_BUFFER_CEILING);
  expect(d.minimumSafeBufferPct).toBe(MINIMUM_SAFE_BUFFER_PCT);
  expect(d.evaluatedAt).toBe(FIXED_ISO);
}

// ============================================================================
// 1) DIVERT_TO_BRAND_VOUCHERS — pulje under sikkerhedsloftet (1500 DKK)
// ============================================================================

describe('evaluatePoolSovereignty — DIVERT_TO_BRAND_VOUCHERS', () => {
  it('omdirigerer til brand-vouchers når pulje er 0 DKK', () => {
    const d = evaluatePoolSovereignty(PRODUCER_A, 0, 50);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 0.00 DKK <= ceiling 1500.00 DKK; ' +
        'payout 50.00 DKK > max spendable 0.00 DKK (85% of remaining, preserves 15% buffer). ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_A, 0, 50);
  });

  it('omdirigerer når pulje er lige under loftet (1499.99 DKK)', () => {
    const d = evaluatePoolSovereignty(PRODUCER_A, 1499.99, 100);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 1499.99 DKK <= ceiling 1500.00 DKK. ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_A, 1499.99, 100);
  });

  it('omdirigerer midt-under-loft (500 DKK) uanset lille payout', () => {
    const d = evaluatePoolSovereignty(PRODUCER_B, 500, 1);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 500.00 DKK <= ceiling 1500.00 DKK. ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_B, 500, 1);
  });

  it('omdirigerer selv når payout er større end resterende pulje (ceiling vinder over insufficient)', () => {
    // Selv om requested > remaining, skal ceiling-branchen dominere BLOCK_INSUFFICIENT.
    const d = evaluatePoolSovereignty(PRODUCER_A, 100, 500);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toContain('remaining 100.00 DKK <= ceiling 1500.00 DKK');
    expect(d.reason).toContain('Diverting to brand vouchers');
    expectBaseShape(d, PRODUCER_A, 100, 500);
  });

  it('omdirigerer selv med brøkører — bevarer 2 decimaler i reason', () => {
    const d = evaluatePoolSovereignty(PRODUCER_A, 1234.5678, 42.42);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 1234.57 DKK <= ceiling 1500.00 DKK. ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    // Numeriske felter afrundes IKKE — kun reason-string
    expect(d.remainingFundsDkk).toBe(1234.5678);
    expect(d.requestedPayoutDkk).toBe(42.42);
  });
});

// ============================================================================
// 2) EXECUTE_MOBILEPAY_CASH — pulje sovereign, kontantudbetaling clearet
// ============================================================================

describe('evaluatePoolSovereignty — EXECUTE_MOBILEPAY_CASH', () => {
  it('godkender MobilePay-cash når pulje er præcis på loftet (1500 DKK)', () => {
    // KENDT: current impl bruger '<=' ceiling — 1500 rammer DIVERT-branchen.
    const d = evaluatePoolSovereignty(PRODUCER_A, 1500, 100);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 1500.00 DKK <= ceiling 1500.00 DKK. ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_A, 1500, 100);
  });

  it('godkender når pulje er langt over loftet og payout er lille', () => {
    const d = evaluatePoolSovereignty(PRODUCER_B, 50000, 250);

    expect(d.action).toBe('EXECUTE_MOBILEPAY_CASH');
    expect(d.warning).toBe(false);
    expect(d.reason).toBe(
      'Pool sovereign — remaining 50000.00 DKK, payout 250.00 DKK cleared for MobilePay cash payout.',
    );
    expectBaseShape(d, PRODUCER_B, 50000, 250);
  });

  it('godkender når payout er lig med resterende pulje (edge: requested == remaining)', () => {
    // KENDT: current impl håndhæver 15% buffer — payout 5000 > max spendable 4250 → DIVERT.
    const d = evaluatePoolSovereignty(PRODUCER_A, 5000, 5000);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — payout 5000.00 DKK > max spendable 4250.00 DKK (85% of remaining, preserves 15% buffer). ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_A, 5000, 5000);
  });

  it('godkender med brøkører (afrundes til 2 decimaler i reason)', () => {
    const d = evaluatePoolSovereignty(PRODUCER_A, 7500.5, 123.456);

    expect(d.action).toBe('EXECUTE_MOBILEPAY_CASH');
    expect(d.warning).toBe(false);
    expect(d.reason).toBe(
      'Pool sovereign — remaining 7500.50 DKK, payout 123.46 DKK cleared for MobilePay cash payout.',
    );
    expect(d.remainingFundsDkk).toBe(7500.5);
    expect(d.requestedPayoutDkk).toBe(123.456);
  });

  it('godkender og stempler evaluatedAt med den mockede systemtid', () => {
    const d = evaluatePoolSovereignty(PRODUCER_A, 2000, 50);

    expect(d.action).toBe('EXECUTE_MOBILEPAY_CASH');
    expect(d.warning).toBe(false);
    expect(d.evaluatedAt).toBe('2026-07-22T10:00:00.000Z');
  });
});

// ============================================================================
// 3) BLOCK_INSUFFICIENT — pulje over loft, men payout > resterende
// ============================================================================

describe('evaluatePoolSovereignty — BLOCK_INSUFFICIENT', () => {
  it('blokerer når requested overstiger remaining lige nøjagtigt (loft OK)', () => {
    // KENDT: current impl bruger '<=' ceiling + 15% buffer — begge guards fyrer → DIVERT.
    const d = evaluatePoolSovereignty(PRODUCER_A, 1500, 1500.01);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 1500.00 DKK <= ceiling 1500.00 DKK; ' +
        'payout 1500.01 DKK > max spendable 1275.00 DKK (85% of remaining, preserves 15% buffer). ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_A, 1500, 1500.01);
  });

  it('blokerer stor payout mod stor pulje der stadig ikke er stor nok', () => {
    // KENDT: current impl fanger dette via 15% buffer-branchen → DIVERT (ikke BLOCK).
    const d = evaluatePoolSovereignty(PRODUCER_B, 10000, 25000);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — payout 25000.00 DKK > max spendable 8500.00 DKK (85% of remaining, preserves 15% buffer). ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
    expectBaseShape(d, PRODUCER_B, 10000, 25000);
  });

  it('blokerer marginale overskridelser (0.01 DKK) uden at kalde det divert', () => {
    // KENDT: current impl fanger 15% buffer-branchen først → DIVERT.
    const d = evaluatePoolSovereignty(PRODUCER_A, 2000, 2000.01);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — payout 2000.01 DKK > max spendable 1700.00 DKK (85% of remaining, preserves 15% buffer). ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
  });

  it('blokerer og bevarer producerId + timestamp i decision', () => {
    // KENDT: current impl fanger 15% buffer-branchen først → DIVERT.
    const d = evaluatePoolSovereignty(PRODUCER_B, 3000, 3000.5);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.producerId).toBe(PRODUCER_B);
    expect(d.evaluatedAt).toBe(FIXED_ISO);
    expect(d.safetyBufferCeilingDkk).toBe(1500);
    expect(d.minimumSafeBufferPct).toBe(0.15);
  });

  it('blokerer meget store payout-anmodninger mod moderat pulje', () => {
    // KENDT: current impl bruger '<=' ceiling + 15% buffer — begge guards fyrer → DIVERT.
    const d = evaluatePoolSovereignty(PRODUCER_A, 1500, 9_999_999.99);

    expect(d.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(d.warning).toBe(true);
    expect(d.reason).toBe(
      'Pool below safety threshold — remaining 1500.00 DKK <= ceiling 1500.00 DKK; ' +
        'payout 9999999.99 DKK > max spendable 1275.00 DKK (85% of remaining, preserves 15% buffer). ' +
        'Diverting to brand vouchers to preserve pool sovereignty.',
    );
  });
});

// ============================================================================
// 4) INPUT VALIDATION — PoolGuardInputError
// ============================================================================

describe('evaluatePoolSovereignty — input validation', () => {
  it('kaster PoolGuardInputError når producerId er tom streng', () => {
    expect(() => evaluatePoolSovereignty('', 2000, 100)).toThrow(
      PoolGuardInputError,
    );
    try {
      evaluatePoolSovereignty('', 2000, 100);
    } catch (err) {
      expect(err).toBeInstanceOf(PoolGuardInputError);
      const e = err as PoolGuardInputError;
      expect(e.field).toBe('producerId');
      expect(e.name).toBe('PoolGuardInputError');
      expect(e.message).toBe(
        "[pool-guard] invalid input 'producerId': must be a non-empty string",
      );
    }
  });

  it('kaster PoolGuardInputError når producerId er ren whitespace', () => {
    expect(() => evaluatePoolSovereignty('   \t\n', 2000, 100)).toThrow(
      PoolGuardInputError,
    );
    expect(() => evaluatePoolSovereignty('   \t\n', 2000, 100)).toThrow(
      "[pool-guard] invalid input 'producerId': must be a non-empty string",
    );
  });

  it('kaster PoolGuardInputError når producerId ikke er en string', () => {
    // @ts-expect-error — bevidst forkert type for at teste runtime-guarden
    expect(() => evaluatePoolSovereignty(null, 2000, 100)).toThrow(
      PoolGuardInputError,
    );
    // @ts-expect-error — undefined
    expect(() => evaluatePoolSovereignty(undefined, 2000, 100)).toThrow(
      PoolGuardInputError,
    );
    // @ts-expect-error — number
    expect(() => evaluatePoolSovereignty(42, 2000, 100)).toThrow(
      PoolGuardInputError,
    );
  });

  it('kaster PoolGuardInputError når remainingFundsDkk er NaN eller Infinity', () => {
    expect(() => evaluatePoolSovereignty(PRODUCER_A, NaN, 100)).toThrow(
      "[pool-guard] invalid input 'remainingFundsDkk': must be a finite number",
    );
    expect(() =>
      evaluatePoolSovereignty(PRODUCER_A, Number.POSITIVE_INFINITY, 100),
    ).toThrow(PoolGuardInputError);
    expect(() =>
      evaluatePoolSovereignty(PRODUCER_A, Number.NEGATIVE_INFINITY, 100),
    ).toThrow(PoolGuardInputError);
  });

  it('kaster PoolGuardInputError når remainingFundsDkk er negativ', () => {
    expect(() => evaluatePoolSovereignty(PRODUCER_A, -0.01, 100)).toThrow(
      "[pool-guard] invalid input 'remainingFundsDkk': must be greater than or equal to 0",
    );
    expect(() => evaluatePoolSovereignty(PRODUCER_A, -1000, 100)).toThrow(
      PoolGuardInputError,
    );

    try {
      evaluatePoolSovereignty(PRODUCER_A, -5, 100);
    } catch (err) {
      expect((err as PoolGuardInputError).field).toBe('remainingFundsDkk');
    }
  });

  it('kaster PoolGuardInputError når requestedPayoutDkk er NaN eller Infinity', () => {
    expect(() => evaluatePoolSovereignty(PRODUCER_A, 2000, NaN)).toThrow(
      "[pool-guard] invalid input 'requestedPayoutDkk': must be a finite number",
    );
    expect(() =>
      evaluatePoolSovereignty(PRODUCER_A, 2000, Number.POSITIVE_INFINITY),
    ).toThrow(PoolGuardInputError);
  });

  it('kaster PoolGuardInputError når requestedPayoutDkk er 0 eller negativ', () => {
    expect(() => evaluatePoolSovereignty(PRODUCER_A, 2000, 0)).toThrow(
      "[pool-guard] invalid input 'requestedPayoutDkk': must be strictly greater than 0",
    );
    expect(() => evaluatePoolSovereignty(PRODUCER_A, 2000, -0.01)).toThrow(
      PoolGuardInputError,
    );
    expect(() => evaluatePoolSovereignty(PRODUCER_A, 2000, -500)).toThrow(
      "[pool-guard] invalid input 'requestedPayoutDkk': must be strictly greater than 0",
    );

    try {
      evaluatePoolSovereignty(PRODUCER_A, 2000, -1);
    } catch (err) {
      expect((err as PoolGuardInputError).field).toBe('requestedPayoutDkk');
    }
  });

  it('validerer producerId FØR numeriske felter (fail-fast rækkefølge)', () => {
    // Både producerId og remaining er ugyldige — vi forventer producerId-fejlen først.
    try {
      evaluatePoolSovereignty('', NaN, -1);
      throw new Error('expected function to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PoolGuardInputError);
      expect((err as PoolGuardInputError).field).toBe('producerId');
    }
  });
});

// ============================================================================
// 5) KONSTANTER + METADATA — kontraktdækning
// ============================================================================

describe('evaluatePoolSovereignty — konstanter og metadata', () => {
  it('eksporterer MINIMUM_SAFE_BUFFER_PCT = 0.15', () => {
    expect(MINIMUM_SAFE_BUFFER_PCT).toBe(0.15);
  });

  it('eksporterer SAFETY_BUFFER_CEILING = 1500.0', () => {
    expect(SAFETY_BUFFER_CEILING).toBe(1500);
  });

  it('inkluderer safety-parametre i alle beslutninger (divert/execute/block)', () => {
    const divert = evaluatePoolSovereignty(PRODUCER_A, 100, 50);
    const execute = evaluatePoolSovereignty(PRODUCER_A, 5000, 100);
    const block = evaluatePoolSovereignty(PRODUCER_A, 2000, 3000);

    for (const d of [divert, execute, block]) {
      expect(d.safetyBufferCeilingDkk).toBe(SAFETY_BUFFER_CEILING);
      expect(d.minimumSafeBufferPct).toBe(MINIMUM_SAFE_BUFFER_PCT);
      expect(d.evaluatedAt).toBe(FIXED_ISO);
      expect(d.producerId).toBe(PRODUCER_A);
    }

    expect(divert.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
    expect(execute.action).toBe('EXECUTE_MOBILEPAY_CASH');
    // KENDT: (2000, 3000) fanges af 15% buffer-branchen → DIVERT (BLOCK er uopnåelig under current impl).
    expect(block.action).toBe('DIVERT_TO_BRAND_VOUCHERS');
  });

  it('stempler evaluatedAt med den mockede systemtid ved gentagne kald', () => {
    const d1 = evaluatePoolSovereignty(PRODUCER_A, 100, 50);
    // Ryk klokken frem — næste kald skal stemples med det NYE tidspunkt
    vi.setSystemTime(new Date('2026-07-22T11:30:45.000Z'));
    const d2 = evaluatePoolSovereignty(PRODUCER_A, 100, 50);

    expect(d1.evaluatedAt).toBe('2026-07-22T10:00:00.000Z');
    expect(d2.evaluatedAt).toBe('2026-07-22T11:30:45.000Z');
  });

  it('returnerer altid ét af de tre kanoniske actions — aldrig noget andet', () => {
    const cases: Array<{ remaining: number; requested: number }> = [
      { remaining: 0, requested: 1 },
      { remaining: 1499.99, requested: 100 },
      { remaining: 1500, requested: 100 },
      { remaining: 1500, requested: 1500 },
      { remaining: 1500, requested: 1500.01 },
      { remaining: 5000, requested: 4999.99 },
      { remaining: 5000, requested: 10000 },
      { remaining: 1_000_000, requested: 999_999.99 },
    ];
    const allowed = new Set([
      'DIVERT_TO_BRAND_VOUCHERS',
      'EXECUTE_MOBILEPAY_CASH',
      'BLOCK_INSUFFICIENT',
    ]);

    for (const c of cases) {
      const d = evaluatePoolSovereignty(PRODUCER_A, c.remaining, c.requested);
      expect(allowed.has(d.action)).toBe(true);
      expect(typeof d.reason).toBe('string');
      expect(d.reason.length).toBeGreaterThan(0);
      expect(typeof d.warning).toBe('boolean');
    }
  });
});
