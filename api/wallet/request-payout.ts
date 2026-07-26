// cirkel-system/api/wallet/request-payout.ts
//
// JUDGE-02 Wallet — request payout (Fase 1: human-in-loop settlement).
//
// Flow:
//   1. Verificer session (JWT gyldig, sub_hash ok)
//   2. F3.8: resolveTrustedUid(req) — reject hvis UID spoof
//   3. Rate-limit: max 1 request per bruger per 24t
//   4. Check balance ≥ amount_ore, amount ≥ 100 øre (1 DKK)
//   5. Modul 1.3: evaluatePoolSovereignty(...) — divert til brand-vouchers
//      hvis puljen er under safety threshold; blokér hvis utilstrækkelig.
//   6. Insert payout_requests med status='pending'
//   7. Marker de reserverede rewards som 'reserved_for_payout'
//   8. Insert governance_transactions audit-row
//   9. Returner reference til klient — Michael godkender manuelt
//
// INGEN autonom MobilePay/bank-integration Fase 1.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { verifySession, readCookieFromHeader } from '../../src/lib/session.js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';
import { evaluatePoolSovereignty } from '../_pool-guard.js';

const MIN_PAYOUT_ORE = 100;   // 1 DKK
const MAX_PAYOUT_ORE = 50_000; // 500 DKK per request (Fase 1 loft)

// JUDGE-02 opgradering: brug Confidential Payout RPC (Modul 45)
// hvis USE_CONFIDENTIAL_PAYOUT=1 er sat.
const USE_CONFIDENTIAL_PAYOUT = process.env.USE_CONFIDENTIAL_PAYOUT === '1';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function generateReference(): string {
  const random = randomBytes(4).toString('hex').toUpperCase();
  const date = new Date().toISOString().substring(0, 10).replace(/-/g, '');
  return `CIRKEL-P-${date}-${random}`;
}

