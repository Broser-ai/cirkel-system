// cirkel-system/api/me.ts
//
// JUDGE-01 Anontome Login flow — session introspection.
// Returnerer session-info + balance til klient.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifySession, readCookieFromHeader } from '../src/lib/session.js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cookie = req.headers.cookie;
  const token = readCookieFromHeader(cookie);
  const session = token ? verifySession(token) : null;

  if (!session) {
    return res.status(401).json({ error: 'not_authenticated' });
  }

  const supabase = getSupabase();
  let balance_ore = 0;
  let lifetime_paid_ore = 0;
  let confirmed_reward_count = 0;

  if (supabase) {
    try {
      const hashBytea = `\\x${session.sub_hash}`;
      const { data } = await supabase
        .from('citizen_balance')
        .select('balance_ore, lifetime_paid_ore, confirmed_reward_count')
        .eq('mitid_uuid_hash', hashBytea)
        .maybeSingle();
      if (data) {
        balance_ore = Number(data.balance_ore ?? 0);
        lifetime_paid_ore = Number(data.lifetime_paid_ore ?? 0);
        confirmed_reward_count = Number(data.confirmed_reward_count ?? 0);
      }
    } catch (err: any) {
      console.error('[me] Supabase balance-query fejlede:', err?.message ?? err);
    }
  }

  return res.status(200).json({
    sub_hash: session.sub_hash,
    tier: session.tier,
    exp: session.exp,
    balance_ore,
    balance_dkk_formatted: formatOreAsDkk(balance_ore),
    lifetime_paid_ore,
    confirmed_reward_count,
  });
}

function formatOreAsDkk(ore: number): string {
  const kroner = Math.floor(ore / 100);
  const rest = Math.abs(ore % 100).toString().padStart(2, '0');
  return `${kroner},${rest} DKK`;
}
