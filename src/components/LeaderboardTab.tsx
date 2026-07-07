// F2.5 — LeaderboardTab: top-N via /api/leaderboard
// Fremhæver brugerens egen række via rank fra /api/dashboard, med navn-fallback.
// Ingen service-role i frontend.

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Leaf, Coins, AlertCircle, RefreshCw, User as UserIcon } from 'lucide-react';
import { UserProfile } from '../types';
import DashboardWidget from './DashboardWidget';

interface LeaderboardTabProps {
  user: UserProfile;
}

interface LeaderboardEntry {
  rank: number;
  name: string;
  level: number;
  member_status: string;
  points: number;
  co2_kg: number;
}

interface LeaderboardResponse {
  success: boolean;
  leaderboard?: LeaderboardEntry[];
  error?: string;
}

interface DashboardLite {
  success: boolean;
  leaderboard_rank?: number;
  profile?: {
    full_name?: string;
    display_name?: string;
    first_name?: string;
  };
  error?: string;
}

export default function LeaderboardTab({ user }: LeaderboardTabProps) {
  const firebaseUid = (user as any).uid || user.id;

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myFirstName, setMyFirstName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lbRes, dRes] = await Promise.all([
        fetch('/api/leaderboard?limit=10', { method: 'GET' }),
        fetch(`/api/dashboard?firebaseUid=${encodeURIComponent(firebaseUid)}`, { method: 'GET' }),
      ]);
      const lbJson: LeaderboardResponse = await lbRes.json();
      const dJson: DashboardLite = await dRes.json();

      if (!lbRes.ok || !lbJson.success || !lbJson.leaderboard) {
        setError(lbJson.error || 'Kunne ikke hente ranglisten lige nu.');
        setLoading(false);
        return;
      }
      setEntries(lbJson.leaderboard);

      if (dRes.ok && dJson.success) {
        if (typeof dJson.leaderboard_rank === 'number') {
          setMyRank(dJson.leaderboard_rank);
        }
        // Byg fornavn til navn-fallback-match
        const full = dJson.profile?.full_name || dJson.profile?.display_name || user.fullName || '';
        const first = dJson.profile?.first_name || (full ? full.split(' ')[0] : '');
        setMyFirstName(first);
      }
      setLoading(false);
    } catch (err: any) {
      setError('Netværksfejl — tjek forbindelsen og prøv igen.');
      setLoading(false);
    }
  }, [firebaseUid, user.fullName]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const isMe = (entry: LeaderboardEntry): boolean => {
    if (myRank !== null && entry.rank === myRank) return true;
    if (!myFirstName) return false;
    // Navn-fallback: get_leaderboard returnerer kun fornavn af privacy-hensyn
    return entry.name?.trim().toLowerCase() === myFirstName.trim().toLowerCase();
  };

  return (
    <div className="w-full max-w-lg mx-auto px-4 pt-4 pb-24 flex flex-col gap-5 select-none animate-in fade-in duration-200 text-left">
      {/* Live status-widget øverst */}
      <DashboardWidget user={user} />

      {/* Header */}
      <div
        className="rounded-3xl p-5 text-white shadow-lg relative overflow-hidden"
        style={{ background: '#05361B' }}
      >
        <div className="absolute right-0 top-0 w-32 h-32 rounded-full blur-2xl pointer-events-none" style={{ background: 'rgba(249, 126, 25, 0.15)' }} />
        <div className="flex items-center gap-2 relative">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(249, 126, 25, 0.2)' }}>
            <Trophy className="w-4 h-4" style={{ color: '#F97E19' }} />
          </span>
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest block leading-none" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Rangliste
            </span>
            <h3 className="text-sm font-black uppercase tracking-wider mt-1 leading-none">
              Cirkels top-genbrugere
            </h3>
          </div>
        </div>
        <p className="text-[11px] font-semibold mt-3 leading-normal relative" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {myRank
            ? `Du står lige nu på plads #${myRank}. Hver scan tæller — hold din stime i gang.`
            : 'Scan en emballage for at komme på ranglisten.'}
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 bg-white border border-gray-100 rounded-2xl animate-pulse" />
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
      {!loading && !error && entries.length === 0 && (
        <div className="text-center p-7 border-2 border-dashed border-gray-200 rounded-3xl bg-white/40">
          <span className="text-2xl">🏆</span>
          <p className="text-xs font-black text-primary mt-2">Ranglisten er endnu tom</p>
          <p className="text-[10px] font-semibold mt-1 leading-normal" style={{ color: '#6E6E6E' }}>
            Vær den første på Cirkels top-liste — scan en emballage nu.
          </p>
        </div>
      )}

      {/* Liste */}
      {!loading && !error && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const highlight = isMe(entry);
            const isTop3 = entry.rank <= 3;
            const rankBg = entry.rank === 1
              ? '#F97E19'
              : entry.rank === 2
              ? '#3B7A57'
              : entry.rank === 3
              ? '#F5E9DC'
              : 'rgba(5, 54, 27, 0.08)';
            const rankFg = entry.rank === 3 ? '#05361B' : (isTop3 ? '#ffffff' : '#05361B');

            return (
              <motion.div
                key={`${entry.rank}-${entry.name}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="rounded-2xl p-3 border flex items-center gap-3 shadow-sm"
                style={
                  highlight
                    ? {
                        background: '#F5E9DC',
                        borderColor: '#F97E19',
                        boxShadow: '0 0 0 2px rgba(249, 126, 25, 0.25)',
                      }
                    : { background: '#ffffff', borderColor: 'rgba(5, 54, 27, 0.1)' }
                }
              >
                {/* Rank-badge */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                  style={{ background: rankBg, color: rankFg }}
                >
                  {isTop3 ? (entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉') : `#${entry.rank}`}
                </div>

                {/* Navn + status */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black truncate" style={{ color: '#05361B' }}>
                      {entry.name}
                      {highlight && (
                        <span
                          className="ml-1.5 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                          style={{ background: '#F97E19', color: '#ffffff' }}
                        >
                          Dig
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] font-bold" style={{ color: '#6E6E6E' }}>
                      {entry.member_status} · lvl {entry.level}
                    </span>
                  </div>
                </div>

                {/* Point + CO2 */}
                <div className="flex flex-col items-end shrink-0 gap-0.5">
                  <div className="flex items-center gap-1">
                    <Coins className="w-3 h-3" style={{ color: '#F97E19' }} />
                    <span className="text-[11px] font-black" style={{ color: '#05361B' }}>
                      {entry.points}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Leaf className="w-3 h-3" style={{ color: '#3B7A57' }} />
                    <span className="text-[9px] font-bold" style={{ color: '#6E6E6E' }}>
                      {entry.co2_kg.toFixed(1)} kg CO₂
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Fallback-blok hvis brugeren ikke er i top-N men har rank */}
      {!loading && !error && entries.length > 0 && myRank !== null && myRank > entries.length && (
        <div className="mt-1">
          <span className="text-[9px] font-black uppercase tracking-widest block mb-1.5" style={{ color: '#6E6E6E' }}>
            Din placering
          </span>
          <div
            className="rounded-2xl p-3 border flex items-center gap-3"
            style={{ background: '#F5E9DC', borderColor: '#F97E19' }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
              style={{ background: '#F97E19', color: '#ffffff' }}
            >
              #{myRank}
            </div>
            <div className="flex-1 flex items-center gap-1.5">
              <UserIcon className="w-4 h-4" style={{ color: '#05361B' }} />
              <span className="text-xs font-black" style={{ color: '#05361B' }}>
                {myFirstName || user.fullName || 'Dig'} — bliv ved: scan flere for at rykke op.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
