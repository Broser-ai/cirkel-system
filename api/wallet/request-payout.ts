// cirkel-system/api/wallet/request-payout.ts
//
// JUDGE-02 Wallet — request payout (Fase 1: human-in-loop settlement).
//
// Flow:
//   1. Verificer session (JWT gyldig, sub_hash ok)
//   2. Rate-limit: max 1 request per bruger per 24t
//   3. Check balance ≥ amount_ore, amount ≥ 100 øre (1 DKK)
//   4. Insert payout_requests med status='pending'
//   5. Marker de reserverede rewards som 'reserved_for_payout'
//   6. Insert governance_transactions audit-row
//   7. Returner reference til klient — Michael godkender manuelt
//
// INGEN autonom MobilePay/bank-integration Fase 1.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { verifySession, readCookieFromHeader } from '../../src/lib/session';

const MIN_PAYOUT_ORE = 100;   // 1 DKK
const MAX_PAYOUT_ORE = 50_000; // 500 DKK per request (Fase 1 loft)

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
    const ip_hash = hashIp(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress);
    const user_agent_hash = hashUa(req.headers['user-agent']);

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
      message: 'Din anmodning er modtaget. Du får en notifikation når den er udbetalt.',
    });
  } catch (err: any) {
    console.error('[request-payout] unexpected:', err?.message ?? err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
