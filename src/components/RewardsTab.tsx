// F2.5 — RewardsTab: reward-katalog via /api/rewards + indløs via /api/redeem
// Cash-gate: hvis reward.category === 'cash' OG bruger er ikke cpr/mitid-verificeret,
// vises "Verificér for at udbetale"-tilstand i stedet for aktiv Indløs-knap.
// Ingen service-role i frontend.

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Coins, Gift, Loader2, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw
} from 'lucide-react';
import { UserProfile } from '../types';
import DashboardWidget from './DashboardWidget';

interface RewardsTabProps {
  user: UserProfile;
  onChangeUser?: (updates: Partial<UserProfile>) => void;
}

interface RewardItem {
  id: string;
  title: string;
  description?: string;
  cost_points: number;
  category?: string;   // 'cash' | 'coupon' | 'code' | 'award' | ...
  stock?: number | null;
  emoji?: string;
}

interface RewardsResponse {
  success: boolean;
  rewards?: RewardItem[];
  error?: string;
}

interface RedeemResponse {
  success: boolean;
  redemption_id?: string;
  reward?: string;
  cost_points?: number;
  remaining_points?: number;
  error?: string;
}

interface DashboardLite {
  success: boolean;
  profile?: {
    spendable_points?: number;
    points?: number;
    verification_tier?: string;
  };
  error?: string;
}

