// cirkel-system/api/deposit.ts
//
// Integration-Audit forslag #2 (accepteret 2026-07-16).
// Læser aktuel pant-sats for en region fra Supabase economic_governance.
// Cache: 60 sekunder in-memory på server-side.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 60_000;
const FALLBACK_ORE = 20;

interface CachedDeposit {
  region_id: string;
  current_deposit_ore: number;
  target_return_rate: number;
  last_updated: string;
  cached_at: number;
}

const cache = new Map<string, CachedDeposit>();

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function isCirkelRegion(region: unknown): region is string {
  return typeof region === 'string' &&
    /^[a-z]+-[a-z]+$/i.test(region) &&
    region.length <= 32;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const region = String(req.query.region ?? 'aarhus-c');
  if (!isCirkelRegion(region)) {
    return res.status(400).json({ error: 'invalid_region' });
  }

  const cached = cache.get(region);
  if (cached && Date.now() - cached.cached_at < CACHE_TTL_MS) {
    return res.status(200).json({
      region_id: cached.region_id,
      current_deposit_ore: cached.current_deposit_ore,
      target_return_rate: cached.target_return_rate,
      last_updated: cached.last_updated,
      source: 'cache',
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(200).json({
      region_id: region,
      current_deposit_ore: FALLBACK_ORE,
      target_return_rate: 0.90,
      last_updated: null,
      source: 'fallback_no_config',
    });
  }

  try {
    const { data, error } = await supabase
      .from('economic_governance')
      .select('region_id, current_deposit_ore, target_return_rate, last_updated')
      .eq('region_id', region)
      .maybeSingle();

    if (error) {
      console.error('[deposit] Supabase error:', error.message);
      return res.status(200).json({
        region_id: region,
        current_deposit_ore: FALLBACK_ORE,
        target_return_rate: 0.90,
        last_updated: null,
        source: 'fallback_db_error',
      });
    }

    const row = data ?? {
      region_id: region,
      current_deposit_ore: FALLBACK_ORE,
      target_return_rate: 0.90,
      last_updated: new Date().toISOString(),
    };

    cache.set(region, {
      region_id: row.region_id,
      current_deposit_ore: Number(row.current_deposit_ore),
      target_return_rate: Number(row.target_return_rate),
      last_updated: row.last_updated ?? new Date().toISOString(),
      cached_at: Date.now(),
    });

    return res.status(200).json({
      ...row,
      source: data ? 'live' : 'fallback_row_missing',
    });
  } catch (err: any) {
    console.error('[deposit] unexpected:', err?.message ?? err);
    return res.status(200).json({
      region_id: region,
      current_deposit_ore: FALLBACK_ORE,
      target_return_rate: 0.90,
      last_updated: null,
      source: 'fallback_exception',
    });
  }
}
