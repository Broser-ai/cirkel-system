// cirkel-system/api/nudge.ts
//
// Integration-Audit forslag #5 (accepteret 2026-07-16).
// Smart Nudging (Modul 13): borgeren guides til den container med lavest fill.
//
// Fase 1: statisk fordeling baseret på seneste 24t witness_attestations.
// Fase 2: WorldModel.orchestrate med rigtige IoT-sensor-events (M-8+29).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { AARHUS_IOT_CONTAINERS, AARHUS_CONTAINER_CAPACITY_GRAMS } from '../src/lib/aarhus-config';

const CACHE_TTL_MS = 5 * 60_000;

interface NudgeRecommendation {
  best_container_id: string;
  best_container_name: string;
  best_container_address: string;
  bonus_ore: number;
  bonus_reason: string;
  fill_pct_estimates: Array<{ id: string; fill_pct: number }>;
  cached_at: string;
}

let cache: NudgeRecommendation | null = null;
let cacheTimestamp = 0;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const region = String(req.query.region ?? 'aarhus-c');
  if (region !== 'aarhus-c') {
    return res.status(200).json({
      best_container_id: AARHUS_IOT_CONTAINERS[0].id,
      bonus_ore: 0,
      note: `Region ${region} har ikke Smart Nudging endnu`,
    });
  }

  const now = Date.now();
  if (cache && now - cacheTimestamp < CACHE_TTL_MS) {
    return res.status(200).json(cache);
  }

  const supabase = getSupabase();
  const fillEstimates: Array<{ id: string; fill_pct: number }> = [];

  if (supabase) {
    try {
      // Fase 1 proxy: tæl witness_attestations per material_type sidste 24t,
      // fordel deterministic per container (via id-hash mod count).
      const since = new Date(now - 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('witness_attestations')
        .select('material_type, created_at')
        .gte('created_at', since);
      const totalScans = data?.length ?? 0;
      for (let i = 0; i < AARHUS_IOT_CONTAINERS.length; i++) {
        // Placeholder-fordeling — Fase 2 bruger rigtige IoT weight-sensor events
        const proxyFill = ((totalScans * (i + 1) * 37) % 100);
        fillEstimates.push({
          id: AARHUS_IOT_CONTAINERS[i].id,
          fill_pct: Math.min(95, proxyFill),
        });
      }
    } catch (err: any) {
      console.error('[nudge] fill-estimate fejlede:', err?.message ?? err);
    }
  }

  if (fillEstimates.length === 0) {
    for (const c of AARHUS_IOT_CONTAINERS) fillEstimates.push({ id: c.id, fill_pct: 40 });
  }

  // Vælg containeren med lavest fill (mest ledig kapacitet)
  fillEstimates.sort((a, b) => a.fill_pct - b.fill_pct);
  const best = fillEstimates[0];
  const bestMeta = AARHUS_IOT_CONTAINERS.find(c => c.id === best.id)!;

  const bonus_ore = best.fill_pct < 20 ? 10 : 0;
  const bonus_reason = bonus_ore > 0
    ? 'Ekstra bonus — container har god plads'
    : 'Standard-pant, ingen fill-bonus';

  const rec: NudgeRecommendation = {
    best_container_id: best.id,
    best_container_name: bestMeta.name,
    best_container_address: bestMeta.address,
    bonus_ore,
    bonus_reason,
    fill_pct_estimates: fillEstimates,
    cached_at: new Date(now).toISOString(),
  };
  cache = rec;
  cacheTimestamp = now;
  return res.status(200).json(rec);
}