export default function RewardsTab({ user, onChangeUser }: RewardsTabProps) {
  const firebaseUid = (user as any).uid || user.id;

  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spendable, setSpendable] = useState<number>(user.points || 0);
  const [verificationTier, setVerificationTier] = useState<string>(user.verificationTier || 'standard');

  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Kør rewards + dashboard parallelt — vi har brug for saldo og tier
      const [rRes, dRes] = await Promise.all([
        fetch('/api/rewards', { method: 'GET' }),
        fetch(`/api/dashboard?firebaseUid=${encodeURIComponent(firebaseUid)}`, { method: 'GET' }),
      ]);
      const rJson: RewardsResponse = await rRes.json();
      const dJson: DashboardLite = await dRes.json();

      if (!rRes.ok || !rJson.success || !rJson.rewards) {
        setError(rJson.error || 'Kunne ikke hente belønninger. Prøv igen om lidt.');
        setLoading(false);
        return;
      }
      setRewards(rJson.rewards);

      if (dRes.ok && dJson.success && dJson.profile) {
        setSpendable(dJson.profile.spendable_points ?? dJson.profile.points ?? user.points ?? 0);
        if (dJson.profile.verification_tier) {
          setVerificationTier(dJson.profile.verification_tier);
        }
      }
      setLoading(false);
    } catch (err: any) {
      setError('Netværksfejl — tjek forbindelsen og prøv igen.');
      setLoading(false);
    }
  }, [firebaseUid, user.points]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRedeem = async (reward: RewardItem) => {
    setRedeemingId(reward.id);
    setFlash(null);
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebaseUid, rewardId: reward.id }),
      });
      const json: RedeemResponse = await res.json();
      if (!res.ok || !json.success) {
        setFlash({
          type: 'error',
          msg: json.error || 'Vi kunne ikke gennemføre indløsningen. Prøv igen.',
        });
        setRedeemingId(null);
        return;
      }
      // Success — opdater saldo lokalt og showToast globalt hvis tilgængelig
      if (typeof json.remaining_points === 'number') {
        setSpendable(json.remaining_points);
        if (onChangeUser) {
          onChangeUser({ points: json.remaining_points });
        }
      }
      setFlash({
        type: 'success',
        msg: `Indløst: ${json.reward || reward.title}. Ny saldo: ${json.remaining_points ?? spendable} CP.`,
      });
      const showToast = (window as any).showToast;
      if (typeof showToast === 'function') {
        showToast(`Indløst: ${json.reward || reward.title}`, 'success');
      }
      setRedeemingId(null);
    } catch (err: any) {
      setFlash({ type: 'error', msg: 'Netværksfejl — indløsningen kom ikke igennem.' });
      setRedeemingId(null);
    }
  };

  const isCashGated = (r: RewardItem): boolean => {
    if (r.category !== 'cash') return false;
    return verificationTier !== 'cpr' && verificationTier !== 'mitid';
  };

  return (
    <div className="w-full max-w-lg mx-auto px-4 pt-4 pb-24 flex flex-col gap-5 select-none animate-in fade-in duration-200 text-left">
      {/* Live status-widget øverst */}
      <DashboardWidget user={user} />

      {/* Header + saldo */}
      <div
        className="rounded-3xl p-5 text-white shadow-lg relative overflow-hidden"
        style={{ background: '#05361B' }}
      >
        <div className="absolute right-0 top-0 w-32 h-32 rounded-full blur-2xl pointer-events-none" style={{ background: 'rgba(249, 126, 25, 0.15)' }} />
        <div className="flex items-center gap-2 relative">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(249, 126, 25, 0.2)' }}>
            <Gift className="w-4 h-4" style={{ color: '#F97E19' }} />
          </span>
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest block leading-none" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Belønninger
            </span>
            <h3 className="text-sm font-black uppercase tracking-wider mt-1 leading-none">
              Indløs dine Cirkel Points
            </h3>
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2 relative">
          <span className="text-4xl font-black tracking-tighter" style={{ color: '#F97E19' }}>
            {spendable}
          </span>
          <span className="text-sm font-black" style={{ color: 'rgba(255,255,255,0.8)' }}>
            CP til rådighed
          </span>
        </div>
        <p className="text-[11px] font-semibold mt-2 leading-normal" style={{ color: 'rgba(255,255,255,0.7)' }}>
          Point du bruger her trækkes fra din saldo — livstidspoint bevares, så dit medlemskabsniveau er sikkert.
        </p>
      </div>

      {/* Flash-besked */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`rounded-2xl p-3 flex items-start gap-2 border ${
              flash.type === 'success'
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-rose-50 border-rose-200'
            }`}
          >
            {flash.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            )}
            <span className={`text-[11px] font-black leading-tight ${
              flash.type === 'success' ? 'text-emerald-900' : 'text-rose-900'
            }`}>
              {flash.msg}
            </span>
            <button
              onClick={() => setFlash(null)}
              className="ml-auto text-[10px] font-black text-primary/50 hover:text-primary shrink-0"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-white border border-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Fejl */}
      {!loading && error && (
        <div className="bg-white border border-amber-200 rounded-2xl p-4 text-left">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-black text-primary">{error}</p>
              <button
                onClick={loadAll}
                className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg bg-primary text-white hover:opacity-90 active:scale-97"
              >
                <RefreshCw className="w-3 h-3" /> Prøv igen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tom-tilstand */}
      {!loading && !error && rewards.length === 0 && (
        <div className="text-center p-7 border-2 border-dashed border-gray-200 rounded-3xl bg-white/40">
          <span className="text-2xl">🎁</span>
          <p className="text-xs font-black text-primary mt-2">Ingen belønninger klar lige nu</p>
          <p className="text-[10px] font-semibold mt-1 leading-normal" style={{ color: '#6E6E6E' }}>
            Vi tilføjer nye tilbud løbende — scan videre og kig forbi igen om lidt.
          </p>
        </div>
      )}

      {/* Reward-kort */}
      {!loading && !error && rewards.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {rewards.map((r) => {
            const cashGated = isCashGated(r);
            const canAfford = spendable >= r.cost_points;
            const outOfStock = typeof r.stock === 'number' && r.stock <= 0;
            const isRedeeming = redeemingId === r.id;
            const disabled = !canAfford || outOfStock || cashGated || isRedeeming;

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-gray-150 rounded-2xl p-4 shadow-sm flex items-center gap-3"
              >
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 border"
                  style={{ background: '#F5E9DC', borderColor: 'rgba(5, 54, 27, 0.12)' }}
                >
                  {r.emoji || (r.category === 'cash' ? '💰' : '🎁')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="text-xs font-black" style={{ color: '#05361B' }}>
                      {r.title}
                    </h4>
                    {r.category && (
                      <span
                        className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md leading-none"
                        style={{ background: 'rgba(5, 54, 27, 0.06)', color: '#3B7A57' }}
                      >
                        {r.category}
                      </span>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-[10px] font-semibold mt-0.5 leading-normal line-clamp-2" style={{ color: '#6E6E6E' }}>
                      {r.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <Coins className="w-3 h-3" style={{ color: '#F97E19' }} />
                    <span className="text-[10.5px] font-black" style={{ color: '#05361B' }}>
                      {r.cost_points} CP
                    </span>
                    {outOfStock && (
                      <span className="ml-2 text-[9px] font-black uppercase tracking-wider text-rose-600">
                        Udsolgt
                      </span>
                    )}
                  </div>
                </div>

                {cashGated ? (
                  <button
                    onClick={() => {
                      const showToast = (window as any).showToast;
                      if (typeof showToast === 'function') {
                        showToast('Verificér din identitet under Profil for at kunne udbetale kontanter.', 'info');
                      }
                    }}
                    className="shrink-0 inline-flex items-center gap-1.5 py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-97"
                    style={{
                      background: 'rgba(5, 54, 27, 0.06)',
                      color: '#05361B',
                      border: '1px solid rgba(5, 54, 27, 0.15)',
                    }}
                    title="Kræver CPR- eller MitID-verificering under Profil"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verificér
                  </button>
                ) : (
                  <button
                    onClick={() => !disabled && handleRedeem(r)}
                    disabled={disabled}
                    className={`shrink-0 inline-flex items-center gap-1.5 py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                      disabled ? 'opacity-50 cursor-not-allowed' : 'active:scale-97 hover:opacity-95'
                    }`}
                    style={{
                      background: disabled ? 'rgba(5, 54, 27, 0.08)' : '#F97E19',
                      color: disabled ? '#6E6E6E' : '#05361B',
                    }}
                  >
                    {isRedeeming ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Indløser…
                      </>
                    ) : (
                      <>
                        <Gift className="w-3.5 h-3.5" />
                        {canAfford ? 'Indløs' : 'For få point'}
                      </>
                    )}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
