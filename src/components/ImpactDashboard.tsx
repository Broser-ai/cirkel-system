import React, { useState } from 'react';
import { UserProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Globe, Leaf, Award, Flame, HelpCircle, Eye, Activity, Sparkles, TrendingUp } from 'lucide-react';
import AnimatedCount from './AnimatedCount';

interface ImpactDashboardProps {
  user: UserProfile;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun'];
const MONTHLY_RATIOS = [0.12, 0.15, 0.18, 0.22, 0.15, 0.18]; // Ratios of overall recycling performed

export default function ImpactDashboard({ user }: ImpactDashboardProps) {
  const [activeTab, setActiveTab] = useState<'co2' | 'waste'>('co2');
  const [hoveredPoint, setHoveredPoint] = useState<{ month: string; val: string } | null>(null);

  // Derived environmental metrics based on verified scan counts
  const totalWasteKg = Number((user.scansCount * 0.045).toFixed(1)); // 45g average per pack
  const co2Saved = user.co2SavedKg;

  // Set-up goal values
  const co2Goal = 150.0; // 150 kg CO2 target
  const wasteGoal = 50.0; // 50 kg waste target

  const currentVal = activeTab === 'co2' ? co2Saved : totalWasteKg;
  const currentGoal = activeTab === 'co2' ? co2Goal : wasteGoal;
  const percentOfGoal = Math.min(Math.round((currentVal / currentGoal) * 100), 100);

  // Material category breakdown split
  const materialMaterials = [
    { name: 'Plastik (PET/HDPE)', ratio: 0.45, color: 'bg-emerald-500', icon: '🥤', unit: 'kg' },
    { name: 'Metal & Alu-dåser', ratio: 0.25, color: 'bg-amber-400', icon: '🥫', unit: 'kg' },
    { name: 'Glas & Flasker', ratio: 0.18, color: 'bg-indigo-400', icon: '🍾', unit: 'kg' },
    { name: 'Pap & Karton', ratio: 0.12, color: 'bg-orange-400', icon: '📦', unit: 'kg' },
  ];

  // Equivalencies to bring abstract numbers to life
  const co2Equivalents = [
    {
      icon: '🚗',
      label: 'Bilkørsel neutraliseret',
      value: `${(co2Saved * 8.2).toFixed(0)} km`,
      desc: 'Svarer til mængden af CO₂ udledt af en gennemsnitlig dieselbil.',
    },
    {
      icon: '🌳',
      label: 'Træers dags-optag',
      value: `${(co2Saved / 0.06).toFixed(0)} dage`,
      desc: 'Dage det tager et fuldvoksent bøgetræ at absorbere denne CO₂.',
    },
    {
      icon: '💡',
      label: 'LED belysning sparet',
      value: `${(co2Saved * 58).toFixed(0)} timer`,
      desc: 'Konstant brændtid for en standard 11W A+ energisparepære.',
    },
  ];

  const wasteEquivalents = [
    {
      icon: '🗑️',
      label: 'Undgået losseplads',
      value: `${(totalWasteKg * 1.8).toFixed(1)} L`,
      desc: 'Rumfanget af komprimeret usorteret affald holdt ude af naturen.',
    },
    {
      icon: '🌊',
      label: 'Vandforbrug reddet',
      value: `${(totalWasteKg * 14.5).toFixed(0)} L`,
      desc: 'Rent drikkevand genvundet ved at undgå ny råmaterialeproduktion.',
    },
    {
      icon: '⭐',
      label: 'Cirkulære points optjent',
      value: `${user.points} CP`,
      desc: 'Personlige point klar til udbetaling i Cirkels wallet-butik.',
    },
  ];

  const equivalentsList = activeTab === 'co2' ? co2Equivalents : wasteEquivalents;

  // Monthly trend calculations using constant distribution factorized by overall stats
  const trendData = MONTHS.map((month, index) => {
    const multiplier = MONTHLY_RATIOS[index];
    const rawVal = activeTab === 'co2' ? co2Saved * multiplier : totalWasteKg * multiplier;
    return {
      month,
      val: Number(rawVal.toFixed(1)),
    };
  });

  const maxTrendVal = Math.max(...trendData.map(d => d.val)) || 1;

  // Circular progress math
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentOfGoal / 100) * circumference;

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-5 w-full">
      {/* Title & Interactive tab switcher */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-primary/5 text-primary rounded-lg text-sm shrink-0">📊</span>
            <h4 className="text-sm font-black text-primary tracking-tight uppercase">Min grønne statistik</h4>
          </div>
          
          <span className="text-[10px] font-bold text-success-alt tracking-wider uppercase flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-success-alt animate-pulse" /> Opdateret live
          </span>
        </div>

        {/* Tab Switcher */}
        <div className="bg-primary/5 p-1 rounded-xl flex gap-1 border border-primary/5">
          <button
            id="tab-co2-saved-btn"
            onClick={() => setActiveTab('co2')}
            className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'co2'
                ? 'bg-primary text-accent shadow-sm'
                : 'text-primary/60 hover:text-primary hover:bg-primary/5'
            }`}
          >
            🌍 CO₂ Besparelse
          </button>
          <button
            id="tab-waste-recycled-btn"
            onClick={() => setActiveTab('waste')}
            className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'waste'
                ? 'bg-primary text-accent shadow-sm'
                : 'text-primary/60 hover:text-primary hover:bg-primary/5'
            }`}
          >
            📦 Genanvendt affald
          </button>
        </div>
      </div>

      {/* Goal Ring & Primary Metric Bento block */}
      <div className="grid grid-cols-5 gap-3.5 items-center bg-[#FAF9F6] border border-gray-150 p-4 rounded-2xl relative overflow-hidden">
        {/* Glow vector effect */}
        <div className="absolute -left-12 -top-12 w-28 h-28 rounded-full bg-accent/20 blur-xl pointer-events-none" />

        {/* Circular Progress (2 columns) */}
        <div className="col-span-2 flex flex-col items-center justify-center text-center relative z-10 border-r border-gray-200/60 pr-2">
          <svg className="w-20 h-20 transform -rotate-90">
            {/* Background track circle */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              className="text-gray-100"
              strokeWidth="5"
              fill="transparent"
              stroke="currentColor"
            />
            {/* Dynamic foreground indicator */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              className="text-primary transition-all duration-1000 ease-out"
              strokeWidth="6.5"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              stroke="url(#accentGrad)"
            />
            {/* Gradient definition */}
            <defs>
              <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#C8F24A" />
                <stop offset="100%" stopColor="#2DD4A0" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute top-[28px] inset-x-0 mx-auto flex flex-col items-center justify-center">
            <span className="text-[13px] font-black text-primary leading-none">{percentOfGoal}%</span>
            <span className="text-[7px] font-black text-muted-text uppercase tracking-widest leading-none mt-0.5">MÅL</span>
          </div>
        </div>

        {/* Primary Statistics displaying big numbers (3 columns) */}
        <div className="col-span-3 pl-1 flex flex flex-col justify-center relative z-10">
          <span className="text-[9px] font-bold text-muted-text uppercase tracking-wider">
            {activeTab === 'co2' ? 'Samlet CO₂ sparet' : 'Samlet genanvendt'}
          </span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-3xl font-black text-primary tracking-tight">
              <AnimatedCount value={currentVal} decimals={activeTab === 'co2' ? 0 : 1} duration={1200} />
            </span>
            <span className="text-sm font-bold text-primary">
              kg
            </span>
          </div>
          <p className="text-[10px] font-semibold text-muted-text mt-1">
            Din personlige indsats svarer til et bidrag på <span className="font-bold text-primary"><AnimatedCount value={currentVal} decimals={activeTab === 'co2' ? 0 : 1} duration={1200} /> {activeTab === 'co2' ? 'kg CO₂-ækvivalenter' : 'kg sorteret emballage'}</span> overført til genbrug.
          </p>
        </div>
      </div>

      {/* Month Trend interactive Pure SVG Bar Chart */}
      <div className="bg-[#FAF9F6] border border-gray-150 p-4 rounded-2xl flex flex-col gap-2.5">
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-black text-muted-text uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" /> Månedlige målinger ({activeTab === 'co2' ? 'kg' : 'kg'})
          </span>
          
          <div className="h-4 flex items-center">
            <AnimatePresence mode="wait">
              {hoveredPoint ? (
                <motion.span 
                  key={hoveredPoint.month}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 py-0.5 px-2.5 rounded-full"
                >
                  {hoveredPoint.month}: {hoveredPoint.val} kg
                </motion.span>
              ) : (
                <span className="text-[9px] font-bold text-muted-text italic">Klik på en måned for detaljer</span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Clean, high contrast minimalist pure SVG bar container */}
        <div className="w-full flex items-end justify-between px-2 pt-6 pb-2 h-28 border-b border-gray-200">
          {trendData.map((d) => {
            const barHeightPercent = Math.max(Math.round((d.val / maxTrendVal) * 85), 6);
            return (
              <div 
                key={d.month}
                className="flex flex-col items-center flex-1 group"
                onClick={() => setHoveredPoint({ month: d.month, val: d.val.toString() })}
                onMouseEnter={() => setHoveredPoint({ month: d.month, val: d.val.toString() })}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                {/* Visual tooltip on hover */}
                <div className="text-[9px] font-black text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-150 mb-1 leading-none select-none">
                  {d.val}
                </div>

                {/* Animated bar path replacement with rich custom Tailwind styling */}
                <div className="w-8 bg-gray-100 group-hover:bg-gray-150 rounded-t-lg relative overflow-hidden transition-colors cursor-pointer flex items-end" style={{ height: '70px' }}>
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: `${barHeightPercent}%` }}
                    transition={{ type: 'spring', stiffness: 80, damping: 15 }}
                    className="w-full rounded-t-md bg-gradient-to-t from-primary via-emerald-800 to-accent"
                  />
                </div>

                <span className="text-[10px] font-black text-primary group-hover:text-amber-500 mt-2 tracking-tight select-none transition-colors">
                  {d.month}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Container 2: Category Breakdown (only makes sense for overall materials) */}
      <div className="bg-[#FAF9F6] border border-gray-150 p-4 rounded-2xl flex flex-col gap-3">
        <span className="text-[9px] font-black text-muted-text uppercase tracking-wider">
          Materialefordeling af genbrugsmængde
        </span>

        <div className="flex flex-col gap-2.5">
          {materialMaterials.map((mat) => {
            const absoluteWeight = Number((totalWasteKg * mat.ratio).toFixed(1));
            const percentageText = `${Math.round(mat.ratio * 100)}%`;
            return (
              <div key={mat.name} className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-xs font-bold text-primary">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{mat.icon}</span>
                    <span className="text-[11px] font-black leading-none">{mat.name}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-black">{absoluteWeight} {mat.unit}</span>
                    <span className="text-[9px] font-bold text-muted-text">({percentageText})</span>
                  </div>
                </div>

                {/* Styled progress container */}
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: percentageText }}
                    transition={{ duration: 1, type: 'spring' }}
                    className={`h-full rounded-full ${mat.color}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Container 3: Beautiful equivalency facts carousel */}
      <div className="flex flex-col gap-2 pt-1 border-t border-gray-100">
        <span className="text-[9px] font-black text-muted-text uppercase tracking-wider">
          Hvad betyder dette for miljøet?
        </span>
        <div className="grid grid-cols-1 gap-2">
          {equivalentsList.map((eq) => (
            <div 
              key={eq.label} 
              className="flex items-center gap-3.5 bg-gray-50/60 hover:bg-gray-50 border border-gray-100 p-3 rounded-xl transition-colors shrink-0"
            >
              <div className="text-2xl bg-white w-10 h-10 shadow-sm border border-gray-100 rounded-xl flex items-center justify-center shrink-0">
                {eq.icon}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-baseline">
                  <h5 className="text-[10px] font-black text-primary leading-tight uppercase tracking-wider">{eq.label}</h5>
                  <span className="text-xs font-black text-emerald-800 bg-emerald-100/60 px-2 py-0.5 rounded-full">{eq.value}</span>
                </div>
                <p className="text-[10px] font-semibold text-muted-text mt-0.5 leading-normal">{eq.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
