// cirkel-system/src/hooks/useDynamicDeposit.ts
//
// Integration-Audit forslag #2 (accepteret 2026-07-16).
// Erstatter hardkodet "0.20" i ScanTab med PID-kalibreret realtidsværdi
// fra Modul 1.3 (AarhusEconomicGovernor).
//
// Fallback: hvis /api/deposit fejler eller ikke svarer inden 3s, viser vi
// den historiske faste sats — så UI'et aldrig blokerer.

import { useState, useEffect, useRef } from 'react';
import { AARHUS_C_REGION_ID } from '../lib/aarhus-config';

export interface DepositState {
  amount_dkk: string;      // fx "2,02"
  amount_ore: number;      // fx 202
  source: 'live' | 'fallback' | 'loading';
  last_updated: string | null;
  target_return_rate: number | null;
}

const FALLBACK: DepositState = {
  amount_dkk: '0,20',
  amount_ore: 20,
  source: 'fallback',
  last_updated: null,
  target_return_rate: null,
};

const FETCH_TIMEOUT_MS = 3000;
const REFRESH_MS = 5 * 60 * 1000; // opdater hver 5. min

function formatOreAsDkk(ore: number): string {
  const kroner = Math.floor(ore / 100);
  const rest = Math.abs(ore % 100).toString().padStart(2, '0');
  return `${kroner},${rest}`;
}

async function fetchDeposit(region: string, signal: AbortSignal): Promise<DepositState | null> {
  try {
    const res = await fetch(`/api/deposit?region=${encodeURIComponent(region)}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const ore = Number(data.current_deposit_ore);
    if (!Number.isFinite(ore) || ore < 10) return null;
    return {
      amount_dkk: formatOreAsDkk(ore),
      amount_ore: ore,
      source: 'live',
      last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
      target_return_rate: typeof data.target_return_rate === 'number' ? data.target_return_rate : null,
    };
  } catch {
    return null;
  }
}

export function useDynamicDeposit(region: string = AARHUS_C_REGION_ID): DepositState {
  const [state, setState] = useState<DepositState>({ ...FALLBACK, source: 'loading' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetchDeposit(region, controller.signal).then(result => {
      clearTimeout(timeoutId);
      if (cancelled) return;
      setState(result ?? FALLBACK);
    });

    const scheduleRefresh = () => {
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;
        const refresh = new AbortController();
        const refreshTimeout = setTimeout(() => refresh.abort(), FETCH_TIMEOUT_MS);
        const fresh = await fetchDeposit(region, refresh.signal);
        clearTimeout(refreshTimeout);
        if (cancelled) return;
        if (fresh) setState(fresh);
        scheduleRefresh();
      }, REFRESH_MS);
    };
    scheduleRefresh();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [region]);

  return state;
}
