// cirkel-system/api/wallet/transfer.ts
//
// P2P Wallet Transfer — Give-marketplace endpoint (Fase 1).
//
// Flow:
//   1. Method-guard (POST only).
//   2. Parse + validér body {from_user, to_user, amount_dkk, reference}.
//   3. F3.8: resolveTrustedUid(req, from_user) — reject på UID-spoof.
//      Kun afsender verificeres; modtager identificeres per UID (klient-oplyst)
//      da modtageren ikke deltager i request-signeringen.
//   4. Lazy Supabase service-role client (samme pattern som api/scan.ts).
//   5. Læs sender-saldo, bekræft balance >= amount.
//   6. Modul 1.3: evaluatePoolSovereignty(...) — divert til brand-vouchers
//      hvis puljen er under safety threshold; blokér hvis utilstrækkelig.
//   7. Udfør atomisk P2P-transfer via RPC 'wallet_p2p_transfer'.
//   8. Returnér struktureret JSON-response.
//
// Import lokal-fil-suffix .js (Vercel-serverless / ESM krav).
// depth: api/wallet/transfer.ts → api/ = '../'.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';
import {
  evaluatePoolSovereignty,
  type PoolSovereigntyDecision,
} from '../_pool-guard.js';

// ─── Konstanter ──────────────────────────────────────────────────────────────
const MIN_TRANSFER_DKK = 1;
const MAX_TRANSFER_DKK = 500; // Fase 1 loft (samme som request-payout).
const REFERENCE_MAX_LEN = 128;
const UID_MAX_LEN = 128;

// ─── Types ───────────────────────────────────────────────────────────────────
interface TransferRequestBody {
  from_user: string;
  to_user: string;
  amount_dkk: number;
  reference: string;
}

interface TransferSuccessData {
  reference: string;
  from_user: string;
  to_user: string;
  amount_dkk: number;
  amount_ore: number;
  new_sender_balance_dkk: number;
  transferred_at: string;
  pool_guard: {
    action: PoolSovereigntyDecision['action'];
    reason: string;
    remaining_funds_dkk: number;
  };
}

interface PoolDivertData {
  action: 'brand_vouchers';
  reason: string;
  remaining_funds_dkk: number;
  requested_payout_dkk: number;
  evaluated_at: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  detail?: string;
}

interface P2PTransferRpcRow {
  reference: string;
  from_user: string;
  to_user: string;
  amount_ore: number;
  new_sender_balance_ore: number;
  transferred_at: string;
}

// ─── Supabase lazy init (samme pattern som api/scan.ts) ──────────────────────
let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isPlainString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

function parseBody(raw: unknown): TransferRequestBody | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'body_missing_or_invalid_json' };
  }
  const body = raw as Record<string, unknown>;

  const from_user = body.from_user;
  const to_user = body.to_user;
  const reference = body.reference;
  const amount_dkk_raw = body.amount_dkk;

  if (!isPlainString(from_user, UID_MAX_LEN)) return { error: 'from_user_invalid' };
  if (!isPlainString(to_user, UID_MAX_LEN)) return { error: 'to_user_invalid' };
  if (!isPlainString(reference, REFERENCE_MAX_LEN)) return { error: 'reference_invalid' };

  const amount_dkk =
    typeof amount_dkk_raw === 'number'
      ? amount_dkk_raw
      : typeof amount_dkk_raw === 'string'
        ? Number.parseFloat(amount_dkk_raw)
        : Number.NaN;

  if (!Number.isFinite(amount_dkk) || amount_dkk < MIN_TRANSFER_DKK || amount_dkk > MAX_TRANSFER_DKK) {
    return {
      error: `amount_dkk_out_of_range: must be finite number in [${MIN_TRANSFER_DKK}, ${MAX_TRANSFER_DKK}]`,
    };
  }

  const sender = from_user.trim();
  const recipient = to_user.trim();
  if (sender === recipient) {
    return { error: 'self_transfer_not_allowed' };
  }

  return {
    from_user: sender,
    to_user: recipient,
    amount_dkk,
    reference: reference.trim(),
  };
}

