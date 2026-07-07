import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHaptic, HapticPattern } from '../lib/haptics';
import { UserProfile } from '../types';
import { Camera, ShieldCheck, Mail, MapPin, Smartphone, Bell, Globe, HelpCircle, Info, LogOut, Award, Lock, CheckCircle2, Sparkles, Calendar, TrendingUp, BarChart3, Activity, Trophy, Users, Check, Share2, Copy, ExternalLink, X, Sun, Moon } from 'lucide-react';
import ImpactDashboard from './ImpactDashboard';
import AnimatedCount from './AnimatedCount';
import VerificationStatus from './VerificationStatus';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useLanguage } from '../lib/i18n';

const CustomChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-primary text-white border border-accent/20 p-2.5 rounded-xl shadow-lg text-[10px] font-sans">
        <p className="font-extrabold text-[#C8F24A] uppercase tracking-wider mb-1">
          {payload[0]?.payload?.fullDayName || label}
        </p>
        {payload.map((entry: any) => (
          <p key={entry.name} className="font-bold flex items-center gap-1.5 mt-0.5">
            <span 
              className="w-1.5 h-1.5 rounded-full" 
              style={{ backgroundColor: entry.stroke }} 
            />
            <span className="text-white/60">{entry.name}:</span>
            <span className="text-white font-black">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const CustomSixMonthTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-primary text-white border border-accent/20 p-2.5 rounded-xl shadow-lg text-[10px] font-sans">
        <p className="font-extrabold text-[#C8F24A] uppercase tracking-wider mb-1">
          {payload[0]?.payload?.fullMonthName || label}
        </p>
        {payload.map((entry: any) => (
          <p key={entry.name} className="font-bold flex items-center gap-1.5 mt-0.5">
            <span 
              className="w-1.5 h-1.5 rounded-full bg-emerald-400" 
            />
            <span className="text-white/60">{entry.name}:</span>
            <span className="text-white font-black">{entry.value} kg</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill?: string | CanvasGradient | CanvasPattern,
  stroke?: string | CanvasGradient | CanvasPattern,
  lineWidth: number = 1
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

interface ProfilTabProps {
  user: UserProfile;
  onChangeUser: (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => void;
  onLogout: () => void;
  isDarkMode?: boolean;
  setIsDarkMode?: (isDark: boolean) => void;
  onSimulateInactivity?: () => void;
}

const SUPPORTED_MUNICIPALITIES = [
  'Aarhus Kommune',
  'Københavns Kommune',
  'Odense Kommune',
  'Aalborg Kommune',
  'Esbjerg Kommune',
  'Randers Kommune',
  'Vejle Kommune',
];

interface BadgeMilestone {
  levelThreshold: number; // in kg
  name: string;
  emoji: string;
  description: string;
}

interface AchievementBadge {
  id: string;
  name: string;
  emoji: string;
  description: string;
  howToUnlock: string;
  isUnlocked: boolean;
  progressText: string;
  progressPercent: number;
}

const BADGES: BadgeMilestone[] = [
  { levelThreshold: 0, name: 'Grøn Spire', emoji: '🌱', description: 'Du er godt i gang! Hver genanvendt dåse og flaske gør en mærkbar forskel.' },
  { levelThreshold: 10, name: 'Plastik-Pioner', emoji: '🥤', description: 'Du er fantastisk til at sortere og mindske unødigt råstofspild.' },
  { levelThreshold: 25, name: 'Metal-Mester', emoji: '🥫', description: 'Dåser, metaller og sortering falder dig helt naturligt.' },
  { levelThreshold: 50, name: 'Cirkulær Champion', emoji: '♻️', description: 'Du genbruger på eliteniveau! Stort set intet går til spilde i dit hjem.' },
  { levelThreshold: 100, name: 'Planet-Redder', emoji: '🌍', description: 'Ultimativ grøn status. Din indsats inspirerer hele nabolaget!' }
];

interface RankTier {
  id: string;
  name: string;
  emoji: string;
  scoreRequired: number;
  perks: string;
  badgeBg: string;
  badgeTextColor: string;
}

const RANK_TIERS: RankTier[] = [
  {
    id: 'bronze',
    name: 'Grøn Novice',
    emoji: '🍃',
    scoreRequired: 0,
    perks: 'Standard 1x point optjening i Cirkel-netværket.',
    badgeBg: 'bg-amber-150 text-amber-900 border-amber-300',
    badgeTextColor: 'text-amber-800'
  },
  {
    id: 'silver',
    name: 'Miljø-Vogter',
    emoji: '☘️',
    scoreRequired: 500,
    perks: '1.1x guldpoint optjening + adgang til avancerede IoT logs.',
    badgeBg: 'bg-slate-100 text-slate-800 border-slate-300',
    badgeTextColor: 'text-slate-700'
  },
  {
    id: 'gold',
    name: 'Cirkulær Ambassadør',
    emoji: '💎',
    scoreRequired: 1500,
    perks: '1.25x point optjening + inviter venner med forhøjet bonus.',
    badgeBg: 'bg-yellow-100 text-yellow-900 border-yellow-300',
    badgeTextColor: 'text-amber-700'
  },
  {
    id: 'platinum',
    name: 'Klima-Ranger',
    emoji: '🌌',
    scoreRequired: 4000,
    perks: '1.5x point optjening + VIP partner tilbud og byttepas.',
    badgeBg: 'bg-teal-50 text-teal-900 border-teal-200',
    badgeTextColor: 'text-teal-800'
  },
  {
    id: 'legend',
    name: 'Biosfærens Frelser',
    emoji: '👑',
    scoreRequired: 8000,
    perks: 'Maks 2.0x point + særstatus på den ugentlige Cirkel rangliste!',
    badgeBg: 'bg-indigo-50 text-indigo-900 border-indigo-200',
    badgeTextColor: 'text-indigo-800'
  }
];

export default function ProfilTab({ 
  user, onChangeUser, onLogout, isDarkMode, setIsDarkMode, onSimulateInactivity 
}: ProfilTabProps) {
  const { t, language, setLanguage } = useLanguage();
  const [municipality, setMunicipality] = useState(user.municipality);
  const [showMuniSelector, setShowMuniSelector] = useState(false);
  const [activeBadgeId, setActiveBadgeId] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<'all' | 'scans' | 'co2'>('all');
  const [sixMonthView, setSixMonthView] = useState<'cumulative' | 'monthly'>('cumulative');
  const [leaderboardScope, setLeaderboardScope] = useState<'community' | 'national'>('community');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  // Persistent Notification States
  const [notifsEnabled, setNotifsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('cirkel_notifs_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [remindCollected, setRemindCollected] = useState<boolean>(() => {
    const saved = localStorage.getItem('cirkel_notifs_remind_collected');
    return saved !== null ? saved === 'true' : true;
  });
  const [remindEvents, setRemindEvents] = useState<boolean>(() => {
    const saved = localStorage.getItem('cirkel_notifs_remind_events');
    return saved !== null ? saved === 'true' : true;
  });
  const [reminderInterval, setReminderInterval] = useState<'3days' | 'weekly' | 'monthly'>(() => {
    return (localStorage.getItem('cirkel_notifs_interval') as any) || 'weekly';
  });
  const [showNotifAccordion, setShowNotifAccordion] = useState(false);
  const [activeToast, setActiveToast] = useState<{ message: string; sub: string; icon: string } | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareStyle, setShareStyle] = useState<'forest' | 'midnight' | 'neon'>('forest');
  const [shareCopied, setShareCopied] = useState(false);

  // Persistent Haptic Feedback State
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('haptics_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const handleHapticsToggle = (val: boolean) => {
    setHapticsEnabled(val);
    localStorage.setItem('haptics_enabled', String(val));
    if (val) {
      triggerHaptic(HapticPattern.LIGHT_TAP);
    }
  };

  const triggerTestToast = (type: 'collected' | 'event') => {
    if (type === 'collected') {
      setActiveToast({
        message: 'TID TIL NÆSTE CIRKEL DROP-POINT AFLEVERING ♻️',
        sub: `Hej ${user.fullName.split(' ')[0]}! Du har genanvendte genstande klar til aflevering. Gå til Cirkel-kortet for at finde dit nærmeste drop-point i ${municipality}!`,
        icon: '🔔'
      });
    } else {
      setActiveToast({
        message: 'NYT GENBRUGSEVENT NÆR DIG 📍',
        sub: `Der er planlagt fælles sorteringsdag og storskrald-rådgivning i ${municipality} på lørdag! Mød op og lær de helt nye retningslinjer at kende.`,
        icon: '📅'
      });
    }
    // Auto collapse after 6 seconds
    setTimeout(() => {
      setActiveToast(prev => prev);
    }, 6000);
  };

  const handleNotifToggle = (val: boolean) => {
    setNotifsEnabled(val);
    localStorage.setItem('cirkel_notifs_enabled', String(val));
  };

  const handleRemindCollectedToggle = (val: boolean) => {
    setRemindCollected(val);
    localStorage.setItem('cirkel_notifs_remind_collected', String(val));
  };

  const handleRemindEventsToggle = (val: boolean) => {
    setRemindEvents(val);
    localStorage.setItem('cirkel_notifs_remind_events', String(val));
  };

  const handleIntervalChange = (val: '3days' | 'weekly' | 'monthly') => {
    setReminderInterval(val);
    localStorage.setItem('cirkel_notifs_interval', val);
  };

  const totalWasteKg = Number((user.scansCount * 0.045).toFixed(1));

  // Streak & Fire Animations state
  const [prevStreak, setPrevStreak] = useState(user.streakDays);
  const [showFlameBurst, setShowFlameBurst] = useState(false);
  const [flameScale, setFlameScale] = useState(1);

  React.useEffect(() => {
    if (user.streakDays > prevStreak) {
      setShowFlameBurst(true);
      setFlameScale(1.8);
      triggerHaptic(HapticPattern.SUCCESS_LONG);
      
      const t1 = setTimeout(() => {
        setFlameScale(1);
      }, 500);

      const t2 = setTimeout(() => {
        setShowFlameBurst(false);
      }, 2500);

      setPrevStreak(user.streakDays);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else if (user.streakDays < prevStreak) {
      setPrevStreak(user.streakDays);
    }
  }, [user.streakDays, prevStreak]);

  // State to control full ranking guidelines display
  const [showRankDetails, setShowRankDetails] = useState(false);

  // Dynamic Score Formula: CO2Saved * 12 + scansCount * 6
  const userImpactScore = Math.round((user.co2SavedKg * 12) + (user.scansCount * 6));

  let currentRankIdx = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (userImpactScore >= RANK_TIERS[i].scoreRequired) {
      currentRankIdx = i;
    } else {
      break;
    }
  }

  const currentRank = RANK_TIERS[currentRankIdx];
  const nextRank = currentRankIdx < RANK_TIERS.length - 1 ? RANK_TIERS[currentRankIdx + 1] : null;

  // Let's compute progress metrics
  let rankProgressPercent = 100;
  let remainingScore = 0;
  if (nextRank) {
    const scoreRange = nextRank.scoreRequired - currentRank.scoreRequired;
    const completedInScoreRange = userImpactScore - currentRank.scoreRequired;
    rankProgressPercent = Math.min(Math.round((completedInScoreRange / scoreRange) * 100), 100);
    remainingScore = nextRank.scoreRequired - userImpactScore;
  }

  // Determine current badge and next badge based on recycled weight
  let currentBadgeIdx = 0;
  for (let i = 0; i < BADGES.length; i++) {
    if (totalWasteKg >= BADGES[i].levelThreshold) {
      currentBadgeIdx = i;
    } else {
      break;
    }
  }

  const currentBadge = BADGES[currentBadgeIdx];
  const nextBadge = currentBadgeIdx < BADGES.length - 1 ? BADGES[currentBadgeIdx + 1] : null;

  const shareText = `Jeg hjælper med at gøre Danmark grønnere via Cirkel! ♻️\n\n` +
    `🌳 Min indsats har sparet: ${user.co2SavedKg} kg CO₂\n` +
    `📦 Genanvendte emballager: ${user.scansCount} stk\n` +
    `🏆 Sorteringsniveau: ${currentBadge.name}\n` +
    `⚖️ Total genbrugt materiale: ${totalWasteKg} kg\n\n` +
    `Kom og vær med til at gøre en lokal forskel i ${municipality}! Hent Cirkel-appen i dag. 🌱`;

  const generateShareCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // Background Gradient Selection
    let gradient = ctx.createLinearGradient(0, 0, 800, 800);
    if (shareStyle === 'forest') {
      gradient.addColorStop(0, '#064e3b');
      gradient.addColorStop(1, '#022c22');
    } else if (shareStyle === 'midnight') {
      gradient.addColorStop(0, '#0f172a');
      gradient.addColorStop(0.5, '#030712');
      gradient.addColorStop(1, '#1e1b4b');
    } else { // neon style
      gradient.addColorStop(0, '#022c22');
      gradient.addColorStop(0.5, '#0f172a');
      gradient.addColorStop(1, '#111827');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 800);

    // Decorative graphics
    if (shareStyle === 'forest') {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)';
      ctx.lineWidth = 4;
      for (let i = 1; i <= 6; i++) {
        ctx.beginPath();
        ctx.arc(800, 800, i * 140, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(16, 185, 129, 0.04)';
      ctx.font = '240px sans-serif';
      ctx.fillText('🌲', 520, 720);
    } else if (shareStyle === 'midnight') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      const stars = [
        [150, 120], [620, 180], [350, 240], [110, 480],
        [710, 520], [210, 680], [580, 640], [450, 730],
        [80, 290], [690, 310]
      ];
      stars.forEach(([sx, sy]) => {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.random() * 2 + 1, 0, 2 * Math.PI);
        ctx.fill();
      });
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.font = '240px sans-serif';
      ctx.fillText('🌌', 500, 740);
    } else { // neon theme
      ctx.strokeStyle = 'rgba(200, 242, 74, 0.05)';
      ctx.lineWidth = 2;
      for (let x = 0; x <= 800; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 800);
        ctx.stroke();
      }
      for (let y = 0; y <= 800; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(800, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(200, 242, 74, 0.03)';
      ctx.font = '240px sans-serif';
      ctx.fillText('⚡', 540, 710);
    }

    // Outer premium border
    ctx.strokeStyle = shareStyle === 'neon' ? 'rgba(200, 242, 74, 0.25)' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 16;
    ctx.strokeRect(20, 20, 760, 760);

    // Inner fine border
    ctx.strokeStyle = shareStyle === 'neon' ? 'rgba(200, 242, 74, 0.1)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 36, 728, 728);

    // 1. HEADER BRANDING BOX
    const headerPillColor = shareStyle === 'neon' ? '#C8F24A' : 'rgba(255, 255, 255, 0.12)';
    const headerTextColor = shareStyle === 'neon' ? '#022c22' : '#ffffff';
    
    const pillW = 240;
    const pillH = 46;
    const pillX = 60;
    const pillY = 70;
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 12, headerPillColor);
    
    ctx.fillStyle = headerTextColor;
    ctx.font = 'bold 16px "Inter", sans-serif';
    ctx.fillText('CIRKEL STATSKORT', pillX + 32, pillY + 28);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.fillText(`📍 ${municipality}`, 60, 150);

    ctx.fillStyle = '#C8F24A';
    ctx.font = '48px "Inter", Arial';
    ctx.fillText('♻️', 690, 110);

    // 2. CENTRAL CO2 IMPACT MILESTONE
    const cardBgColor = 'rgba(15, 23, 42, 0.35)';
    const cardBorderColor = shareStyle === 'neon' ? 'rgba(200, 242, 74, 0.2)' : 'rgba(255, 255, 255, 0.1)';
    drawRoundedRect(ctx, 60, 185, 680, 215, 24, cardBgColor, cardBorderColor, 2);

    ctx.font = '64px sans-serif';
    ctx.fillText('🌳', 95, 275);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px "Inter", sans-serif';
    ctx.fillText(`${user.co2SavedKg} kg CO₂`, 190, 275);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = '800 12px "Inter", sans-serif';
    ctx.fillText('SAMLET CO₂ SPARRET FOR ATMOSFÆREN', 190, 310);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 332);
    ctx.lineTo(740, 332);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = 'bold 14px "Inter", sans-serif';
    ctx.fillText('NIVEAU', 95, 355);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.fillText(`${currentBadge.emoji} ${currentBadge.name}`, 95, 380);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = 'bold 14px "Inter", sans-serif';
    ctx.fillText('GENANVENDT EMBALLAGE', 420, 355);

    ctx.fillStyle = '#C8F24A';
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.fillText(`${totalWasteKg.toFixed(1)} kg (${user.scansCount} stk)`, 420, 380);

    // 3. BADGE / MILESTONE HERO BLOCK
    const badgeBgGradient = ctx.createLinearGradient(0, 430, 0, 710);
    badgeBgGradient.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    badgeBgGradient.addColorStop(1, 'rgba(255, 255, 255, 0.01)');
    drawRoundedRect(ctx, 60, 420, 680, 270, 24, badgeBgGradient, cardBorderColor, 2);

    ctx.fillStyle = 'rgba(200, 242, 74, 0.08)';
    ctx.beginPath();
    ctx.arc(175, 555, 80, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 242, 74, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '96px Arial';
    ctx.fillText(currentBadge.emoji, 125, 590);

    ctx.fillStyle = '#C8F24A';
    ctx.font = 'bold 16px "Inter", sans-serif';
    ctx.fillText('OPNÅET MILEPÆL', 285, 485);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Inter", sans-serif';
    ctx.fillText(currentBadge.name, 285, 530);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '15px "Inter", sans-serif';
    const originalDesc = currentBadge.description;
    const words = originalDesc.split(' ');
    let line1 = '';
    let line2 = '';
    let reachedLimit = false;

    words.forEach(word => {
      if (!reachedLimit && (line1 + ' ' + word).length < 42) {
        line1 += (line1 ? ' ' : '') + word;
      } else {
        reachedLimit = true;
        line2 += (line2 ? ' ' : '') + word;
      }
    });

    ctx.fillText(line1, 285, 570);
    ctx.fillText(line2, 285, 595);

    ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.font = 'bold 15px "Inter", sans-serif';
    ctx.fillText(`✓ Certificeret af Cirkel i ${municipality}`, 285, 640);

    // 4. CARD FOOTER ROW
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 715);
    ctx.lineTo(740, 715);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.fillText(user.fullName, 60, 750);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = 'bold 16px "Inter", sans-serif';
    ctx.fillText('CIRKEL.APP', 620, 750);

    return canvas;
  };

  const handleDownloadImage = () => {
    try {
      const canvas = generateShareCanvas();
      const imageURL = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `cirkel_-${currentBadge.name.toLowerCase().replace(' ', '_')}.png`;
      link.href = imageURL;
      link.click();

      setActiveToast({
        message: 'BILLEDE GEMT OG NEDE! 💾',
        sub: 'Det smukke delingsbillede er gemt i dine overførsler. Del det direkte på dine sociale medier!',
        icon: '✅'
      });
    } catch (e) {
      console.error("Canvas export failed:", e);
    }
  };

  const handleWebShare = async () => {
    try {
      const canvas = generateShareCanvas();
      canvas.toBlob(async (blob) => {
        if (!blob) {
          // Fallback if blob failed
          await shareTextFallback();
          return;
        }

        const file = new File([blob], `${currentBadge.name.toLowerCase().replace(/\s+/g, '_')}_milestone.png`, { type: 'image/png' });
        
        const canShareFiles = navigator.share && navigator.canShare && navigator.canShare({ files: [file] });

        if (canShareFiles) {
          try {
            await navigator.share({
              files: [file],
              title: 'Min Grønne Cirkel Indflydelse ♻️',
              text: shareText,
            });
            setActiveToast({
              message: 'BILLEDE DELT! 🚀',
              sub: 'Tak fordi du deler dit grønne engagement som et smukt billede!',
              icon: '✅'
            });
            setShowShareModal(false);
          } catch (shareErr) {
            console.log('Error sharing files, trying fallback:', shareErr);
            await shareTextFallback();
          }
        } else {
          await shareTextFallback();
        }
      }, 'image/png');
    } catch (err) {
      console.error('Error in canvas sharing:', err);
      await shareTextFallback();
    }
  };

  const shareTextFallback = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Min Grønne Cirkel Indflydelse ♻️',
          text: shareText,
          url: 'https://cirkel.app'
        });
        setActiveToast({
          message: 'INDHOLD DELT! 🚀',
          sub: 'Tak fordi du deler dit grønne engagement med verden!',
          icon: '✅'
        });
        setShowShareModal(false);
      } catch (err) {
        console.log('Error sharing:', err);
      }
    } else {
      handleCopyShare();
    }
  };

  const handleCopyShare = () => {
    navigator.clipboard.writeText(shareText);
    setShareCopied(true);
    setTimeout(() => {
      setShareCopied(false);
    }, 2000);
  };

  const communityLeaderboard = useMemo(() => {
    // 4 realistic competitors for local community sorting
    const localCompetitors = [
      { name: 'Morten S.', weight: 42.5, avatar: '🦊', badge: 'Cirkulær Champion', isCurrentUser: false },
      { name: 'Sofie L.', weight: 29.8, avatar: '🐼', badge: 'Metal-Mester', isCurrentUser: false },
      { name: 'Lars H.', weight: 14.5, avatar: '🐨', badge: 'Plastik-Pioner', isCurrentUser: false },
      { name: 'Signe K.', weight: 5.2, avatar: '🐰', badge: 'Grøn Spire', isCurrentUser: false },
    ];

    // 4 realistic competitors for national sorting
    const nationalCompetitors = [
      { name: 'Niels P. (Kbh)', weight: 148.5, avatar: '🦁', badge: 'Planet-Redder', isCurrentUser: false },
      { name: 'Emma J. (Odense)', weight: 92.4, avatar: '🦄', badge: 'Planet-Redder', isCurrentUser: false },
      { name: 'Lasse B. (Aalborg)', weight: 64.1, avatar: '🦉', badge: 'Cirkulær Champion', isCurrentUser: false },
      { name: 'Sofie L. (Aarhus)', weight: 29.8, avatar: '🐼', badge: 'Metal-Mester', isCurrentUser: false },
    ];

    const competitors = leaderboardScope === 'community' ? localCompetitors : nationalCompetitors;

    // Add current user dynamically with real total weight
    const allPlayers = [
      ...competitors,
      { 
        name: `${user.fullName} (Dig)`, 
        weight: totalWasteKg, 
        avatar: '👤', 
        badge: currentBadge.name, 
        isCurrentUser: true 
      }
    ];

    // Sort descending by weight
    const sorted = [...allPlayers].sort((a, b) => b.weight - a.weight);

    // Map ranks and limit to top 5
    return sorted.map((player, idx) => ({
      ...player,
      rank: idx + 1,
    })).slice(0, 5);
  }, [user.fullName, totalWasteKg, currentBadge.name, leaderboardScope]);

  const weeklyProgressData = useMemo(() => {
    const weekdaysLong = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];
    const today = new Date();
    const data = [];
    
    // Baseline distribution weights for the past 7 days (sum = 9.5)
    // Distributes overall stats across consecutive weekdays
    const weights = [0.8, 1.2, 0.7, 1.9, 1.1, 2.3, 1.5];
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dayLabel = weekdaysLong[d.getDay()];
      const ratio = weights[6 - i] / sumWeights;
      
      // Compute counts proportionally based on user actual profiles
      const scansCount = Math.max(0, Math.round(user.scansCount * ratio));
      const co2Value = Number((user.co2SavedKg * ratio).toFixed(1));
      
      data.push({
        day: `${dayLabel} ${d.getDate()}/${d.getMonth() + 1}`,
        'Scanninger': scansCount,
        'CO₂ besp. (kg)': co2Value,
        fullDayName: d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' })
      });
    }
    return data;
  }, [user.scansCount, user.co2SavedKg]);

  const sixMonthsProgressData = useMemo(() => {
    const monthsLong = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
    const today = new Date();
    const data = [];
    
    // Distribution weighting of CO2 saved each month over the last 6 months
    const monthlyWeights = [0.12, 0.15, 0.18, 0.16, 0.21, 0.18];
    const sumWeights = monthlyWeights.reduce((a, b) => a + b, 0);
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today);
      d.setMonth(today.getMonth() - i);
      const monthLabel = monthsLong[d.getMonth()];
      const yearLabel = d.getFullYear().toString().slice(-2);
      
      const ratio = monthlyWeights[5 - i] / sumWeights;
      const monthlyCo2 = Number((user.co2SavedKg * ratio).toFixed(1));
      
      // Calculate cumulative CO2 up to this month
      let cumulativeCo2 = 0;
      if (i === 0) {
        cumulativeCo2 = user.co2SavedKg;
      } else {
        const ratioSumSoFar = monthlyWeights.slice(0, 6 - i).reduce((a, b) => a + b, 0) / sumWeights;
        cumulativeCo2 = Number((user.co2SavedKg * ratioSumSoFar).toFixed(1));
      }
      
      data.push({
        month: `${monthLabel} '${yearLabel}`,
        'Månedlig CO₂ sparet (kg)': monthlyCo2,
        'Akkumuleret CO₂ sparet (kg)': cumulativeCo2,
        fullMonthName: d.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' })
      });
    }
    return data;
  }, [user.co2SavedKg]);

  const handleMunicipalityChange = (muni: string) => {
    setMunicipality(muni);
    onChangeUser(prev => {
      const updated = {
        ...prev,
        municipality: muni,
      };
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });
    setShowMuniSelector(false);
  };

  // Calculate percentage progress to next badge milestone
  let progressPercent = 100;
  let remainingKg = 0;
  if (nextBadge) {
    const range = nextBadge.levelThreshold - currentBadge.levelThreshold;
    const completedInRange = totalWasteKg - currentBadge.levelThreshold;
    progressPercent = Math.min(Math.round((completedInRange / range) * 100), 100);
    remainingKg = Number((nextBadge.levelThreshold - totalWasteKg).toFixed(1));
  }

  const achievements: AchievementBadge[] = [
    {
      id: 'eco_hero',
      name: 'Eco Hero',
      emoji: '🌱',
      description: 'Velkommen til dine grønne vaner! Denne bedrift låses op, når du har gennemført mindst 10 emballagescanninger.',
      howToUnlock: 'Scan 10 emballager',
      isUnlocked: user.scansCount >= 10,
      progressText: `${user.scansCount} / 10 scans`,
      progressPercent: Math.min(Math.round((user.scansCount / 10) * 100), 100),
    },
    {
      id: 'zero_waste_pro',
      name: 'Zero Waste Pro',
      emoji: '♻️',
      description: 'Du sorterer med omtanke! Denne titel låses op, når du har genanvendt mindst 25 kg samlet emballagevægt.',
      howToUnlock: 'Genbrug 25 kg emballage',
      isUnlocked: totalWasteKg >= 25,
      progressText: `${totalWasteKg} / 25 kg`,
      progressPercent: Math.min(Math.round((totalWasteKg / 25) * 100), 100),
    },
    {
      id: 'streak_master',
      name: 'Streak Master',
      emoji: '🔥',
      description: 'Urokkelig vane! Hold din genbrugsstime og sorteringsaktivitet kørende i mere end 7 på hinanden følgende dage.',
      howToUnlock: 'Nå en streak på 7 dage',
      isUnlocked: user.streakDays >= 7,
      progressText: `${user.streakDays} / 7 dage`,
      progressPercent: Math.min(Math.round((user.streakDays / 7) * 100), 100),
    },
    {
      id: 'pant_tycoon',
      name: 'Pant-Matador',
      emoji: '🪙',
      description: 'Udbetalingsekspert! Generer en samlet udbetalt pantesaldo på over 250 kr til din MobilePay.',
      howToUnlock: 'Optjen 250 kr saldo',
      isUnlocked: user.balance >= 250,
      progressText: `${user.balance.toFixed(0)} / 250 kr`,
      progressPercent: Math.min(Math.round((user.balance / 250) * 100), 100),
    },
    {
      id: 'co2_gladiator',
      name: 'CO₂-Gladiator',
      emoji: '🌍',
      description: 'Sand klima-kriger! Spar over 100 kg CO₂-udledning for atmosfæren gennem ugentlige genbrugssessioner.',
      howToUnlock: 'Spar over 100 kg CO₂',
      isUnlocked: user.co2SavedKg >= 100,
      progressText: `${user.co2SavedKg} / 100 kg`,
      progressPercent: Math.min(Math.round((user.co2SavedKg / 100) * 100), 100),
    }
  ];

  const unlockedCount = achievements.filter(a => a.isUnlocked).length;

  return (
    <div className="w-full max-w-lg mx-auto px-4 pt-4 pb-12 flex flex-col gap-6 relative">
      
      {/* Floating Interactive Toast Reminder Container */}
      {activeToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md mx-auto pointer-events-none animate-bounce-short">
          <div className="bg-primary text-white border border-[#C8F24A]/20 rounded-2xl p-4 shadow-xl flex items-start gap-3 pointer-events-auto bg-slate-900 border-l-[6px] border-l-[#C8F24A]">
            <span className="text-xl shrink-0 p-1 bg-white/10 rounded-xl leading-none flex items-center justify-center h-8 w-8">{activeToast.icon}</span>
            <div className="flex-1 min-w-0">
              <h5 className="text-[10px] font-black text-[#C8F24A] uppercase tracking-widest">{activeToast.message}</h5>
              <p className="text-[11px] text-white/90 font-medium mt-1 leading-relaxed">{activeToast.sub}</p>
            </div>
            <button 
              id="close-active-toast-btn"
              onClick={() => setActiveToast(null)}
              className="text-white/40 hover:text-white p-0.5 text-xs transition-colors shrink-0 font-extrabold"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col items-center bg-white border border-gray-200 rounded-3xl p-6 shadow-sm relative">
        <div className="relative w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center border-2 border-primary/10">
          <span className="text-4xl">👤</span>
          <div className="absolute right-0 bottom-0 bg-accent p-1.5 rounded-full border-2 border-white">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          </div>
        </div>
        
        <h3 className="text-xl font-black text-primary mt-4 tracking-tight">
          {user.fullName}
        </h3>
        <p className="text-xs font-semibold text-muted-text mt-1">{user.email}</p>

        <div className="bg-amber-100 border border-amber-200 py-1 px-4 rounded-full mt-3 flex items-center gap-1.5">
          <span className="text-[10px] font-black text-amber-800">⭐ {user.memberStatus}</span>
          <span className="text-amber-400 font-extrabold text-[10px]">·</span>
          <span className="text-[10px] font-black text-amber-800">Level {user.level}</span>
        </div>

        {/* Share Impact Button */}
        <button
          id="share-impact-trigger-btn"
          onClick={() => setShowShareModal(true)}
          className="mt-3.5 w-full max-w-[180px] py-2 px-3 border border-gray-200 hover:border-gray-300 rounded-xl bg-gray-50/50 hover:bg-gray-50 text-[9.5px] font-black text-primary uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer hover:shadow-3xs active:scale-97 transition-all focus:outline-none"
        >
          <Share2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Del Grøn Indflydelse</span>
        </button>
      </div>

      {/* Trust & Verification Tier Indicator */}
      <VerificationStatus 
        user={user} 
        onChangeUser={onChangeUser} 
        onToast={setActiveToast} 
      />

      {/* Daily Recycling Goal Section */}
      <div id="daily-recycling-goal-card" className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center text-emerald-850 shrink-0">
            <span className="text-xl">🎯</span>
          </div>
          <div>
            <span className="text-[9px] font-black text-muted-text uppercase tracking-widest leading-none">
              {language === 'da' ? 'Individuelle mål' : 'Personal Targets'}
            </span>
            <h4 className="text-sm font-black text-primary tracking-tight mt-0.5">
              {language === 'da' ? 'Dagligt Genbrugsmål' : 'Daily Recycling Goal'}
            </h4>
          </div>
        </div>

        <p className="text-[11px] font-semibold text-muted-text leading-relaxed text-justify">
          {language === 'da' 
            ? 'Sæt et dagligt mål for, hvor mange emballager du vil scanne og sortere korrekt. Fuldfør målet hver dag for at holde din grønne stime i gang!'
            : "Set a daily target of items to scan and recycle correctly. Achieve your target daily to maintain your green streak!"}
        </p>

        {/* Goal Selector Controls */}
        <div className="grid grid-cols-5 gap-1 bg-gray-50 p-1.5 rounded-2xl border border-gray-150">
          {[0, 1, 3, 5, 10].map((goalVal) => {
            const isSelected = (user.dailyRecyclingGoal ?? 3) === goalVal;
            return (
              <button
                id={`daily-goal-${goalVal}-option`}
                key={goalVal}
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  onChangeUser({ dailyRecyclingGoal: goalVal });
                  
                  // Trigger interactive micro-toast inside ProfilTab
                  setActiveToast({
                    message: language === 'da' ? 'MÅL OPDATERET 🎯' : 'GOAL UPDATED 🎯',
                    sub: goalVal === 0 
                      ? (language === 'da' ? 'Dagligt genbrugsmål er blevet slået fra.' : 'Daily recycling goal has been disabled.')
                      : (language === 'da' 
                          ? `Dit nye daglige mål er sat til ${goalVal} emballage-scanninger!` 
                          : `Your new daily target is set to ${goalVal} recycled items!`),
                    icon: '🚀'
                  });
                }}
                className={`py-3 px-1 rounded-xl text-center flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${
                  isSelected 
                    ? 'bg-primary text-[#C8F24A] font-black shadow-xs ring-2 ring-primary/10 animate-pulse-short' 
                    : 'hover:bg-gray-150 text-primary font-bold'
                }`}
              >
                <span className={`text-[12px] font-black ${isSelected ? 'scale-110' : ''}`}>
                  {goalVal === 0 ? '❌' : goalVal}
                </span>
                <span className="text-[8px] font-black uppercase tracking-wider block opacity-85">
                  {goalVal === 0 
                    ? (language === 'da' ? 'Fra' : 'Off') 
                    : (language === 'da' ? 'emner' : 'items')}
                </span>
              </button>
            );
          })}
        </div>

        {/* Dynamic status helper text based on goal choice */}
        <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-md">✨</span>
            <span className="font-extrabold text-emerald-950">
              {(user.dailyRecyclingGoal ?? 3) === 0 ? (
                language === 'da' ? 'Sæt et mål for at få fremskridtsvisning' : 'Set a target to enable progress bars'
              ) : (
                language === 'da' 
                  ? `Mål: ${user.dailyRecyclingGoal ?? 3} emballage-scanninger i dag` 
                  : `Target: ${user.dailyRecyclingGoal ?? 3} item scans for today`
              )}
            </span>
          </div>
          <span className="text-[10px] font-black text-emerald-800 uppercase bg-emerald-150/50 px-2.5 py-0.5 rounded-lg font-mono">
            {(user.dailyRecyclingGoal ?? 3) === 0 ? (
              language === 'da' ? 'inaktiv' : 'inactive'
            ) : (user.dailyRecyclingGoal ?? 3) <= 1 ? (
              language === 'da' ? 'mild' : 'gentle'
            ) : (user.dailyRecyclingGoal ?? 3) <= 3 ? (
              language === 'da' ? 'aktiv' : 'active'
            ) : (user.dailyRecyclingGoal ?? 3) <= 5 ? (
              language === 'da' ? 'øko-helt' : 'eco hero'
            ) : (
              language === 'da' ? 'super' : 'super'
            )}
          </span>
        </div>
      </div>

      {/* Recycling Level & Badge Progress Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-accent/20 rounded-xl flex items-center justify-center text-xl shrink-0">
              {currentBadge.emoji}
            </span>
            <div>
              <span className="text-[9px] font-black text-muted-text uppercase tracking-widest leading-none">Nuværende Badge</span>
              <h4 className="text-sm font-black text-primary tracking-tight mt-0.5">{currentBadge.name}</h4>
            </div>
          </div>
          
          <div className="text-right">
            <span className="text-[9px] font-black text-muted-text uppercase tracking-widest leading-none block">Genanvendt</span>
            <span className="text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md mt-0.5 inline-block">
              <AnimatedCount value={totalWasteKg} decimals={1} duration={1200} /> kg / {nextBadge ? `${nextBadge.levelThreshold} kg` : 'Maks'}
            </span>
          </div>
        </div>

        <p className="text-[11px] font-semibold text-muted-text leading-relaxed">
          {currentBadge.description}
        </p>

        {/* Progress Bar Container */}
        <div className="flex flex-col gap-1.5 mt-1">
          <div className="flex justify-between text-[10px] font-black text-primary uppercase">
            <span>Level {user.level}</span>
            {nextBadge ? (
              <span className="text-muted-text">Mod {nextBadge.name} ({progressPercent}%)</span>
            ) : (
              <span className="text-amber-500 font-black">Ultimativt Niveau 🏆</span>
            )}
          </div>
          
          {/* Main Progress Bar Track */}
          <div className="w-full h-3.5 bg-gray-100 rounded-full overflow-hidden p-0.5 border border-gray-150">
            <div 
              style={{ width: `${progressPercent}%` }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-accent transition-all duration-1000 ease-out flex items-center justify-end pr-1 shadow-sm"
            >
              {progressPercent > 12 && (
                <span className="text-[7.5px] font-black text-primary select-none font-mono">
                  {progressPercent}%
                </span>
              )}
            </div>
          </div>

          {nextBadge && (
            <span className="text-[10px] font-bold text-muted-text">
              Mangler kun <span className="font-extrabold text-primary">{remainingKg} kg</span> emballage for at opnå {nextBadge.emoji} <span className="font-extrabold text-primary">{nextBadge.name}</span>.
            </span>
          )}
        </div>

        {/* Quick horizontal badge list displaying milestones */}
        <div className="border-t border-gray-100 pt-3.5 mt-0.5">
          <span className="text-[9px] font-black text-muted-text uppercase tracking-widest block mb-2">Alle niveauer</span>
          <div className="grid grid-cols-5 gap-1.5">
            {BADGES.map((badge, idx) => {
              const isLocked = totalWasteKg < badge.levelThreshold;
              const isCurrent = idx === currentBadgeIdx;
              return (
                <div 
                  key={badge.name} 
                  className={`flex flex-col items-center text-center p-1.5 rounded-xl border transition-all ${
                    isCurrent 
                      ? 'bg-primary/5 border-primary/20 scale-102 shadow-none' 
                      : isLocked 
                        ? 'bg-gray-50/40 border-gray-100 opacity-50 grayscale'
                        : 'bg-white border-emerald-100 shadow-sm'
                  }`}
                  title={`${badge.name}: ${badge.levelThreshold} kg`}
                >
                  <span className="text-lg">{badge.emoji}</span>
                  <span className="text-[8px] font-black text-primary leading-none mt-1.5 truncate max-w-full">
                    {badge.name.split('-')[0]}
                  </span>
                  <span className="text-[7px] font-black text-muted-text leading-none mt-0.5 font-mono">
                    {badge.levelThreshold}kg
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. Cirkel Klimarank System */}
      <div id="cirkel-klimarank-card" className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center text-xl shrink-0">
              👑
            </span>
            <div className="text-left">
              <span className="text-[9px] font-black text-muted-text uppercase tracking-widest leading-none">Cirkel Klimarank</span>
              <h4 className="text-sm font-black text-primary tracking-tight mt-0.5">Din Sorterings-Status</h4>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[9px] font-black text-muted-text uppercase tracking-widest leading-none block">Indflydelsespoint</span>
            <span className="text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 rounded-md mt-0.5 inline-block font-mono">
              <AnimatedCount value={userImpactScore} decimals={0} duration={1200} /> pts
            </span>
          </div>
        </div>

        {/* Dynamic Rank Badge Tag */}
        <div className="flex items-center gap-3 bg-[#FAF9F6] border border-gray-150 p-3.5 rounded-2xl text-left">
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center text-2xl shrink-0 shadow-3xs ${currentRank.badgeBg}`}>
            {currentRank.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-black uppercase text-muted-text tracking-wider">Aktuel Rank:</span>
              <span className={`text-[10px] font-black uppercase tracking-wider ${currentRank.badgeTextColor}`}>
                {currentRank.name}
              </span>
            </div>
            <p className="text-[11px] font-bold text-primary mt-0.5 leading-snug">
              Beregnet ud fra dine CO₂-besparelser og scanninger. {nextRank ? `Mangler ${remainingScore} pts til næste rank.` : 'Du har opnået det ultimative sorterings-niveau!'}
            </p>
          </div>
        </div>

        {/* Progress bar to next rank */}
        {nextRank && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[10px] font-black text-primary uppercase">
              <span>{currentRank.name}</span>
              <span className="text-muted-text">Næste Rank: {nextRank.name} ({rankProgressPercent}%)</span>
            </div>
            
            {/* Main Progress Bar Track */}
            <div className="w-full h-3 border border-gray-150 bg-gray-50 rounded-full overflow-hidden p-0.5">
              <div 
                style={{ width: `${rankProgressPercent}%` }}
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 ease-out flex items-center justify-end pr-1 shadow-3xs"
              />
            </div>

            <span className="text-[10px] font-semibold text-muted-text block text-left">
              Fremdrift baseret på: <span className="font-extrabold text-primary">{user.co2SavedKg} kg CO₂</span> sparet og <span className="font-extrabold text-primary">{user.scansCount} scanninger</span>.
            </span>
          </div>
        )}

        {/* Dynamic Activity/CO2 Contribution Score breakdown */}
        <div className="border-t border-gray-100 pt-3.5 mt-0.5">
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[9px] font-black text-muted-text uppercase tracking-widest block">Point-beregning</span>
            <button
              id="toggle-rank-details-btn"
              type="button"
              onClick={() => setShowRankDetails(!showRankDetails)}
              className="text-[9px] font-black uppercase text-emerald-600 hover:text-emerald-700 tracking-wider flex items-center gap-1 cursor-pointer"
            >
              <span>{showRankDetails ? 'Skjul detaljer' : 'Se hele rangstien'}</span>
              <span>{showRankDetails ? '▲' : '▼'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-left">
            <div className="bg-[#FAF9F6] border border-gray-150 p-2.5 rounded-xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] font-black text-muted-text uppercase tracking-widest block">CO₂ Bidrag</span>
                <span className="text-xs font-black text-primary block mt-0.5">{user.co2SavedKg} kg CO₂ sparet</span>
              </div>
              <span className="text-[10px] font-extrabold text-emerald-700 font-mono mt-1.5 block">
                +{(user.co2SavedKg * 12).toFixed(0)} points <span className="text-[8px] text-muted-text font-normal font-sans">(12 pts/kg)</span>
              </span>
            </div>

            <div className="bg-[#FAF9F6] border border-gray-150 p-2.5 rounded-xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] font-black text-muted-text uppercase tracking-widest block">Søgninger & Scans</span>
                <span className="text-xs font-black text-primary block mt-0.5">{user.scansCount} scanninger udført</span>
              </div>
              <span className="text-[10px] font-extrabold text-[#4F46E5] font-mono mt-1.5 block">
                +{(user.scansCount * 6).toFixed(0)} points <span className="text-[8px] text-muted-text font-normal font-sans">(6 pts/scan)</span>
              </span>
            </div>
          </div>

          {/* Expanded Rank Path Guidelines (shown if toggled) */}
          {showRankDetails && (
            <div id="expanded-ranking-guidelines" className="mt-4 border-t border-dashed border-gray-200 pt-3 flex flex-col gap-2.5 text-left animate-fade-in">
              <span className="text-[9px] font-black text-muted-text uppercase tracking-widest block">Rangeringsniveauer og fordele</span>
              
              <div className="flex flex-col gap-1.5">
                {RANK_TIERS.map((tier) => {
                  const isCurrent = currentRank.id === tier.id;
                  const isUnlocked = userImpactScore >= tier.scoreRequired;
                  return (
                    <div 
                      id={`rank-tier-item-${tier.id}`}
                      key={tier.id}
                      className={`p-2.5 rounded-xl border flex gap-3 items-start transition-all ${
                        isCurrent 
                          ? 'border-[#C8F24A] bg-[#C8F24A]/5 ring-1 ring-[#C8F24A]/20' 
                          : isUnlocked 
                            ? 'border-gray-200 bg-emerald-50/20' 
                            : 'border-gray-150 bg-gray-50/50 opacity-60'
                      }`}
                    >
                      <span className="text-xl leading-none mt-0.5 shrink-0 font-sans">{tier.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-black uppercase ${isCurrent ? 'text-primary' : 'text-gray-500'}`}>
                            {tier.name} {isCurrent && '(Din Rank)'}
                          </span>
                          <span className="text-[9px] font-black font-mono text-muted-text uppercase">
                            {tier.scoreRequired} pts
                          </span>
                        </div>
                        <p className="text-[10px] font-bold text-muted-text mt-0.5 leading-snug font-sans">
                          {tier.perks}
                        </p>
                      </div>
                      {isUnlocked && (
                        <span className="text-emerald-600 text-xs font-black shrink-0 mt-0.5">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compact Wallets & Streak Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <span className="text-xl bg-teal-50 w-10 h-10 rounded-xl flex items-center justify-center shrink-0">💰</span>
          <div>
            <p className="text-base font-black text-primary">{user.balance.toFixed(2)} kr</p>
            <p className="text-[9px] font-bold text-muted-text uppercase">Saldo til udbetaling</p>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <motion.span 
            animate={{ 
              scale: showFlameBurst ? [1, 1.4, 1] : 1,
              rotate: showFlameBurst ? [0, -10, 10, -10, 10, 0] : 0
            }}
            transition={{ duration: 0.6 }}
            className="text-xl bg-amber-50 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 origin-center"
          >
            🔥
          </motion.span>
          <div>
            <p className="text-base font-black text-primary">{user.streakDays} dage</p>
            <p className="text-[9px] font-bold text-muted-text uppercase">Aktiv streak</p>
          </div>
        </div>
      </div>

      {/* Visual & Interactive Recycling Streak Habit Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <motion.div 
              animate={{ 
                scale: flameScale,
                rotate: showFlameBurst ? [0, -12, 12, -12, 12, 0] : 0
              }}
              transition={{ duration: 0.6 }}
              className="p-1 px-1.5 bg-amber-50 border border-amber-200 rounded-lg text-sm shrink-0 animate-pulse relative"
            >
              🔥
              <AnimatePresence>
                {showFlameBurst && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    {[...Array(6)].map((_, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 1, scale: 0.3, y: 0, x: 0 }}
                        animate={{ 
                          opacity: 0, 
                          scale: [0.6, 1.3, 0.4], 
                          y: -35 - Math.random() * 30, 
                          x: (Math.random() - 0.5) * 45,
                          rotate: (Math.random() - 0.5) * 180
                        }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.4, ease: "easeOut" }}
                        className="absolute text-xs select-none"
                      >
                        {['🔥', '✨', '⚡', '🔥', '💥', '🔥'][i % 6]}
                      </motion.span>
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
            <div>
              <h4 className="text-sm font-black text-primary tracking-tight uppercase">Genbrugs-Streak</h4>
              <p className="text-[9px] text-muted-text font-bold">Hold liv i din daglige sorteringsvane</p>
            </div>
          </div>
          <div className="flex bg-amber-50/50 border border-amber-100 px-3 py-1.5 rounded-2xl items-center gap-1 shrink-0 shadow-3xs relative overflow-visible">
            <motion.span 
              animate={{ 
                scale: showFlameBurst ? [1, 1.7, 1] : [1, 1.05, 1],
                rotate: showFlameBurst ? [0, 20, -20, 20, -20, 0] : [0, -2, 2, -2, 2, 0]
              }}
              transition={{ 
                scale: { duration: 0.7, ease: "easeInOut" },
                rotate: showFlameBurst ? { duration: 0.7 } : { duration: 2, repeat: Infinity, repeatType: "mirror" }
              }}
              className="text-base select-none inline-block origin-bottom"
            >
              🔥
            </motion.span>
            <span className="text-sm font-black text-amber-800 font-mono leading-none">{user.streakDays}</span>
            <span className="text-[8px] font-black text-amber-700/80 uppercase tracking-wider leading-none ml-0.5">DAGE</span>
          </div>
        </div>

        {/* 7-Day progress visual track */}
        <div className="flex flex-col gap-2">
          <span className="text-[8.5px] font-bold text-muted-text uppercase tracking-widest block">Dine seneste 7 dage</span>
          
          <div className="grid grid-cols-7 gap-1 bg-gray-50/80 border border-gray-150 p-2 rounded-2xl">
            {weeklyProgressData.map((dayData, idx) => {
              // Extract just the day initials e.g. "Man"
              const dayInitials = dayData.day.split(' ')[0] || '';
              const dateNumber = dayData.day.split(' ')[1] || '';
              const hasScanned = dayData['Scanninger'] > 0;
              const isToday = idx === 6; // last item in weeklyProgressData is always today

              return (
                <div 
                  key={dayData.day} 
                  className={`flex flex-col items-center text-center p-1.5 rounded-xl border relative transition-all ${
                    isToday
                      ? 'bg-white border-amber-300 ring-1 ring-amber-105 shadow-3xs'
                      : hasScanned
                        ? 'bg-white border-gray-200 shadow-4xs'
                        : 'bg-gray-100/50 border-gray-150/40 opacity-60'
                  }`}
                >
                  {/* Small Today Tag */}
                  {isToday && (
                    <span className="absolute -top-1 bg-amber-500 text-white font-black text-[5px] px-1 rounded-full uppercase leading-none select-none tracking-widest">
                      IDAG
                    </span>
                  )}

                  <span className="text-[8px] font-black text-primary/80 uppercase mb-1">{dayInitials}</span>
                  
                  {/* Icon Status Indicator */}
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all ${
                    hasScanned 
                      ? 'bg-amber-100 border border-amber-200 scale-102 font-bold animate-in zoom-in-50' 
                      : 'bg-gray-200/50 border border-dashed border-gray-300'
                  }`}>
                    {hasScanned ? '🔥' : '●'}
                  </div>

                  <span className="text-[7.5px] font-bold text-muted-text font-mono mt-1.5">{dateNumber}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Streak Stats Breakdown */}
        <div className="grid grid-cols-2 gap-2 mt-0.5">
          <div className="bg-[#FAF9F6] border border-gray-150 p-3 rounded-xl flex items-center gap-2.5">
            <span className="text-xl">🎯</span>
            <div>
              <span className="text-[8px] font-bold text-muted-text uppercase tracking-wider block">Dagens Gøremål</span>
              <span className={`text-[10px] font-extrabold block leading-normal ${user.scansCount > 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                {user.scansCount > 0 ? '✓ Scan udført' : '⚡ 0 / 1 scan i dag'}
              </span>
            </div>
          </div>
          <div className="bg-[#FAF9F6] border border-gray-150 p-3 rounded-xl flex items-center gap-2.5">
            <span className="text-xl">🏆</span>
            <div>
              <span className="text-[8px] font-bold text-muted-text uppercase tracking-wider block">Længste Streak</span>
              <span className="text-[10px] font-black text-primary leading-normal">{Math.max(user.streakDays, 14)} dage</span>
            </div>
          </div>
        </div>

        {/* Interactive simulation area */}
        <div className="bg-[#FAF9F6] border border-gray-150 p-3 rounded-2xl flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-black text-primary uppercase tracking-widest block">Streak Simulator</span>
            <span className="text-[8px] font-bold text-muted-text uppercase">Leg & test i appen</span>
          </div>
          <p className="text-[10px] text-muted-text font-semibold leading-relaxed">
            Test streak-beregningen ved at foretage et simuleret scan i dag. Det vil øge din streak og tænde dagens flamme!
          </p>
          <button
            id="simulate-streak-scan-btn"
            onClick={() => {
              onChangeUser(prev => {
                const nextStreak = prev.streakDays + 1;
                const nextScans = prev.scansCount + 1;
                const updated = {
                  ...prev,
                  streakDays: nextStreak,
                  scansCount: nextScans,
                  co2SavedKg: Number((prev.co2SavedKg + 0.15).toFixed(1)),
                  balance: Number((prev.balance + 1.00).toFixed(2)),
                  points: prev.points + 20
                };
                localStorage.setItem('cirkel_user', JSON.stringify(updated));
                return updated;
              });

              setActiveToast({
                message: 'STREAK FORLÆNGET OG UDVIDET! 🔥',
                sub: `Fedt! Din streak er oppe på ${user.streakDays + 1} dage i træk. Du har modtaget +1,00 kr og +20 CP i streak-bonussaldo!`,
                icon: '🔥'
              });
            }}
            className="w-full py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black text-[10px] uppercase rounded-xl transition-all shadow-xs cursor-pointer select-none tracking-widest text-center"
          >
            🔥 Forlæng min streak med nyt scan (+1 dag)
          </button>
        </div>
      </div>

      {/* Sustainable Environmental Impact Dashboard */}
      <ImpactDashboard user={user} />

      {/* Weekly Insight Chart Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-[#FAF9F6] border border-gray-150 rounded-lg text-sm shrink-0">📈</span>
            <div>
              <h4 className="text-sm font-black text-primary tracking-tight uppercase">Ugentlig Indsigt</h4>
              <p className="text-[9px] text-muted-text font-bold">Genbrugsmålinger de seneste 7 dage</p>
            </div>
          </div>
          <div className="flex bg-gray-50 border border-gray-150 p-1 rounded-xl gap-1 shrink-0">
            <button
              id="chart-metric-all-btn"
              onClick={() => setChartMetric('all')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                chartMetric === 'all'
                  ? 'bg-primary text-accent shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Begge
            </button>
            <button
              id="chart-metric-scans-btn"
              onClick={() => setChartMetric('scans')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                chartMetric === 'scans'
                  ? 'bg-primary text-accent shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Scans
            </button>
            <button
              id="chart-metric-co2-btn"
              onClick={() => setChartMetric('co2')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                chartMetric === 'co2'
                  ? 'bg-primary text-accent shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              CO₂
            </button>
          </div>
        </div>

        {/* Recharts Line Chart viewport */}
        <div className="w-full h-56 mt-2 relative select-none">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={weeklyProgressData}
              margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis 
                dataKey="day" 
                tick={{ fontSize: 9, fontWeight: 700, fill: '#6B7280' }} 
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                tick={{ fontSize: 9, fontWeight: 700, fill: '#6B7280' }} 
                axisLine={false}
                tickLine={false} 
              />
              <Tooltip content={<CustomChartTooltip />} />
              {(chartMetric === 'all' || chartMetric === 'scans') && (
                <Line 
                  type="monotone" 
                  dataKey="Scanninger" 
                  stroke="#111827" 
                  strokeWidth={2.5} 
                  activeDot={{ r: 6, stroke: '#111827', strokeWidth: 2, fill: '#C8F24A' }}
                  dot={{ r: 3.5, stroke: '#111827', strokeWidth: 1.5, fill: '#FFFFFF' }}
                />
              )}
              {(chartMetric === 'all' || chartMetric === 'co2') && (
                <Line 
                  type="monotone" 
                  dataKey="CO₂ besp. (kg)" 
                  stroke="#10B981" 
                  strokeWidth={2.5} 
                  activeDot={{ r: 6, stroke: '#10B981', strokeWidth: 2, fill: '#C8F24A' }}
                  dot={{ r: 3.5, stroke: '#10B981', strokeWidth: 1.5, fill: '#FFFFFF' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Extra dynamic daily averages blocks */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div className="bg-[#FAF9F6] border border-gray-150 p-2.5 rounded-xl flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-gray-200 flex items-center justify-center text-sm shrink-0">📦</span>
            <div>
              <span className="text-[8px] font-bold text-muted-text uppercase tracking-wider block">Gns. Scans / Dag</span>
              <span className="text-xs font-black text-primary leading-none">{(user.scansCount / 7).toFixed(1)} stk</span>
            </div>
          </div>
          <div className="bg-[#FAF9F6] border border-gray-150 p-2.5 rounded-xl flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-sm shrink-0">🌍</span>
            <div>
              <span className="text-[8px] font-bold text-muted-text uppercase tracking-wider block font-sans">CO₂ sparet / Dag</span>
              <span className="text-xs font-black text-emerald-800 leading-none">{(user.co2SavedKg / 7).toFixed(2)} kg</span>
            </div>
          </div>
        </div>

        {/* Dynamic educational suggestion message */}
        <div className="bg-emerald-50/40 border border-emerald-100 p-3.5 rounded-2xl text-[11px] font-semibold text-emerald-950 leading-relaxed flex items-start gap-2.5">
          <span className="text-base leading-none">💡</span>
          <p>
            Din grønne kurve stiger! De seneste 7 dage har du sparet i gennemsnit <span className="font-extrabold text-emerald-800">{(user.co2SavedKg / 7).toFixed(2)} kg CO₂ </span> om dagen. Det svarer til at slette <span className="font-extrabold text-[#111827]">{((user.co2SavedKg / 7) * 8.2).toFixed(1)} km</span> dieselbils-kørsel fra dit klimaaftryk hver eneste dag!
          </p>
        </div>
      </div>

      {/* 6-Month CO2 Historical Impact Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center text-left">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-emerald-50 border border-emerald-100 rounded-lg text-sm shrink-0">🌱</span>
            <div className="text-left">
              <h4 className="text-sm font-black text-primary tracking-tight uppercase">CO₂ Besparelse (6 Mdr.)</h4>
              <p className="text-[9px] text-muted-text font-bold">Historisk klimabelastning sparet det seneste halve år</p>
            </div>
          </div>
          <div className="flex bg-gray-50 border border-gray-150 p-1 rounded-xl gap-1 shrink-0">
            <button
              id="six-month-cumulative-btn"
              onClick={() => setSixMonthView('cumulative')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                sixMonthView === 'cumulative'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Akkumuleret
            </button>
            <button
              id="six-month-monthly-btn"
              onClick={() => setSixMonthView('monthly')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                sixMonthView === 'monthly'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Månedlig
            </button>
          </div>
        </div>

        {/* Recharts Area Chart viewport */}
        <div className="w-full h-56 mt-2 relative select-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={sixMonthsProgressData}
              margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
            >
              <defs>
                <linearGradient id="co2Gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 9, fontWeight: 700, fill: '#6B7280' }} 
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                tick={{ fontSize: 9, fontWeight: 700, fill: '#6B7280' }} 
                axisLine={false}
                tickLine={false} 
              />
              <Tooltip content={<CustomSixMonthTooltip />} />
              <Area 
                type="monotone" 
                dataKey={sixMonthView === 'cumulative' ? 'Akkumuleret CO₂ sparet (kg)' : 'Månedlig CO₂ sparet (kg)'} 
                stroke="#10B981" 
                strokeWidth={2.5} 
                fillOpacity={1}
                fill="url(#co2Gradient)"
                activeDot={{ r: 6, stroke: '#10B981', strokeWidth: 2, fill: '#C8F24A' }}
                dot={{ r: 3.5, stroke: '#10B981', strokeWidth: 1.5, fill: '#FFFFFF' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Dynamic 6-month averages blocks */}
        {(() => {
          const avgMonthly = user.co2SavedKg / 6;
          const peakMonthData = [...sixMonthsProgressData].sort((a, b) => b['Månedlig CO₂ sparet (kg)'] - a['Månedlig CO₂ sparet (kg)'])[0];
          const treeEquivalent = user.co2SavedKg / 1.83; // 1 mature tree absorbs ~1.83 kg CO2 per month
          
          return (
            <div className="flex flex-col gap-3.5 mt-1 text-left">
              <div className="grid grid-cols-3 gap-2">
                <div id="co2-metric-avg" className="bg-[#FAF9F6] border border-gray-150 p-2 rounded-xl">
                  <span className="text-[7.5px] font-bold text-muted-text uppercase tracking-wider block">Gns. pr. md</span>
                  <span className="text-xs font-black text-primary leading-none">{avgMonthly.toFixed(1)} kg</span>
                </div>
                <div id="co2-metric-peak" className="bg-[#FAF9F6] border border-gray-150 p-2 rounded-xl">
                  <span className="text-[7.5px] font-bold text-muted-text uppercase tracking-wider block font-sans">Maks-måned</span>
                  <span className="text-xs font-black text-emerald-800 leading-none">
                    {peakMonthData ? `${peakMonthData['Månedlig CO₂ sparet (kg)']} kg` : 'N/A'}
                  </span>
                </div>
                <div id="co2-metric-trees" className="bg-[#FAF9F6] border border-gray-150 p-2 rounded-xl">
                  <span className="text-[7.5px] font-bold text-muted-text uppercase tracking-wider block font-sans">Træer (Mdr.)</span>
                  <span className="text-xs font-black text-amber-700 leading-none">{Math.max(1, Math.round(treeEquivalent))} træer</span>
                </div>
              </div>

              {/* Dynamic informative visual representation */}
              <div className="bg-emerald-50/40 border border-emerald-100 p-3.5 rounded-2xl text-[11px] font-semibold text-emerald-950 leading-relaxed flex items-start gap-2.5">
                <span className="text-base leading-none">🌳</span>
                <p>
                  Over det seneste halve år svarer din samlede indsats til, at <span className="font-extrabold text-emerald-800">{Math.max(1, Math.round(treeEquivalent))} fuldvoksne træer</span> har optaget CO₂ fra atmosfæren i en hel måned! Din indsats gør en langsigtet forskel for Danmarks ressourcekredsløb.
                </p>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Everyday Objects Comparison Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center text-left">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-[#FAF9F6] border border-gray-150 rounded-lg text-sm shrink-0">⚖️</span>
            <div>
              <h4 className="text-sm font-black text-primary tracking-tight uppercase">Svarer til hvad?</h4>
              <p className="text-[9px] text-muted-text font-bold">Din genanvendte vægt sammenlignet med hverdagsting</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black font-mono text-primary block bg-primary/5 px-2.5 py-1 rounded-xl border border-primary/5">
              {totalWasteKg.toFixed(1)} kg
            </span>
          </div>
        </div>

        {/* Dynamic Items Slider/Buttons Selector */}
        {(() => {
          const COMPARISON_ITEMS = [
            { id: 'bowling', name: 'Bowlingkugler', val: 5.4, icon: '🎳', plural: 'bowlingkugler', unitText: 'ca. 5,4 kg/stk' },
            { id: 'laptop', name: 'MacBooks', val: 1.4, icon: '💻', plural: 'MacBooks', unitText: 'ca. 1,4 kg/stk' },
            { id: 'soccer', name: 'Fodbolde', val: 0.43, icon: '⚽', plural: 'fodbolde', unitText: 'ca. 430g/stk' },
            { id: 'apple', name: 'Store æbler', val: 0.15, icon: '🍎', plural: 'store æbler', unitText: 'ca. 150g/stk' }
          ];

          const [selectedComp, setSelectedComp] = React.useState('bowling');
          const activeItem = COMPARISON_ITEMS.find(item => item.id === selectedComp) || COMPARISON_ITEMS[0];
          const calculatedCount = totalWasteKg / activeItem.val;
          const displayCount = calculatedCount >= 1 ? calculatedCount.toFixed(1) : calculatedCount.toFixed(2);
          
          // Generate array for visual icons grid representation
          const visCount = Math.floor(calculatedCount);
          const remainderPercent = Math.round((calculatedCount - visCount) * 100);
          
          // Cap rendering of emojis to prevent clutter
          const maxIcons = 30;
          const iconsToRender = Math.min(maxIcons, Math.max(0, visCount));
          const hasMore = visCount > maxIcons;

          return (
            <div className="flex flex-col gap-4">
              {/* Item selection tabs */}
              <div className="grid grid-cols-4 gap-1.5 bg-gray-50 border border-gray-150 p-1 rounded-xl">
                {COMPARISON_ITEMS.map((item) => (
                  <button
                    id={`comp-item-${item.id}-btn`}
                    key={item.id}
                    onClick={() => setSelectedComp(item.id)}
                    className={`py-2 px-1 rounded-lg text-center flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      selectedComp === item.id 
                        ? 'bg-primary text-accent shadow-xs' 
                        : 'hover:bg-gray-100 text-primary'
                    }`}
                  >
                    <span className="text-base select-none">{item.icon}</span>
                    <span className="text-[8px] font-black uppercase tracking-wider block truncate w-full">{item.name}</span>
                  </button>
                ))}
              </div>

              {/* Visualized Icons Stage */}
              <div className="bg-[#FAF9F6] border border-gray-150 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden select-none">
                {/* Decorative scale watermark background */}
                <span className="absolute -right-3 -bottom-5 text-7xl opacity-5 pointer-events-none">⚖️</span>
                
                {/* Icon Grid/Flexbox */}
                {calculatedCount < 0.01 ? (
                  <div className="text-center">
                    <span className="text-2xl opacity-40 block mb-1">🌱</span>
                    <span className="text-[10px] font-bold text-muted-text uppercase">Begynd at sortere for at fylde pladsen!</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 w-full">
                    <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-[280px]">
                      {/* Render full elements */}
                      {Array.from({ length: iconsToRender }).map((_, i) => (
                        <div 
                          key={i} 
                          className="w-8 h-8 rounded-lg bg-white border border-gray-200/80 shadow-3xs flex items-center justify-center text-base animate-in zoom-in-50 duration-200"
                        >
                          {activeItem.icon}
                        </div>
                      ))}

                      {/* Render partial element if there is a remainder with noticeable percentage */}
                      {!hasMore && remainderPercent > 10 && (
                        <div 
                          className="w-8 h-8 rounded-lg bg-white border border-dashed border-gray-300 flex items-center justify-center text-base relative overflow-hidden animate-in zoom-in-30 duration-200"
                          style={{ opacity: Math.max(0.3, remainderPercent / 100) }}
                          title={`Delvist genbrugt: ${remainderPercent}%`}
                        >
                          {activeItem.icon}
                          <div className="absolute inset-0 bg-white/70" style={{ height: `${100 - remainderPercent}%` }} />
                        </div>
                      )}

                      {/* Special placeholder if even 1 element is not fully reached (e.g. qty is 0.something) */}
                      {visCount === 0 && remainderPercent > 0 && remainderPercent <= 10 && (
                        <div className="w-8 h-8 rounded-lg bg-white border border-dashed border-gray-300 flex items-center justify-center text-base opacity-40">
                          {activeItem.icon}
                        </div>
                      )}

                      {/* If capped, display more pill */}
                      {hasMore && (
                        <div className="h-8 px-2 rounded-lg bg-primary text-accent border border-primary text-[10px] font-black flex items-center justify-center shadow-3xs">
                          +{visCount - maxIcons} mere
                        </div>
                      )}
                    </div>

                    {/* Fun explanation text */}
                    <div className="text-center px-2">
                      <p className="text-xs font-semibold text-[#111827] leading-relaxed">
                        Du har genanvendt det samme som <span className="font-extrabold text-[#111827] bg-accent px-1 rounded-sm">{displayCount}</span> {activeItem.plural}!
                      </p>
                      <span className="text-[8.5px] font-bold text-muted-text uppercase tracking-widest block mt-1">
                        Metrik baseret på {activeItem.unitText}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Educational insight callout */}
              <p className="text-[10px] font-bold text-muted-text text-center italic">
                💡 Selvom en enkelt tom dåse eller plastikflaske føles ultra let, så bliver det hurtigt til mange kilo værdifulde ressourcer over tid!
              </p>
            </div>
          );
        })()}
      </div>

      {/* Community Leaderboard Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-[#FAF9F6] border border-gray-150 rounded-lg text-sm shrink-0">🏆</span>
            <div>
              <h4 className="text-sm font-black text-primary tracking-tight uppercase">Fællesskabets Top Sortere</h4>
              <p className="text-[9px] text-muted-text font-bold">Top 5 baseret på samlet vægt genanvendt</p>
            </div>
          </div>
          
          {/* Scope Selector: Community (Municipality) vs National */}
          <div className="flex bg-gray-50 border border-gray-150 p-1 rounded-xl gap-1 shrink-0">
            <button
              id="scope-community-btn"
              onClick={() => setLeaderboardScope('community')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                leaderboardScope === 'community'
                  ? 'bg-primary text-accent shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Kommune
            </button>
            <button
              id="scope-national-btn"
              onClick={() => setLeaderboardScope('national')}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                leaderboardScope === 'national'
                  ? 'bg-primary text-accent shadow-xs'
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Hele Landet
            </button>
          </div>
        </div>

        {/* Dynamic scope name banner */}
        <div className="bg-primary/[0.03] border border-primary/5 p-2 rounded-xl text-center">
          <span className="text-[10px] font-extrabold text-primary/70 uppercase tracking-widest flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5 stroke-[2.5]" />
            {leaderboardScope === 'community' 
              ? `Liga: ${user.municipality}` 
              : 'National Sorteringsliga (Danmark)'}
          </span>
        </div>

        {/* The Leaderboard List */}
        <div className="flex flex-col gap-2">
          {communityLeaderboard.map((player) => {
            const maxVal = communityLeaderboard[0]?.weight || 100;
            const ratioPercent = maxVal > 0 ? Math.min(100, Math.round((player.weight / maxVal) * 100)) : 0;
            
            return (
              <div 
                id={`leaderboard-rank-${player.rank}`}
                key={player.name}
                className={`relative flex flex-col gap-2 p-3 rounded-2xl border transition-all ${
                  player.isCurrentUser 
                    ? 'bg-primary/5 border-primary/20 scale-102 ring-1 ring-primary/5' 
                    : 'bg-gray-50/30 border-gray-100 hover:bg-gray-50/60'
                }`}
              >
                <div className="flex items-center justify-between gap-3 z-10">
                  <div className="flex items-center gap-3">
                    {/* Rank Badge */}
                    <div className="w-6.5 h-6.5 flex items-center justify-center font-black select-none text-sm leading-none">
                      {player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : `#${player.rank}`}
                    </div>

                    {/* Avatar / Icon */}
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 ${
                      player.isCurrentUser ? 'bg-primary text-accent font-extrabold shadow-sm' : 'bg-gray-150 text-primary'
                    }`}>
                      {player.avatar}
                    </div>

                    {/* Meta info */}
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-black tracking-tight ${player.isCurrentUser ? 'text-primary' : 'text-primary/95'}`}>
                          {player.name}
                        </span>
                        {player.isCurrentUser && (
                          <span className="text-[8px] font-black uppercase bg-primary text-accent px-1.5 py-0.5 rounded-full tracking-wider select-none">
                            DIG
                          </span>
                        )}
                      </div>
                      <span className="text-[8px] font-bold text-muted-text uppercase tracking-wider block mt-0.5">
                        {player.badge}
                      </span>
                    </div>
                  </div>

                  {/* Weight Recycled label */}
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-black font-mono block ${player.isCurrentUser ? 'text-emerald-800' : 'text-primary'}`}>
                      {player.weight.toFixed(1)} kg
                    </span>
                    <span className="text-[7.5px] font-bold text-muted-text uppercase tracking-widest block font-sans">
                      GENBRUGT
                    </span>
                  </div>
                </div>

                {/* Relative weight visual indicator line/pills */}
                <div className="w-full flex items-center gap-2 mt-1 px-1">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden p-0">
                    <div 
                      className={`h-full rounded-full transition-all duration-1000 ease-out ${
                        player.isCurrentUser ? 'bg-gradient-to-r from-emerald-500 to-accent' : 'bg-primary/45'
                      }`}
                      style={{ width: `${ratioPercent}%` }}
                    />
                  </div>
                  <span className="text-[8px] font-bold text-muted-text font-mono select-none">
                    {ratioPercent}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Motivational / Contextual Banner */}
        {(() => {
          const myRank = communityLeaderboard.find(p => p.isCurrentUser)?.rank || 5;
          const isWinner = myRank === 1;
          const nextLeader = communityLeaderboard.find(p => p.rank === myRank - 1);
          
          return (
            <div className={`p-4 rounded-2xl text-[11px] font-semibold leading-relaxed border ${
              isWinner 
                ? 'bg-amber-50 border-amber-200 text-amber-950' 
                : 'bg-emerald-50/30 border-emerald-100 text-emerald-950'
            }`}>
              <div className="flex gap-2.5 items-start">
                <span className="text-base leading-none">{isWinner ? '👑' : '💪'}</span>
                <div>
                  <h5 className="font-extrabold text-[#111827] uppercase tracking-wide text-[9px] mb-0.5 leading-none">
                    {isWinner ? 'Du Fører Sorteringsligaen!' : 'Nå Højere Op På Skanen!'}
                  </h5>
                  <p>
                    {isWinner 
                      ? `Fantastisk indsats, ${user.fullName}! Du indtager lige nu førstepladsen i ${leaderboardScope === 'community' ? user.municipality : 'Danmark'}. Fortsæt med at inspirere!`
                      : nextLeader 
                        ? `Du ligger i øjeblikket nummer ${myRank} i ${leaderboardScope === 'community' ? 'din kommune' : 'landet'}. Du skal blot genanvende ${(nextLeader.weight - totalWasteKg).toFixed(1)} kg mere emballage for at overhale ${nextLeader.name.split(' ')[0]}!`
                        : `Rigtig flot sortering! Hver aflevering i Cirkel Drop-Point trækker dig tættere og tættere på topplaceringen.`
                    }
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Personlige Mærker & Bedrifter (Unlocked Achievements) */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-accent/10 text-primary rounded-lg text-sm shrink-0">🏅</span>
            <h4 className="text-sm font-black text-primary tracking-tight uppercase">Mærker & Bedrifter</h4>
          </div>
          <span className="text-[10px] font-bold text-muted-text uppercase bg-gray-50 border border-gray-150 py-0.5 px-2 rounded-md">
            {unlockedCount} af {achievements.length} Oplåst
          </span>
        </div>

        <p className="text-[11px] font-semibold text-muted-text -mt-1 leading-relaxed">
          Gennemfør sorteringshandlinger for at låse op for de eksklusive trofæer. Klik på et mærke for at se detaljer og fremskridt.
        </p>

        <div className="flex flex-col gap-2.5 mt-1">
          {achievements.map((badge, idx) => {
            const isSelected = activeBadgeId === badge.id;
            return (
              <motion.div 
                id={`achievement-badge-${badge.id}`}
                key={badge.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ 
                  y: -3, 
                  scale: 1.012, 
                  boxShadow: badge.isUnlocked 
                    ? "0 8px 24px -6px rgba(16,185,129,0.12)" 
                    : "0 6px 16px -4px rgba(0,0,0,0.04)"
                }}
                whileTap={{ scale: 0.98 }}
                transition={{ 
                  type: "spring",
                  stiffness: 300,
                  damping: 24,
                  delay: Math.min(idx * 0.05, 0.45)
                }}
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setActiveBadgeId(isSelected ? null : badge.id);
                }}
                className={`border rounded-2xl p-3.5 transition-all cursor-pointer relative overflow-hidden ${
                  badge.isUnlocked 
                    ? isSelected 
                      ? 'bg-emerald-50/70 border-emerald-300 shadow-sm' 
                      : 'bg-[#FAF9F6] border-emerald-100 hover:border-emerald-200 hover:bg-emerald-50/30'
                    : 'bg-gray-50/40 border-gray-150 hover:bg-gray-50/60'
                }`}
              >
                {/* Visual shimmer glow on unlocked badges */}
                {badge.isUnlocked && (
                  <div className="absolute -right-6 -top-6 w-14 h-14 bg-gradient-to-br from-accent/20 to-emerald-200/20 rounded-full blur-lg pointer-events-none" />
                )}

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl transition-transform duration-300 shrink-0 ${
                      badge.isUnlocked 
                        ? 'bg-accent/25 text-primary shadow-sm scale-102 font-bold'
                        : 'bg-gray-200/50 text-gray-450 opacity-50 font-normal grayscale'
                    }`}>
                      {badge.emoji}
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h5 className={`text-xs font-black tracking-tight ${badge.isUnlocked ? 'text-primary' : 'text-gray-400'}`}>
                          {badge.name}
                        </h5>
                        {badge.isUnlocked && (
                          <span className="text-[8px] font-black uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full tracking-wider">
                            Oplåst
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold text-muted-text mt-0.5">
                        {badge.howToUnlock}
                      </p>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end shrink-0 select-none">
                    <span className="text-[10px] font-black text-primary font-mono mb-1">
                      {badge.progressText}
                    </span>
                    {badge.isUnlocked ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    )}
                  </div>
                </div>

                {/* Expanded Progress Bar Block */}
                {isSelected && (
                  <div className="mt-3 py-2 border-t border-gray-200/60 flex flex-col gap-2">
                    <p className="text-[11px] font-semibold text-primary leading-relaxed">
                      {badge.description}
                    </p>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[8px] font-black tracking-wider uppercase text-muted-text">
                        <span>Fremdrift</span>
                        <span className="font-mono">{badge.progressPercent}%</span>
                      </div>
                      <div className="w-full h-2 bg-gray-150/50 rounded-full overflow-hidden p-0.5">
                        <div 
                          style={{ width: `${badge.progressPercent}%` }}
                          className={`h-full rounded-full transition-all duration-750 ease-out ${
                            badge.isUnlocked ? 'bg-gradient-to-r from-emerald-500 to-accent' : 'bg-gray-300'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Settings Options rows */}
      <div>
        <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-3">{t('settings')}</span>
        <div className="flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
          
          {/* Municipality selection bar */}
          <div className="p-4">
            <div className="flex justify-between items-center text-left">
              <div className="flex items-center gap-3.5">
                <MapPin className="w-5 h-5 text-muted-text shrink-0" />
                <span className="text-xs font-black text-primary">{t('my_municipality')}</span>
              </div>
              <button 
                id="select-municipality-btn"
                onClick={() => setShowMuniSelector(!showMuniSelector)}
                className="text-xs font-black text-primary hover:underline cursor-pointer"
              >
                {municipality}
              </button>
            </div>

            {showMuniSelector && (
              <div className="mt-3.5 pt-3 border-t border-gray-100 flex flex-col gap-1">
                <span className="text-[10px] font-bold text-muted-text uppercase tracking-wider block mb-1">Skift til en anden kommune</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {SUPPORTED_MUNICIPALITIES.map((m) => (
                    <button
                      id={`muni-option-${m.toLowerCase().replace(/\s+/g, '-')}-btn`}
                      key={m}
                      onClick={() => handleMunicipalityChange(m)}
                      className={`text-[11px] font-semibold p-2 rounded-xl text-left border cursor-pointer ${
                        m === municipality 
                          ? 'bg-primary text-white border-primary' 
                          : 'bg-gray-50 text-primary border-gray-150 hover:bg-gray-100'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center p-4">
            <div className="flex items-center gap-3.5">
              <Smartphone className="w-5 h-5 text-muted-text shrink-0" />
              <span className="text-xs font-black text-primary">MobilePay status</span>
            </div>
            <span className="text-[11px] font-bold text-muted-text uppercase">Tilsluttet ✓</span>
          </div>

          <div className="flex flex-col p-4">
            <div 
              id="notif-settings-toggle-row"
              onClick={() => setShowNotifAccordion(!showNotifAccordion)}
              className="flex justify-between items-center cursor-pointer select-none"
            >
              <div className="flex items-center gap-3.5">
                <Bell className="w-5 h-5 text-muted-text shrink-0" />
                <span className="text-xs font-black text-primary">Notifikationer & Påmindelser</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                  notifsEnabled ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}>
                  {notifsEnabled ? 'Aktive ✓' : 'Slået fra'}
                </span>
                <span className="text-xs text-muted-text font-bold transition-transform duration-200" style={{ transform: showNotifAccordion ? 'rotate(90deg)' : 'none' }}>
                  →
                </span>
              </div>
            </div>

            {showNotifAccordion && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-4 animate-in fade-in duration-200">
                
                {/* Master Switch */}
                <div className="flex justify-between items-center bg-[#FAF9F6] p-3 rounded-xl border border-gray-150">
                  <div>
                    <span className="text-xs font-black text-primary block">Tillad påmindelser</span>
                    <span className="text-[9px] text-muted-text font-bold">Få automatiske push-notifikationer og alerts</span>
                  </div>
                  <button 
                    id="notifs-master-toggle-btn"
                    onClick={() => handleNotifToggle(!notifsEnabled)}
                    className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none cursor-pointer tracking-wider flex items-center ${
                      notifsEnabled ? 'bg-primary' : 'bg-gray-200'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 shadow-sm ${
                      notifsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {notifsEnabled && (
                  <>
                    {/* Interval Option Radio Pills */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-muted-text uppercase tracking-wider block">Påmindelsesinterval</span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: '3days', label: 'Hver 3. dag' },
                          { id: 'weekly', label: 'Ugentligt' },
                          { id: 'monthly', label: 'Månedligt' }
                        ].map((choice) => {
                          const active = reminderInterval === choice.id;
                          return (
                            <button
                              id={`interval-choice-${choice.id}-btn`}
                              key={choice.id}
                              onClick={() => handleIntervalChange(choice.id as any)}
                              className={`p-2 rounded-xl text-center border cursor-pointer text-[10px] font-black transition-all ${
                                active 
                                  ? 'bg-primary text-accent border-primary' 
                                  : 'bg-gray-50 text-primary border-gray-150 hover:bg-gray-100'
                              }`}
                            >
                              {choice.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Toggle Sub-Settings (Remind Collected vs Events) */}
                    <div className="flex flex-col gap-3 mt-1">
                      <span className="text-[10px] font-bold text-muted-text uppercase tracking-wider block">Emner og indhold</span>
                      
                      {/* Checkbox 1: Collected Items */}
                      <button
                        id="toggle-remind-collected-btn"
                        onClick={() => handleRemindCollectedToggle(!remindCollected)}
                        className="flex items-start gap-3 text-left w-full cursor-pointer focus:outline-none bg-transparent border-0 p-0"
                      >
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          remindCollected ? 'bg-primary border-primary text-[#C8F24A]' : 'border-gray-300 bg-white'
                        }`}>
                          {remindCollected && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
                        </div>
                        <div>
                          <span className="text-xs font-black text-primary block leading-none">Indsamlede genstande</span>
                          <span className="text-[9.5px] text-muted-text font-bold mt-1 block leading-relaxed">
                            Minde mig om at få afleveret mine scannede emballager og udbetalt min opsparede pant.
                          </span>
                        </div>
                      </button>

                      {/* Checkbox 2: Events & Tips */}
                      <button
                        id="toggle-remind-events-btn"
                        onClick={() => handleRemindEventsToggle(!remindEvents)}
                        className="flex items-start gap-3 text-left w-full cursor-pointer focus:outline-none bg-transparent border-0 p-0"
                      >
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          remindEvents ? 'bg-primary border-primary text-[#C8F24A]' : 'border-gray-300 bg-white'
                        }`}>
                          {remindEvents && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
                        </div>
                        <div>
                          <span className="text-xs font-black text-primary block leading-none">Lokale genbrugsevents & tømninger</span>
                          <span className="text-[9.5px] text-muted-text font-bold mt-1 block leading-relaxed">
                            Besked om storskrald, tømningsdage samt miljøaktiviteter i <span className="font-extrabold text-primary">{municipality}</span>.
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* Testing Area Banners */}
                    <div className="mt-2.5 pt-3.5 border-t border-gray-100 flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-muted-text uppercase tracking-wider block">Simulator</span>
                      <p className="text-[9px] text-muted-text font-semibold leading-relaxed -mt-1">
                        Test hvordan påmindelserne ser ud direkte i Cirkel-appen med din registrerede kommune og profil:
                      </p>
                      
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <button
                          id="trigger-collected-sample-btn"
                          disabled={!remindCollected}
                          onClick={() => triggerTestToast('collected')}
                          className={`p-2.5 rounded-xl border font-black text-[10px] text-center flex flex-col items-center justify-center gap-1 transition-all ${
                            remindCollected 
                              ? 'bg-emerald-50 text-emerald-950 border-emerald-150 hover:bg-emerald-100/70 cursor-pointer' 
                              : 'bg-gray-50/50 text-gray-400 border-gray-200 cursor-not-allowed opacity-50'
                          }`}
                        >
                          <span className="text-base select-none">🔔</span>
                          <span>Test Aflevering Påmindelse</span>
                        </button>

                        <button
                          id="trigger-event-sample-btn"
                          disabled={!remindEvents}
                          onClick={() => triggerTestToast('event')}
                          className={`p-2.5 rounded-xl border font-black text-[10px] text-center flex flex-col items-center justify-center gap-1 transition-all ${
                            remindEvents
                              ? 'bg-teal-50 text-teal-950 border-teal-150 hover:bg-teal-100/70 cursor-pointer' 
                              : 'bg-gray-50/50 text-gray-400 border-gray-200 cursor-not-allowed opacity-50'
                          }`}
                        >
                          <span className="text-base select-none">📅</span>
                          <span>Test Event Notifikation</span>
                        </button>
                      </div>

                      {onSimulateInactivity && (
                        <button
                          id="trigger-inactivity-simulation-btn"
                          onClick={onSimulateInactivity}
                          className="w-full mt-2 p-2.5 rounded-xl border border-rose-150 bg-rose-50 hover:bg-rose-100/70 text-rose-950 font-black text-[10px] text-center flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-3xs"
                        >
                          <span className="text-base select-none">⏳</span>
                          <span>
                            {language === 'da'
                              ? 'Simulér 3+ dages inaktivitet (Test beholder-påmindelse)'
                              : 'Simulate 3+ Days Inactivity (Test Bin Reminder)'}
                          </span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div 
            id="language-select-row"
            onClick={() => setShowLanguageModal(true)}
            className="flex justify-between items-center p-4 hover:bg-gray-50 cursor-pointer transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Globe className="w-5 h-5 text-muted-text shrink-0" />
              <span className="text-xs font-black text-primary">{t('language_label')}</span>
            </div>
            <div className="flex items-center gap-2 select-none">
              <span className="text-base filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.1)] leading-none">
                {language === 'da' ? '🇩🇰' : '🇬🇧'}
              </span>
              <span className="text-[11px] font-black text-muted-text uppercase">
                {language === 'da' ? 'Dansk (DA)' : 'English (EN)'}
              </span>
              <span className="text-xs text-muted-text font-bold">→</span>
            </div>
          </div>

          <div 
            id="theme-select-row"
            onClick={() => {
              triggerHaptic(HapticPattern.LIGHT_TAP);
              if (setIsDarkMode) setIsDarkMode(!isDarkMode);
            }}
            className="flex justify-between items-center p-4 hover:bg-gray-50 cursor-pointer transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              {isDarkMode ? (
                <Moon className="w-5 h-5 text-muted-text shrink-0" />
              ) : (
                <Sun className="w-5 h-5 text-muted-text shrink-0" />
              )}
              <span className="text-xs font-black text-primary">
                {language === 'da' ? 'Visuelt tema' : 'Visual Theme'}
              </span>
            </div>
            <div className="flex items-center gap-3 select-none">
              <span className="text-[11px] font-black text-muted-text uppercase">
                {isDarkMode 
                  ? (language === 'da' ? 'Mørk (Dark)' : 'Dark Mode') 
                  : (language === 'da' ? 'Lys (Light)' : 'Light Mode')}
              </span>
              <div
                type="button"
                className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none flex items-center shrink-0 ${
                  isDarkMode ? 'bg-primary animate-none' : 'bg-gray-200'
                }`}
              >
                <div 
                  className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 shadow-sm ${
                    isDarkMode ? 'translate-x-5' : 'translate-x-0'
                  }`} 
                />
              </div>
            </div>
          </div>

          {/* Haptic Feedback Settings Toggle */}
          <div 
            id="haptics-settings-toggle-row"
            onClick={() => handleHapticsToggle(!hapticsEnabled)}
            className="flex justify-between items-center p-4 hover:bg-gray-50 cursor-pointer transition-colors text-left animate-in fade-in duration-200"
          >
            <div className="flex items-center gap-3.5">
              <Smartphone className="w-5 h-5 text-muted-text shrink-0 animate-pulse" style={{ animationDuration: '3s' }} />
              <div className="flex flex-col">
                <span className="text-xs font-black text-primary block leading-none">
                  {language === 'da' ? 'Haptisk feedback' : 'Haptic Feedback'}
                </span>
                <span className="text-[9px] text-muted-text font-bold block mt-1 whitespace-normal max-w-[180px] leading-snug">
                  {language === 'da' 
                    ? 'Vibrationer ved scanning og belønninger' 
                    : 'Vibrations when scanning & claiming rewards'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 select-none shrink-0">
              <span className="text-[11px] font-black text-muted-text uppercase">
                {hapticsEnabled 
                  ? (language === 'da' ? 'Aktiv ✓' : 'Enabled ✓') 
                  : (language === 'da' ? 'Inaktiv' : 'Disabled')}
              </span>
              <div
                className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 flex items-center shrink-0 ${
                  hapticsEnabled ? 'bg-primary' : 'bg-gray-200'
                }`}
              >
                <div 
                  className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 shadow-sm ${
                    hapticsEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`} 
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center p-4 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center gap-3.5">
              <HelpCircle className="w-5 h-5 text-muted-text shrink-0" />
              <span className="text-xs font-black text-primary">Hjælp & support</span>
            </div>
            <span className="text-xs text-muted-text font-bold">→</span>
          </div>

          <div className="flex justify-between items-center p-4">
            <div className="flex items-center gap-3.5">
              <Info className="w-5 h-5 text-muted-text shrink-0" />
              <span className="text-xs font-black text-primary">Version & jura</span>
            </div>
            <span className="text-[11px] font-bold text-muted-text">Cirkel v1.0.4</span>
          </div>

        </div>
      </div>

      {/* Logout button */}
      <button 
        id="logout-btn"
        onClick={onLogout}
        className="w-full mt-2 border border-red-200 hover:bg-red-50 text-red-500 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
      >
        <LogOut className="w-4 h-4 shrink-0" /> {t('log_out')}
      </button>

      {/* Share Impact Modal Overlay */}
      {showShareModal && (
        <div id="share-impact-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white border border-gray-150 rounded-3xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
            
            {/* Header */}
            <div className="flex justify-between items-start pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary/5 flex items-center justify-center text-sm">✨</span>
                <div>
                  <h4 className="text-xs font-black text-primary uppercase tracking-wider">Del din grønne status</h4>
                  <p className="text-[9px] text-muted-text font-bold">Generer et flot delingskort til sociale medier</p>
                </div>
              </div>
              <button
                id="close-share-modal-btn"
                onClick={() => setShowShareModal(false)}
                className="p-1 hover:bg-gray-150 rounded-lg text-primary/40 hover:text-primary transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dynamic Card Preview Area */}
            <div 
              className={`p-5 rounded-2xl relative overflow-hidden select-none shadow-md flex flex-col justify-between min-h-[200px] transition-all duration-300 ${
                shareStyle === 'forest' 
                  ? 'bg-gradient-to-br from-emerald-800 to-teal-950 text-white' 
                  : shareStyle === 'midnight'
                    ? 'bg-gradient-to-br from-slate-900 via-gray-950 to-indigo-950 text-white border border-white/5'
                    : 'bg-gradient-to-br from-emerald-950 via-teal-980 to-slate-900 text-white border border-emerald-500/10'
              }`}
            >
              {/* Dynamic Design Highlights / Background Watermarks */}
              <div className="absolute right-2 -bottom-6 text-8xl opacity-10 pointer-events-none font-sans">
                {shareStyle === 'forest' ? '🌲' : shareStyle === 'midnight' ? '🌌' : '⚡'}
              </div>
              
              {/* Card Top Branding Row */}
              <div className="flex justify-between items-start z-10">
                <div>
                  <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                    shareStyle === 'neon' ? 'bg-[#C8F24A] text-emerald-950' : 'bg-white/10 text-white'
                  }`}>
                    CIRKEL STATSKORT
                  </span>
                  <p className="text-[9px] text-white/70 font-semibold mt-1 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5 stroke-[3]" />
                    {municipality}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[20px] font-serif leading-none h-6 w-6 block filter drop-shadow-sm">♻️</span>
                </div>
              </div>

              {/* Central Big Goal Impact metrics */}
              <div className="my-5 z-10">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🌳</span>
                  <div>
                    <h5 className="text-[20px] font-black tracking-tight leading-none font-sans">
                      {user.co2SavedKg} kg CO₂
                    </h5>
                    <span className="text-[9px] text-white/80 uppercase tracking-widest font-black block mt-1">
                      SAMLET CO₂ SPARRET
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/10 text-left">
                  <div>
                    <span className="text-[8px] font-bold text-white/60 uppercase tracking-wide block">Niveau</span>
                    <span className="text-xs font-black flex items-center gap-1 mt-0.5">
                      <span>{currentBadge.emoji}</span>
                      <span className="truncate max-w-[90px]">{currentBadge.name}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] font-bold text-white/60 uppercase tracking-wide block">Genanvendt</span>
                    <span className="text-xs font-black font-mono block mt-0.5">
                      {totalWasteKg.toFixed(1)} kg
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Bottom Owner signature */}
              <div className="flex justify-between items-center border-t border-white/10 pt-2 text-[8px] font-semibold text-white/50 z-10">
                <span className="text-white/80 font-black">{user.fullName}</span>
                <span className="tracking-widest uppercase">CIRKEL.APP</span>
              </div>
            </div>

            {/* Design customization pills */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-bold text-muted-text uppercase tracking-wider block">Vælg kortdesign:</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'forest', name: 'Skovgrøn', class: 'border-emerald-600 bg-emerald-700' },
                  { id: 'midnight', name: 'Midnat', class: 'border-slate-800 bg-slate-900' },
                  { id: 'neon', name: 'Nordlys', class: 'border-teal-500 bg-teal-600' }
                ].map((skin) => (
                  <button
                    id={`share-skin-${skin.id}-btn`}
                    key={skin.id}
                    onClick={() => setShareStyle(skin.id as any)}
                    className={`py-1.5 px-1 rounded-xl text-center border cursor-pointer text-[9.5px] font-black transition-all flex items-center justify-center gap-1 ${
                      shareStyle === skin.id 
                        ? 'bg-primary text-accent border-primary ring-2 ring-primary/10' 
                        : 'bg-gray-50 text-primary border-gray-150 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full border ${skin.class}`} />
                    <span>{skin.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Social Sharing Actions */}
            <div className="flex flex-col gap-2 mt-1">
              {/* Native / System Share Button */}
              <button
                id="share-native-system-btn"
                onClick={handleWebShare}
                className="w-full py-2.5 bg-primary text-accent hover:bg-primary/95 font-black text-xs uppercase rounded-xl transition-all shadow-sm cursor-pointer select-none tracking-wider flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4 stroke-[2.5]" />
                <span>Del med venner</span>
              </button>

              {/* Download stylized image button */}
              <button
                id="share-download-image-btn"
                onClick={handleDownloadImage}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase rounded-xl transition-all shadow-sm cursor-pointer select-none tracking-wider flex items-center justify-center gap-2"
              >
                <span>📥</span>
                <span>Download som billede</span>
              </button>

              {/* Fallback copy block */}
              <button
                id="share-copy-text-btn"
                onClick={handleCopyShare}
                className={`w-full py-2.5 font-black text-xs uppercase rounded-xl transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                  shareCopied 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                    : 'bg-white text-primary border-gray-200 hover:bg-gray-50'
                }`}
              >
                {shareCopied ? (
                  <>
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>Kopieret til udklipsholder!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Kopier tekst & statistik</span>
                  </>
                )}
              </button>
            </div>

            {/* Simple disclaimer */}
            <p className="text-[8.5px] text-muted-text text-center leading-relaxed">
              * Systemet genererer automatisk en flot besked med dine personlige data klar til at poste på sociale medier.
            </p>

          </div>
        </div>
      )}

      {/* Prominent Language Selection Modal */}
      {showLanguageModal && (
        <div id="language-selection-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            className="bg-white border border-gray-150 rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-5 animate-in slide-in-from-bottom-4 duration-300"
          >
            {/* Header */}
            <div className="flex justify-between items-start pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5 text-left">
                <span className="w-8 h-8 rounded-xl bg-primary/5 flex items-center justify-center text-sm filter drop-shadow-xs select-none">🌐</span>
                <div>
                  <h4 className="text-xs font-black text-primary uppercase tracking-wider">{t('change_language_title')}</h4>
                  <p className="text-[9px] text-muted-text font-bold leading-tight">{t('change_language_subtitle')}</p>
                </div>
              </div>
              <button
                id="close-language-modal-btn"
                onClick={() => setShowLanguageModal(false)}
                className="w-7 h-7 bg-gray-50 border border-gray-200 hover:bg-gray-150 rounded-full flex items-center justify-center cursor-pointer transition-all active:scale-90"
              >
                <X className="w-3.5 h-3.5 text-primary" />
              </button>
            </div>

            {/* Description */}
            <p className="text-[10px] text-muted-text text-left leading-relaxed font-semibold">
              {t('select_lang_desc')}
            </p>

            {/* Language options list */}
            <div className="flex flex-col gap-3">
              {/* Danish Option */}
              <button
                id="select-lang-da-modal-btn"
                onClick={() => {
                  setLanguage('da');
                }}
                className={`flex justify-between items-center p-4 rounded-2xl border transition-all cursor-pointer ${
                  language === 'da'
                    ? 'bg-amber-50/40 border-amber-300 ring-2 ring-amber-300/40 shadow-xs'
                    : 'bg-white border-gray-200 hover:border-gray-350 hover:bg-gray-50/50'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className="text-3xl filter drop-shadow-[0_2px_2px_rgba(0,0,0,0.15)] leading-none select-none">🇩🇰</div>
                  <div className="text-left">
                    <span className="text-xs font-black text-primary block leading-none">Dansk</span>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">Sprog: Dansk / Danish</span>
                  </div>
                </div>
                {language === 'da' ? (
                  <div className="w-6 h-6 rounded-full bg-amber-400 text-primary flex items-center justify-center shadow-3xs border border-amber-300">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border border-gray-250 bg-white" />
                )}
              </button>

              {/* English Option */}
              <button
                id="select-lang-en-modal-btn"
                onClick={() => {
                  setLanguage('en');
                }}
                className={`flex justify-between items-center p-4 rounded-2xl border transition-all cursor-pointer ${
                  language === 'en'
                    ? 'bg-amber-50/40 border-amber-300 ring-2 ring-amber-300/40 shadow-xs'
                    : 'bg-white border-gray-200 hover:border-gray-350 hover:bg-gray-50/50'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className="text-3xl filter drop-shadow-[0_2px_2px_rgba(0,0,0,0.15)] leading-none select-none">🇬🇧</div>
                  <div className="text-left">
                    <span className="text-xs font-black text-primary block leading-none">English</span>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">Language: English</span>
                  </div>
                </div>
                {language === 'en' ? (
                  <div className="w-6 h-6 rounded-full bg-amber-400 text-primary flex items-center justify-center shadow-3xs border border-amber-300">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border border-gray-250 bg-white" />
                )}
              </button>
            </div>

            {/* Action buttons */}
            <div className="pt-2 border-t border-gray-100 flex gap-2.5">
              <button
                id="confirm-language-modal-btn"
                onClick={() => setShowLanguageModal(false)}
                className="flex-1 py-3 bg-primary hover:bg-primary/95 text-white font-extrabold text-xs uppercase rounded-xl transition-all shadow-md cursor-pointer select-none tracking-wider text-center"
              >
                {language === 'da' ? 'Udfør' : 'Done'}
              </button>
            </div>

          </motion.div>
        </div>
      )}

    </div>
  );
}