function hashIp(ip: string | string[] | undefined): string {
  const raw = Array.isArray(ip) ? ip[0] : (ip ?? 'unknown');
  return createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

function hashUa(ua: string | undefined): string {
  return createHash('sha256').update(ua ?? 'unknown').digest('hex').substring(0, 16);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const token = readCookieFromHeader(req.headers.cookie);
  const session = token ? verifySession(token) : null;
  if (!session) return res.status(401).json({ error: 'not_authenticated' });

  // F3.8: verify Firebase ID-token og reject på UID-spoof FØR videre payout-logik.
  // Bruger firebaseUid fra body som clientProvidedUid (matches mod token.uid);
  // resolveTrustedUid kaster i enforce-mode, warn-only pass-through logges.
  let trustedUid: string | null = null;
  try {
    const clientProvidedUid = String(req.body?.firebaseUid ?? '');
    const trust = await resolveTrustedUid(req, clientProvidedUid);
    if (trust.spoofed) {
      console.warn('[request-payout] F3.8 UID_SPOOF_DETECTED:', trust.reason);
      return res.status(403).json({
        error: 'uid_spoof_detected',
        reason: trust.reason,
      });
    }
    trustedUid = trust.trusted_uid || null;
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 401;
    const reason = err?.reason ?? err?.message ?? 'firebase_token_verify_failed';
    console.warn('[request-payout] F3.8 verify fejlede:', reason);
    return res.status(status).json({ error: 'unauthorized', reason });
  }

  const amount_ore = Number(req.body?.amount_ore);
  const method = String(req.body?.method ?? 'mobilepay');

  if (!Number.isInteger(amount_ore) || amount_ore < MIN_PAYOUT_ORE || amount_ore > MAX_PAYOUT_ORE) {
    return res.status(400).json({
      error: 'invalid_amount',
      message: `amount_ore skal være heltal i [${MIN_PAYOUT_ORE}, ${MAX_PAYOUT_ORE}]`,
    });
  }
  if (!['mobilepay', 'bank_transfer', 'manual'].includes(method)) {
    return res.status(400).json({ error: 'invalid_method' });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: 'db_unavailable' });

  const hashBytea = `\\x${session.sub_hash}`;
  const ip_hash = hashIp(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress);
  const user_agent_hash = hashUa(req.headers['user-agent']);

  // JUDGE-02 Confidential Payout: atomisk RPC der verificerer ZK-proof kæde
  if (USE_CONFIDENTIAL_PAYOUT) {
    try {
      const { data, error } = await supabase.rpc('request_payout_confidential', {
        p_mitid_hash: hashBytea,
        p_amount_ore: amount_ore,
        p_method: method,
        p_ip_hash: ip_hash,
        p_ua_hash: user_agent_hash,
      });
      if (error) {
        const msg = error.message ?? 'unknown';
        if (msg.includes('rate_limited')) return res.status(429).json({ error: 'rate_limited' });
        if (msg.includes('insufficient_balance')) return res.status(400).json({ error: 'insufficient_balance' });
        if (msg.includes('insufficient_verified_balance')) {
          return res.status(400).json({
            error: 'insufficient_verified_balance',
            message: 'Ikke nok scans med ZK-proof til at dække udbetalingen.',
          });
        }
        if (msg.includes('amount_below_minimum')) return res.status(400).json({ error: 'invalid_amount' });
        if (msg.includes('amount_above_maximum')) return res.status(400).json({ error: 'invalid_amount' });
        console.error('[request-payout] confidential RPC fejlede:', msg);
        return res.status(500).json({ error: 'confidential_rpc_failed' });
      }
      const row = Array.isArray(data) ? data[0] : data;
      return res.status(200).json({
        ok: true,
        reference: row.reference,
        amount_ore: row.amount_ore,
        amount_dkk: `${Math.floor(row.amount_ore / 100)},${String(row.amount_ore % 100).padStart(2, '0')} DKK`,
        status: row.status,
        requested_at: row.requested_at,
        proof_verified: row.proof_verified,
        confidential_mode: true,
        estimated_settlement: 'næste hverdag',
      });
    } catch (err: any) {
      console.error('[request-payout] confidential exception:', err?.message ?? err);
      return res.status(500).json({ error: 'internal_error' });
    }
  }

  try {
    // Rate-limit via RPC
    const { data: canRequest, error: rlError } = await supabase
      .rpc('can_request_payout', { p_hash: hashBytea });
    if (rlError) {
      console.error('[request-payout] rate-limit RPC fejlede:', rlError.message);
      return res.status(500).json({ error: 'rate_limit_check_failed' });
    }
    if (canRequest === false) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Max 1 payout-anmodning per 24 timer.',
      });
    }

    // Læs balance
    const { data: balance, error: balError } = await supabase
      .from('citizen_balance')
      .select('balance_ore')
      .eq('mitid_uuid_hash', hashBytea)
      .maybeSingle();
    if (balError) {
      console.error('[request-payout] balance-query fejlede:', balError.message);
      return res.status(500).json({ error: 'balance_check_failed' });
    }
    const currentBalance = Number(balance?.balance_ore ?? 0);
    if (currentBalance < amount_ore) {
      return res.status(400).json({
        error: 'insufficient_balance',
        balance_ore: currentBalance,
        requested_ore: amount_ore,
      });
    }

    // Modul 1.3 — Pool Sovereignty Guard.
    // Evaluerer om puljen kan bære udbetalingen som MobilePay-kontant,
    // eller om den skal omdirigeres til brand-vouchers / blokeres.
    // producer_id = trusted UID (falls back til session sub_hash) så guarden
    // har en stabil producent-identitet i log/audit.
    const producerId = trustedUid ?? session.sub_hash;
    const remainingFundsDkk = currentBalance / 100;
    const requestedAmountDkk = amount_ore / 100;

    let poolDecision;
    try {
      poolDecision = evaluatePoolSovereignty(
        producerId,
        remainingFundsDkk,
        requestedAmountDkk,
      );
    } catch (guardErr: any) {
      console.error('[request-payout] pool-guard fejlede:', guardErr?.message ?? guardErr);
      return res.status(500).json({ error: 'pool_guard_failed' });
    }

    if (poolDecision.action === 'DIVERT_TO_BRAND_VOUCHERS') {
      console.warn('[request-payout] Modul 1.3 divert:', poolDecision.reason);
      return res.status(200).json({
        status: 'diverted',
        action: 'brand_vouchers',
        reason: poolDecision.reason,
        remaining_funds_dkk: poolDecision.remainingFundsDkk,
        requested_payout_dkk: poolDecision.requestedPayoutDkk,
        evaluated_at: poolDecision.evaluatedAt,
      });
    }

    if (poolDecision.action === 'BLOCK_INSUFFICIENT') {
      console.warn('[request-payout] Modul 1.3 block:', poolDecision.reason);
      return res.status(402).json({
        error: 'insufficient_pool_funds',
        action: 'blocked',
        reason: poolDecision.reason,
        remaining_funds_dkk: poolDecision.remainingFundsDkk,
        requested_payout_dkk: poolDecision.requestedPayoutDkk,
        evaluated_at: poolDecision.evaluatedAt,
      });
    }

    // poolDecision.action === 'EXECUTE_MOBILEPAY_CASH' → fortsæt eksisterende flow.

    // Find rewards at reservere (FIFO)
    const { data: rewards, error: rewError } = await supabase
      .from('citizen_rewards')
      .select('id, amount_ore')
      .eq('mitid_uuid_hash', hashBytea)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true });
    if (rewError) {
      console.error('[request-payout] rewards-query fejlede:', rewError.message);
      return res.status(500).json({ error: 'rewards_query_failed' });
    }

    let accumulated = 0;
    const reservedIds: string[] = [];
    for (const r of rewards ?? []) {
      if (accumulated >= amount_ore) break;
      accumulated += Number(r.amount_ore);
      reservedIds.push(r.id);
    }
    if (accumulated < amount_ore) {
      return res.status(500).json({ error: 'reservation_shortfall', accumulated, requested: amount_ore });
    }

    const reference = generateReference();

    // Insert payout_requests
    const { data: payoutRow, error: prError } = await supabase
      .from('payout_requests')
      .insert({
        reference,
        mitid_uuid_hash: hashBytea,
        amount_ore,
        method,
        status: 'pending',
        reserved_reward_ids: reservedIds,
        ip_hash,
        user_agent_hash,
      })
      .select('id, reference, requested_at')
      .single();
    if (prError) {
      console.error('[request-payout] insert fejlede:', prError.message);
      return res.status(500).json({ error: 'insert_failed' });
    }

    // Insert governance_transactions audit
    await supabase.from('governance_transactions').insert({
      txn_type: 'payout',
      region_id: 'aarhus-c',
      amount_ore,
      metadata: { payout_id: payoutRow.id, reference, method },
    });

    return res.status(200).json({
      ok: true,
      reference: payoutRow.reference,
      amount_ore,
      amount_dkk: `${Math.floor(amount_ore / 100)},${String(amount_ore % 100).padStart(2, '0')} DKK`,
      status: 'pending',
      requested_at: payoutRow.requested_at,
      estimated_settlement: 'næste hverdag',
      pool_guard: {
        action: poolDecision.action,
        reason: poolDecision.reason,
        remaining_funds_dkk: poolDecision.remainingFundsDkk,
      },
      message: 'Din anmodning er modtaget. Du får en notifikation når den er udbetalt.',
    });
  } catch (err: any) {
    console.error('[request-payout] unexpected:', err?.message ?? err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