function dkkToOre(dkk: number): number {
  // Undgå floating-point drift: multiplér og rund til nærmeste øre.
  return Math.round(dkk * 100);
}

function oreToDkk(ore: number): number {
  return Math.round(ore) / 100;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse | void> {
  // 1. Method-guard.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    const body: ApiResponse<never> = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // 2. Parse + validér body.
  const parsed = parseBody(req.body);
  if ('error' in parsed) {
    const body: ApiResponse<never> = { success: false, error: parsed.error };
    return res.status(400).json(body);
  }
  const { from_user, to_user, amount_dkk, reference } = parsed;

  // 3. F3.8 — verificér Firebase ID-token og bekræft afsender.
  let trustedUid: string;
  try {
    const trust = await resolveTrustedUid(req, from_user);
    if (trust.spoofed) {
      const body: ApiResponse<never> = {
        success: false,
        error: 'uid_spoof_detected',
        detail: trust.reason,
      };
      return res.status(403).json(body);
    }
    trustedUid = trust.trusted_uid || from_user;
  } catch (err) {
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 401;
    const detail =
      typeof (err as { reason?: unknown })?.reason === 'string'
        ? (err as { reason: string }).reason
        : err instanceof Error
          ? err.message
          : 'firebase_token_verify_failed';
    const body: ApiResponse<never> = {
      success: false,
      error: 'unauthorized',
      detail,
    };
    return res.status(status).json(body);
  }

  // Ekstra sikkerhedslag: den verificerede UID SKAL være afsenderen.
  // resolveTrustedUid håndterer det via requiredUid, men vi tjekker eksplicit.
  if (trustedUid !== from_user) {
    const body: ApiResponse<never> = {
      success: false,
      error: 'sender_mismatch',
      detail: 'Verificeret UID matcher ikke from_user.',
    };
    return res.status(403).json(body);
  }

  // 4. Supabase service-role client.
  const supabase = getSupabase();
  if (!supabase) {
    const body: ApiResponse<never> = {
      success: false,
      error: 'db_unavailable',
      detail: 'Supabase service-role konfiguration mangler.',
    };
    return res.status(503).json(body);
  }

  const amount_ore = dkkToOre(amount_dkk);

  try {
    // 5. Læs sender-balance.
    const { data: balanceRow, error: balanceErr } = await supabase
      .from('wallet_balances')
      .select('balance_ore')
      .eq('firebase_uid', trustedUid)
      .maybeSingle();

    if (balanceErr) {
      console.error('[wallet/transfer] balance-query fejlede:', balanceErr.message);
      const body: ApiResponse<never> = { success: false, error: 'balance_query_failed' };
      return res.status(500).json(body);
    }

    const currentBalanceOre = Number(balanceRow?.balance_ore ?? 0);
    if (!Number.isFinite(currentBalanceOre) || currentBalanceOre < amount_ore) {
      const body: ApiResponse<{ balance_ore: number; requested_ore: number }> = {
        success: false,
        error: 'insufficient_balance',
        data: {
          balance_ore: Math.max(0, currentBalanceOre),
          requested_ore: amount_ore,
        },
      };
      return res.status(400).json(body);
    }

    // 6. Pool sovereignty guard.
    const currentBalanceDkk = oreToDkk(currentBalanceOre);
    let poolDecision: PoolSovereigntyDecision;
    try {
      poolDecision = evaluatePoolSovereignty(trustedUid, currentBalanceDkk, amount_dkk);
    } catch (guardErr) {
      const detail =
        guardErr instanceof Error ? guardErr.message : 'pool_guard_unknown_error';
      console.error('[wallet/transfer] pool-guard fejlede:', detail);
      const body: ApiResponse<never> = {
        success: false,
        error: 'pool_guard_failed',
        detail,
      };
      return res.status(500).json(body);
    }

    if (poolDecision.action === 'DIVERT_TO_BRAND_VOUCHERS') {
      console.warn('[wallet/transfer] Modul 1.3 divert:', poolDecision.reason);
      const body: ApiResponse<PoolDivertData> = {
        success: false,
        error: 'diverted_to_brand_vouchers',
        detail: poolDecision.reason,
        data: {
          action: 'brand_vouchers',
          reason: poolDecision.reason,
          remaining_funds_dkk: poolDecision.remainingFundsDkk,
          requested_payout_dkk: poolDecision.requestedPayoutDkk,
          evaluated_at: poolDecision.evaluatedAt,
        },
      };
      return res.status(200).json(body);
    }

    if (poolDecision.action === 'BLOCK_INSUFFICIENT') {
      console.warn('[wallet/transfer] Modul 1.3 block:', poolDecision.reason);
      const body: ApiResponse<{
        remaining_funds_dkk: number;
        requested_payout_dkk: number;
        evaluated_at: string;
      }> = {
        success: false,
        error: 'insufficient_pool_funds',
        detail: poolDecision.reason,
        data: {
          remaining_funds_dkk: poolDecision.remainingFundsDkk,
          requested_payout_dkk: poolDecision.requestedPayoutDkk,
          evaluated_at: poolDecision.evaluatedAt,
        },
      };
      return res.status(402).json(body);
    }

    // 7. Atomisk P2P-transfer via RPC.
    //    Servisrollen udfører hele operationen i DB-transaktion (debit sender,
    //    kredit modtager, ledger-entry, unik reference-guard).
    const { data: rpcRaw, error: rpcErr } = await supabase.rpc('wallet_p2p_transfer', {
      p_from_user: trustedUid,
      p_to_user: to_user,
      p_amount_ore: amount_ore,
      p_reference: reference,
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? 'unknown';
      console.error('[wallet/transfer] RPC fejlede:', msg);

      if (/insufficient_balance/i.test(msg)) {
        const body: ApiResponse<never> = { success: false, error: 'insufficient_balance' };
        return res.status(400).json(body);
      }
      if (/duplicate|already_exists|reference/i.test(msg)) {
        const body: ApiResponse<never> = {
          success: false,
          error: 'duplicate_reference',
          detail: msg,
        };
        return res.status(409).json(body);
      }
      if (/recipient_not_found|to_user/i.test(msg)) {
        const body: ApiResponse<never> = {
          success: false,
          error: 'recipient_not_found',
          detail: msg,
        };
        return res.status(404).json(body);
      }
      const body: ApiResponse<never> = {
        success: false,
        error: 'transfer_rpc_failed',
        detail: msg,
      };
      return res.status(500).json(body);
    }

    const rpcRow: P2PTransferRpcRow | null = Array.isArray(rpcRaw)
      ? (rpcRaw[0] as P2PTransferRpcRow | undefined) ?? null
      : (rpcRaw as P2PTransferRpcRow | null);

    if (!rpcRow) {
      const body: ApiResponse<never> = {
        success: false,
        error: 'transfer_no_result',
        detail: 'wallet_p2p_transfer returnerede intet.',
      };
      return res.status(500).json(body);
    }

    // 8. Struktureret success-response.
    const data: TransferSuccessData = {
      reference: rpcRow.reference,
      from_user: rpcRow.from_user,
      to_user: rpcRow.to_user,
      amount_dkk: oreToDkk(rpcRow.amount_ore),
      amount_ore: rpcRow.amount_ore,
      new_sender_balance_dkk: oreToDkk(rpcRow.new_sender_balance_ore),
      transferred_at: rpcRow.transferred_at,
      pool_guard: {
        action: poolDecision.action,
        reason: poolDecision.reason,
        remaining_funds_dkk: poolDecision.remainingFundsDkk,
      },
    };

    const body: ApiResponse<TransferSuccessData> = { success: true, data };
    return res.status(200).json(body);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown_error';
    console.error('[wallet/transfer] unexpected:', detail);
    const body: ApiResponse<never> = {
      success: false,
      error: 'internal_error',
      detail,
    };
    return res.status(500).json(body);
  }
}
