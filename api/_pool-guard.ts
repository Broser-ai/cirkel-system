/**
 * Modul 1.3 — Pulje-sikkerhedsventil (Pool Sovereignty Guard)
 *
 * Beskytter producent-puljen mod udbetalinger der ville underminere
 * puljens likviditet. Ved lav pulje-saldo omdirigeres udbetalingen fra
 * MobilePay-kontantudbetaling til brand-vouchers, som holder værdien
 * inde i økosystemet.
 *
 * Sikkerhedsregler:
 *   1. remaining <= SAFETY_BUFFER_CEILING (1500 DKK)
 *        → DIVERT_TO_BRAND_VOUCHERS (pulje under absolut gulv)
 *   2. requestedPayout > remaining * (1 - MINIMUM_SAFE_BUFFER_PCT)
 *        → DIVERT_TO_BRAND_VOUCHERS (udbetaling ville brænde ind i 15% buffer)
 *   3. requestedPayout > remaining
 *        → BLOCK_INSUFFICIENT (utilstrækkelig pulje)
 *   4. ellers
 *        → EXECUTE_MOBILEPAY_CASH
 */

export const MINIMUM_SAFE_BUFFER_PCT = 0.15 as const;
export const SAFETY_BUFFER_CEILING = 1500.0 as const;

export type PoolSovereigntyAction =
  | "EXECUTE_MOBILEPAY_CASH"
  | "DIVERT_TO_BRAND_VOUCHERS"
  | "BLOCK_INSUFFICIENT";

export interface PoolSovereigntyDecision {
  readonly action: PoolSovereigntyAction;
  readonly warning: boolean;
  readonly reason: string;
  readonly producerId: string;
  readonly remainingFundsDkk: number;
  readonly requestedPayoutDkk: number;
  readonly safetyBufferCeilingDkk: number;
  readonly minimumSafeBufferPct: number;
  readonly evaluatedAt: string;
}

export class PoolGuardInputError extends Error {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(`[pool-guard] invalid input '${field}': ${message}`);
    this.name = "PoolGuardInputError";
    this.field = field;
  }
}

/**
 * Evaluerer om en producent-udbetaling må gennemføres som
 * MobilePay-kontantudbetaling, skal omdirigeres til brand-vouchers,
 * eller helt blokeres pga. utilstrækkelig pulje.
 */
export function evaluatePoolSovereignty(
  producerId: string,
  remainingFundsDkk: number,
  requestedPayoutDkk: number,
): PoolSovereigntyDecision {
  if (typeof producerId !== "string" || producerId.trim().length === 0) {
    throw new PoolGuardInputError("producerId", "must be a non-empty string");
  }
  if (!Number.isFinite(remainingFundsDkk)) {
    throw new PoolGuardInputError(
      "remainingFundsDkk",
      "must be a finite number",
    );
  }
  if (!Number.isFinite(requestedPayoutDkk)) {
    throw new PoolGuardInputError(
      "requestedPayoutDkk",
      "must be a finite number",
    );
  }
  if (remainingFundsDkk < 0) {
    throw new PoolGuardInputError(
      "remainingFundsDkk",
      "must be greater than or equal to 0",
    );
  }
  if (requestedPayoutDkk <= 0) {
    throw new PoolGuardInputError(
      "requestedPayoutDkk",
      "must be strictly greater than 0",
    );
  }

  const evaluatedAt = new Date().toISOString();

  const base = {
    producerId,
    remainingFundsDkk,
    requestedPayoutDkk,
    safetyBufferCeilingDkk: SAFETY_BUFFER_CEILING,
    minimumSafeBufferPct: MINIMUM_SAFE_BUFFER_PCT,
    evaluatedAt,
  } as const;

  // Guard #1 — pulje under absolut gulv: divert uanset payout-størrelse.
  const atOrBelowCeiling = remainingFundsDkk <= SAFETY_BUFFER_CEILING;

  // Guard #2 — udbetaling ville brænde ind i 15% buffer af den nuværende pulje.
  // Tilladt payout er højst (1 - MINIMUM_SAFE_BUFFER_PCT) * remaining.
  const maxSpendableDkk = remainingFundsDkk * (1 - MINIMUM_SAFE_BUFFER_PCT);
  const wouldBurnBuffer = requestedPayoutDkk > maxSpendableDkk;

  if (atOrBelowCeiling || wouldBurnBuffer) {
    const reasonParts: string[] = [];
    if (atOrBelowCeiling) {
      reasonParts.push(
        `remaining ${remainingFundsDkk.toFixed(2)} DKK <= ceiling ${SAFETY_BUFFER_CEILING.toFixed(2)} DKK`,
      );
    }
    if (wouldBurnBuffer) {
      reasonParts.push(
        `payout ${requestedPayoutDkk.toFixed(2)} DKK > max spendable ${maxSpendableDkk.toFixed(2)} DKK (${((1 - MINIMUM_SAFE_BUFFER_PCT) * 100).toFixed(0)}% of remaining, preserves ${(MINIMUM_SAFE_BUFFER_PCT * 100).toFixed(0)}% buffer)`,
      );
    }
    return {
      ...base,
      action: "DIVERT_TO_BRAND_VOUCHERS",
      warning: true,
      reason: `Pool below safety threshold — ${reasonParts.join("; ")}. Diverting to brand vouchers to preserve pool sovereignty.`,
    };
  }

  // Guard #3 — payout overstiger hele den resterende pulje.
  if (requestedPayoutDkk > remainingFundsDkk) {
    return {
      ...base,
      action: "BLOCK_INSUFFICIENT",
      warning: true,
      reason: `Requested payout ${requestedPayoutDkk.toFixed(2)} DKK exceeds remaining pool ${remainingFundsDkk.toFixed(2)} DKK.`,
    };
  }

  return {
    ...base,
    action: "EXECUTE_MOBILEPAY_CASH",
    warning: false,
    reason: `Pool sovereign — remaining ${remainingFundsDkk.toFixed(2)} DKK, payout ${requestedPayoutDkk.toFixed(2)} DKK cleared for MobilePay cash payout.`,
  };
}

export default evaluatePoolSovereignty;
