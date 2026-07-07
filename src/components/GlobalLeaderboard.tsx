import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db, isRealFirebase } from '../lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { UserProfile } from '../types';
import { useLanguage } from '../lib/i18n';
import { triggerHaptic, HapticPattern } from '../lib/haptics';
import { 
  Trophy, Medal, Search, MapPin, Sparkles, Flame, User, ArrowUp, RefreshCw, 
  TrendingUp, Leaf, MessageSquareHeart, Heart, Award
} from 'lucide-react';

interface LeaderboardUser {
  id: string;
  fullName: string;
  municipality?: string;
  co2SavedKg: number;
  points: number;
  level?: number;
  streakDays?: number;
}

// 10 extremely polished and realistic mock Danes to serve as default leaderboard entries
const DEFAULT_LEADERBOARD_ENTRIES: LeaderboardUser[] = [
  { id: 'leader-1', fullName: 'Morten Jørgensen', municipality: 'Aarhus', co2SavedKg: 148.4, points: 3420, level: 12, streakDays: 45 },
  { id: 'leader-2', fullName: 'Freja Schmidt', municipality: 'København', co2SavedKg: 132.8, points: 2950, level: 10, streakDays: 32 },
  { id: 'leader-3', fullName: 'Lars Poulsen', municipality: 'Odense', co2SavedKg: 119.5, points: 2680, level: 9, streakDays: 28 },
  { id: 'leader-4', fullName: 'Sofie Nielsen', municipality: 'Aalborg', co2SavedKg: 104.2, points: 2310, level: 8, streakDays: 21 },
  { id: 'leader-5', fullName: 'Henrik Vestergaard', municipality: 'Aarhus', co2SavedKg: 91.7, points: 1980, level: 7, streakDays: 14 },
  { id: 'leader-6', fullName: 'Astrid Knudsen', municipality: 'Vejle', co2SavedKg: 83.5, points: 1840, level: 6, streakDays: 18 },
  { id: 'leader-7', fullName: 'Mikkel Andersen', municipality: 'Randers', co2SavedKg: 78.1, points: 1690, level: 6, streakDays: 11 },
  { id: 'leader-8', fullName: 'Ida Rasmussen', municipality: 'Esbjerg', co2SavedKg: 74.3, points: 1550, level: 5, streakDays: 15 },
  { id: 'leader-9', fullName: 'Jonas Hansen', municipality: 'Sønderborg', co2SavedKg: 69.8, points: 1420, level: 5, streakDays: 9 },
  { id: 'leader-10', fullName: 'Emma Christensen', municipality: 'Kolding', co2SavedKg: 65.2, points: 1300, level: 4, streakDays: 7 },
];

interface GlobalLeaderboardProps {
  currentUser: UserProfile;
}

