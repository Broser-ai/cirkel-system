// cirkel-system/api/wallet/balance.ts
//
// JUDGE-02 Wallet — læs borgerens balance fra citizen_balance-view.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifySession, readCookieFromHeader } from '../../src/lib/session.js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function formatOreAsDkk(ore: number): string {
  const kroner = Math.floor(ore / 100);
  const rest = Math.abs(ore % 100).toString().padStart(2, '0');
  return `${kroner},${rest} DKK`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const token = readCookieFromHeader(req.headers.cookie);
  const session = token ? verifySession(token) : null;
  if (!session) return res.status(401).json({ error: 'not_authenticated' });

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(200).json({
      balance_ore: 0,
      balance_dkk: '0,00 DKK',
      pending_payout_ore: 0,
      lifetime_paid_ore: 0,
      source: 'fallback_no_config',
    });
  }

  const hashBytea = `\\x${session.sub_hash}`;

  try {
    const { data, error } = await supabase
      .from('citizen_balance')
      .select('balance_ore, pending_payout_ore, lifetime_paid_ore, confirmed_reward_count, latest_reward_at')
      .eq('mitid_uuid_hash', hashBytea)
      .maybeSingle();

    if (error) {
      console.error('[balance] Supabase error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    const row = data ?? {
      balance_ore: 0,
      pending_payout_ore: 0,
      lifetime_paid_ore: 0,
      confirmed_reward_count: 0,
      latest_reward_at: null,
    };

    return res.status(200).json({
      balance_ore: Number(row.balance_ore ?? 0),
      balance_dkk: formatOreAsDkk(Number(row.balance_ore ?? 0)),
      pending_payout_ore: Number(row.pending_payout_ore ?? 0),
      lifetime_paid_ore: Number(row.lifetime_paid_ore ?? 0),
      confirmed_reward_count: Number(row.confirmed_reward_count ?? 0),
      latest_reward_at: row.latest_reward_at,
      source: data ? 'live' : 'empty',
    });
  } catch (err: any) {
    console.error('[balance] unexpected:', err?.message ?? err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
