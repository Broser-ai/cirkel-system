// F2.5 — DashboardWidget: viser Mortens LIVE tal via /api/dashboard
// Wire-mønster identisk med ScanTab.tsx (fetch mod egen /api/, ikke direkte Supabase-RPC).
// Ingen service-role i frontend — /api/dashboard håndterer det server-side.

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Coins, Wallet, Trophy, Flame, Leaf, Award as AwardIcon, Sparkles, AlertCircle
} from 'lucide-react';
import { UserProfile } from '../types';

interface DashboardWidgetProps {
  user: UserProfile;
}

interface DashboardResponse {
  success: boolean;
  profile?: {
    id?: string;
    balance?: number;
    points?: number;
    spendable_points?: number;
    lifetime_points?: number;
    member_status?: string;
    level?: number;
    streak_days?: number;
    total_co2_kg?: number;
    co2_saved_kg?: number;
  };
  recent_scans?: any[];
  kpi?: {
    total_scans?: number;
    total_points?: number;
    total_kroner?: number;
    total_co2_kg?: number;
  };
  achievements?: Array<{
    badge_id?: string;
    id?: string;
    title?: string;
    name?: string;
    emoji?: string;
    unlocked_at?: string;
  }>;
  leaderboard_rank?: number;
  error?: string;
}

export default function DashboardWidget({ user }: DashboardWidgetProps) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const firebaseUid = (user as any).uid || user.id;

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/dashboard?firebaseUid=${encodeURIComponent(firebaseUid)}`,
          { method: 'GET' }
        );
        const json: DashboardResponse = await res.json();
        if (!alive) return;
        if (!res.ok || !json.success) {
          setError(json.error || 'Kunne ikke hente dine tal lige nu.');
          setLoading(false);
          return;
        }
        setData(json);
        setLoading(false);
      } catch (err: any) {
        if (!alive) return;
        setError('Netværksfejl — tjek forbindelsen og prøv igen.');
        setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [firebaseUid]);

  // Loading state — skeleton med brand-ånd
  if (loading) {
    return (
      <div className="bg-white border border-gray-150 rounded-3xl p-5 shadow-sm animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 bg-gray-100 rounded-lg" />
          <div className="h-3 w-40 bg-gray-100 rounded" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-50 border border-gray-100 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  // Error state — hvad + næste skridt, ikke rå fejl
  if (error || !data || !data.profile) {
    return (
      <div className="bg-white border border-amber-200 rounded-3xl p-5 shadow-sm text-left">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-black text-primary uppercase tracking-wider">
              Din live status er ikke klar endnu
            </h4>
            <p className="text-[11px] text-muted-text font-semibold mt-1 leading-normal">
              Vi kunne ikke hente dine seneste tal. Prøv at scanne en emballage — så bygges dine tal op automatisk.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const profile = data.profile;
  const kpi = data.kpi || {};
  const achievements = data.achievements || [];
  const rank = data.leaderboard_rank;

  const spendable = profile.spendable_points ?? profile.points ?? 0;
  const lifetime = profile.lifetime_points ?? profile.points ?? 0;
  const balance = profile.balance ?? 0;
  const memberStatus = profile.member_status ?? 'Standard-medlem';
  const level = profile.level ?? 1;
  const streak = profile.streak_days ?? 0;
  const co2 = profile.total_co2_kg ?? profile.co2_saved_kg ?? kpi.total_co2_kg ?? 0;
  const totalScans = kpi.total_scans ?? 0;

  // Tag de nyeste 3 badges
  const recentBadges = achievements
    .slice()
    .sort((a, b) => {
      const at = a.unlocked_at ? new Date(a.unlocked_at).getTime() : 0;
      const bt = b.unlocked_at ? new Date(b.unlocked_at).getTime() : 0;
      return bt - at;
    })
    .slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="bg-white border border-gray-150 rounded-3xl p-5 shadow-sm text-left flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ background: 'rgba(59, 122, 87, 0.12)' }}>
            <Sparkles className="w-4 h-4" style={{ color: '#3B7A57' }} />
          </span>
          <h4 className="text-xs font-black text-primary uppercase tracking-wider">
            Din Cirkel — live
          </h4>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ color: '#05361B', borderColor: 'rgba(5, 54, 27, 0.15)', background: 'rgba(59, 122, 87, 0.08)' }}>
          {memberStatus}
        </span>
      </div>

      {/* KPI-kort — 2x2 grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Saldo (kr) */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5" style={{ color: '#05361B' }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#6E6E6E' }}>
              Saldo
            </span>
          </div>
          <span className="text-xl font-black tracking-tight" style={{ color: '#05361B' }}>
            {balance.toFixed(2)} kr
          </span>
        </div>

        {/* Point (spendable) */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5" style={{ color: '#F97E19' }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#6E6E6E' }}>
              Point (CP)
            </span>
          </div>
          <span className="text-xl font-black tracking-tight" style={{ color: '#05361B' }}>
            {spendable}
          </span>
          <span className="text-[9px] font-bold" style={{ color: '#6E6E6E' }}>
            {lifetime} livstid · lvl {level}
          </span>
        </div>

        {/* Streak */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5" style={{ color: '#F97E19' }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#6E6E6E' }}>
              Stime
            </span>
          </div>
          <span className="text-xl font-black tracking-tight" style={{ color: '#05361B' }}>
            {streak} {streak === 1 ? 'dag' : 'dage'}
          </span>
        </div>

        {/* CO2 */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Leaf className="w-3.5 h-3.5" style={{ color: '#3B7A57' }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#6E6E6E' }}>
              CO₂ sparet
            </span>
          </div>
          <span className="text-xl font-black tracking-tight" style={{ color: '#05361B' }}>
            {co2.toFixed(2)} kg
          </span>
          <span className="text-[9px] font-bold" style={{ color: '#6E6E6E' }}>
            {totalScans} {totalScans === 1 ? 'scan' : 'scans'} i alt
          </span>
        </div>
      </div>

      {/* Rank + Badges-række */}
      <div className="flex flex-col gap-2 pt-1 border-t border-gray-100">
        {typeof rank === 'number' && rank > 0 && (
          <div className="flex items-center justify-between bg-[#F5E9DC] border border-[#F5E9DC] rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4" style={{ color: '#F97E19' }} />
              <span className="text-[11px] font-black" style={{ color: '#05361B' }}>
                Din plads på ranglisten
              </span>
            </div>
            <span className="text-sm font-black" style={{ color: '#05361B' }}>
              #{rank}
            </span>
          </div>
        )}

        <div>
          <span className="text-[9px] font-black uppercase tracking-widest block mb-1.5" style={{ color: '#6E6E6E' }}>
            Seneste badges
          </span>
          {recentBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {recentBadges.map((b, i) => (
                <span
                  key={b.badge_id || b.id || i}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 border"
                  style={{ background: 'rgba(59, 122, 87, 0.08)', borderColor: 'rgba(59, 122, 87, 0.2)' }}
                  title={b.title || b.name || b.badge_id || 'Badge'}
                >
                  <AwardIcon className="w-3 h-3" style={{ color: '#3B7A57' }} />
                  <span className="text-[10px] font-black" style={{ color: '#05361B' }}>
                    {b.emoji ? `${b.emoji} ` : ''}{b.title || b.name || b.badge_id || 'Badge'}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] font-semibold leading-normal" style={{ color: '#6E6E6E' }}>
              Ingen badges endnu — scan din første emballage for at åbne dit første.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