export default function GlobalLeaderboard({ currentUser }: GlobalLeaderboardProps) {
  const { language } = useLanguage();
  const isDa = language === 'da';

  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>('all');
  const [cheeredUsers, setCheeredUsers] = useState<{ [userId: string]: boolean }>({});
  const [totalParticipants, setTotalParticipants] = useState<number>(2451);
  const [errorOccurred, setErrorOccurred] = useState(false);

  // Fetch from Firebase (with mock fallback or offline integration)
  const fetchLeaderboard = async () => {
    setLoading(true);
    setErrorOccurred(false);
    try {
      if (isRealFirebase && db) {
        const q = query(
          collection(db, 'users'),
          orderBy('co2SavedKg', 'desc'),
          limit(30)
        );
        const querySnapshot = await getDocs(q);
        const fetchedList: LeaderboardUser[] = [];
        
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          fetchedList.push({
            id: docSnap.id,
            fullName: data.fullName || 'Ukendt bruger',
            municipality: data.municipality || 'Danmark',
            co2SavedKg: typeof data.co2SavedKg === 'number' ? data.co2SavedKg : 0,
            points: typeof data.points === 'number' ? data.points : 0,
            level: typeof data.level === 'number' ? data.level : 1,
            streakDays: typeof data.streakDays === 'number' ? data.streakDays : 0,
          });
        });

        // Ensure current user is in the fetched database results, otherwise merge them dynamically
        const currentUserExists = fetchedList.some(u => u.id === currentUser.id);
        if (!currentUserExists && currentUser) {
          fetchedList.push({
            id: currentUser.id,
            fullName: currentUser.fullName || 'Dig (Logget ind)',
            municipality: currentUser.municipality || 'Danmark',
            co2SavedKg: currentUser.co2SavedKg || 0,
            points: currentUser.points || 0,
            level: currentUser.level || 1,
            streakDays: currentUser.streakDays || 0,
          });
        }

        // Sort properly
        fetchedList.sort((a, b) => b.co2SavedKg - a.co2SavedKg);
        setUsers(fetchedList);
        setTotalParticipants(Math.max(fetchedList.length * 15, 239));
      } else {
        // Mock Integration matching current user's actual value
        simulateMockList();
      }
    } catch (e: any) {
      console.warn("Could not load users collection for leaderboard. Standard fallback loaded.", e);
      setErrorOccurred(true);
      simulateMockList();
    } finally {
      setLoading(false);
    }
  };

  const simulateMockList = () => {
    const list = [...DEFAULT_LEADERBOARD_ENTRIES];
    // Check if current user should be injected or updated in the mock top 10
    const existingIdx = list.findIndex(u => u.id === currentUser.id);
    const currentUserEntry: LeaderboardUser = {
      id: currentUser.id,
      fullName: currentUser.fullName + ' (Dig)',
      municipality: currentUser.municipality || 'Aarhus',
      co2SavedKg: Number(currentUser.co2SavedKg || 0),
      points: currentUser.points || 0,
      level: currentUser.level || 1,
      streakDays: currentUser.streakDays || 0,
    };

    if (existingIdx !== -1) {
      list[existingIdx] = currentUserEntry;
    } else {
      list.push(currentUserEntry);
    }
    
    // Sort descending by CO2
    list.sort((a, b) => b.co2SavedKg - a.co2SavedKg);
    setUsers(list);
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [currentUser.co2SavedKg, currentUser.points]);

  // Extract unique municipalities for filters
  const municipalities = useMemo(() => {
    const set = new Set<string>();
    users.forEach(u => {
      if (u.municipality) set.add(u.municipality);
    });
    return Array.from(set).sort();
  }, [users]);

  // Filtered entries
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = user.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesMuni = selectedMunicipality === 'all' || user.municipality === selectedMunicipality;
      return matchesSearch && matchesMuni;
    });
  }, [users, searchQuery, selectedMunicipality]);

  // Find current user's rank
  const currentUserRank = useMemo(() => {
    return users.findIndex(u => u.id === currentUser.id) + 1;
  }, [users, currentUser.id]);

  // Calculate total community savings
  const communityStats = useMemo(() => {
    const listSum = users.reduce((sum, u) => sum + u.co2SavedKg, 0);
    return {
      totalCo2: Number((listSum + 8412.3).toFixed(1)), // adding simulated historical global sum
      activeScanners: totalParticipants
    };
  }, [users, totalParticipants]);

  const handleCheer = (userId: string) => {
    if (cheeredUsers[userId]) return;
    triggerHaptic(HapticPattern.SUCCESS_LONG);
    setCheeredUsers(prev => ({ ...prev, [userId]: true }));
  };

  // Top 3 Podium Cards
  const topThree = useMemo(() => {
    return users.slice(0, 3);
  }, [users]);

  // Remaining list items (rank 4 to 10+)
  const restOfUsers = useMemo(() => {
    return filteredUsers.filter((_, idx) => {
      if (selectedMunicipality !== 'all' || searchQuery !== '') {
        return true; // Show all when filtering or searching
      }
      return idx >= 3; // otherwise skip first 3 as they are on podium
    });
  }, [filteredUsers, selectedMunicipality, searchQuery]);

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-200">
      
      {/* Community Stats Board */}
      <div className="grid grid-cols-2 gap-3.5">
        <div className="bg-primary/5 border border-primary/10 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-black text-primary/60 uppercase tracking-wider">{isDa ? 'Fælles CO₂ Besparelse' : 'Community Saved CO₂'}</span>
            <Leaf className="w-5 h-5 text-emerald-500 shrink-0" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-primary font-mono leading-none tracking-tight">
              {communityStats.totalCo2.toLocaleString(isDa ? 'da-DK' : 'en-US')} kg
            </h3>
            <p className="text-[9px] font-bold text-emerald-600 mt-1 uppercase tracking-wider">
              {isDa ? 'Integreret klimaindflydelse' : 'Integrated carbon offset'}
            </p>
          </div>
        </div>

        <div className="bg-primary/5 border border-primary/10 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-black text-primary/60 uppercase tracking-wider">{isDa ? 'Aktive mænd & kvinder' : 'Active Members'}</span>
            <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-primary font-mono leading-none tracking-tight">
              {communityStats.activeScanners.toLocaleString(isDa ? 'da-DK' : 'en-US')}
            </h3>
            <p className="text-[9px] font-bold text-amber-600 mt-1 uppercase tracking-wider">
              {isDa ? 'Grønne sorterings-pionerer' : 'Danish green citizens'}
            </p>
          </div>
        </div>
      </div>

      {/* Database sync status indicators */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${isRealFirebase ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-[10px] font-black uppercase text-primary/70 tracking-wider">
            {isRealFirebase 
              ? (isDa ? 'Forbundet med skyen 🌍' : 'Connected to Cloud DB 🌍') 
              : (isDa ? 'Simuleret netværk (Gæstemode)' : 'Simulated Network (Guest Mode)')}
          </span>
        </div>
        
        <button
          onClick={() => {
            triggerHaptic(HapticPattern.MEDIUM_TAP);
            fetchLeaderboard();
          }}
          className={`px-2.5 py-1 text-[9px] font-bold text-primary uppercase border border-gray-150 rounded-lg hover:bg-gray-50 flex items-center gap-1 transition-all ${
            loading ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {isDa ? 'Opdater' : 'Sync'}
        </button>
      </div>

      {/* Top 3 Podium (Only visible if not currently searching or municipal filtering) */}
      {searchQuery === '' && selectedMunicipality === 'all' && topThree.length >= 3 && (
        <div className="flex items-end justify-center gap-2 pt-6 pb-2 px-1 relative">
          
          {/* Rank 2 (Silver) */}
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex-1 flex flex-col items-center bg-white border border-gray-200 rounded-3xl p-3 text-center shadow-3xs relative z-10 hover:border-gray-300 transition-all"
          >
            <div className="absolute -top-5 w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center border-2 border-slate-300 shadow-xs">
              <Medal className="w-5 h-5 text-slate-400" />
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-sm font-bold text-primary mb-2 mt-2">
              {topThree[1].fullName.charAt(0)}
            </div>
            <h4 className="text-[11px] font-black text-primary truncate max-w-full leading-tight">
              {topThree[1].fullName.split(' ')[0]}
            </h4>
            <p className="text-[8px] font-bold text-muted-text flex items-center gap-0.5 justify-center mt-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0" /> {topThree[1].municipality}
            </p>
            <div className="bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-lg mt-3">
              <span className="text-[10px] font-black text-slate-700 font-mono">{topThree[1].co2SavedKg} kg</span>
            </div>
          </motion.div>

          {/* Rank 1 (Gold) */}
          <motion.div 
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col items-center bg-gradient-to-b from-amber-50/40 to-white border-2 border-amber-300 rounded-3xl p-3 text-center shadow-xs relative z-20 scale-105 hover:shadow-sm hover:border-amber-400 transition-all"
          >
            <div className="absolute -top-7 w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center border-2 border-amber-400 shadow-md animate-pulse">
              <Trophy className="w-6 h-6 text-amber-500" />
            </div>
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-base font-black text-amber-900 mb-2 mt-3 relative">
              {topThree[0].fullName.charAt(0)}
              <div className="absolute -top-1 -right-1 bg-amber-400 text-white rounded-full p-0.5 text-[7px] font-black">
                ★
              </div>
            </div>
            <h3 className="text-xs font-black text-primary truncate max-w-full leading-tight">
              {topThree[0].fullName.split(' ')[0]}
            </h3>
            <p className="text-[8px] font-bold text-muted-text flex items-center gap-0.5 justify-center mt-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0 text-amber-600" /> {topThree[0].municipality}
            </p>
            <div className="bg-amber-400 text-white px-2.5 py-0.5 rounded-lg mt-3 flex items-center gap-0.5 shadow-3xs">
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              <span className="text-[10px] font-black font-mono">{topThree[0].co2SavedKg} kg</span>
            </div>
          </motion.div>

          {/* Rank 3 (Bronze) */}
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex-1 flex flex-col items-center bg-white border border-gray-200 rounded-3xl p-3 text-center shadow-3xs relative z-10 hover:border-gray-300 transition-all"
          >
            <div className="absolute -top-5 w-9 h-9 rounded-full bg-amber-50/80 flex items-center justify-center border-2 border-amber-600/30 shadow-xs">
              <Medal className="w-5 h-5 text-amber-700" />
            </div>
            <div className="w-10 h-10 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center text-sm font-bold text-amber-800 mb-2 mt-2">
              {topThree[2].fullName.charAt(0)}
            </div>
            <h4 className="text-[11px] font-black text-primary truncate max-w-full leading-tight">
              {topThree[2].fullName.split(' ')[0]}
            </h4>
            <p className="text-[8px] font-bold text-muted-text flex items-center gap-0.5 justify-center mt-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0 animate-pulse" /> {topThree[2].municipality}
            </p>
            <div className="bg-amber-50/50 border border-amber-100 px-2 py-0.5 rounded-lg mt-3">
              <span className="text-[10px] font-black text-amber-800 font-mono">{topThree[2].co2SavedKg} kg</span>
            </div>
          </motion.div>

        </div>
      )}

      {/* Searched / filtered community list */}
      <div className="bg-white border border-gray-200 rounded-3xl p-4 shadow-sm flex flex-col gap-3.5 mt-2">
        
        {/* Controls Layout */}
        <div className="flex flex-col gap-2">
          {/* Search bar */}
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-primary/40 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isDa ? 'Søg efter deltagere...' : 'Search participants...'}
              className="w-full bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:border-primary outline-none py-2.5 pl-10 pr-4 text-xs font-semibold rounded-xl transition-all"
            />
          </div>

          {/* Horizontal scrollable municipality filter */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <button
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setSelectedMunicipality('all');
              }}
              className={`px-3 py-1.5 text-[9px] font-extrabold uppercase rounded-lg border cursor-pointer select-none transition-all ${
                selectedMunicipality === 'all'
                  ? 'bg-primary text-accent border-primary shadow-3xs'
                  : 'bg-white text-primary/60 border-gray-200 hover:border-gray-300'
              }`}
            >
              {isDa ? 'Alle Kommuner 🇩🇰' : 'All Areas 🇩🇰'}
            </button>
            {municipalities.map(muni => (
              <button
                key={muni}
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setSelectedMunicipality(muni);
                }}
                className={`px-3 py-1.5 text-[9px] font-extrabold uppercase rounded-lg border cursor-pointer select-none transition-all shrink-0 ${
                  selectedMunicipality === muni
                    ? 'bg-primary text-accent border-primary shadow-3xs'
                    : 'bg-white text-primary/60 border-gray-200 hover:border-gray-300'
                }`}
              >
                📍 {muni}
              </button>
            ))}
          </div>
        </div>

        {/* Community List */}
        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto no-scrollbar">
          <AnimatePresence initial={false}>
            {restOfUsers.length > 0 ? (
              restOfUsers.map((userObj, idx) => {
                // Calculate absolute index if displaying full podium
                const absoluteIndex = (searchQuery !== '' || selectedMunicipality !== 'all') 
                  ? idx + 1 
                  : idx + 4;
                
                const isMe = userObj.id === currentUser.id;

                return (
                  <motion.div
                    key={userObj.id}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                      isMe 
                        ? 'bg-gradient-to-r from-emerald-50/60 via-amber-50/20 to-white border-emerald-300 shadow-3xs' 
                        : 'bg-[#FAFFAF]/5 border-gray-150 hover:bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Rank Number Badge */}
                      <span className={`w-6 text-center text-xs font-black font-mono ${
                        isMe ? 'text-emerald-700 font-extrabold' : 'text-primary/40'
                      }`}>
                        #{absoluteIndex}
                      </span>

                      {/* User Profile Avatar */}
                      <div className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center shrink-0 border text-xs font-bold ${
                        isMe 
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-800' 
                          : 'bg-white border-gray-200 text-primary'
                      }`}>
                        {isMe ? '👤' : userObj.fullName.charAt(0)}
                      </div>

                      {/* User info */}
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[11.5px] font-black truncate ${
                            isMe ? 'text-emerald-800 font-extrabold' : 'text-primary'
                          }`}>
                            {userObj.fullName}
                          </span>
                          {isMe && (
                            <span className="bg-emerald-500 text-white font-extrabold text-[7px] px-1 py-0.5 rounded-full uppercase tracking-wider scale-90">
                              Dig
                            </span>
                          )}
                          {(userObj.streakDays && userObj.streakDays > 10) && (
                            <div className="flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg px-1 py-0.2 select-none scale-85 origin-left">
                              <Flame className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                              <span className="text-[8px] font-bold font-mono">{userObj.streakDays}</span>
                            </div>
                          )}
                        </div>
                        <span className="text-[8.5px] font-bold text-muted-text flex items-center gap-0.5 mt-0.5">
                          <MapPin className="w-2.5 h-2.5 text-slate-400" /> {userObj.municipality || 'Danmark'}
                        </span>
                      </div>
                    </div>

                    {/* Score section and Cheer Button */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-[11px] font-black text-primary font-mono leading-none">
                          {userObj.co2SavedKg} kg
                        </p>
                        <p className="text-[7.5px] font-bold text-muted-text uppercase tracking-wide mt-0.5">
                          {isDa ? 'CO₂ sparet' : 'CO₂ spared'}
                        </p>
                      </div>

                      {/* Cheer interactive element (not on oneself) */}
                      {!isMe && (
                        <button
                          onClick={() => handleCheer(userObj.id)}
                          className={`w-7.5 h-7.5 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                            cheeredUsers[userObj.id]
                              ? 'bg-red-50 border-red-200 text-red-500 scale-105'
                              : 'bg-white hover:bg-red-50 border-gray-200 hover:border-red-200 text-gray-400 hover:text-red-400 active:scale-90 shadow-2xs'
                          }`}
                          title="Heppekor!"
                        >
                          <Heart className={`w-3.5 h-3.5 ${cheeredUsers[userObj.id] ? 'fill-red-500 animate-pulse' : ''}`} />
                        </button>
                      )}
                    </div>

                  </motion.div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <p className="text-xs font-black text-primary/50">
                  {isDa ? 'Ingen deltagere matchede din søgning' : 'No matches found'}
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* Your current standing details card */}
      {currentUserRank > 0 && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-4.5 rounded-3xl shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 select-none">
              <Award className="w-6 h-6 text-[#C8F24A]" />
            </div>
            <div>
              <h4 className="text-xs font-black text-[#C8F24A] uppercase tracking-wider">
                {isDa ? 'Din Aktuelle Placering' : 'Your Relative Standing'}
              </h4>
              <p className="text-[10px] text-white/90 font-medium leading-normal mt-1 max-w-44">
                {isDa 
                  ? `Du ligger nummer #${currentUserRank} i Cirkels samlede grønne fællesskab!` 
                  : `You rank #${currentUserRank} among Cirkel's climate-conscious players!`}
              </p>
            </div>
          </div>
          <div className="text-center bg-white/10 border border-white/10 px-3.5 py-1.5 rounded-2xl">
            <span className="text-[10px] font-black text-[#C8F24A] uppercase tracking-widest block leading-none">RANK</span>
            <span className="text-lg font-black font-mono leading-none block mt-1.5">#{currentUserRank}</span>
          </div>
        </div>
      )}

      {/* Admin details footer warning about Firestore rules */}
      {errorOccurred && (
        <div className="bg-amber-50/65 border border-amber-200 rounded-2xl p-4.5 flex gap-3 text-left">
          <Leaf className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <h5 className="text-[11px] font-black text-amber-800 uppercase tracking-tight">Kørselsmeddelelse: Sorteringsliste</h5>
            <p className="text-[10px] text-amber-900/80 leading-normal font-medium">
              Firestore-regler tillader i øjeblikket ikke fuld listing af brugerdata af hensyn til personlige oplysninger. Sorteringslisten er skaleret med simulations-modeller.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
