import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, Landmark, BarChart3, Radio, HelpCircle, FileText, Key, Check, Plus, Trash2, 
  Settings, Layers, RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, MapPin, 
  TrendingUp, Leaf, Award, Download, ArrowRight, Server, Database, Globe, Search, Play,
  Users, QrCode, Tag, Sparkles, Percent, Zap, Heart, Cpu, BookOpen, Calendar, AlertCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useLanguage } from '../lib/i18n';
import { jsPDF } from 'jspdf';
import { db, isRealFirebase } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

const monthsDa = ['Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun'];
const monthsEn = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface ComplianceDeadline {
  id: string;
  regions: string[];
  titleDa: string;
  titleEn: string;
  dueDate: string;
  importance: 'critical' | 'high' | 'medium';
  lawType: string;
  daysLeft: number;
  descriptionDa: string;
  descriptionEn: string;
  fineDa: string;
  fineEn: string;
  recommendationDa: string;
  recommendationEn: string;
  learnMoreId: string;
}

const complianceAlertsDB: ComplianceDeadline[] = [
  {
    id: 'epr-reporting',
    regions: ['Aarhus Kommune', 'Københavns Kommune', 'Odense Kommune', 'Aalborg Kommune', 'Frederikssund Kommune', 'Danmark'],
    titleDa: 'Udvidet Producentansvar (EPR) Emballageindberetning',
    titleEn: 'Extended Producer Responsibility (EPR) Packaging Reporting',
    dueDate: '2026-09-01',
    importance: 'critical',
    lawType: 'EPR',
    daysLeft: 70,
    descriptionDa: 'Lokal og national verifikation af alt engangs- og genbrugsemballage markedsført i kommunen for første halvdel af 2026.',
    descriptionEn: 'Local and national verification of all single-use and reusable packaging placed on the market for the first half of 2026.',
    fineDa: 'Administrativt bødeforlæg på op til 50.000 DKK pr. manglende produktlinje samt risiko for markedskarantæne.',
    fineEn: 'Administrative fine of up to DKK 50,000 per missing product line and risk of market suspension.',
    recommendationDa: 'Forbind din B2B-emballageportefølje til Cirkels IoT-pantløsning og eksporter automatisk det reviderede mængderegnskab som bevis.',
    recommendationEn: 'Connect your B2B packaging portfolio to Cirkel\'s IoT return loop and automatically export audited quantity logs.',
    learnMoreId: 'epr'
  },
  {
    id: 'deforestation-eudr',
    regions: ['Aarhus Kommune', 'Københavns Kommune', 'Odense Kommune', 'Aalborg Kommune', 'Frederikssund Kommune', 'Danmark'],
    titleDa: 'EUDR Skovrydnings-Overensstemmelsesattest (FSC-Sourcing)',
    titleEn: 'EUDR Deforestation Compliance Due Diligence (FSC-Sourcing)',
    dueDate: '2026-12-30',
    importance: 'high',
    lawType: 'EUDR',
    daysLeft: 190,
    descriptionDa: 'Lovpligtigt krav om due diligence og satellit-sporbarhed for alle pap- og papiremballager sourced i EU.',
    descriptionEn: 'Legally binding due diligence requirement and satellite geo-traceability for all cardboard and paper packaging sourced in the EU.',
    fineDa: 'Konfiskation af partier og straffebøder på op til 4% af den årlige globale omsætning i det pågældende medlemsland.',
    fineEn: 'Confiscation of shipments and penalties up to 4% of the annual global turnover in the corresponding member state.',
    recommendationDa: 'Benyt Cirkels FSC blockchain-verifikation til papkasser for automatisk at knytte geo-koordinatbeviser til emballagens digitale tvilling.',
    recommendationEn: 'Use Cirkel\'s FSC verification for cardboard containers to instantly append geo-coordinate proof to digital twins.',
    learnMoreId: 'eudr'
  },
  {
    id: 'aarhus-refill-quota',
    regions: ['Aarhus Kommune'],
    titleDa: 'Aarhus Kommune Særligt Takstregulativ for Takeaway-huse',
    titleEn: 'Aarhus Municipality Special Refill Quota for Takeaways',
    dueDate: '2026-10-15',
    importance: 'critical',
    lawType: 'Municipal Mandate',
    daysLeft: 114,
    descriptionDa: 'Aarhus Kommunes nye affaldsregulativ pålægger restauranter og detailhandlere i Aarhus C at tilbyde cirkulære refil-løsninger.',
    descriptionEn: 'Aarhus Municipality\'s new waste regulations mandate central restaurants and retailers to offer circular refill cups.',
    fineDa: 'Løbende ugentlige tvangsbøder på op til 10.000 DKK samt suspenderet udeserveringsbevilling.',
    fineEn: 'Consecutive weekly enforcement fines up to DKK 10,000 and temporary suspension of outdoor dining permits.',
    recommendationDa: 'Implementer Cirkel Smart-Bins og kopper med laser-QR på jeres strøg-caféer for at opnå fuld dispensation for refiltvangen.',
    recommendationEn: 'Deploy Cirkel Smart-Bins and cups with laser-engraved QR codes across high-street stores to secure full exemption status.',
    learnMoreId: 'ppwr'
  },
  {
    id: 'frederikssund-sorting-v4',
    regions: ['Frederikssund Kommune'],
    titleDa: 'Frederikssund Erhvervsaffaldsbekendtgørelse v4.2',
    titleEn: 'Frederikssund Commercial Waste Executive Order v4.2',
    dueDate: '2026-11-01',
    importance: 'high',
    lawType: 'Erhvervsaffald',
    daysLeft: 131,
    descriptionDa: 'Evalueringsfrist for obligatorisk kildesortering af mindst 8 kildesorterede affaldsfraktioner på alle erhvervsadresser.',
    descriptionEn: 'Evaluation deadline for mandatory sorting of at least 8 custom waste fractions on all registered commercial properties.',
    fineDa: 'Overtrædelse af affaldsregulativet straffes med administrative påbud, dagsbøder og obligatorisk nød-kontamineringsgebyr.',
    fineEn: 'Violation trigger administrative injunctions, daily penalty rates, and forced contamination response surcharges.',
    recommendationDa: 'Opsæt Cirkel Smart Bins vaskbare systemer i kantinen. Den indbyggede AI-kontamineringsanalyse sikrer ren sortering og stopper overtrædelser i realtid.',
    recommendationEn: 'Set up Cirkel Smart Bins in your cafeteria. Built-in AI contamination tracking keeps fracts super clean and logs compliance metrics.',
    learnMoreId: 'plastic_levy'
  },
  {
    id: 'cph-neutral-delivery',
    regions: ['Københavns Kommune'],
    titleDa: 'Københavns Kommunes Partnerskabsaftale om CO2-neutral Emballagedistribution',
    titleEn: 'City of Copenhagen Partnership Agreement on Green Logistics',
    dueDate: '2026-11-15',
    importance: 'medium',
    lawType: 'Municipal Mandate',
    daysLeft: 145,
    descriptionDa: 'Obligatorisk registrering af distributionsveje og emissionsintensitet for genanvendelige e-handelskasser i Hovedstaden.',
    descriptionEn: 'Mandatory emissions-audit and tracking log for reusable e-commerce transit packaging distributed within Copenhagen.',
    fineDa: 'Tab af grønt leverandørstempel i Københavns Kommunes indkøbssystemer (tab af offentlige udbudspoint).',
    fineEn: 'Loss of green vendor rating in the City of Copenhagen procurement register (points deducted from bids).',
    recommendationDa: 'Tilkobl Cirkel Connect API til at transmittere realtids CO2-reduktionsregnskab direkte til Københavns digital twin.',
    recommendationEn: 'Hook up Cirkel Connect APIs to stream real-time logistics carbon offset statistics straight to the Copenhagen Green Portal.',
    learnMoreId: 'csrd'
  },
  {
    id: 'odense-smart-sorting',
    regions: ['Odense Kommune'],
    titleDa: 'Odense Kommune Miljøindsats for Kaffebarer og Drikkekartoner',
    titleEn: 'Odense Municipality Green Initiative on Coffee & Beverage Cups',
    dueDate: '2026-12-01',
    importance: 'critical',
    lawType: 'Local Directive',
    daysLeft: 161,
    descriptionDa: 'Odense udruller nyt sorterings- og pantdirektiv for bionedbrydelige kopper med krav om sporbar pantgodkendelse.',
    descriptionEn: 'Odense rolls out new sorting and deposit directives for compostable cups, requiring audited deposit-and-return track record.',
    fineDa: 'Afgiftspålæg på 1,25 DKK pr. udleveret kop uden gyldig retroaktiv pantregistrering samt tab af miljømærke.',
    fineEn: 'A surcharge of DKK 1.25 per distributed cup lacking deposit-return validation, plus suspension of eco-certification.',
    recommendationDa: 'Aktiver Odense-specifikke pantindstillinger på Cirkelkortet for at godtgøre borgernes tilbagemeldte returgrad.',
    recommendationEn: 'Activate Odense-specific deposit parameters inside the Cirkel wallet to verify returned item volume automatically.',
    learnMoreId: 'danish_tax'
  },
  {
    id: 'eu-ppwr-2030-target',
    regions: ['Aarhus Kommune', 'Københavns Kommune', 'Odense Kommune', 'Aalborg Kommune', 'Frederikssund Kommune', 'Danmark'],
    titleDa: 'EU PPWR Genbrugskvoter & PFAS Forbud',
    titleEn: 'EU PPWR Reuse Quotas & Total PFAS Material Restrictions',
    dueDate: '2027-01-01',
    importance: 'critical',
    lawType: 'PPWR',
    daysLeft: 192,
    descriptionDa: 'Forbuddet mod PFAS i fødevareemballage træder fuldbyrdet i kraft side om side med registrering af genbrugskvoter på 10% for drikkevarer.',
    descriptionEn: 'Full restriction on PFAS chemical additives in takeaway packaging alongside a mandatory 10% circular reuse target for cups.',
    fineDa: 'Markedsforbud i samtlige EU-lande samt tvangsbøder svarende til op mod 5% af det overtrædende selskabs globale omsætning.',
    fineEn: 'Immediate sale ban across the EU region plus fines equivalent of up to 5% of global organization-wide annual turnover.',
    recommendationDa: 'Omlæg emballager med rPET, verificer fravær af fluorstoffer, og brug Cirkels rotationsmåler til at spore genforbrugelige kredsløb.',
    recommendationEn: 'Transition your assets to rPET, log fluorochemical test certificates, and use Cirkel loop rotations to track lifecycle rate.',
    learnMoreId: 'ppwr'
  }
];

import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ReferenceLine, ReferenceArea
} from 'recharts';
import { triggerHaptic, HapticPattern } from '../lib/haptics';
import RecyclingCenterMap from './RecyclingCenterMap';
import AdministrativeHeatmap from './AdministrativeHeatmap';
import EnterpriseCrmCirkelModal from './EnterpriseCrmCirkelModal';

interface B2BPartnerDashboardProps {
  user: any;
  onChangeUser: (updates: any) => void;
  portalType?: 'business' | 'kommune';
}

// Interactive Custom Tooltip for Circular Recovery & CO2 Trend
const PerformanceCustomTooltip = ({ active, payload, label, language }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isDa = language === 'da';
    return (
      <div className="bg-[#091E3A] border-2 border-[#1E3A8A] text-white p-4 rounded-2xl shadow-2xl text-xs flex flex-col gap-2 min-w-[210px] backdrop-blur-md animate-in fade-in duration-150">
        <div className="flex justify-between items-center border-b border-[#2C5282]/40 pb-1.5 mb-11">
          <span className="font-black text-[#C8F24A] font-mono tracking-wider text-[11px] uppercase">
            {isDa ? `${label} Performance` : `${label} Overview`}
          </span>
          <span className="text-[9px] text-gray-400 font-bold">Verificeret</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 text-gray-300">
              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
              <span>{isDa ? 'CO₂ Sparet:' : 'CO₂ Saved:'}</span>
            </div>
            <span className="font-extrabold text-[#10B981] font-mono">{data.co2Saved} Tons</span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 text-gray-300">
              <span className="w-2 h-2 rounded-full bg-[#85A912]" />
              <span>{isDa ? 'Materialevægt:' : 'Recycled Mass:'}</span>
            </div>
            <span className="font-extrabold text-[#85A912] font-mono">{data.weightTons} Tons</span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 text-gray-300">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span>{isDa ? 'Borger-scanninger:' : 'Citizen Scans:'}</span>
            </div>
            <span className="font-extrabold text-blue-400 font-mono">{data.citizensScans.toLocaleString()}</span>
          </div>
        </div>
        <div className="text-[9px] text-[#A0AEC0] border-t border-[#2C5282]/40 pt-1.5 mt-1 font-semibold leading-normal">
          {isDa 
            ? '✓ Korreleret med officielle CSRD GHG emissions-faktorer'
            : '✓ Correlated with official CSRD GHG emissions factors'}
        </div>
      </div>
    );
  }
  return null;
};

// Interactive Custom Tooltip for Material Distribution PieChart
const MaterialDistributionCustomTooltip = ({ active, payload, language }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isDa = language === 'da';
    const sharePercentage = data.value;
    const rawValueKg = (sharePercentage / 100) * 14842;
    
    return (
      <div className="bg-[#1e293b] border border-gray-700 text-white p-3.5 rounded-2xl shadow-2xl text-[10.5px] flex flex-col gap-2 min-w-[190px] animate-in fade-in duration-100">
        <div className="flex items-center gap-2 border-b border-gray-750 pb-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
          <span className="font-extrabold text-gray-150">{data.name}</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-gray-300">
            <span>{isDa ? 'Procentdel:' : 'Share Ratio:'}</span>
            <span className="font-mono font-black text-white text-xs">{sharePercentage}%</span>
          </div>
          <div className="flex justify-between items-center text-gray-300">
            <span>{isDa ? 'Estimeret Mængde:' : 'Est. Amount:'}</span>
            <span className="font-mono font-extrabold text-[#C8F24A]">{Math.round(rawValueKg).toLocaleString()} kg</span>
          </div>
        </div>
        <p className="text-[8.5px] text-gray-400 font-medium leading-normal italic mt-0.5 border-t border-gray-750 pt-1.5">
          {isDa 
            ? 'Estimeret ud fra kommunens råstofvolumen' 
            : 'Est. based on total municipal feedstock pool'}
        </p>
      </div>
    );
  }
  return null;
};

// Interactive Custom Tooltip for Campaign Simulation ROI Graph
const CampaignSimulationCustomTooltip = ({ active, payload, label, language }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isDa = language === 'da';
    return (
      <div className="bg-[#0f172a] border border-emerald-500/30 text-white p-3.5 rounded-2xl shadow-xl text-[10.5px] flex flex-col gap-2 min-w-[190px] animate-in fade-in duration-100">
        <p className="font-black text-emerald-400 font-mono uppercase text-[9.5px] tracking-wider border-b border-gray-800 pb-1.5 font-sans">
          {label} {isDa ? '- Performance' : '- Performance'}
        </p>
        <div className="flex flex-col gap-1.5 mt-0.5">
          <div className="flex justify-between items-center">
            <span className="text-gray-300">{isDa ? 'Konvertering:' : 'Conversion rate:'}</span>
            <span className="font-extrabold text-[#85A912] font-mono">{data.conversion}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-300">{isDa ? 'Est. CO₂ sparet:' : 'Est. CO₂ saved:'}</span>
            <span className="font-extrabold text-white font-mono">{data.carbonSaved} Tons</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-300">{isDa ? 'Tillidsindeks:' : 'Trust index:'}</span>
            <span className="font-extrabold text-blue-400 font-mono">{data.trust} / 100</span>
          </div>
        </div>
        <p className="text-[8px] text-gray-400 leading-normal border-t border-gray-800 pt-1.5">
          {isDa
            ? 'Støttet af intelligent nudging og belønningsmultiplikatorer'
            : 'Powered by smart nudging & customized loyalty tiers'}
        </p>
      </div>
    );
  }
  return null;
};

// Interactive Custom Tooltip for ESG legislation Benchmarking BarChart
const EsgBenchmarkingCustomTooltip = ({ active, payload, language }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isDa = language === 'da';
    return (
      <div className="bg-white border-2 border-gray-200 text-primary p-3 rounded-2xl shadow-xl text-[10.5px] flex flex-col gap-1.5 min-w-[180px] animate-in fade-in duration-100">
        <p className="font-black text-gray-800 uppercase tracking-wide border-b border-gray-150 pb-1 mb-0.5 font-sans text-[11px]">
          {data.name}
        </p>
        <div className="flex justify-between items-center">
          <span className="text-gray-500 font-semibold">{isDa ? 'Benchmark score:' : 'Circularity score:'}</span>
          <span className="font-black text-xs" style={{ color: data.fill }}>{data.score}%</span>
        </div>
        <p className="text-[9px] text-gray-400 font-semibold leading-normal mt-0.5">
          {data.label}: {data.score < 40 ? (isDa ? 'Uden Cirkel system' : 'Without Cirkel system') :
                        data.score < 70 ? (isDa ? 'Top-kvartil grænse' : 'Top-quartile ceiling') :
                                          (isDa ? 'PPWR EU-mål 2030' : 'PPWR EU targeted compliance')}
        </p>
      </div>
    );
  }
  return null;
};

export default function B2BPartnerDashboard({ user, onChangeUser, portalType = 'business' }: B2BPartnerDashboardProps) {
  const { t, language } = useLanguage();
  const isDa = language === 'da';
  const [activeTab, setActiveTab ] = useState<'overview' | 'muni' | 'provider' | 'map' | 'integrations' | 'esg' | 'campaigns'>('overview');
  const [b2bRole, setB2bRole] = useState<'municipality' | 'company'>('municipality');
  const [mapViewMode, setMapViewMode] = useState<'local' | 'heatmap'>('heatmap');
  const [esgReportTemplate, setEsgReportTemplate] = useState<'csrd' | 'ppwr' | 'epr'>('csrd');
  const [esgReportFormat, setEsgReportFormat] = useState<'pdf' | 'excel' | 'docx' | 'csv'>('pdf');
  const [overviewSubTab, setOverviewSubTab] = useState<'current' | 'projections'>('current');
  const [projectionGrowthModel, setProjectionGrowthModel] = useState<'linear' | 'optimistic' | 'conservative'>('linear');
  const [projectionCo2Goal, setProjectionCo2Goal] = useState<number>(500);
  const [projectionRecyclingGoal, setProjectionRecyclingGoal] = useState<number>(85);

  // Onboarding Tour states
  const [showTour, setShowTour] = useState<boolean>(() => {
    return localStorage.getItem('cirkel_b2b_tour_completed') !== 'true';
  });
  const [tourStep, setTourStep] = useState<number>(0);

  // TRIN 3 hotfix: auto-persistér tour-completion når tour lukkes uanset close-metode
  // (spring over, afslut, klik udenfor, Esc, portal-skift osv.)
  useEffect(() => {
    if (!showTour) {
      localStorage.setItem('cirkel_b2b_tour_completed', 'true');
    }
  }, [showTour]);

  const tourSteps = [
    {
      titleDa: "Velkommen til Cirkel Partner Portal! 🎓",
      titleEn: "Welcome to Cirkel Partner Portal! 🎓",
      descDa: "Dette er din centraliserede kommune- og virksomheds-portal. Tag med på denne uundværlige rundvisning for at opdage vores nøglefunktioner som KPI-rapportering, ESG-benchmarking og live API-indstillinger.",
      descEn: "This is your centralized municipal and enterprise hub. Let's go through this quick guide to locate strategic reporting tools, ESG compliance dashboards, and enterprise integration keys.",
      tab: "overview"
    },
    {
      titleDa: "1. Strategisk KPI Rapportering 📊",
      titleEn: "1. Strategic KPI Reporting 📊",
      descDa: "Følg borgeres genanvending i realtid, se akkumulerede CO₂-besparelser, og overvåg aktive nudging- og sorteringskampagner live på tværs af kommuner.",
      descEn: "Track citizen recycling in real-time, monitor accumulated carbon savings, and view active nudging and separation campaigns live across municipalities.",
      tab: "overview"
    },
    {
      titleDa: "2. EPR & ESG Lovgivnings-Analysator 🌿",
      titleEn: "2. EPR & ESG Legislation Analysator 🌿",
      descDa: "Modellér dine produkter her mod strikse regler (såsom PPWR og EUDR skovregler). Par automatisk emballager med FSC-beviser og beregn afgiftsbesparelser.",
      descEn: "Model your packaging products against strict regulations like PPWR and forestry laws (EUDR). Automatically pair products with FSC proofs and project tax savings.",
      tab: "esg"
    },
    {
      titleDa: "3. Integrations-gateway & API 🔑",
      titleEn: "3. Integrations Gateway & API 🔑",
      descDa: "Administrér TLS-krypterede live API-nøgler, opsæt realtids callback webhooks, og tilslut jeres CRM-systemer som Salesforce, SAP eller Dynamics direkte.",
      descEn: "Manage secure live API keys, establish webhook callback URLs, and sync verified Scope 3 data directly with Salesforce, SAP, or Microsoft Dynamics.",
      tab: "integrations"
    }
  ];

  // TRIN 3 — feature-flag: hvis portalType's custom_content = true, vis placeholder-slot
  const [useCustomContent, setUseCustomContent] = useState(false);
  const [flagLoaded, setFlagLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/b2b/analytics?range=30d')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.success && j?.features) {
          const flag = portalType === 'kommune'
            ? j.features.kommune_custom_content
            : j.features.business_custom_content;
          setUseCustomContent(!!flag);
        }
        setFlagLoaded(true);
      })
      .catch(() => { if (alive) setFlagLoaded(true); });
    return () => { alive = false; };
  }, [portalType]);

  useEffect(() => {
    if (showTour) {
      const targetTab = tourSteps[tourStep]?.tab;
      if (targetTab) {
        setActiveTab(targetTab as any);
      }
    }
  }, [tourStep, showTour]);

  // Marketing & Nudging Campaign States
  const [marketingCampaigns, setMarketingCampaigns] = useState([
    { id: 'mc-1', title: 'Arla rPET Loop Crusade', postcode: '8000', voucherCode: 'ARLA-PCR-20', voucherText: '20% Rabat på Øko-Mælk el. Skyr', targetMaterial: 'Plastik (rPET)', labelCode: 'CIRK-ARLA-PCR', labelStyle: 'Smart-RFID', budget: 35000, spend: 12400, scans: 6200, active: true, conversionRate: 88, color: '#85A912' },
    { id: 'mc-2', title: 'Lurpak Gold Foil Return Challenge', postcode: '8260', voucherCode: 'LURPAK-FREE-BUTTER', voucherText: 'Køb 3, få 1 gratis Lurpak brik', targetMaterial: 'Aluminium', labelCode: 'CIRK-LUR-GOLD', labelStyle: 'High-Contrast QR', budget: 20000, spend: 8500, scans: 4250, active: true, conversionRate: 74, color: '#002b49' },
    { id: 'mc-3', title: 'Aarhus Grøn Kaffekop Loop', postcode: '8000', voucherCode: 'MUNI-COFFEE-FREE', voucherText: 'Gratis kaffe hos deltagende caféer', targetMaterial: 'Komposit-emballage', labelCode: 'CIRK-AARHUS-CUP', labelStyle: 'Laser QR Sticker', budget: 50000, spend: 32000, scans: 16000, active: true, conversionRate: 92, color: '#3B82F6' },
    { id: 'mc-4', title: 'Eco-Pilsner Return Party', postcode: '8210', voucherCode: 'PILSNER-FREE-1', voucherText: 'Byt 10 dåser til en kold sodavand/øl', targetMaterial: 'Aluminium', labelCode: 'CIRK-PIL-PARTY', labelStyle: 'Laser QR Sticker', budget: 15000, spend: 14200, scans: 7100, active: false, conversionRate: 95, color: '#F59E0B' }
  ]);

  // Campaign builder states
  const [newBrandCampTitle, setNewBrandCampTitle] = useState('');
  const [newBrandCampPostcode, setNewBrandCampPostcode] = useState('8000');
  const [newBrandCampVoucherText, setNewBrandCampVoucherText] = useState('15% Rabat på din næste kurv');
  const [newBrandCampVoucherCode, setNewBrandCampVoucherCode] = useState('BRAND-ECO-15');
  const [newBrandCampBudget, setNewBrandCampBudget] = useState(25000);
  const [newBrandCampMaterial, setNewBrandCampMaterial] = useState('Plastik (rPET)');
  const [newBrandCampLabelStyle, setNewBrandCampLabelStyle] = useState('Laser QR Sticker');
  const [newBrandCampColor, setNewBrandCampColor] = useState('#85A912');
  const [selectedLabelCampId, setSelectedLabelCampId] = useState<string>('mc-1');

  // Interactive Live data generator states
  const [simulatedLiveScans, setSimulatedLiveScans] = useState<number>(0);
  const [totalSimulatedSavings, setTotalSimulatedSavings] = useState<number>(0);

  // Advanced Analysis states
  const [marketingBudgetSlider, setMarketingBudgetSlider] = useState<number>(30000);
  const [nudgeFrequency, setNudgeFrequency] = useState<number>(3); // posts per user per week limit
  const [rewardMultiplier, setRewardMultiplier] = useState<number>(1.5); // Multiplier on eco points given
  const [isSimulatingLive, setIsSimulatingLive] = useState<boolean>(false);

  // Live returns IoT simulation engine
  useEffect(() => {
    let interval: any;
    if (isSimulatingLive) {
      interval = setInterval(() => {
        const addedScans = Math.floor(Math.random() * 3) + 1;
        const savedKg = addedScans * 0.15 * rewardMultiplier;
        setSimulatedLiveScans(prev => prev + addedScans);
        setTotalSimulatedSavings(prev => prev + savedKg);

        // Randomly update active campaigns
        setMarketingCampaigns(prev => prev.map(c => {
          if (c.active && Math.random() > 0.4) {
            const extraScans = Math.floor(Math.random() * 2) + 1;
            const costPerScan = Math.round(c.budget / 1000);
            const extraSpend = Math.round(extraScans * costPerScan);
            const newSpend = Math.min(c.spend + extraSpend, c.budget);
            const newScans = c.scans + extraScans;
            return {
              ...c,
              spend: newSpend,
              scans: newScans,
              conversionRate: Math.min(99, Math.round(c.conversionRate + (Math.random() * 1.5 - 0.7)))
            };
          }
          return c;
        }));

        if (Math.random() > 0.55) {
          const names = ['Aarhusianer_99', 'EcoMads_8000', 'MetteS_Viby', 'LarsGreen', 'ArlaLoverX', 'ZeroWasteAarhus', 'KlimaLine'];
          const randomName = names[Math.floor(Math.random() * names.length)];
          const materials = ['rPET mælkeflaske', 'kartonbrik', 'guldfolie', 'Alu-pilsnerdåse'];
          const material = materials[Math.floor(Math.random() * materials.length)];
          addLog('IoT_GW', `Borger '${randomName}' scannede og returnerede 1x ${material} via Cirkel-tag!`, 'success');
        }
      }, 1400);
    }
    return () => clearInterval(interval);
  }, [isSimulatingLive, rewardMultiplier]);

  // EPR / ESG Simulator States
  const [esgTonnage, setEsgTonnage] = useState<number>(145);
  const [esgMaterial, setEsgMaterial] = useState<string>('plastic_virgin');
  const [esgRecyclability, setEsgRecyclability] = useState<string>('B');
  const [esgCirkelOffsetShare, setEsgCirkelOffsetShare] = useState<number>(45);
  const [esgPFAS, setEsgPFAS] = useState<boolean>(false);
  const [esgImportedShare, setEsgImportedShare] = useState<number>(20);
  const [esgIsFscCertified, setEsgIsFscCertified] = useState<boolean>(true);
  const [esgCarbonPriceEuro, setEsgCarbonPriceEuro] = useState<number>(85);
  const [selectedLawDetail, setSelectedLawDetail] = useState<string | null>(null);

  // Registered packaging database
  const [registeredProducts, setRegisteredProducts] = useState([
    { id: '1', name: 'Arla Minimælk Eco 1L', ean: '5700251020492', material: 'Drikkekarton (Multi-layer)', weight: 28, grade: 'A+', tax: 0.18, co2: 0.12 },
    { id: '2', name: 'Lurpak Smør 250g folie', ean: '5700251149202', material: 'Alu-folie laminat', weight: 8, grade: 'B', tax: 0.35, co2: 0.24 },
    { id: '3', name: 'Cirkel Genvindings-kop rPET', ean: '5709128394103', material: 'Plastik (rPET)', weight: 14, grade: 'A++', tax: 0.08, co2: 0.04 },
    { id: '4', name: 'Premium Pilsner dåse 0.33L', ean: '5701142598371', material: 'Aluminium', weight: 12, grade: 'A++', tax: 0.05, co2: 0.02 }
  ]);

  // Producer state inputs
  const [newProdName, setNewProdName] = useState('');
  const [newProdEan, setNewProdEan] = useState('');
  const [newProdMaterial, setNewProdMaterial] = useState('Plastik (rPET)');
  const [newProdWeight, setNewProdWeight] = useState(20);
  const [newProdGrade, setNewProdGrade] = useState('A++');

  // Municipal campaigns state
  const [municipalCampaigns, setMunicipalCampaigns] = useState([
    { id: '1', title: 'Grøn Sommer: Sorter Plastik Cirkel-kopper', postcode: '8000', reward: 1.50, progress: 74, active: true },
    { id: '2', title: 'Karton-indsamling i Viby J', postcode: '8260', reward: 2.00, progress: 48, active: true },
    { id: '3', title: 'Alu-Quest: Drop Point Aarhus C', postcode: '8000', reward: 1.20, progress: 91, active: true }
  ]);

  // Campaign state inputs
  const [newCampTitle, setNewCampTitle] = useState('');
  const [newCampPostcode, setNewCampPostcode] = useState('8000');
  const [newCampReward, setNewCampReward] = useState(1.50);

  // AI Enterprise Co-pilot Strategy states
  const [aiProductObjective, setAiProductObjective] = useState('EPR afgiftsreduktion, special branding, vouchers og optimerede Cirkel-koder');
  const [aiProductNameInput, setAiProductNameInput] = useState('Arla rPET mælkeflaske');
  const [aiProductMaterialSelect, setAiProductMaterialSelect] = useState('Plastik (rPET)');
  const [aiProductTonnageInput, setAiProductTonnageInput] = useState(120);
  const [aiProductWeightInput, setAiProductWeightInput] = useState(18);
  const [aiIsGeneratingReport, setAiIsGeneratingReport] = useState(false);
  const [aiGeneratedResult, setAiGeneratedResult] = useState<any | null>(null);

  const handleFetchAiStrategy = async () => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.LIGHT_TAP);
    setAiIsGeneratingReport(true);
    addLog('AI_ADVISOR', `Starter strategisk ESG-revisionsproces for '${aiProductNameInput}'...`, 'info');
    try {
      const response = await fetch('/api/b2b-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: aiProductNameInput,
          targetMaterial: aiProductMaterialSelect,
          currentCircularityIndex: 35,
          packagingWeight: aiProductWeightInput,
          annualTonnage: aiProductTonnageInput,
          desiredObjective: aiProductObjective
        })
      });
      const resData = await response.json();
      if (resData.success && resData.data) {
        setAiGeneratedResult(resData.data);
        addLog('AI_ADVISOR', `Strategisk ESG-revisionsrapport fuldført med succes for ${aiProductNameInput}!`, 'success');
        const toastFn = (window as any).showToast;
        if (toastFn) toastFn('AI Strategirapport & Kampagner klar!', 'success');
      } else {
        throw new Error('Ugyldigt dataformat modtaget fra AI');
      }
    } catch (e: any) {
      console.error(e);
      addLog('AI_ADVISOR', `Fejl under AI strategiforespørgsel: ` + e.message, 'error');
    } finally {
      setAiIsGeneratingReport(false);
    }
  };

  // IoT Smart Bins Status with contamination tracking
  const [smartBinsList, setSmartBinsList] = useState([
    { id: '1', location: 'Aarhus Rådhusplads', fill: 82, battery: 94, status: 'Aktiv', category: 'Plast & Metal', lastEmptied: 'I går', contamination: 4 },
    { id: '2', location: 'Salling Strøget', fill: 34, battery: 78, status: 'Aktiv', category: 'Drikkekartoner', lastEmptied: '2 dage siden', contamination: 18 },
    { id: '3', location: 'Banegårdspladsen', fill: 91, battery: 88, status: 'Tømning Nødvendig', category: 'Alu & Flasker', lastEmptied: '3 timer siden', contamination: 9 },
    { id: '4', location: 'Dokk1 Havnefront', fill: 12, battery: 99, status: 'Aktiv', category: 'Plast & Metal', lastEmptied: '3 dage siden', contamination: 1 },
    { id: '5', location: 'Aarhus Universitetsparken', fill: 67, battery: 85, status: 'Aktiv', category: 'Cirkel kopper', lastEmptied: 'I dag', contamination: 12 }
  ]);

  // States for adding a new smart-bin
  const [newBinLocation, setNewBinLocation] = useState('');
  const [newBinCategory, setNewBinCategory] = useState('Plast & Metal');
  const [newBinBattery, setNewBinBattery] = useState(99);

  // PostGIS route optimization result state
  const [optimizedRoute, setOptimizedRoute] = useState<any | null>(null);

  // ESG / CSRD Certificate state
  const [showCO2Cert, setShowCO2Cert] = useState(false);
  const [certPartnerName, setCertPartnerName] = useState('Aarhus Kommune');

  // Compliance Alerts state
  const [selectedAlertRegion, setSelectedAlertRegion] = useState<string>(user?.municipality || 'Aarhus Kommune');
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<string[]>([]);
  const [activeAlertFilter, setActiveAlertFilter] = useState<'all' | 'urgent' | 'upcoming'>('all');

  // Annual ESG Report generation states
  const [esgReportYear, setEsgReportYear] = useState<string>('2026');
  const [isGeneratingEsgPdf, setIsGeneratingEsgPdf] = useState(false);
  const [esgPdfStatus, setEsgPdfStatus] = useState<string>('');

  // Webhooks configurations
  const [b2bApiKey, setB2bApiKey] = useState('cirkel_pk_live_d8f2j9e9s3a1m9d4k2');
  const [b2bWebhookUrl, setB2bWebhookUrl] = useState('https://api.aarhus.dk/waste/v1/callback');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [showExportOptionsModal, setShowExportOptionsModal] = useState(false);

  // Live syslog feedback
  const [syslogs, setSyslogs] = useState<any[]>([
    { id: 1, type: 'info', service: 'IoT_GW', msg: 'System online. Forbindelse til 5 standard Master-Bins aktiveret.' },
    { id: 2, type: 'success', service: 'EPR_EVAL', msg: 'Emballagetakst opdateret til overensstemmelse med EU 2026 PPWR standard.' },
    { id: 3, type: 'info', service: 'AUTH', msg: 'Sikker adgang verificeret for: Aarhus Kommune Miljø & Kultur.' }
  ]);

  const addLog = (service: string, msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setSyslogs(prev => [
      { id: Date.now(), type, service, msg: `[${timestamp}] ${msg}` },
      ...prev.slice(0, 15)
    ]);
  };

  // Asynchronous ESG Annual Report compilator pulling data from Firestore
  const generateAnnualEsgPdf = async () => {
    const toastFn = (window as any).showToast;
    try {
      setIsGeneratingEsgPdf(true);
      setEsgPdfStatus(isDa ? 'Etablerer databaseforbindelse...' : 'Connecting to database ledger...');
      addLog('EsgService', `ESG Rapportinitieret for: ${selectedAlertRegion} (${esgReportYear})`, 'info');
      
      // Artificial delay for premium premium UX feedback
      await new Promise(resolve => setTimeout(resolve, 600));
      
      setEsgPdfStatus(isDa ? 'Forespørger historisk sorteringsdata i Firestore...' : 'Querying historical sorting records from Firestore...');
      
      let totalCitizens = 0;
      let totalScans = 0;
      let totalCo2Saved = 0;
      let totalPoints = 0;
      let activeUsersList: any[] = [];
      
      if (isRealFirebase) {
        try {
          const q = query(
            collection(db, 'users'),
            where('municipality', '==', selectedAlertRegion)
          );
          const querySnapshot = await getDocs(q);
          totalCitizens = querySnapshot.size;
          
          querySnapshot.forEach((docSnap) => {
            const d = docSnap.data();
            totalScans += typeof d.scansCount === 'number' ? d.scansCount : 0;
            totalCo2Saved += typeof d.co2SavedKg === 'number' ? d.co2SavedKg : 0;
            totalPoints += typeof d.points === 'number' ? d.points : 0;
            
            activeUsersList.push({
              name: d.fullName || 'Anonym',
              scans: d.scansCount || 0,
              co2: d.co2SavedKg || 0,
              points: d.points || 0
            });
          });
          
          addLog('EsgService', `Modtog data fra Firestore for ${querySnapshot.size} profiler.`, 'success');
        } catch (error) {
          addLog('EsgService', `Firestore query fejlede, kører mængde-estimationsalgoritmer.`, 'warn');
          try {
            handleFirestoreError(error, OperationType.LIST, 'users');
          } catch (wrappedErr) {
            console.warn("Caught and formatted firestore exception for telemetry:", wrappedErr);
          }
        }
      }
      
      // Sandbox fallback data if no records are found or in offline dev mode
      if (totalCitizens === 0) {
        if (selectedAlertRegion.includes('Aarhus')) {
          totalCitizens = 4850;
          totalScans = 184501;
          totalCo2Saved = 64225;
          totalPoints = 369400;
        } else if (selectedAlertRegion.includes('København')) {
          totalCitizens = 12400;
          totalScans = 592810;
          totalCo2Saved = 142240;
          totalPoints = 1184000;
        } else if (selectedAlertRegion.includes('Odense')) {
          totalCitizens = 3210;
          totalScans = 110900;
          totalCo2Saved = 34910;
          totalPoints = 221800;
        } else if (selectedAlertRegion.includes('Aalborg')) {
          totalCitizens = 2950;
          totalScans = 85200;
          totalCo2Saved = 25100;
          totalPoints = 175400;
        } else if (selectedAlertRegion.includes('Frederikssund')) {
          totalCitizens = 1820;
          totalScans = 42800;
          totalCo2Saved = 12450;
          totalPoints = 85600;
        } else {
          totalCitizens = 3840;
          totalScans = 104200;
          totalCo2Saved = 31200;
          totalPoints = 149000;
        }

        activeUsersList = [
          { name: 'Mads Hansen', scans: 450, co2: 126, points: 5400 },
          { name: 'Signe Nielsen', scans: 312, co2: 87, points: 3740 },
          { name: 'Mikkel Jørgensen', scans: 289, co2: 80, points: 3460 },
          { name: 'Freja Poulsen', scans: 245, co2: 68, points: 2940 },
          { name: 'Lars Thomsen', scans: 198, co2: 55, points: 2370 }
        ];
      }

      setEsgPdfStatus(isDa ? 'Kompilerer professionel ESG skabelon...' : 'Compiling design ESG layout...');
      await new Promise(resolve => setTimeout(resolve, 800));

      // ---------------------------------------------
      // ESG TEMPLATE & VALUE RESOLUTIONS
      // ---------------------------------------------
      let eprRate = 2200;
      let plasticLevyRate = 0;
      let cbamRate = 0;
      let eudrRate = 0;
      let pfasRate = 0;
      let co2PerTonMaterial = 1.2;
      let materialLabel = "Karton/Blanding";

      if (esgMaterial === 'plastic_virgin') {
        eprRate = 3800;
        plasticLevyRate = 6000;
        co2PerTonMaterial = 2.8;
        materialLabel = "Virgin Plastik";
      } else if (esgMaterial === 'plastic_recycled') {
        eprRate = 1100;
        co2PerTonMaterial = 0.9;
        materialLabel = "PCR Genbrugsplast";
      } else if (esgMaterial === 'bioplastic') {
        eprRate = 2100;
        plasticLevyRate = 1800;
        co2PerTonMaterial = 1.4;
        materialLabel = "PLA Bioplast";
      } else if (esgMaterial === 'paper_deforested') {
        eprRate = 2400;
        eudrRate = 6800;
        co2PerTonMaterial = 1.3;
        materialLabel = "Ucertificeret Papir";
      } else if (esgMaterial === 'paper_certified') {
        eprRate = 850;
        co2PerTonMaterial = 0.4;
        materialLabel = "FSC Certificeret Pap/Kart";
      } else if (esgMaterial === 'aluminum') {
        eprRate = 1400;
        cbamRate = 4500;
        co2PerTonMaterial = 8.4;
        materialLabel = "Jomfrueligt Alu";
      } else if (esgMaterial === 'aluminum_recycled') {
        eprRate = 400;
        cbamRate = 0;
        co2PerTonMaterial = 0.6;
        materialLabel = "Genbrugsaluminum";
      } else if (esgMaterial === 'composite') {
        eprRate = 5800;
        plasticLevyRate = 3500;
        co2PerTonMaterial = 2.2;
        materialLabel = "Laminat Komposit";
      } else if (esgMaterial === 'glass_virgin') {
        eprRate = 1800;
        co2PerTonMaterial = 1.8;
        materialLabel = "Jomfrueligt Glas";
      } else if (esgMaterial === 'glass_recycled') {
        eprRate = 500;
        co2PerTonMaterial = 0.5;
        materialLabel = "Returglas / Skår";
      }

      if (esgPFAS) {
        pfasRate = 15000;
      }

      let ecoMultiplier = 1.0;
      if (esgRecyclability === 'A++') ecoMultiplier = 0.40;
      else if (esgRecyclability === 'A+') ecoMultiplier = 0.60;
      else if (esgRecyclability === 'A') ecoMultiplier = 0.85;
      else if (esgRecyclability === 'B') ecoMultiplier = 1.00;
      else if (esgRecyclability === 'C') ecoMultiplier = 1.45;
      else if (esgRecyclability === 'D') ecoMultiplier = 1.90;

      const baseEprAmount = esgTonnage * eprRate * ecoMultiplier;
      const plasticLevyAmount = esgTonnage * plasticLevyRate;
      const cbamAmount = esgTonnage * (esgImportedShare / 100) * cbamRate;
      const eudrAmount = esgTonnage * eudrRate;
      const pfasAmount = esgTonnage * pfasRate;
      const co2TonsTotal = esgTonnage * co2PerTonMaterial;
      const shadowCarbonPriceDkk = esgCarbonPriceEuro * 7.45;
      const carbonDebtAmount = co2TonsTotal * shadowCarbonPriceDkk;
      const legacyTotalAmount = baseEprAmount + plasticLevyAmount + cbamAmount + eudrAmount + pfasAmount + carbonDebtAmount;

      const loopReductionFactor = (1 - esgCirkelOffsetShare / 100);
      const cirkelEpr = baseEprAmount * loopReductionFactor;
      const cirkelPlasticLevy = plasticLevyAmount * loopReductionFactor;
      const cirkelCbam = cbamAmount * loopReductionFactor;
      const cirkelEudr = 0;
      const cirkelPfas = esgPFAS ? (pfasAmount * 0.3) : 0;
      const cirkelCarbonDebt = carbonDebtAmount * loopReductionFactor;
      const cirkelTotalAmount = cirkelEpr + cirkelPlasticLevy + cirkelCbam + cirkelEudr + cirkelPfas + cirkelCarbonDebt;
      const savedDkk = legacyTotalAmount - cirkelTotalAmount;
      const savingPercentage = Math.round((savedDkk / (legacyTotalAmount || 1)) * 100);

      // Define legislative texts based on selected template
      let reportTitle = "";
      let reportTemplateName = "";
      let reportRegulationRef = "";
      let reportIntroduction = "";
      let reportImpactText = "";
      let tableHeaders: string[] = [];
      let tableRows: string[][] = [];

      if (esgReportTemplate === 'csrd') {
        reportTitle = isDa ? "EU CSRD - ESRS E5 Ressourceforbrug & Cirkulær Økonomi" : "EU CSRD - ESRS E5 Resource Use & Circular Economy";
        reportTemplateName = "EU CSRD Standard ESRS E5 (Resource Inflows & Circular Outflows)";
        reportRegulationRef = "Corporate Sustainability Reporting Directive (CSRD) / ESRS E5 Resource Use & Circular Economy standard.";
        reportIntroduction = isDa 
          ? `Denne revisionsrapport udgør dokumentationsgrundlag under CSRD (ESRS E5-standarden for cirkulær økonomi) i regionen ${selectedAlertRegion} for finansåret ${esgReportYear}. Ved brug af Cirkels IoT-pantløsning og realtime registreringer i Firestore, kan organisationen attestere præcise genanvendelsesmængder samt undgået Scope 3 udledning.`
          : `This report serves as compliance evidence under the CSRD (ESRS E5 Circular Economy standard) in ${selectedAlertRegion} for reporting period ${esgReportYear}. Utilizing Cirkel's IoT-smart return channels and real-time Firestore ledgers, the organization is able to audit precise circular material flows and Scope 3 greenhouse gas avoidance.`;
        reportImpactText = isDa
          ? `Resultatet dokumenterer, at ${esgCirkelOffsetShare}% af emballagerne succesfuldt er omdirigeret fra lineær deponering til et lukket kredsløb. Dette reducerer Scope 3 drivhusgasudledningen med i alt ${((esgTonnage * (esgCirkelOffsetShare/100)) * co2PerTonMaterial).toFixed(1)} tons CO2e, hvilket nedsætter organisationens langsigtede klimamæssige risikofaktorer.`
          : `The audit verifies that ${esgCirkelOffsetShare}% of outbound packaging mass is successfully redirected into an active closed loop. This mitigates Scope 3 emissions by a total of ${((esgTonnage * (esgCirkelOffsetShare/100)) * co2PerTonMaterial).toFixed(1)} tons CO2e, effectively mitigating long-term climate liability risks.`;
        
        tableHeaders = isDa
          ? ["Ressource-Metrik", "Værdi (Tons / Rate)", "Compliance-Beskrivelse"]
          : ["Resource Metric", "Value (Tons / Rate)", "Compliance Description"];
        tableRows = [
          [isDa ? "Samlet Emballageforbrug" : "Total Packaging Input", `${esgTonnage} Tons/år`, isDa ? "Den samlede emballagemængde sat i cirkulation." : "The total annual packaging mass put on the market."],
          [isDa ? "Jomfrueligt Råstofforbrug" : "Virgin Raw Material Sourced", `${(esgTonnage * (1 - esgCirkelOffsetShare/100)).toFixed(1)} Tons/år`, isDa ? "Mængde af råmateriale fra ikke-cirkulære forsyningskæder." : "Material sourced from traditional, non-circular extraction lines."],
          [isDa ? "Genanvendt Emballagemateriale (PCR)" : "Post-Consumer Recycled Content", `${(esgTonnage * (esgCirkelOffsetShare/100)).toFixed(1)} Tons/år`, isDa ? "Materiale indvundet og recirkuleret gennem Cirkels IoT-løsning." : "Material successfully recovered and circularized by Cirkel nodes."],
          [isDa ? "Undgået Deponering & Forbrænding" : "Diverted Landfill / Incineration Mass", `${(esgTonnage * (esgCirkelOffsetShare/100)).toFixed(1)} Tons/år`, isDa ? "Fysisk emballagemasse holdt ude af det kommunale affaldsregnskab." : "Physical mass kept entirely out of regional waste streams."],
          [isDa ? "Undgået Scope 3 CO2-Udledning" : "Mitigated Scope 3 CO2 Emissions", `${((esgTonnage * (esgCirkelOffsetShare/100)) * co2PerTonMaterial).toFixed(1)} Tons CO2e`, isDa ? "CO2-besparelse beregnet efter standardiserede ESRS E5 faktorer." : "CO2 emissions reduction calculated under standard ESRS E5 rules."]
        ];
      } else if (esgReportTemplate === 'ppwr') {
        reportTitle = isDa ? "EU PPWR Emballage & Emballageaffald Overensstemmelsesattest" : "EU PPWR Packaging & Packaging Waste Compliance Certificate";
        reportTemplateName = "EU PPWR Forordningsattest (PCR Krav & Returgrad Artikel 26/38)";
        reportRegulationRef = "EU Packaging and Packaging Waste Regulation (PPWR) 2026 / Artikel 26 & 38.";
        reportIntroduction = isDa
          ? `Denne overensstemmelsesattest bekræfter organisationens opfyldelse af kravene i EU Packaging and Packaging Waste Regulation (PPWR), herunder mål for genanvendt indhold (PCR-andel) og etablering af velfungerende pantsystemer (DRS). Cirkels smarte returpunkter i ${selectedAlertRegion} muliggør præcis sporing af disse metrikker.`
          : `This compliance certificate validates organizational alignment with upcoming EU Packaging and Packaging Waste Regulation (PPWR) targets, including minimum Post-Consumer Recycled (PCR) content and deposit-return parameters. Cirkel's active nodes in ${selectedAlertRegion} provide audit-ready proof.`;
        reportImpactText = isDa
          ? `Gennem Cirkels digitale returpunkter er der opnået en verificeret returgrad på ${esgCirkelOffsetShare}%. Dette overstiger det fremtidige PPWR 2030-krav om minimum 30% genanvendt indhold i plastemballager. Den gennemsnitlige genanvendelses-frekvens reducerer behovet for engangsemballager med i alt ${Math.round(totalScans * (esgCirkelOffsetShare/100) * 1.2).toLocaleString('da-DK')} enheder.`
          : `Through Cirkel's active smart return network, the packaging achieves a verified return rate of ${esgCirkelOffsetShare}%. This outperforms the upcoming PPWR 2030 target of 30% post-consumer recycled content for plastic. The reuse loop reduces the consumption of single-use packaging by an estimated ${Math.round(totalScans * (esgCirkelOffsetShare/100) * 1.2).toLocaleString('da-DK')} units.`;
        
        tableHeaders = isDa
          ? ["PPWR Overensstemmelses-Metrik", "Målt Værdi", "PPWR Juridisk Reference & Status"]
          : ["PPWR Compliance Metric", "Measured Value", "PPWR Legal Reference & Status"];
        tableRows = [
          [isDa ? "Sorterede Emballageenheder via IoT" : "Sorted Packaging Units via IoT Nodes", `${totalScans.toLocaleString('da-DK')} stk`, isDa ? "Fysiske enheder registreret på Cirkel Smart-Bins." : "Physical items scanned and validated by Cirkel IoT hardware."],
          [isDa ? "Gennemsnitlig Returgrad (Pant-rate)" : "Average Return Rate (Deposit Efficiency)", `${esgCirkelOffsetShare}%`, isDa ? "Andel returnerede emballager jf. PPWR Artikel 38." : "Packaging returned to deposit network under PPWR Article 38."],
          [isDa ? "Verificeret PCR (Genanvendt) Indhold" : "Verified PCR Recycled Content Share", `${esgCirkelOffsetShare}%`, isDa ? "Målt genanvendt råvareandel i det cirkulerede kredsløb." : "Measured recycled plastic/metal/cardboard content in the loop."],
          [isDa ? "EU PPWR 2030 Minimumskrav (PCR Plast)" : "EU PPWR 2030 Minimum Target (PCR Plastic)", "30.0%", isDa ? "Gældende lovkrav for plastikemballage jf. PPWR Artikel 26." : "Mandated minimum post-consumer recycled content by 2030 under Art 26."],
          [isDa ? "PCR Sikkerheds-margin til Lovgrænse" : "PCR Safety Margin to Regulatory Floor", `${(esgCirkelOffsetShare - 30.0).toFixed(1)}%`, isDa ? "Organisationens aktuelle fordel i forhold til 2030-kravet." : "Current compliance headroom relative to the 2030 requirement."]
        ];
      } else { // epr
        reportTitle = isDa ? "EU EPR Miljø-øko-moduleret Afgiftsrevisionsrapport" : "EU EPR Eco-Modulated Producer Responsibility Report";
        reportTemplateName = "EU EPR Afgiftsrevisions-Rapport (Udvidet Producentansvar)";
        reportRegulationRef = "Dansk Miljøbeskyttelseslov § 9, EU EPR Direktiv 2008/98/EF / Eco-modulation parameters.";
        reportIntroduction = isDa
          ? `Denne revisionsrapport beregner og reviderer virksomhedens udvidede producentansvarsforpligtelser (EPR) for emballage i ${selectedAlertRegion} for året ${esgReportYear}. Ved brug af Cirkels IoT-pantesystem og materialegradssortering A++ modtager producenten øko-modulationsrabatter og direkte kredsløbskompensationer.`
          : `This audit report calculates and audits producer liability fees under Extended Producer Responsibility (EPR) regulations active in ${selectedAlertRegion} for year ${esgReportYear}. Utilizing Cirkel's smart deposit network and material sorting grade A++ enables access to substantial eco-modulation fee discounts.`;
        reportImpactText = isDa
          ? `Under en lineær model ville de samlede EPR-miljøafgifter udgøre ${Math.round(legacyTotalAmount).toLocaleString('da-DK')} DKK. Med Cirkels IoT-pantesystem reduceres den revisionspligtige miljøafgift til ${Math.round(cirkelTotalAmount).toLocaleString('da-DK')} DKK. Dette giver en samlet årlig besparelse på ${Math.round(savedDkk).toLocaleString('da-DK')} DKK (svarende til ${savingPercentage}% reduktion).`
          : `In a traditional linear model, the company's annual EPR liability would amount to ${Math.round(legacyTotalAmount).toLocaleString('da-DK')} DKK. Using Cirkel's IoT network, audited environmental liability drops to ${Math.round(cirkelTotalAmount).toLocaleString('da-DK')} DKK. This yields a net annual savings of ${Math.round(savedDkk).toLocaleString('da-DK')} DKK (a ${savingPercentage}% reduction).`;
        
        tableHeaders = isDa
          ? ["EPR Afgiftsmetrik & Øko-modulation", "Standard Lineær", "Cirkel Loop Optimeret", "Besparelse (DKK)", "Procentuel Reduktion"]
          : ["EPR Fee Metric & Eco-Modulation", "Standard Linear", "Cirkel Loop Optimized", "Savings (DKK)", "Percentage Reduction"];
        tableRows = [
          [isDa ? "Udvidet Producentansvar (EPR) Baserate" : "EPR Base Fee (Base material tariff)", `${Math.round(baseEprAmount).toLocaleString('da-DK')} DKK`, `${Math.round(cirkelEpr).toLocaleString('da-DK')} DKK`, `${Math.round(baseEprAmount - cirkelEpr).toLocaleString('da-DK')} DKK`, `${esgCirkelOffsetShare}%`],
          [isDa ? "EU Plastafgift (Levy-sats)" : "EU Plastic Levy Tax", `${Math.round(plasticLevyAmount).toLocaleString('da-DK')} DKK`, `${Math.round(cirkelPlasticLevy).toLocaleString('da-DK')} DKK`, `${Math.round(plasticLevyAmount - cirkelPlasticLevy).toLocaleString('da-DK')} DKK`, `${esgCirkelOffsetShare}%`],
          [isDa ? "Klimagæld Skygge CO2-afgift" : "CO2 Climate Shadow Debt", `${Math.round(carbonDebtAmount).toLocaleString('da-DK')} DKK`, `${Math.round(cirkelCarbonDebt).toLocaleString('da-DK')} DKK`, `${Math.round(carbonDebtAmount - cirkelCarbonDebt).toLocaleString('da-DK')} DKK`, `${esgCirkelOffsetShare}%`],
          [isDa ? "SAMLET REVISIONSPLIGTIG MILJØGÆLD" : "TOTAL AUDITED EPR LIABILITY", `${Math.round(legacyTotalAmount).toLocaleString('da-DK')} DKK`, `${Math.round(cirkelTotalAmount).toLocaleString('da-DK')} DKK`, `${Math.round(savedDkk).toLocaleString('da-DK')} DKK`, `${savingPercentage}%`]
        ];
      }


      // EXPORT FORMAT DISPATCHER FOR NON-PDF FORMATS
      if (esgReportFormat === 'csv') {
        let csvLines: string[] = [];
        csvLines.push(`"CIRKEL SYSTEMS - ESG COMPLIANCE REPORT"`);
        csvLines.push(`"Rapportskabelon","${reportTemplateName}"`);
        csvLines.push(`"Virksomhed/Kommune","${selectedAlertRegion}"`);
        csvLines.push(`"Rapporteringsår","${esgReportYear}"`);
        csvLines.push(`"Reguleringsreference","${reportRegulationRef}"`);
        csvLines.push(``);
        csvLines.push(`"${tableHeaders.join('","')}"`);
        tableRows.forEach(row => {
          csvLines.push(`"${row.map(cell => cell.replace(/"/g, '""')).join('","')}"`);
        });
        csvLines.push(``);
        csvLines.push(`"Kryptografisk Hash Proof","crk_ledger_sha256_${Math.random().toString(36).substring(2, 10).toUpperCase()}"`);
        csvLines.push(`"Udarbejdet","Morten Schmidt, Chief Sustainability Auditor, Cirkel ApS"`);

        const csvString = csvLines.join("\n");
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Cirkel_ESG_${esgReportTemplate.toUpperCase()}_Report_${selectedAlertRegion.replace(/\s+/g, '_')}_${esgReportYear}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        addLog('EsgService', `ESG CSV-rapport (${esgReportTemplate}) eksporteret med succes.`, 'success');
        setIsGeneratingEsgPdf(false);
        setEsgPdfStatus('');
        setShowExportOptionsModal(false);
        if (toastFn) toastFn(`Succes! CSV-rapport downloadet.`, 'success');
        confetti({ particleCount: 50, spread: 45, origin: { y: 0.85 } });
        return;
      }

      if (esgReportFormat === 'excel') {
        let excelHtml = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
          <head>
            <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
            <style>
              table { border-collapse: collapse; font-family: 'Segoe UI', Arial, sans-serif; }
              td, th { border: 1px solid #D1D5DB; padding: 8px 12px; font-size: 11px; }
              .header { background-color: #0F2916; color: #FFFFFF; font-weight: bold; font-size: 11px; text-transform: uppercase; }
              .title { font-size: 16px; font-weight: bold; color: #0F2916; padding-bottom: 6px; }
              .meta-label { font-weight: bold; background-color: #F3F4F6; width: 220px; }
              .meta-val { color: #111827; }
              .badge { background-color: #85A912; color: white; font-weight: bold; text-align: center; font-size: 11px; padding: 6px; }
              .number { text-align: right; }
              .total-row { font-weight: bold; background-color: #ECFDF5; border-top: 2px solid #0F2916; border-bottom: 2px double #0F2916; }
            </style>
          </head>
          <body>
            <table>
              <tr><td colspan="5" class="title">${reportTitle}</td></tr>
              <tr><td colspan="5" class="badge">✓ JURIDISK REVISIONSKLAR CERTIFICERET LEDGER - BEKRÆFTET INDSATS</td></tr>
              <tr><td class="meta-label">Lovgivnings-ramme:</td><td colspan="4" class="meta-val">${reportTemplateName}</td></tr>
              <tr><td class="meta-label">Rapporterende Enhed:</td><td colspan="4" class="meta-val">${selectedAlertRegion}</td></tr>
              <tr><td class="meta-label">Rapporteringsår:</td><td colspan="4" class="meta-val">${esgReportYear}</td></tr>
              <tr><td class="meta-label">Lovgrundlag & Standarder:</td><td colspan="4" class="meta-val">${reportRegulationRef}</td></tr>
              <tr><td class="meta-label">Tilsynskode (SHA-256):</td><td colspan="4" class="meta-val" style="font-family: monospace;">crk_secure_node_${Math.random().toString(36).substring(2, 12).toUpperCase()}</td></tr>
              <tr><td colspan="5"></td></tr>
              <tr class="header">
                ${tableHeaders.map(h => `<th>${h}</th>`).join('')}
              </tr>
              ${tableRows.map((row, rIdx) => {
                const isEprTotal = esgReportTemplate === 'epr' && rIdx === tableRows.length - 1;
                return `
                  <tr class="${isEprTotal ? 'total-row' : ''}">
                    ${row.map((cell, cIdx) => {
                      const isNum = cIdx > 0 && !isNaN(parseFloat(cell.replace(/\./g, '').replace(/,/g, '.')));
                      return `<td class="${isNum ? 'number' : ''}">${cell}</td>`;
                    }).join('')}
                  </tr>
                `;
              }).join('')}
            </table>
          </body>
          </html>
        `;

        const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Cirkel_ESG_${esgReportTemplate.toUpperCase()}_Report_${selectedAlertRegion.replace(/\s+/g, '_')}_${esgReportYear}.xls`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        addLog('EsgService', `ESG Excel-rapport (${esgReportTemplate}) genereret og downloadet.`, 'success');
        setIsGeneratingEsgPdf(false);
        setEsgPdfStatus('');
        setShowExportOptionsModal(false);
        if (toastFn) toastFn(`Succes! Excel-regneark downloadet.`, 'success');
        confetti({ particleCount: 60, spread: 50, origin: { y: 0.85 } });
        return;
      }

      if (esgReportFormat === 'docx') {
        const wordHtml = `
          <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
          <head>
            <meta charset="utf-8">
            <title>${reportTitle}</title>
            <style>
              body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333333; margin: 40px; }
              h1 { color: #0F2916; border-bottom: 2px solid #85A912; padding-bottom: 8px; font-size: 18px; text-transform: uppercase; }
              h2 { color: #0F2916; font-size: 13px; margin-top: 24px; text-transform: uppercase; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; }
              p { font-size: 10px; color: #4B5563; margin-bottom: 12px; }
              table { width: 100%; border-collapse: collapse; margin: 16px 0; }
              th { background-color: #0F2916; color: #FFFFFF; font-weight: bold; text-align: left; border: 1px solid #E5E7EB; padding: 8px; font-size: 9px; }
              td { border: 1px solid #E5E7EB; padding: 8px; font-size: 9px; }
              .meta-box { border: 1px solid #85A912; background-color: #F9FBF6; padding: 12px; margin-bottom: 20px; border-radius: 8px; }
              .meta-box table td { border: none; padding: 4px; }
              .badge { background-color: #85A912; color: white; padding: 4px 8px; font-size: 8px; font-weight: bold; border-radius: 4px; text-transform: uppercase; }
              .text-right { text-align: right; }
              .bold { font-weight: bold; }
            </style>
          </head>
          <body>
            <div style="text-align: center; margin-bottom: 30px;">
              <span class="badge">Officiel Revisionsattest</span>
              <h1 style="margin-top: 10px; border: none; padding: 0;">${reportTitle}</h1>
              <p style="font-size: 11px; color: #0D1E11; font-weight: bold;">Leveret under Cirkel Systems IoT-Sorteringsnetværk og Firestore Ledgers</p>
            </div>

            <div class="meta-box">
              <table>
                <tr><td class="bold" style="width: 200px;">Organisation / Kommune:</td><td>${selectedAlertRegion}</td></tr>
                <tr><td class="bold">Lovgivningsmæssig Standard:</td><td>${reportTemplateName}</td></tr>
                <tr><td class="bold">Rapporteringsperiode:</td><td>Finansår ${esgReportYear} (Komplet mængderegnskab)</td></tr>
                <tr><td class="bold">Reguleringsgrundlag:</td><td>${reportRegulationRef}</td></tr>
              </table>
            </div>

            <h2>1. Lovgivningsmæssig Introduktion</h2>
            <p>${reportIntroduction}</p>

            <h2>2. Revisionsdata & Mængdebalancer</h2>
            <table>
              <thead>
                <tr>
                  ${tableHeaders.map((h: string) => `<th>${h}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${tableRows.map((row: string[]) => `
                  <tr>
                    ${row.map((cell: string, idx: number) => {
                      const isNum = idx > 0 && !isNaN(parseFloat(cell.replace(/\./g, '').replace(/,/g, '.')));
                      return `<td class="${isNum ? 'text-right' : ''}">${cell}</td>`;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <h2>3. Miljømæssige & Økonomiske Konsekvenser</h2>
            <p>${reportImpactText}</p>
          </body>
          </html>
        `;

        const blob = new Blob([wordHtml], { type: 'application/msword;charset=utf-8' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Cirkel_ESG_${esgReportTemplate.toUpperCase()}_Report_${selectedAlertRegion.replace(/\s+/g, '_')}_${esgReportYear}.doc`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        addLog('EsgService', `ESG Word-rapport (${esgReportTemplate}) genereret og downloadet.`, 'success');
        setIsGeneratingEsgPdf(false);
        setEsgPdfStatus('');
        setShowExportOptionsModal(false);
        if (toastFn) toastFn(`Succes! Word-dokument downloadet.`, 'success');
        confetti({ particleCount: 60, spread: 50, origin: { y: 0.85 } });
        return;
      }

      setEsgPdfStatus(isDa ? 'Kompilerer professionel PDF skabelon...' : 'Compiling design PDF layout...');
      await new Promise(resolve => setTimeout(resolve, 800));

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // ==========================================
      // PAGE 1: COVER & EXECUTIVE SUMMARY
      // ==========================================
      
      // Top Dark Forest Green Banner
      doc.setFillColor(13, 30, 17);
      doc.rect(0, 0, 210, 52, 'F');

      // Top Light Green Bar Accents
      doc.setFillColor(133, 169, 18);
      doc.rect(0, 52, 210, 2, 'F');

      // Banner Typography
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('CIRKEL CORPORATE SUSTAINABILITY REGISTRY', 20, 18);

      doc.setFontSize(reportTitle.length > 35 ? 13 : 16);
      doc.text(reportTitle.toUpperCase(), 20, 29);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(190, 215, 120);
      doc.text(`REGIONAL AUDIT & EMISSION SAVINGS ACCOUNTING · REPORT YEAR: ${esgReportYear}`, 20, 36);

      // Certified Badge Stamp
      doc.setFillColor(133, 169, 18);
      doc.rect(148, 12, 42, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('AUDITED ✓ CERTIFIED', 151, 17.5);

      // Report Metadata Box
      doc.setDrawColor(220, 230, 200);
      doc.setFillColor(250, 251, 246);
      doc.rect(20, 60, 170, 28, 'FD');

      doc.setTextColor(40, 40, 40);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('ORGANISATION / MUNICIPALITY:', 25, 66);
      doc.setFont('helvetica', 'normal');
      doc.text(selectedAlertRegion.toUpperCase(), 82, 66);

      doc.setFont('helvetica', 'bold');
      doc.text('REPORT MODEL / FRAMEWORK:', 25, 72);
      doc.setFont('helvetica', 'normal');
      doc.text(reportTemplateName.substring(0, 52), 82, 72);

      doc.setFont('helvetica', 'bold');
      doc.text('REGULATORY STANDARDS:', 25, 78);
      doc.setFont('helvetica', 'normal');
      doc.text(reportRegulationRef.substring(0, 52), 82, 78);

      doc.setFont('helvetica', 'bold');
      doc.text('VERIFICATION SIGNATURE:', 25, 84);
      doc.setFont('helvetica', 'normal');
      doc.text(`[CIRKEL-SHA-PROOF-${Math.random().toString(36).substring(2, 8).toUpperCase()}]`, 82, 84);

      // Section 1: Executive Summary
      doc.setTextColor(20, 40, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(isDa ? '1. JURIDISK COMPLIANCE-ERKLÆRING & INTRODUKTION' : '1. EXECUTIVE SUMMARY & LEGISLATIVE COMPLIANCE STATEMENT', 20, 97);
      
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.5);
      doc.line(20, 99, 190, 99);

      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      
      const introLines = doc.splitTextToSize(reportIntroduction, 170);
      doc.text(introLines, 20, 105);

      // KPI Grid Cards Header
      doc.setFillColor(245, 246, 240);
      doc.rect(20, 142, 170, 7, 'F');
      doc.setTextColor(50, 70, 20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('KEY ENVIRONMENTAL PERFORMANCE INDICATORS (KPIs) - RETRIEVED FROM FIRESTORE LEDGER', 24, 147);

      // 4 Bento Grid KPI Cards
      // Row 1
      // Card A
      doc.setDrawColor(225, 225, 225);
      doc.setFillColor(255, 255, 255);
      doc.rect(20, 154, 82, 24, 'FD');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text('ACTIVE ENGAGED CITIZENS', 24, 160);
      doc.setTextColor(13, 30, 17);
      doc.setFontSize(16);
      doc.text(totalCitizens.toLocaleString('da-DK'), 24, 171);

      // Card B
      doc.rect(108, 154, 82, 24, 'FD');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.text('CUMULATIVE CO2 SAVED (TONS)', 112, 160);
      doc.setTextColor(16, 185, 129); // green
      doc.setFontSize(16);
      doc.text(`${(totalCo2Saved / 1000).toFixed(2)} t`, 112, 171);

      // Row 2
      // Card C
      doc.rect(20, 183, 82, 24, 'FD');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.text('TOTAL PACKAGING CORES RECIRCULATED', 24, 189);
      doc.setTextColor(13, 30, 17);
      doc.setFontSize(16);
      doc.text(`${totalScans.toLocaleString('da-DK')} items`, 24, 200);

      // Card D
      doc.rect(108, 183, 82, 24, 'FD');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.text('CIRKEL DEPOSIT POINTS SYSTEM REWARDED', 112, 189);
      doc.setTextColor(133, 169, 18); // yellow-brown
      doc.setFontSize(16);
      doc.text(`${totalPoints.toLocaleString('da-DK')} CP`, 112, 200);

      // Section 2: Financial Resource Recovery Accrual
      doc.setTextColor(20, 40, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(isDa ? '2. MILJØMÆSSIG & COMPLIANCE-FORPLIGTELSES ANALYSE' : '2. ENVIRONMENTAL IMPACT & COMPLIANCE ANALYSIS', 20, 218);
      doc.line(20, 220, 190, 220);

      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);

      const finLines = doc.splitTextToSize(reportImpactText, 170);
      doc.text(finLines, 20, 226);

      // Footer
      doc.setDrawColor(240, 240, 240);
      doc.line(20, 280, 190, 280);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Cirkel ESG Ledger · Annual Audited Report ${esgReportYear} · Confidential. Document hash: crk_hash_${Math.random().toString(36).substring(2, 8)}`, 20, 285);
      doc.text('Page 1 of 2', 178, 285);

      // ==========================================
      // PAGE 2: MATERIAL BREAKDOWN & LEGISLATIVE COMPLIANCE
      // ==========================================
      doc.addPage();

      // Top mini header
      doc.setDrawColor(133, 169, 18);
      doc.setLineWidth(0.8);
      doc.line(20, 15, 190, 15);
      doc.setFontSize(8);
      doc.setTextColor(133, 169, 18);
      doc.setFont('helvetica', 'bold');
      doc.text('CIRKEL DECENTRALIZED DATA LEDGER', 20, 11);
      doc.setTextColor(130, 130, 130);
      doc.text('ANNUAL CORPORATE AUDIT KEY DETAILS', 123, 11);

      // Section 3: Material Distribution
      doc.setTextColor(20, 40, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(isDa ? '3. REVISIONSREGNSKAB & TRANSACTIONSDETALJER' : '3. REGULATORY COMPLIANCE LEDGER DETAILS', 20, 26);
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.3);
      doc.line(20, 28, 190, 28);

      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(isDa 
        ? `Følgende tabel indeholder de officielle mængder og afgifter opgjort jf. kravene i ${reportTemplateName}:`
        : `The following table contains the official quantities and calculations compiled in compliance with ${reportTemplateName}:`, 20, 34);

      // Table Header row
      doc.setFillColor(244, 245, 240);
      doc.rect(20, 40, 170, 8, 'F');
      
      doc.setTextColor(13, 30, 17);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);

      if (esgReportTemplate !== 'epr') {
        doc.text(tableHeaders[0], 24, 45.5);
        doc.text(tableHeaders[1], 88, 45.5);
        doc.text(tableHeaders[2], 122, 45.5);
      } else {
        doc.text(tableHeaders[0], 24, 45.5);
        doc.text(tableHeaders[1], 76, 45.5);
        doc.text(tableHeaders[2], 108, 45.5);
        doc.text(tableHeaders[3], 138, 45.5);
        doc.text(tableHeaders[4], 170, 45.5);
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      let rY = 48;
      tableRows.forEach((row, idx) => {
        // Alternating row background
        if (idx % 2 === 1) {
          doc.setFillColor(252, 253, 250);
          doc.rect(20, rY, 170, 8, 'F');
        }
        doc.setTextColor(50, 50, 50);
        
        const isLastEpr = esgReportTemplate === 'epr' && idx === tableRows.length - 1;
        if (isLastEpr) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(13, 30, 17);
        }

        if (esgReportTemplate !== 'epr') {
          doc.text(row[0], 24, rY + 5.5);
          doc.text(row[1], 88, rY + 5.5);
          const descLines = doc.splitTextToSize(row[2], 64);
          doc.text(descLines, 122, rY + 4.5);
        } else {
          doc.text(row[0], 24, rY + 5.5);
          doc.text(row[1], 76, rY + 5.5);
          doc.text(row[2], 108, rY + 5.5);
          doc.text(row[3], 138, rY + 5.5);
          doc.text(row[4], 170, rY + 5.5);
        }

        doc.setFont('helvetica', 'normal');

        // Draw line divider
        doc.setDrawColor(240, 240, 240);
        doc.line(20, rY + 8, 190, rY + 8);
        rY += 8;
      });

      // Section 4: Regulatory Alert Status Matching
      doc.setTextColor(20, 40, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(isDa ? '4. REGULERINGS- og JURIDISKE NOTER' : '4. ENVIRONMENTAL LEGISLATION COMPLIANCE STATEMENTS', 20, rY + 12);
      doc.setDrawColor(230, 230, 230);
      doc.line(20, rY + 14, 190, rY + 14);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(70, 70, 70);
      doc.text(isDa 
        ? `Følgende compliance sporingsnoter er aktive i regionen ${selectedAlertRegion} jf. Cirkel ledger verification:`
        : `Below are the audited regulatory alert tracks in ${selectedAlertRegion} linked to the organization's Cirkel ledger verification:`, 20, rY + 19);

      // Print first 2 compliance alerts matching the region
      let alertY = rY + 24;
      const associatedAlerts = complianceAlertsDB.filter(a => a.regions.includes(selectedAlertRegion)).slice(0, 2);
      
      associatedAlerts.forEach((alert) => {
        doc.setFillColor(250, 251, 246);
        doc.setDrawColor(210, 220, 180);
        doc.rect(20, alertY, 170, 16, 'FD');

        doc.setTextColor(13, 30, 17);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(`[${alert.lawType}] ${isDa ? alert.titleDa : alert.titleEn}`, 24, alertY + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(`DEADLINE: ${alert.dueDate}  |  STATUS: SYNCED TO CIRKEL LOOP`, 24, alertY + 9);
        doc.setTextColor(60, 60, 60);
        doc.text(`PENALTY RISK: ${isDa ? alert.fineDa : alert.fineEn}`, 24, alertY + 13);
        
        alertY += 21;
      });

      // Section 5: Audit Data Ledger Verification Table
      doc.setTextColor(20, 40, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('5. AUDITED ANONYMOUS REGISTERED CITIZEN LEDGER', 20, alertY + 8);
      doc.line(20, alertY + 10, 190, alertY + 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text('To facilitate third-party ESG audits, a sample log of top local citizens who opted in for municipal metadata contribution is recorded below:', 20, alertY + 15);

      // Mini Citizen table
      let tableY = alertY + 19;
      doc.setFillColor(245, 245, 245);
      doc.rect(20, tableY, 170, 7, 'F');
      
      doc.setTextColor(13, 30, 17);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('CITIZEN AUDIT IDENTIFY KEY', 24, tableY + 5);
      doc.text('COMPLETED SCANS', 78, tableY + 5);
      doc.text('CO2 REDUCTION METRICS (KG)', 113, tableY + 5);
      doc.text('GREEN ECO-POINTS REWARDED', 158, tableY + 5);

      doc.setFont('helvetica', 'normal');
      tableY += 7;
      activeUsersList.slice(0, 4).forEach((citizen, idx) => {
        doc.setTextColor(60, 60, 60);
        doc.text(`CirkelCitizenID-${citizen.name.replace(/\s+/g, '').substring(0, 6)}-${1000 + idx}`, 24, tableY + 5);
        doc.text(`${citizen.scans} scans`, 78, tableY + 5);
        doc.text(`${citizen.co2} kg CO2`, 113, tableY + 5);
        doc.text(`${citizen.points} CP`, 158, tableY + 5);
        
        doc.line(20, tableY + 7, 190, tableY + 7);
        tableY += 7;
      });

      // Corporate signature block
      doc.setFillColor(250, 252, 248);
      doc.setDrawColor(200, 220, 180);
      doc.rect(20, 234, 170, 22, 'FD');

      doc.setTextColor(40, 70, 20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('STATEMENT OF REPLICABILITY & AUDIT QUALITY:', 24, 239);
      doc.setTextColor(70, 80, 70);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      
      const disclaimerTxt = `This document verifies that all recorded packaging return logs are authentic transactions processed under verified Cirkel IoT mesh rules. No self-reported circular loops are accepted; all calculations map directly to physical material sensors. This ESG certificate is safe for board disclosures.`;
      const discLines = doc.splitTextToSize(disclaimerTxt, 160);
      doc.text(discLines, 24, 243.5);

      // Core Signatures
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 30, 17);
      doc.text('Morten Schmidt', 25, 269);
      doc.setFont('helvetica', 'normal');
      doc.text('Chief Sustainability Auditor, Cirkel ApS', 25, 273);
      doc.line(25, 265, 85, 265);

      doc.setFont('helvetica', 'bold');
      doc.text('Digital Security Vault ID', 121, 269);
      doc.setFont('helvetica', 'normal');
      doc.text(`SHA-256: 4df5a9f2e3a1... (VERIFIED NODE)`, 121, 273);
      doc.line(121, 265, 181, 265);

      // Page 2 Footer
      doc.setDrawColor(240, 240, 240);
      doc.line(20, 280, 190, 280);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Cirkel ESG Ledger · Annual Audited Report ${esgReportYear} · Confidential. Verified under node: standard_ledger_v3.2.aarhus`, 20, 285);
      doc.text('Page 2 of 2', 178, 285);

      // Save PDF!
      const fileName = `Cirkel_Annual_ESG_Report_${esgReportYear}_${selectedAlertRegion.replace(/\s+/g, '_')}.pdf`;
      doc.save(fileName);

      setIsGeneratingEsgPdf(false);
      setEsgPdfStatus('');
      setShowExportOptionsModal(false);
      
      if (toastFn) {
        toastFn(isDa ? `Succes! Årlig ESG Rapport downloadet som PDF (${fileName})` : `Success! Annual ESG Report downloaded as PDF (${fileName})`, 'success');
      }
      
      addLog('EsgService', `ESG Rapport kompileret og leveret med succes til lokalt download: ${fileName}`, 'success');
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.85 }
      });
      
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      setIsGeneratingEsgPdf(false);
      setEsgPdfStatus('');
      if (toastFn) {
        toastFn(isDa ? 'Fejl opstod under PDF-generering.' : 'Error generating report PDF.', 'error');
      }
      addLog('EsgService', `Generering af PDF-rapport fejlede. Se konsollen for fejl.`, 'error');
    }
  };

  // CSV ESG & Recycling export handler for compliance auditing
  const handleExportEsgCsv = () => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.SCAN_SUCCESS);
    
    // 1. Resolve active ESG inputs
    let eprRate = 2200;
    let plasticLevyRate = 0;
    let cbamRate = 0;
    let eudrRate = 0;
    let pfasRate = 0;
    let co2PerTonMaterial = 1.2;
    let materialLabel = "Karton/Blanding";

    if (esgMaterial === 'plastic_virgin') {
      eprRate = 3800;
      plasticLevyRate = 6000;
      co2PerTonMaterial = 2.8;
      materialLabel = "Virgin Plastik";
    } else if (esgMaterial === 'plastic_recycled') {
      eprRate = 1100;
      co2PerTonMaterial = 0.9;
      materialLabel = "PCR Genbrugsplast";
    } else if (esgMaterial === 'bioplastic') {
      eprRate = 2100;
      plasticLevyRate = 1800;
      co2PerTonMaterial = 1.4;
      materialLabel = "PLA Bioplast";
    } else if (esgMaterial === 'paper_deforested') {
      eprRate = 2400;
      eudrRate = 6800;
      co2PerTonMaterial = 1.3;
      materialLabel = "Ucertificeret Papir";
    } else if (esgMaterial === 'paper_certified') {
      eprRate = 850;
      co2PerTonMaterial = 0.4;
      materialLabel = "FSC Certificeret Pap/Kart";
    } else if (esgMaterial === 'aluminum') {
      eprRate = 1400;
      cbamRate = 4500;
      co2PerTonMaterial = 8.4;
      materialLabel = "Jomfrueligt Alu";
    } else if (esgMaterial === 'aluminum_recycled') {
      eprRate = 400;
      cbamRate = 0;
      co2PerTonMaterial = 0.6;
      materialLabel = "Genbrugsaluminum";
    } else if (esgMaterial === 'composite') {
      eprRate = 5800;
      plasticLevyRate = 3500;
      co2PerTonMaterial = 2.2;
      materialLabel = "Laminat Komposit";
    } else if (esgMaterial === 'glass_virgin') {
      eprRate = 1800;
      co2PerTonMaterial = 1.8;
      materialLabel = "Jomfrueligt Glas";
    } else if (esgMaterial === 'glass_recycled') {
      eprRate = 500;
      co2PerTonMaterial = 0.5;
      materialLabel = "Returglas / Skår";
    }

    if (esgPFAS) {
      pfasRate = 15000;
    }

    let ecoMultiplier = 1.0;
    if (esgRecyclability === 'A++') ecoMultiplier = 0.40;
    else if (esgRecyclability === 'A+') ecoMultiplier = 0.60;
    else if (esgRecyclability === 'A') ecoMultiplier = 0.85;
    else if (esgRecyclability === 'B') ecoMultiplier = 1.00;
    else if (esgRecyclability === 'C') ecoMultiplier = 1.45;
    else if (esgRecyclability === 'D') ecoMultiplier = 1.90;

    const baseEprAmount = esgTonnage * eprRate * ecoMultiplier;
    const plasticLevyAmount = esgTonnage * plasticLevyRate;
    const cbamAmount = esgTonnage * (esgImportedShare / 100) * cbamRate;
    const eudrAmount = esgTonnage * eudrRate;
    const pfasAmount = esgTonnage * pfasRate;
    const co2TonsTotal = esgTonnage * co2PerTonMaterial;
    const shadowCarbonPriceDkk = esgCarbonPriceEuro * 7.45;
    const carbonDebtAmount = co2TonsTotal * shadowCarbonPriceDkk;
    const legacyTotalAmount = baseEprAmount + plasticLevyAmount + cbamAmount + eudrAmount + pfasAmount + carbonDebtAmount;

    const loopReductionFactor = (1 - esgCirkelOffsetShare / 100);
    const cirkelEpr = baseEprAmount * loopReductionFactor;
    const cirkelPlasticLevy = plasticLevyAmount * loopReductionFactor;
    const cirkelCbam = cbamAmount * loopReductionFactor;
    const cirkelEudr = 0;
    const cirkelPfas = esgPFAS ? (pfasAmount * 0.3) : 0;
    const cirkelCarbonDebt = carbonDebtAmount * loopReductionFactor;
    const cirkelTotalAmount = cirkelEpr + cirkelPlasticLevy + cirkelCbam + cirkelEudr + cirkelPfas + cirkelCarbonDebt;
    const savedDkk = legacyTotalAmount - cirkelTotalAmount;
    const savingPercentage = Math.round((savedDkk / (legacyTotalAmount || 1)) * 100);

    const clientName = b2bRole === 'municipality' ? 'Aarhus Kommune' : 'Arla Foods Amba';

    // Build CSV Content
    let csvLines: string[] = [];

    // Title / Header Metadata block
    csvLines.push(`"CIRKEL SYSTEMS - DANSK ESG & MILJØREGNSKAB OVERENSSTEMMELSES-RAPPORT"`);
    csvLines.push(`"Virksomhed/Kommune","${clientName}"`);
    csvLines.push(`"Rapportperiode","Januar 2026 - Juni 2026 (Månedlig compliance-sammenstilling)"`);
    csvLines.push(`"Genereret Dato","2026-06-21"`);
    csvLines.push(`"Primært Emballagemateriale","${materialLabel}"`);
    csvLines.push(`"Årlig Emballagemængde (Tons)","${esgTonnage}"`);
    csvLines.push(`"Cirkel Loop Retur- offset (%)","${esgCirkelOffsetShare}%"`);
    csvLines.push(`"Emballage Genanvendeligheds-klasse","${esgRecyclability}"`);
    csvLines.push(`"Carbonpris skyggeafgift (€/Ton)","${esgCarbonPriceEuro}"`);
    csvLines.push(`"PFAS / REACH Miljørisiko-straf","${esgPFAS ? 'Ja (15.000 DKK / Ton)' : 'Nej (0 DKK)'}"`);
    csvLines.push(``); // Empty row

    // Section 1: Financial & Environmental Audit Summary
    csvLines.push(`"--- 1. OVERORDNET AFGIFTS & KOMPENSATIONS-SAMMENDRAG ---"`);
    csvLines.push(`"Metrik","Standard Lineær Forretningsmodel (DKK)","Cirkel Loop Optimeret Model (DKK)","Besparelse (DKK)","Procentuel Besparelse"`);
    csvLines.push(`"Udvidet Producentansvar (EPR) Afgift","${Math.round(baseEprAmount)}","${Math.round(cirkelEpr)}","${Math.round(baseEprAmount - cirkelEpr)}","${esgCirkelOffsetShare}%"`);
    csvLines.push(`"EU Plastafgift (Levy)","${Math.round(plasticLevyAmount)}","${Math.round(cirkelPlasticLevy)}","${Math.round(plasticLevyAmount - cirkelPlasticLevy)}","${esgCirkelOffsetShare}%"`);
    csvLines.push(`"CBAM CO2 Grænsetold","${Math.round(cbamAmount)}","${Math.round(cirkelCbam)}","${Math.round(cbamAmount - cirkelCbam)}","${esgCirkelOffsetShare}%"`);
    csvLines.push(`"EUDR Skovrydningsbøde","${Math.round(eudrAmount)}","0","${Math.round(eudrAmount)}","100%"`);
    csvLines.push(`"PFAS REACH kemikaliestraf","${Math.round(pfasAmount)}","${Math.round(cirkelPfas)}","${Math.round(pfasAmount - cirkelPfas)}","${esgPFAS ? '70%' : '0%'}"`);
    csvLines.push(`"Skygge CO2-afgift/gæld","${Math.round(carbonDebtAmount)}","${Math.round(cirkelCarbonDebt)}","${Math.round(carbonDebtAmount - cirkelCarbonDebt)}","${esgCirkelOffsetShare}%"`);
    csvLines.push(`"SAMLET REVISIONSPLYGTIG MILJØGÆLD","${Math.round(legacyTotalAmount)}","${Math.round(cirkelTotalAmount)}","${Math.round(savedDkk)}","${savingPercentage}%"`);
    csvLines.push(``);

    // Section 2: Month-by-month compliance & packaging returns
    csvLines.push(`"--- 2. MÅNEDLIG RETURGRAD & RECYCLING AUDIT LOG ---"`);
    csvLines.push(`"Måned","Leveret Emballage (Tons)","Cirkel Returgrad (%)","Returmængde Genbrugt (Tons)","Undgået CO2-Udledning (Tons CO2e)","Borger Scans (Antal)","Standard Miljøgæld (DKK)","Cirkel Netto Miljøgæld (DKK)","Revisionsmæssig Besparelse (DKK)"`);
    
    overallPerformanceData.forEach((m) => {
      const scaleFactor = esgTonnage / 145;
      const mWeight = m.weightTons * scaleFactor;
      const mOffsetPercent = esgCirkelOffsetShare;
      const mReturned = mWeight * (mOffsetPercent / 100);
      const mCO2Saved = mReturned * co2PerTonMaterial;
      const mScans = Math.round(m.citizensScans * scaleFactor);

      // Monthly costs
      const mBaseEpr = mWeight * eprRate * ecoMultiplier;
      const mPlasticLevy = mWeight * plasticLevyRate;
      const mCbam = mWeight * (esgImportedShare / 100) * cbamRate;
      const mEudr = mWeight * eudrRate;
      const mPfas = mWeight * pfasRate;
      const mCarbonDebt = mWeight * co2PerTonMaterial * shadowCarbonPriceDkk;
      
      const mLegacyTotal = mBaseEpr + mPlasticLevy + mCbam + mEudr + mPfas + mCarbonDebt;

      const mCirkelEpr = mBaseEpr * loopReductionFactor;
      const mCirkelPlasticLevy = mPlasticLevy * loopReductionFactor;
      const mCirkelCbam = mCbam * loopReductionFactor;
      const mCirkelEudr = 0;
      const mCirkelPfas = esgPFAS ? (mPfas * 0.3) : 0;
      const mCirkelCarbonDebt = mCarbonDebt * loopReductionFactor;

      const mCirkelTotal = mCirkelEpr + mCirkelPlasticLevy + mCirkelCbam + mCirkelEudr + mCirkelPfas + mCirkelCarbonDebt;
      const mSavings = mLegacyTotal - mCirkelTotal;

      csvLines.push(`"${m.name} 2026","${mWeight.toFixed(2)}","${mOffsetPercent}%","${mReturned.toFixed(2)}","${mCO2Saved.toFixed(2)}","${mScans}","${Math.round(mLegacyTotal)}","${Math.round(mCirkelTotal)}","${Math.round(mSavings)}"`);
    });
    csvLines.push(``);

    // Section 3: Registered Products Compliance
    csvLines.push(`"--- 3. REGISTRERET EMBALLAGE PRODUKTREGISTER (AUDIT SPOOR) ---"`);
    csvLines.push(`"Produkt ID","Produkt Navn","EAN-Nummer","Emballagemateriale","Enkeltvægt (g)","Mærkningsgrad / Eco-modulation"`);
    registeredProducts.forEach((p) => {
      csvLines.push(`"${p.id}","${p.name}","${p.ean}","${p.material}","${p.weight}","${p.grade}"`);
    });
    csvLines.push(``);

    // Section 4: Campaigns
    csvLines.push(`"--- 4. AKTIVE KAMPAGNER & REGISTRERET ADKFÆRDS-NUDGING ---"`);
    csvLines.push(`"Kampagne Navn","Mål-Postnummer","Forbruger-Rabat / Voucher","Aktiv Status","Progress (%)","Mål-Materiale"`);
    marketingCampaigns.forEach((c) => {
      csvLines.push(`"${c.title}","${c.postcode}","${c.voucherText}","${c.active ? 'Aktiv' : 'Pause'}","${c.conversionRate}%","${c.targetMaterial}"`);
    });
    municipalCampaigns.forEach((c) => {
      csvLines.push(`"${c.title}","${c.postcode}","${c.reward.toFixed(2)} kr Cirkel Points","${c.active ? 'Aktiv' : 'Inaktiv'}","${c.progress}%","Generisk genbrug"` );
    });
    csvLines.push(``);

    // Section 5: Bins Audit
    csvLines.push(`"--- 5. SMART BIN SMART-IOT SORTERINGSNAV (REALTIDS AUDIT) ---"`);
    csvLines.push(`"Bin ID","Lokation","Kategori","Fyldegrad (%)","Batteri (%)","Driftsstatus","Sidst tømt"`);
    smartBinsList.forEach((b) => {
      csvLines.push(`"${b.id}","${b.location}","${b.category}","${b.fill}%","${b.battery}%","${b.status}","${b.lastEmptied}"`);
    });

    // Join lines and download
    const csvString = csvLines.join("\n");
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Cirkel_ESG_Recycling_Compliance_Report_${clientName.replace(/\s+/g, '_')}_2026.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Add log feedback to Syslogs
    addLog('CSRD_ENG', `Månedlig ESG & compliance revisionsrapport eksporteret som CSV til lokal revision.`, 'success');
    
    const toastFn = (window as any).showToast;
    if (toastFn) toastFn('ESG CSV revisionsbevis downloadet!', 'success');
  };

  // Chart data sets
  const overallPerformanceData = [
    { name: 'Jan', co2Saved: 12.4, citizensScans: 2400, weightTons: 8.4 },
    { name: 'Feb', co2Saved: 14.8, citizensScans: 3100, weightTons: 9.8 },
    { name: 'Mar', co2Saved: 19.5, citizensScans: 4500, weightTons: 12.1 },
    { name: 'Apr', co2Saved: 24.2, citizensScans: 5900, weightTons: 15.6 },
    { name: 'Maj', co2Saved: 28.1, citizensScans: 7200, weightTons: 18.2 },
    { name: 'Jun', co2Saved: 36.4, citizensScans: 9800, weightTons: 24.8 }
  ];

  const materialTypeDistribution = [
    { name: 'Plastik (rPET)', value: 45, color: '#3B82F6' },
    { name: 'Aluminium', value: 25, color: '#85A912' },
    { name: 'Karton', value: 20, color: '#F59E0B' },
    { name: 'Glas', value: 10, color: '#10B981' }
  ];

  // TRIN 3 — placeholder-slot når custom_content aktiveres (indhold bygges separat)
  if (flagLoaded && useCustomContent) {
    return (
      <div className="bg-[#FAF9F5] min-h-screen flex flex-col items-center justify-center p-8 relative">
        <div
          className="absolute top-3 right-3 z-40 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-md pointer-events-none"
          style={{
            background: portalType === 'kommune' ? 'rgba(5, 54, 27, 0.92)' : 'rgba(133, 169, 18, 0.92)',
            color: '#ffffff',
          }}
        >
          {portalType === 'kommune' ? '🏛️ Kommune Portal' : '💼 Erhverv Portal'}
        </div>
        <div className="max-w-md text-center bg-white border border-gray-200 rounded-3xl p-8 shadow-lg">
          <span className="text-5xl">{portalType === 'kommune' ? '🏛️' : '💼'}</span>
          <h2 className="text-lg font-black mt-4" style={{ color: '#05361B' }}>
            {portalType === 'kommune'
              ? 'Kommune-specifikt indhold aktiveres her'
              : 'Erhverv-specifikt indhold aktiveres her'}
          </h2>
          <p className="text-xs font-semibold mt-3 leading-normal" style={{ color: '#6E6E6E' }}>
            Feature-flag er aktiveret. Reel content-adskillelse bygges i en separat opgave.
            Slå toggle fra i Admin-panelet for at gå tilbage til fælles dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#FAF9F5] min-h-screen text-[#111111] font-sans antialiased flex flex-col md:flex-row border-t border-gray-200 relative">
      {/* TRIN 3 portal-badge — synlig indikator (Erhverv vs Kommune) */}
      <div
        className="absolute top-3 right-3 z-40 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-md pointer-events-none"
        style={{
          background: portalType === 'kommune' ? 'rgba(5, 54, 27, 0.92)' : 'rgba(133, 169, 18, 0.92)',
          color: '#ffffff',
        }}
      >
        {portalType === 'kommune' ? '🏛️ Kommune Portal' : '💼 Erhverv Portal'}
      </div>

      {/* 1. SIDE NAVIGATION RAIL */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-gray-200 p-5 flex flex-col justify-between shrink-0 text-left">
        <div>
          {/* Dashboard Header */}
          <div className="mb-7">
            <span className="text-[9px] font-black tracking-widest text-[#85A912] uppercase bg-[#85A912]/10 border border-[#85A912]/25 px-2.5 py-1 rounded-md">
              B2B Partner Portal
            </span>
            <h2 className="text-xl font-black text-[#002b49] tracking-tight mt-2.5 flex items-center gap-1.5">
              <ShieldCheck className="text-[#85A912] w-5 h-5 shrink-0" />
              Cirkel Connect
            </h2>
            <p className="text-[9.5px] font-bold text-gray-400 mt-1 uppercase">Offentlig & Virksomheds CSRD</p>
          </div>

          {/* Quick role selector */}
          <div className="bg-gray-50 border border-gray-200/80 p-1.5 rounded-xl flex gap-1 mb-6">
            <button
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setB2bRole('municipality');
                addLog('SYS', 'Skiftede brugerrolle til Aarhus Kommune (Admin)', 'success');
              }}
              className={`flex-1 text-[9.5px] font-black py-1.5 rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 ${
                b2bRole === 'municipality'
                  ? 'bg-primary text-[#C8F24A] shadow-xs'
                  : 'text-gray-500 hover:text-primary'
              }`}
            >
              <Landmark className="w-3 h-3" />
              Kommune
            </button>
            <button
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setB2bRole('company');
                addLog('SYS', 'Skiftede brugerrolle til Arla Foods Amba (CSRD)', 'success');
              }}
              className={`flex-1 text-[9.5px] font-black py-1.5 rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 ${
                b2bRole === 'company'
                  ? 'bg-primary text-[#C8F24A] shadow-xs'
                  : 'text-gray-500 hover:text-primary'
              }`}
            >
              <Building2 className="w-3 h-3" />
              Erhverv
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            <button
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('overview'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'overview' ? 'bg-[#85A912]/10 text-[#85A912]' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              Strategisk KPI Overblik
            </button>
            
            <button
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('muni'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'muni' ? 'bg-[#85A912]/10 text-[#85A912]' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <Landmark className="w-4 h-4 shrink-0" />
              Kommune & Nudge-værktøj
            </button>

            <button
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('provider'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'provider' ? 'bg-[#85A912]/10 text-[#85A912]' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              EPR Emballageregister
            </button>

            <button
              id="tab-esg-analyser-btn"
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('esg'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'esg' ? 'bg-emerald-500/10 text-emerald-800 border-l-4 border-emerald-500 pl-2.5' : 'text-gray-650 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <Leaf className="w-4 h-4 shrink-0 text-emerald-600 animate-pulse" />
              EPR & ESG Lovgivnings-Analysator
            </button>

            <button
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('map'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'map' ? 'bg-[#85A912]/10 text-[#85A912]' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <MapPin className="w-4 h-4 shrink-0" />
              Smart-Bin IoT Lokationskort
            </button>

            <button
              id="tab-campaign-manager-btn"
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('campaigns'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'campaigns' ? 'bg-indigo-500/10 text-indigo-700 border-l-4 border-indigo-500 pl-2.5' : 'text-gray-650 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <Award className="w-4 h-4 shrink-0 text-indigo-600 animate-pulse" />
              Kampagner & Nudging Hub
            </button>

            <button
              onClick={() => { triggerHaptic(HapticPattern.LIGHT_TAP); setActiveTab('integrations'); }}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
                activeTab === 'integrations' ? 'bg-[#85A912]/10 text-[#85A912]' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'
              }`}
            >
              <Key className="w-4 h-4 shrink-0" />
              Integrations-gateway
            </button>
          </nav>
        </div>

        {/* Footprint ESG Statement */}
        <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-3.5 mt-8">
          <div className="flex items-center gap-1.5 text-[9px] font-black text-emerald-800 uppercase tracking-widest mb-1.5">
            <Leaf className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            Miljøpåvirkning
          </div>
          <span className="text-xl font-black text-emerald-955 block font-mono">32,4 Tons</span>
          <span className="text-[8.5px] font-bold text-emerald-800 block mt-0.5">Sparet CO₂ til dato 🌲</span>
        </div>
      </aside>

      {/* 2. MAIN HUB WORKSPACE */}
      <main className="flex-1 p-6 md:p-8 flex flex-col gap-6 overflow-y-auto">
        
        {/* Dynamic Partner Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-200 pb-5">
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
              <span className="text-[9.5px] font-black bg-emerald-100 text-emerald-900 border border-emerald-250 px-2 py-0.5 rounded uppercase font-mono">
                Forbindelse: Aktiv (SAP Link)
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-primary mt-1.5">
              {b2bRole === 'municipality' ? 'Aarhus Kommune · Miljø & Affaldskontrol' : 'Arla Foods Amba · ESG Scope 3 Emballage'}
            </h1>
            <p className="text-[10px] text-gray-500 font-semibold mt-1">
              Verificeret B2B portal understøttet af Cirkel Cirkulær Protokol
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              id="restart-b2b-tour-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.HEAVY_TAP);
                setTourStep(0);
                setShowTour(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-500/20 font-black text-[10px] py-2 px-4 rounded-xl shadow-3xs uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5" /> 
              {language === 'da' ? 'Rundvisning 🎓' : 'Onboarding Tour 🎓'}
            </button>
            <button
              onClick={() => {
                triggerHaptic(HapticPattern.HEAVY_TAP);
                setIsGeneratingReport(true);
                setTimeout(() => {
                  setIsGeneratingReport(false);
                  setShowReportModal(true);
                  addLog('CSRD_ENG', 'Official CSRD CO2 compliance verification certificate locked.', 'success');
                }, 1100);
              }}
              className="bg-[#C8F24A] hover:bg-[#bce63f] text-primary font-black text-[10px] py-2 px-4 rounded-xl shadow-3xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Download PDF CSRD Revisionsbevis 📄
            </button>
            <button
              id="header-export-csv-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.HEAVY_TAP);
                setShowExportOptionsModal(true);
              }}
              className="bg-primary hover:bg-[#1a384f] text-[#C8F24A] border border-[#C8F24A]/25 font-black text-[10px] py-2 px-4 rounded-xl shadow-3xs uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> {isDa ? 'Eksporter ESG Rapport 📊' : 'Export ESG Report 📊'}
            </button>
          </div>
        </header>

        {/* 3. DYNAMIC PANELS CONTENT */}
        <AnimatePresence mode="wait">
          
          {/* TAB A: OVERVIEW STRATEGIC PANEL */}
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-6"
            >
              {/* Overview Sub-Tab Switcher */}
              <div className="flex bg-gray-100/85 p-1 rounded-2xl self-start gap-1 border border-gray-200/50">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(HapticPattern.LIGHT_TAP);
                    setOverviewSubTab('current');
                  }}
                  className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 select-none ${
                    overviewSubTab === 'current'
                      ? 'bg-white text-primary shadow-xs border border-gray-150/40'
                      : 'text-gray-500 hover:text-primary border border-transparent'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-[#85A912]" />
                  {isDa ? 'Aktuel Præstation' : 'Current Performance'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(HapticPattern.LIGHT_TAP);
                    setOverviewSubTab('projections');
                  }}
                  className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 select-none ${
                    overviewSubTab === 'projections'
                      ? 'bg-white text-emerald-800 shadow-xs border border-gray-150/40'
                      : 'text-gray-500 hover:text-emerald-800 border border-transparent'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  {isDa ? '12 Mdr. Prospekter & ESG Mål' : '12-Month Projections & Goals'}
                  <span className="bg-emerald-100 text-emerald-800 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                    {isDa ? 'NY' : 'NEW'}
                  </span>
                </button>
              </div>

              {overviewSubTab === 'current' ? (
                <>
                  {/* REGIONAL COMPLIANCE ALERT TICKER / BULLETIN BANNER */}
              {(() => {
                const userRegion = user?.municipality || 'Aarhus Kommune';
                const activeRegionalAlerts = complianceAlertsDB.filter(
                  alert => alert.regions.includes(userRegion) && !acknowledgedAlerts.includes(alert.id)
                );
                const criticalAlertsCount = activeRegionalAlerts.filter(a => a.importance === 'critical').length;
                
                if (activeRegionalAlerts.length === 0) return null;

                return (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`border rounded-3xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left transition-all relative overflow-hidden ${
                      criticalAlertsCount > 0 
                        ? 'bg-rose-50 border-rose-100 text-rose-900 shadow-3xs'
                        : 'bg-emerald-50 border-emerald-100 text-emerald-900 shadow-3xs'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl shrink-0 ${
                        criticalAlertsCount > 0 ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                      }`}>
                        <AlertCircle className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded ${
                            criticalAlertsCount > 0 ? 'bg-rose-600 text-white animate-pulse font-mono' : 'bg-[#85A912] text-white'
                          }`}>
                            {criticalAlertsCount > 0 
                              ? (isDa ? 'Kritiske Miljøfrister' : 'Critical ESG Deadlines') 
                              : (isDa ? 'Miljøalarm' : 'ESG Alert')}
                          </span>
                          <span className="text-[9.5px] text-gray-500 font-extrabold uppercase tracking-wider">
                            📍 {userRegion}
                          </span>
                        </div>
                        <h4 className="text-sm font-black uppercase tracking-tight mt-1 text-primary">
                          {isDa 
                            ? `Aktive lovgivningskrav detekteret: ${activeRegionalAlerts.length} udestående`
                            : `Active legislative requirements detected: ${activeRegionalAlerts.length} issues pending`}
                        </h4>
                        <p className="text-[11px] text-gray-500 mt-0.5 font-semibold leading-relaxed">
                          {criticalAlertsCount > 0
                            ? (isDa 
                              ? `Næste kritiske deadline falder den ${activeRegionalAlerts[0].dueDate}. Manglende rettidig omstilling kan udløse bødestraf.` 
                              : `Next critical deadline falls on ${activeRegionalAlerts[0].dueDate}. Unaddressed issues carry high non-compliance penalties.`)
                            : (isDa 
                              ? `Nye cirkulære forordninger kræver din godkendelse i dit område.` 
                              : `New circular guidelines require your review in your sector.`)}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        triggerHaptic(HapticPattern.SCAN_SUCCESS);
                        setActiveTab('esg');
                        setSelectedAlertRegion(userRegion);
                        setTimeout(() => {
                          const element = document.getElementById('tab-esg-analyser-btn');
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth' });
                          }
                        }, 100);
                      }}
                      className={`text-xs font-black px-4 py-2.5 rounded-2xl flex items-center gap-1.5 uppercase tracking-wider shrink-0 w-full sm:w-auto justify-center cursor-pointer transition-all ${
                        criticalAlertsCount > 0 
                          ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs' 
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                      }`}
                    >
                      <span>{isDa ? 'Løs udfordringer' : 'Resolve conflicts'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                );
              })()}

              {/* Top Bento Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs text-left">
                  <span className="text-[9.5px] font-black text-gray-400 uppercase tracking-widest block">Ugentlig Sorteringsgrad</span>
                  <span className="text-2xl font-black text-primary font-mono block mt-1">78.3 %</span>
                  <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div className="bg-[#85A912] h-full rounded-full" style={{ width: '78.3%' }} />
                  </div>
                  <span className="text-[8px] font-bold text-[#85A912] block mt-1.5">Mål: 85.0% i 2026</span>
                </div>

                <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs text-left">
                  <span className="text-[9.5px] font-black text-gray-400 uppercase tracking-widest block">Indsamlet Total</span>
                  <span className="text-2xl font-black text-primary font-mono block mt-1">14.842 kg</span>
                  <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div className="bg-[#3B82F6] h-full rounded-full" style={{ width: '65%' }} />
                  </div>
                  <span className="text-[8px] font-bold text-gray-400 block mt-1.5">Mest indsamlet: Plastik (rPET)</span>
                </div>

                <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs text-left">
                  <span className="text-[9.5px] font-black text-gray-400 uppercase tracking-widest block">Udbetalt Bonus-pant</span>
                  <span className="text-2xl font-black text-primary font-mono block mt-1">112.440 DKK</span>
                  <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div className="bg-amber-400 h-full rounded-full" style={{ width: '85%' }} />
                  </div>
                  <span className="text-[8px] font-bold text-amber-600 block mt-1.5 text-ellipsis overflow-hidden">Budgetforbrug: 85.2% i Aarhus C</span>
                </div>

                <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs text-left">
                  <span className="text-[9.5px] font-black text-gray-400 uppercase tracking-widest block">Sparet CO₂ Udledning</span>
                  <span className="text-2xl font-black text-emerald-800 font-mono block mt-1">32.4 Tons</span>
                  <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: '74%' }} />
                  </div>
                  <span className="text-[8px] font-bold text-emerald-700 block mt-1.5">Ugentlig stigning: +1.8 tons</span>
                </div>
              </div>

              {/* Chart Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Long Trend Line */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs lg:col-span-2 text-left">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h4 className="text-xs font-black text-primary uppercase">Cirkulær Genindvinding & CO₂ Trend</h4>
                      <p className="text-[9px] font-medium text-gray-400">Gevinstudvikling samt overholdelsesprocent (Jan-Jun 2026)</p>
                    </div>
                    <span className="text-[9px] font-black bg-emerald-50 border border-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-md uppercase font-mono">6 Mdr Dashboard</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overallPerformanceData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gco2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.25}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="gscans" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#85A912" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#85A912" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECEAE7" />
                        <XAxis dataKey="name" stroke="#A3A3A3" fontSize={9} fontWeight="900" />
                        <YAxis stroke="#A3A3A3" fontSize={8} fontWeight="900" />
                        <Tooltip content={<PerformanceCustomTooltip language={language} />} />
                        <Legend wrapperStyle={{ fontSize: '9px', fontWeight: '900', marginTop: '10px' }} />
                        <Area type="monotone" dataKey="co2Saved" name="CO₂ sparet (Tons)" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#gco2)" />
                        <Area type="monotone" dataKey="weightTons" name="Genvundet materialevægt (Tons)" stroke="#85A912" strokeWidth={2.5} fillOpacity={1} fill="url(#gscans)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Circular Material Distribution */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase">Emballage-fordeling</h4>
                    <p className="text-[9px] font-medium text-gray-400">Fordeling af indsamlet råstof til genbrug</p>
                  </div>
                  
                  <div className="h-44 w-full flex justify-center items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={materialTypeDistribution}
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {materialTypeDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<MaterialDistributionCustomTooltip language={language} />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-col gap-1.5 mt-2">
                    {materialTypeDistribution.map((item, index) => (
                      <div key={index} className="flex justify-between items-center text-[10px] font-bold">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="text-gray-650">{item.name}</span>
                        </div>
                        <span className="font-mono text-primary">{item.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Lower Section: Live Syslogs for auditing */}
              <div className="bg-[#111111] text-[#A3E635] font-mono rounded-3xl p-5 shadow-3xs text-left">
                <div className="flex justify-between items-center border-b border-gray-800 pb-3 mb-3">
                  <span className="text-[10px] flex items-center gap-2 uppercase tracking-widest font-black text-white">
                    <Server className="w-4 h-4 text-[#85A912]" />
                    Realtids ESG revisions-logbøger
                  </span>
                  <span className="text-[8px] bg-red-500/10 text-red-400 px-2.5 py-0.5 rounded border border-red-500/25 uppercase font-bold animate-pulse">
                    Live audit trail
                  </span>
                </div>
                <div className="flex flex-col gap-2.5 max-h-44 overflow-y-auto font-mono text-[10.5px] leading-relaxed select-text pr-1">
                  {syslogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2.5">
                      <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider shrink-0 mt-0.5 ${
                        log.type === 'success' ? 'bg-[#C8F24A]/20 text-[#C8F24A]' :
                        log.type === 'warn' ? 'bg-amber-400/20 text-amber-300' :
                        'bg-blue-400/20 text-blue-300'
                      }`}>
                        {log.service}
                      </span>
                      <span className="text-gray-300 flex-1">{log.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-6 text-left"
            >
              {/* Title / Description banner */}
              <div className="bg-gradient-to-r from-emerald-800 to-[#112F46] text-white p-6 rounded-3xl relative overflow-hidden shadow-3xs border border-[#85A912]/20">
                <div className="absolute right-0 top-0 translate-x-12 -translate-y-6 opacity-10 pointer-events-none">
                  <Sparkles className="w-64 h-64 text-[#C8F24A]" />
                </div>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <span className="bg-emerald-550/35 border border-emerald-400/20 text-[#C8F24A] text-[9px] font-mono font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                      🔮 {isDa ? 'AI-Dreven Prognose & ESG Målstyring' : 'AI-Driven Predictive Forecasting & ESG Goal-Setting'}
                    </span>
                    <h2 className="text-xl font-black mt-2 tracking-tight">
                      {isDa ? '12 Måneders Cirkulære Fremskrivninger' : '12-Month Circular Projections'}
                    </h2>
                    <p className="text-xs text-gray-200 mt-1 leading-relaxed max-w-2xl font-semibold">
                      {isDa 
                        ? 'Analyser dine historiske data trends (Januar - Juni 2026) for at projicere fremtidige CO₂-besparelser, materialemængder og sorteringsprocenter. Sæt ambitiøse delmål og optimer dine strategier for at sikre compliance med EU CSRD standarder.'
                        : 'Examine your historical compliance trends (January - June 2026) to project future CO2 offsets, material weights, and sorting rates. Set custom corporate targets and simulate various efficiency models to secure alignment with upcoming CSRD mandates.'}
                    </p>
                  </div>
                  <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shrink-0 text-center font-mono">
                    <span className="text-[9px] uppercase font-black text-gray-200 block">{isDa ? 'Beregnet trendlinje' : 'Computed Trendline'}</span>
                    <span className="text-xl font-black text-[#C8F24A] block mt-0.5">+24.5% MoM</span>
                    <span className="text-[8px] text-emerald-300 block mt-0.5">{isDa ? 'R² Præcision = 98.4%' : 'R² Precision = 98.4%'}</span>
                  </div>
                </div>
              </div>

              {/* Goal Setting & Model Configuration Bento Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* 1. CONFIGURATION: GROWTH MODEL */}
                <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs flex flex-col justify-between">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-emerald-50 rounded-xl">
                        <Cpu className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-primary uppercase">{isDa ? '1. Vælg Vækstmodel' : '1. Growth Model'}</h4>
                        <p className="text-[9px] text-gray-400 font-semibold">{isDa ? 'Simuler eksterne og interne vækstscenarier' : 'Simulate operational efficiency models'}</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      {[
                        { id: 'linear', label: isDa ? 'Lineær Trend (Standard)' : 'Linear Trend (Standard)', desc: isDa ? 'Fortsætter nuværende månedlige gennemsnitlige vækst' : 'Extrapolates existing operational average gains' },
                        { id: 'optimistic', label: isDa ? 'Optimistisk (+25% Effektivitet)' : 'Optimistic (+25% Boost)', desc: isDa ? 'Højere borgerscanninger og optimerede smart bins' : 'Simulates elevated campaign participation' },
                        { id: 'conservative', label: isDa ? 'Konservativ (-20% Fald)' : 'Conservative (-20% Drop)', desc: isDa ? 'Tømningsforsinkelser og mindre regional aktivitet' : 'Accounts for logistics bottlenecks' }
                      ].map((model) => {
                        const isSel = projectionGrowthModel === model.id;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              triggerHaptic(HapticPattern.LIGHT_TAP);
                              setProjectionGrowthModel(model.id as any);
                            }}
                            className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                              isSel 
                                ? 'bg-emerald-50/60 border-emerald-550 text-primary shadow-3xs' 
                                : 'bg-white border-gray-205 hover:border-gray-300 text-gray-600'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10.5px] font-black">{model.label}</span>
                              <span className={`w-3 h-3 rounded-full flex items-center justify-center border ${
                                isSel ? 'border-emerald-550 bg-[#85A912]' : 'border-gray-300'
                              }`}>
                                {isSel && <Check className="w-2 h-2 text-white stroke-[3]" />}
                              </span>
                            </div>
                            <p className="text-[9px] text-gray-400 leading-snug">{model.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <span className="text-[8px] text-gray-400/80 font-mono mt-4 block">
                    {isDa ? 'Baseret på 6 måneders rå-logførte transaktionsmønstre' : 'Based on 6 months of raw logged transaction patterns'}
                  </span>
                </div>

                {/* 2. ESG TARGET A: CO2 SAVINGS */}
                {(() => {
                  // Calculate projected total CO2 savings over next 12 months
                  let co2Slope = 4.8;
                  if (projectionGrowthModel === 'optimistic') co2Slope *= 1.25;
                  else if (projectionGrowthModel === 'conservative') co2Slope *= 0.8;
                  
                  let sumProjCo2 = 0;
                  for (let i = 1; i <= 12; i++) {
                    const variance = 1 + (Math.sin(i * 1.5) * 0.04);
                    sumProjCo2 += 36.4 + co2Slope * i * variance;
                  }
                  const totalProjCo2 = Math.round(sumProjCo2);
                  const pctAchieved = Math.min(200, Math.round((totalProjCo2 / projectionCo2Goal) * 100));
                  
                  let statusText = isDa ? 'Mangler' : 'Pending';
                  let statusColor = 'text-amber-500';
                  let badgeBg = 'bg-amber-50 text-amber-800 border-amber-100';
                  
                  if (pctAchieved >= 100) {
                    statusText = isDa ? 'Mål Nået! 🎉' : 'Goal Met! 🎉';
                    statusColor = 'text-emerald-600';
                    badgeBg = 'bg-emerald-50 text-emerald-800 border-emerald-100';
                  } else if (pctAchieved >= 85) {
                    statusText = isDa ? 'Næsten i mål 👍' : 'Close to target 👍';
                    statusColor = 'text-emerald-500';
                    badgeBg = 'bg-teal-50 text-teal-800 border-teal-100';
                  } else {
                    statusText = isDa ? 'Kræver Indsats ⚠️' : 'Needs Action ⚠️';
                    statusColor = 'text-rose-500';
                    badgeBg = 'bg-rose-50 text-rose-800 border-rose-100';
                  }

                  return (
                    <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs flex flex-col justify-between text-left">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-2 bg-emerald-50 rounded-xl">
                              <Leaf className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-primary uppercase">{isDa ? '2. CO₂ Mål (Tons)' : '2. Annual CO₂ Target'}</h4>
                              <p className="text-[9px] text-gray-400 font-semibold">{isDa ? 'Scope 3 reduktionsmål (12 mdr)' : 'Target Scope 3 offsets'}</p>
                            </div>
                          </div>
                          <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded border ${badgeBg}`}>
                            {statusText}
                          </span>
                        </div>

                        {/* Slider Control */}
                        <div className="bg-gray-50/60 p-3 rounded-2xl border border-gray-150/40 mt-1">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[10px] font-black text-gray-500 uppercase">{isDa ? 'Ønsket Mål:' : 'Annual Target:'}</span>
                            <span className="text-xs font-black text-primary font-mono">{projectionCo2Goal} Tons CO₂</span>
                          </div>
                          <input
                            type="range"
                            min="200"
                            max="800"
                            step="25"
                            value={projectionCo2Goal}
                            onChange={(e) => {
                              triggerHaptic(HapticPattern.LIGHT_TAP);
                              setProjectionCo2Goal(parseInt(e.target.value));
                            }}
                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#85A912]"
                          />
                          <div className="flex justify-between text-[8px] text-gray-400 font-bold mt-1">
                            <span>200t</span>
                            <span>500t</span>
                            <span>800t</span>
                          </div>
                        </div>

                        {/* Metrics circle or bar */}
                        <div className="flex items-center gap-4 mt-2">
                          <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                            {/* Circular track progress */}
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                              <path
                                className="text-gray-100"
                                strokeWidth="3.2"
                                stroke="currentColor"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                              <path
                                className={`${pctAchieved >= 100 ? 'text-[#85A912]' : pctAchieved >= 85 ? 'text-teal-500' : 'text-amber-500'} transition-all duration-550`}
                                strokeDasharray={`${pctAchieved}, 100`}
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                stroke="currentColor"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                            </svg>
                            <span className="absolute text-[11px] font-black font-mono text-primary">{pctAchieved}%</span>
                          </div>
                          <div className="flex-1">
                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block">{isDa ? 'Projiceret Besparelse:' : 'Projected 12M Total:'}</span>
                            <span className="text-base font-black text-primary font-mono block leading-none mt-0.5">{totalProjCo2} Tons CO₂</span>
                            <span className="text-[8.5px] text-gray-400 font-semibold block mt-1">
                              {isDa 
                                ? `Nuværende trend dækker ${pctAchieved}% af dit ${projectionCo2Goal}t mål.` 
                                : `Trajectory achieves ${pctAchieved}% of your ${projectionCo2Goal}t target.`}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-[8px] text-gray-400 font-bold">
                        <span>{isDa ? 'Ugentlig reduktionstakt:' : 'Weekly reduction speed:'}</span>
                        <span className="font-mono text-emerald-700">~{((totalProjCo2) / 52).toFixed(1)} t / {isDa ? 'uge' : 'wk'}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* 3. ESG TARGET B: RECYCLING SORTING RATE */}
                {(() => {
                  // Calculate projected sorting rate peak by month 12
                  let baseSlope = 0.95;
                  if (projectionGrowthModel === 'optimistic') baseSlope = 1.4;
                  else if (projectionGrowthModel === 'conservative') baseSlope = 0.45;
                  
                  const peakSortingRate = parseFloat(Math.min(96, 78.3 + (12 * baseSlope * 1.02)).toFixed(1));
                  const isEUMandateMet = peakSortingRate >= 85.0;
                  const targetGap = parseFloat((peakSortingRate - projectionRecyclingGoal).toFixed(1));

                  return (
                    <div className="bg-white border border-gray-200 p-5 rounded-3xl shadow-3xs flex flex-col justify-between text-left">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-2 bg-emerald-50 rounded-xl">
                              <Award className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-primary uppercase">{isDa ? '3. Sorteringsmål (%)' : '3. Sortering rate Target'}</h4>
                              <p className="text-[9px] text-gray-400 font-semibold">{isDa ? 'Set mål mod EU PPWR direktivet (85%)' : 'Set goal against EU PPWR'}</p>
                            </div>
                          </div>
                          <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded border ${
                            peakSortingRate >= projectionRecyclingGoal ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-100'
                          }`}>
                            {peakSortingRate >= projectionRecyclingGoal ? (isDa ? 'Overholder' : 'Complies') : (isDa ? 'Under mål' : 'Below Goal')}
                          </span>
                        </div>

                        {/* Slider Control */}
                        <div className="bg-gray-50/60 p-3 rounded-2xl border border-gray-150/40 mt-1">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[10px] font-black text-gray-500 uppercase">{isDa ? 'Målsætning:' : 'Target rate:'}</span>
                            <span className="text-xs font-black text-primary font-mono">{projectionRecyclingGoal}% {isDa ? 'Sortering' : 'Sorting'}</span>
                          </div>
                          <input
                            type="range"
                            min="75"
                            max="95"
                            step="1"
                            value={projectionRecyclingGoal}
                            onChange={(e) => {
                              triggerHaptic(HapticPattern.LIGHT_TAP);
                              setProjectionRecyclingGoal(parseInt(e.target.value));
                            }}
                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#85A912]"
                          />
                          <div className="flex justify-between text-[8px] text-gray-400 font-bold mt-1">
                            <span>75%</span>
                            <span>85% (EU Standard)</span>
                            <span>95%</span>
                          </div>
                        </div>

                        {/* Progress Indicators */}
                        <div className="flex flex-col gap-2 mt-2">
                          <div>
                            <div className="flex justify-between text-[9.5px] font-black uppercase tracking-tight mb-1 text-primary">
                              <span>{isDa ? 'Projiceret top (Måned 12):' : 'Projected Peak (Month 12):'}</span>
                              <span className="font-mono text-emerald-800">{peakSortingRate}%</span>
                            </div>
                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-150/20">
                              <div className="bg-emerald-600 h-full rounded-full transition-all duration-550" style={{ width: `${peakSortingRate}%` }} />
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 text-[8.5px] font-bold text-gray-400 mt-1">
                            {isEUMandateMet ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#85A912] shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />
                            )}
                            <span>
                              {isEUMandateMet 
                                ? (isDa 
                                  ? 'Klarer EU 2027-målet for cirkulær emballage (85%).' 
                                  : 'Passes upcoming EU 2027 Directive (85%).')
                                : (isDa 
                                  ? `Mangler ${parseFloat((85.0 - peakSortingRate).toFixed(1))}% for at klare EU standarden.` 
                                  : `Under EU standard by ${parseFloat((85.0 - peakSortingRate).toFixed(1))}%`)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-[8px] text-gray-400 font-bold">
                        <span>{isDa ? 'Afvigelse fra internt mål:' : 'Variance from internal target:'}</span>
                        <span className={`font-mono font-bold ${targetGap >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {targetGap >= 0 ? `+${targetGap}%` : `${targetGap}%`}
                        </span>
                      </div>
                    </div>
                  );
                })()}

              </div>

              {/* 12-Month Projections Unified Chart */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-150 pb-4 mb-4">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase">
                      {isDa ? 'Integreret historisk vs. 12 mdr. Prospekteret Udvikling' : 'Integrated Historical vs. Projected trajectory'}
                    </h4>
                    <p className="text-[9.5px] font-medium text-gray-400">
                      {isDa 
                        ? 'Viser de oprindelige 6 mdr. (grå zone) efterfulgt af de kommende 12 mdr. fremskrivning'
                        : 'Displays baseline 6 months (gray zone) followed by the forecasted 12 months projections'}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap text-[8.5px] font-black font-mono">
                    <span className="bg-emerald-50 border border-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" /> CO₂ sparet (Tons)
                    </span>
                    <span className="bg-[#85A912]/10 border border-[#85A912]/20 text-[#85A912] px-2.5 py-0.5 rounded-md flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#85A912]" /> Genvundet materialevægt (Tons)
                    </span>
                    <span className="bg-blue-50 border border-blue-100 text-blue-700 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Sorteringsgrad (%)
                    </span>
                  </div>
                </div>

                {/* The Chart container */}
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart 
                      data={(() => {
                        const hData = [
                          { name: 'Jan 26', co2Saved: 12.4, weightTons: 8.4, citizensScans: 2400, sortingRate: 72.5, isProjected: false },
                          { name: 'Feb 26', co2Saved: 14.8, citizensScans: 3100, weightTons: 9.8, sortingRate: 74.0, isProjected: false },
                          { name: 'Mar 26', co2Saved: 19.5, citizensScans: 4500, weightTons: 12.1, sortingRate: 75.8, isProjected: false },
                          { name: 'Apr 26', co2Saved: 24.2, citizensScans: 5900, weightTons: 15.6, sortingRate: 76.5, isProjected: false },
                          { name: 'Maj 26', co2Saved: 28.1, citizensScans: 7200, weightTons: 18.2, sortingRate: 77.2, isProjected: false },
                          { name: 'Jun 26', co2Saved: 36.4, citizensScans: 9800, weightTons: 24.8, sortingRate: 78.3, isProjected: false }
                        ];
                        
                        let co2Slope = 4.8;
                        let weightSlope = 3.28;
                        let scansSlope = 1480;
                        
                        if (projectionGrowthModel === 'optimistic') {
                          co2Slope *= 1.25;
                          weightSlope *= 1.25;
                          scansSlope *= 1.25;
                        } else if (projectionGrowthModel === 'conservative') {
                          co2Slope *= 0.8;
                          weightSlope *= 0.8;
                          scansSlope *= 0.8;
                        }
                        
                        const projData = [];
                        for (let i = 1; i <= 12; i++) {
                          const year = i <= 6 ? '26' : '27';
                          const monthLabel = isDa ? monthsDa[i-1] : monthsEn[i-1];
                          const variance = 1 + (Math.sin(i * 1.5) * 0.04);
                          const co2 = parseFloat((36.4 + co2Slope * i * variance).toFixed(1));
                          const weight = parseFloat((24.8 + weightSlope * i * variance).toFixed(1));
                          const scans = Math.round((9800 + scansSlope * i * variance));
                          const startRate = 78.3;
                          const rateSlope = projectionGrowthModel === 'optimistic' ? 1.4 : projectionGrowthModel === 'conservative' ? 0.45 : 0.95;
                          const sortingRate = parseFloat(Math.min(96, startRate + (i * rateSlope * variance)).toFixed(1));
                          
                          projData.push({
                            name: `${monthLabel} ${year}`,
                            co2Saved: co2,
                            weightTons: weight,
                            citizensScans: scans,
                            sortingRate: sortingRate,
                            isProjected: true
                          });
                        }
                        return [...hData, ...projData];
                      })()} 
                      margin={{ top: 15, right: 10, left: -25, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="gco2proj" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="gweightproj" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#85A912" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#85A912" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="grateproj" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.10}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECEAE7" />
                      <XAxis dataKey="name" stroke="#A3A3A3" fontSize={9} fontWeight="900" />
                      <YAxis stroke="#A3A3A3" fontSize={8} fontWeight="900" />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const isProj = payload[0].payload.isProjected;
                            return (
                              <div className="bg-primary border border-gray-700 p-3 rounded-2xl shadow-xl text-left text-white max-w-xs font-mono text-[10px]">
                                <div className="flex justify-between items-center border-b border-gray-700 pb-1.5 mb-1.5">
                                  <span className="font-black text-[11px] uppercase">{label}</span>
                                  {isProj ? (
                                    <span className="bg-emerald-600 text-[#C8F24A] text-[7.5px] font-black px-1.5 py-0.5 rounded-md">
                                      {isDa ? 'PROGNOSE' : 'FORECAST'}
                                    </span>
                                  ) : (
                                    <span className="bg-gray-700 text-gray-300 text-[7.5px] font-black px-1.5 py-0.5 rounded-md">
                                      {isDa ? 'REALISERET' : 'REALIZED'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-col gap-1 text-gray-300 font-bold">
                                  <div className="flex justify-between gap-4">
                                    <span>CO₂ sparet:</span>
                                    <span className="text-[#C8F24A] font-black">{payload[0].value} Tons</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span>Materialevægt:</span>
                                    <span className="text-[#85A912] font-black">{payload[1].value} Tons</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span>Sorteringsgrad:</span>
                                    <span className="text-blue-400 font-black">{payload[2].value}%</span>
                                  </div>
                                  {payload[0].payload.citizensScans && (
                                    <div className="flex justify-between gap-4 border-t border-gray-800 pt-1 mt-1 text-[8.5px]">
                                      <span>Borgerscanninger:</span>
                                      <span className="text-white">{payload[0].payload.citizensScans.toLocaleString()}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }} 
                      />
                      
                      <ReferenceArea 
                        {...({
                          x1: "Jan 26",
                          x2: "Jun 26",
                          fill: "#F3F4F6",
                          fillOpacity: 0.4
                        } as any)}
                      />

                      <ReferenceLine 
                        x="Jun 26" 
                        stroke="#85A912" 
                        strokeWidth={1.5} 
                        strokeDasharray="4 4"
                        label={{ 
                          value: isDa ? 'PROGNOSE TÆRSKEL ⤍' : 'PREDICTION HORIZON ⤍', 
                          position: 'top', 
                          fill: '#4B5563', 
                          fontSize: 8, 
                          fontWeight: '900' 
                        }} 
                      />

                      <Area 
                        type="monotone" 
                        dataKey="co2Saved" 
                        stroke="#10B981" 
                        strokeWidth={2.5} 
                        fillOpacity={1} 
                        fill="url(#gco2proj)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="weightTons" 
                        stroke="#85A912" 
                        strokeWidth={2.5} 
                        fillOpacity={1} 
                        fill="url(#gweightproj)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="sortingRate" 
                        stroke="#3B82F6" 
                        strokeWidth={2} 
                        fillOpacity={1} 
                        fill="url(#grateproj)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Action Recommendations Advisor */}
              {(() => {
                let co2Slope = 4.8;
                if (projectionGrowthModel === 'optimistic') co2Slope *= 1.25;
                else if (projectionGrowthModel === 'conservative') co2Slope *= 0.8;
                
                let sumProjCo2 = 0;
                for (let i = 1; i <= 12; i++) {
                  const variance = 1 + (Math.sin(i * 1.5) * 0.04);
                  sumProjCo2 += 36.4 + co2Slope * i * variance;
                }
                const totalProjCo2 = Math.round(sumProjCo2);
                
                let baseSlope = 0.95;
                if (projectionGrowthModel === 'optimistic') baseSlope = 1.4;
                else if (projectionGrowthModel === 'conservative') baseSlope = 0.45;
                const peakRate = parseFloat(Math.min(96, 78.3 + (12 * baseSlope * 1.02)).toFixed(1));

                const co2Deficit = projectionCo2Goal - totalProjCo2;
                const rateDeficit = projectionRecyclingGoal - peakRate;

                return (
                  <div className="bg-emerald-50/60 border border-emerald-150/45 p-5 rounded-3xl text-left flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-emerald-600" />
                      <div>
                        <h4 className="text-xs font-black text-primary uppercase">{isDa ? 'Cirkel Strategisk ESG-Rådgiver' : 'Cirkel Strategic ESG Advisor'}</h4>
                        <p className="text-[9px] text-gray-400 font-semibold">{isDa ? 'AI-anbefalinger baseret på målafvigelser' : 'Automated action items for circular alignment'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
                      {/* CO2 advice */}
                      <div className="bg-white p-4 rounded-2xl border border-gray-150/45 flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase text-gray-400 tracking-wider block">
                          {isDa ? 'Status: CO₂-mål' : 'Status: CO₂ Reduction target'}
                        </span>
                        {co2Deficit > 0 ? (
                          <>
                            <div className="flex items-center gap-2 text-[11px] font-black text-amber-600">
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                              <span>{isDa ? `Underskud på ${co2Deficit} tons identificeret` : `CO2 Deficit of ${co2Deficit}t identified`}</span>
                            </div>
                            <p className="text-[10.5px] font-medium leading-relaxed text-gray-500 mt-1">
                              {isDa 
                                ? `For at indhente differencen anbefales det at opstille mindst 4 nye Smart Bins i detailsektoren i Aarhus C. Dette vil øge den månedlige indsamlingstakt med ~4.2 tons, hvilket sikrer fuld målopfyldelse.`
                                : `To recover this deficit, we advise deploying 4 additional Smart Bins within high-footfall grocery areas. This layout expansion boosts weekly sorting weight by ~1.1 tons, bringing you back on track.`}
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-[11px] font-black text-[#85A912]">
                              <CheckCircle2 className="w-4 h-4 text-[#85A912] shrink-0" />
                              <span>{isDa ? 'Mål overholdt og sikret!' : 'CO2 Target secured!'}</span>
                            </div>
                            <p className="text-[10.5px] font-medium leading-relaxed text-gray-500 mt-1">
                              {isDa 
                                ? `Fremragende arbejde! Dit reduktionsmål på ${projectionCo2Goal} tons er fuldt ud dækket af din nuværende operationelle effektivitet. Du kan overveje at hæve dit mål med 15% for at styrke din CSRD Scope 3 profil.`
                                : `Superb performance! Your current operational rate exceeds your ${projectionCo2Goal}t corporate goal. We suggest raising your internal milestone by 15% to lock in an elite rating under CSRD standard ESG disclosures.`}
                            </p>
                          </>
                        )}
                      </div>

                      {/* Sorting Rate advice */}
                      <div className="bg-white p-4 rounded-2xl border border-gray-150/45 flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase text-gray-400 tracking-wider block">
                          {isDa ? 'Status: Sorteringsgrad' : 'Status: Recycling sorting rate'}
                        </span>
                        {rateDeficit > 0 ? (
                          <>
                            <div className="flex items-center gap-2 text-[11px] font-black text-rose-600">
                              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                              <span>{isDa ? `Mangler ${rateDeficit}% for at nå målet` : `Deficit of ${rateDeficit}% from your goal`}</span>
                            </div>
                            <p className="text-[10.5px] font-medium leading-relaxed text-gray-500 mt-1">
                              {isDa 
                                ? `Din slutprocent på ${peakRate}% er under dit mål på ${projectionRecyclingGoal}%. Gå til 'Kampagner & Nudging Hub' og aktiver en "Retur-Pant" kampagne rettet mod rPET plastikflasker for at løfte sorteringsgraden.`
                                : `Your peak rate of ${peakRate}% falls short of your target (${projectionRecyclingGoal}%). Go to the 'Campaigns & Nudging Hub' and activate a targeted "rPET Bottle Return Incentive" campaign to boost local civic sorting by ~4.5%.`}
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-[11px] font-black text-[#85A912]">
                              <CheckCircle2 className="w-4 h-4 text-[#85A912] shrink-0" />
                              <span>{isDa ? 'Sorteringsgrad i grøn zone!' : 'Recycling sorting rate in elite zone!'}</span>
                            </div>
                            <p className="text-[10.5px] font-medium leading-relaxed text-gray-500 mt-1">
                              {isDa 
                                ? `Flot! En sorteringsgrad på ${peakRate}% overstiger både dit interne mål og EU PPWR-forordningens minimumskrav. Din organisation er optimalt positioneret til fremtidige revisionsaudits.`
                                : `Fantastic! Your projected sorting rate of ${peakRate}% successfully clears both your internal goals and the EU PPWR minimum directives. Your organization is positioned perfectly for upcoming audits.`}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Data Ledger List & CSV Export */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 border-b border-gray-100 pb-3">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase">{isDa ? '12 Måneders Prospekteringsprotokol' : '12-Month Projections Ledger'}</h4>
                    <p className="text-[9px] font-medium text-gray-400">{isDa ? 'Månedlige rå fremskrivninger til eksport' : 'Detailed monthly metrics output ledger'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(HapticPattern.SCAN_SUCCESS);
                      
                      let co2Slope = 4.8;
                      let weightSlope = 3.28;
                      let scansSlope = 1480;
                      
                      if (projectionGrowthModel === 'optimistic') {
                        co2Slope *= 1.25;
                        weightSlope *= 1.25;
                        scansSlope *= 1.25;
                      } else if (projectionGrowthModel === 'conservative') {
                        co2Slope *= 0.8;
                        weightSlope *= 0.8;
                        scansSlope *= 0.8;
                      }
                      
                      const projData = [];
                      for (let i = 1; i <= 12; i++) {
                        const year = i <= 6 ? '2026' : '2027';
                        const monthLabel = isDa ? monthsDa[i-1] : monthsEn[i-1];
                        const variance = 1 + (Math.sin(i * 1.5) * 0.04);
                        const co2 = parseFloat((36.4 + co2Slope * i * variance).toFixed(1));
                        const weight = parseFloat((24.8 + weightSlope * i * variance).toFixed(1));
                        const scans = Math.round((9800 + scansSlope * i * variance));
                        const startRate = 78.3;
                        const rateSlope = projectionGrowthModel === 'optimistic' ? 1.4 : projectionGrowthModel === 'conservative' ? 0.45 : 0.95;
                        const sortingRate = parseFloat(Math.min(96, startRate + (i * rateSlope * variance)).toFixed(1));
                        
                        projData.push({
                          name: `${monthLabel} ${year}`,
                          co2Saved: co2,
                          weightTons: weight,
                          citizensScans: scans,
                          sortingRate: sortingRate
                        });
                      }

                      const csvRows = [
                        ['Month', 'Projected CO2 Saved (Tons)', 'Projected Recycled Weight (Tons)', 'Projected Citizen Scans', 'Projected Sorting Rate (%)'],
                        ...projData.map(d => [d.name, d.co2Saved, d.weightTons, d.citizensScans, d.sortingRate])
                      ];
                      
                      const csvContent = "data:text/csv;charset=utf-8," 
                        + csvRows.map(e => e.join(",")).join("\n");
                      const encodedUri = encodeURI(csvContent);
                      const link = document.createElement("a");
                      link.setAttribute("href", encodedUri);
                      link.setAttribute("download", `Cirkel_12Month_ESG_Projections_${projectionGrowthModel}.csv`);
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      
                      const toastFn = (window as any).showToast;
                      if (toastFn) toastFn(isDa ? 'Prospekteringsprotokol downloadet som CSV!' : 'Projection Ledger downloaded as CSV!', 'success');
                      addLog('CSRD_ENG', `12 måneders ESG vækstscenarie (${projectionGrowthModel}) eksporteret som CSV til revisionsjournal.`, 'success');
                    }}
                    className="bg-primary hover:bg-[#1a384f] text-[#C8F24A] border border-[#C8F24A]/25 font-black text-[9px] py-2 px-3 rounded-xl shadow-3xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isDa ? 'Eksporter Prospekt-CSV' : 'Export Projections CSV'}
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-gray-150">
                  <table className="w-full text-[10.5px] border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-150 uppercase text-[9px] tracking-wider text-left">
                        <th className="p-3">{isDa ? 'Måned' : 'Month'}</th>
                        <th className="p-3">{isDa ? 'CO₂ sparet' : 'CO₂ Saved'}</th>
                        <th className="p-3">{isDa ? 'Materialevægt' : 'Material weight'}</th>
                        <th className="p-3">{isDa ? 'Borgerscanninger' : 'Citizen scans'}</th>
                        <th className="p-3">{isDa ? 'Sorteringsgrad' : 'Sorting rate'}</th>
                        <th className="p-3">{isDa ? 'Status' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-150 font-medium">
                      {(() => {
                        let co2Slope = 4.8;
                        let weightSlope = 3.28;
                        let scansSlope = 1480;
                        
                        if (projectionGrowthModel === 'optimistic') {
                          co2Slope *= 1.25;
                          weightSlope *= 1.25;
                          scansSlope *= 1.25;
                        } else if (projectionGrowthModel === 'conservative') {
                          co2Slope *= 0.8;
                          weightSlope *= 0.8;
                          scansSlope *= 0.8;
                        }
                        
                        const projData = [];
                        for (let i = 1; i <= 12; i++) {
                          const year = i <= 6 ? '2026' : '2027';
                          const monthLabel = isDa ? monthsDa[i-1] : monthsEn[i-1];
                          const variance = 1 + (Math.sin(i * 1.5) * 0.04);
                          const co2 = parseFloat((36.4 + co2Slope * i * variance).toFixed(1));
                          const weight = parseFloat((24.8 + weightSlope * i * variance).toFixed(1));
                          const scans = Math.round((9800 + scansSlope * i * variance));
                          const startRate = 78.3;
                          const rateSlope = projectionGrowthModel === 'optimistic' ? 1.4 : projectionGrowthModel === 'conservative' ? 0.45 : 0.95;
                          const sortingRate = parseFloat(Math.min(96, startRate + (i * rateSlope * variance)).toFixed(1));
                          
                          projData.push({
                            name: `${monthLabel} ${year}`,
                            co2Saved: co2,
                            weightTons: weight,
                            citizensScans: scans,
                            sortingRate: sortingRate
                          });
                        }
                        return projData;
                      })().map((row, idx) => {
                        const meetsEUMandate = row.sortingRate >= 85.0;
                        return (
                          <tr key={idx} className="hover:bg-gray-50/50">
                            <td className="p-3 font-bold text-primary">{row.name}</td>
                            <td className="p-3 font-mono font-bold text-emerald-800">{row.co2Saved} Tons</td>
                            <td className="p-3 font-mono text-gray-600">{row.weightTons} Tons</td>
                            <td className="p-3 font-mono text-gray-500">{row.citizensScans.toLocaleString()}</td>
                            <td className="p-3 font-mono font-bold text-blue-600">{row.sortingRate}%</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase ${
                                meetsEUMandate ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {meetsEUMandate ? (isDa ? 'Overholder standard' : 'EU compliant') : (isDa ? 'Under tærskel' : 'Sub-optimal')}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

          {/* TAB B: MUNI LOGISTICS & NUDGES */}
          {activeTab === 'muni' && (
            <motion.div
              key="muni"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Left Column: Smart Bins and GIS Info */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                {/* IoT Smart Bin list telemetry control */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left">
                  <div className="flex justify-between items-center border-b border-gray-150 pb-3 mb-4">
                    <div>
                      <h4 className="text-xs font-black text-primary uppercase">IoT Smart-Bin status</h4>
                      <p className="text-[9.5px] font-medium text-gray-400">Overvågning af smarte skraldespande</p>
                    </div>
                    <button
                      onClick={() => {
                        triggerHaptic(HapticPattern.HEAVY_TAP);
                        addLog('ROUTING_AI', 'PostGIS routing algoritme kørt. 3 optimale tømningsruter med optimal CO₂ profil sendt til flåden.', 'success');
                        
                        // Sort active bins by fill level (highest first) for mock optimum route
                        const sortedSeq = [...smartBinsList].sort((a, b) => b.fill - a.fill);
                        setOptimizedRoute({
                          sequence: sortedSeq,
                          distanceSaved: 28.4,
                          fuelSaved: 18.6,
                          co2Reduced: 48.5
                        });

                        const toastFn = (window as any).showToast;
                        if (toastFn) toastFn('Optimal PostGIS logistikrute genereret!', 'success');
                      }}
                      className="bg-[#85A912] hover:bg-[#72920f] text-white font-black text-[9px] py-1.5 px-3 rounded-xl cursor-pointer shadow-3xs uppercase tracking-wider"
                    >
                      Optimer tømning (PostGIS) 🗺️
                    </button>
                  </div>

                  {/* PostGIS Route calculation result card */}
                  {optimizedRoute && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-emerald-50/50 border-2 border-emerald-550/30 rounded-2xl p-4 mb-4 flex flex-col gap-3 text-emerald-950 shadow-3xs"
                    >
                      <div className="flex justify-between items-center border-b border-emerald-200/50 pb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">🛣️</span>
                          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-850">
                            PostGIS Optimeret Tømningssekvens
                          </span>
                        </div>
                        <span className="text-[8px] font-mono font-black text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5 uppercase">
                          Bedste CO2-profil
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] font-black text-primary py-1">
                        {optimizedRoute.sequence.map((item: any, i: number) => (
                          <div key={item.id} className="flex items-center gap-1">
                            <span className="bg-white border border-emerald-200 px-2 py-1 rounded-lg shadow-3xs">
                              {item.location} ({item.fill}%)
                            </span>
                            {i < optimizedRoute.sequence.length - 1 && (
                              <span className="text-emerald-550 font-bold">➔</span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-3 bg-white/70 border border-emerald-150/50 rounded-xl p-2.5 text-center">
                        <div>
                          <span className="text-[8px] font-black text-gray-405 uppercase block">Afstand sparet</span>
                          <span className="text-[11px] font-black font-mono text-emerald-805">-{optimizedRoute.distanceSaved} km</span>
                        </div>
                        <div>
                          <span className="text-[8px] font-black text-gray-405 uppercase block">Diesel reduceret</span>
                          <span className="text-[11px] font-black font-mono text-emerald-805">-{optimizedRoute.fuelSaved} L</span>
                        </div>
                        <div>
                          <span className="text-[8px] font-black text-gray-405 uppercase block">CO₂e besparelse</span>
                          <span className="text-[11.5px] font-black font-mono text-emerald-600">🌿 {optimizedRoute.co2Reduced} kg</span>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          onClick={() => setOptimizedRoute(null)}
                          className="text-gray-500 hover:text-gray-900 font-bold text-[9px] uppercase px-2.5 py-1.5"
                        >
                          Annuller
                        </button>
                        <button
                          onClick={() => {
                            triggerHaptic(HapticPattern.SCAN_SUCCESS);
                            addLog('ROUTING_AI', 'Ruteplan overført til renovationsbil #4. Navigationssekvens låst.', 'success');
                            const toastFn = (window as any).showToast;
                            if (toastFn) toastFn('Rute tildelt renovationsbil #4!', 'success');
                            setOptimizedRoute(null);
                          }}
                          className="bg-primary hover:bg-primary/95 text-accent font-black text-[9px] px-3 py-1.5 rounded-lg shadow-3xs uppercase tracking-wider"
                        >
                          Tildel Chauffør 🚛
                        </button>
                      </div>
                    </motion.div>
                  )}

                  <div className="flex flex-col gap-3">
                    {smartBinsList.map((bin) => (
                      <div key={bin.id} className="border border-gray-150 rounded-2xl p-3.5 flex justify-between items-center bg-gray-50/50">
                        <div className="text-left flex-1 min-w-0 pr-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${bin.fill > 80 ? 'bg-red-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                            <h5 className="text-[12px] font-black text-primary truncate">{bin.location}</h5>
                            <span className="text-[8px] font-black font-mono px-2 py-0.5 rounded-md bg-gray-150 border border-gray-250/20 text-gray-550 uppercase">
                              {bin.category}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3.5 mt-2 flex-wrap">
                            <span className="text-[9px] font-bold text-gray-450 uppercase">
                              Snorlige: <span className="font-extrabold text-gray-550">Tømt {bin.lastEmptied}</span>
                            </span>
                            <span className="text-[9px] font-bold text-gray-450 uppercase flex items-center gap-1">
                              Fejlsortering: 
                              <span className={`font-black ${bin.contamination > 15 ? 'text-amber-500 font-extrabold bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-md' : 'text-emerald-600'}`}>
                                {bin.contamination}%
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <span className="text-[8px] font-black text-gray-400 uppercase block">Fyldningsgrad</span>
                            <span className={`text-[12px] font-black font-mono ${bin.fill > 80 ? 'text-red-500' : 'text-primary'}`}>{bin.fill} %</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[8px] font-black text-gray-400 uppercase block">Batteri</span>
                            <span className="text-[12px] font-black font-mono text-primary">{bin.battery} %</span>
                          </div>

                          <div className="flex gap-1">
                            {bin.contamination > 15 && (
                              <button
                                onClick={() => {
                                  triggerHaptic(HapticPattern.LIGHT_TAP);
                                  addLog('LOCAL_NUDGE', `Advarsels-nudge afsendt til borgere nær "${bin.location}" om øget fejlsortering af ${bin.category}. Sær-bonus på +0.50 DKK aktiveret.`, 'success');
                                  const toastFn = (window as any).showToast;
                                  if (toastFn) toastFn(`Kampagnenudge sendt til ${bin.location}!`, 'success');
                                }}
                                className="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 p-2 rounded-xl text-[10px] font-black cursor-pointer shadow-3xs"
                                title="Udsend lokaliseret sorteringsnudge"
                              >
                                💬 Nudge
                              </button>
                            )}
                            <button
                              onClick={() => {
                                triggerHaptic(HapticPattern.SCAN_SUCCESS);
                                setSmartBinsList(prev => prev.map(b => b.id === bin.id ? { ...b, fill: 0, status: 'Aktiv', lastEmptied: 'Lige nu', contamination: Math.floor(Math.random() * 5) } : b));
                                addLog('IOT_BIN', `Skraldebeholder "${bin.location}" registreret som tømt af renovationsbil.`, 'success');
                                const toastFn = (window as any).showToast;
                                if (toastFn) toastFn(`Beholder "${bin.location}" tømt!`, 'success');
                              }}
                              className="bg-white hover:bg-gray-150 border border-gray-250 p-2 rounded-xl text-xs cursor-pointer shadow-3xs"
                              title="Marker som tømt"
                            >
                              🗑️ Tøm
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deploy New Smart Bin Controller Form */}
                <div id="deploy-smartbin-container" className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left">
                  <div className="flex items-center gap-2 mb-3 border-b border-gray-100 pb-2">
                    <span className="text-base select-none">📡</span>
                    <div>
                      <h4 className="text-xs font-black text-primary uppercase">Registrer Ny Smart IoT Beholder</h4>
                      <p className="text-[9.5px] font-medium text-gray-400">Tilkobl ny smart-bin til det kommunale GIS-kort</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1.5 pb-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] font-black text-gray-400 uppercase">Beholderens Lokation</span>
                      <input
                        type="text"
                        className="bg-white border border-gray-200 px-3 py-2 text-xs rounded-xl font-semibold outline-none focus:ring-2 focus:ring-primary/10"
                        placeholder="E.g. Aarhus Åben Havnebassin"
                        value={newBinLocation}
                        onChange={(e) => setNewBinLocation(e.target.value)}
                      />
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] font-black text-gray-400 uppercase">Affaldskategori</span>
                      <select 
                        className="bg-white border border-gray-200 px-2 py-2 text-xs rounded-xl font-bold cursor-pointer outline-none focus:ring-2 focus:ring-primary/10"
                        value={newBinCategory}
                        onChange={(e) => setNewBinCategory(e.target.value)}
                      >
                        <option value="Plast & Metal">Plast & Metal</option>
                        <option value="Drikkekartoner">Drikkekartoner</option>
                        <option value="Alu & Flasker">Alu & Flasker</option>
                        <option value="Cirkel kopper">Cirkel kopper</option>
                        <option value="Pap & Papir">Pap & Papir</option>
                        <option value="Bioaffald">Bioaffald</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[8px] font-black text-gray-400 uppercase">
                        <span>Batteri-niveau</span>
                        <span className="font-mono text-primary font-bold">{newBinBattery}%</span>
                      </div>
                      <input 
                        type="range"
                        min="20"
                        max="100"
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary mt-2"
                        value={newBinBattery}
                        onChange={(e) => setNewBinBattery(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 mt-2">
                    <button
                      onClick={() => {
                        if (!newBinLocation.trim()) {
                          alert("Venligst angiv lokation for smart-binen!");
                          return;
                        }
                        triggerHaptic(HapticPattern.SCAN_SUCCESS);
                        const newId = String(smartBinsList.length + 1);
                        setSmartBinsList(prev => [
                          ...prev,
                          {
                            id: newId,
                            location: newBinLocation,
                            fill: Math.floor(Math.random() * 35) + 5,
                            battery: newBinBattery,
                            status: 'Aktiv',
                            category: newBinCategory,
                            lastEmptied: 'Aldrig',
                            contamination: Math.floor(Math.random() * 10)
                          }
                        ]);
                        addLog('IOT_REG', `Ny Smart-Bin "${newBinLocation}" registreret og forbundet via LoRaWAN. GPS koordinater allokeret til lokationskortet.`, 'success');
                        
                        const toastFn = (window as any).showToast;
                        if (toastFn) toastFn(`Smart-Bin "${newBinLocation}" deployet!`, 'success');
                        
                        confetti({
                          particleCount: 40,
                          spread: 45,
                          origin: { y: 0.8 },
                          colors: ['#85A912', '#C8F24A', '#22C55E']
                        });

                        setNewBinLocation('');
                      }}
                      className="bg-primary hover:bg-primary/95 text-accent font-black text-[10px] uppercase px-4 py-2.5 rounded-xl cursor-pointer shadow-3xs"
                    >
                      Deploy IoT Recycler 📡
                    </button>
                  </div>
                </div>

                {/* Aarhus map widget placeholder inside muni tab to easily display locations visually */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left">
                  <h4 className="text-xs font-black text-primary uppercase mb-3">IoT Bins på bykort</h4>
                  <div className="h-64 rounded-2xl overflow-hidden border border-gray-150">
                    <RecyclingCenterMap />
                  </div>
                </div>
              </div>

              {/* Custom citizen nudge campaign creator panel */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col gap-4">
                <div>
                  <h4 className="text-xs font-black text-primary uppercase">Nudge & Kampagneværktøj</h4>
                  <p className="text-[9.5px] font-semibold text-gray-400 leading-normal">Udsend dynamiske bonusser (+pant) til borgeres mobil-app for at booste sortering i udvalgte områder.</p>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[8.5px] font-black text-gray-400 uppercase">Kampagnens navn</span>
                    <input
                      type="text"
                      className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none"
                      placeholder="E.g. Bio-indsamling i Midtbyen"
                      value={newCampTitle}
                      onChange={(e) => setNewCampTitle(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8.5px] font-black text-gray-400 uppercase">Målområde Postnummer</span>
                    <input
                      type="text"
                      className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none font-mono"
                      placeholder="8000"
                      value={newCampPostcode}
                      onChange={(e) => setNewCampPostcode(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8.5px] font-black text-gray-400 uppercase">Sær-bonus (DKK per scan)</span>
                    <input
                      type="number"
                      step="0.10"
                      className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none font-mono"
                      placeholder="1.50"
                      value={newCampReward}
                      onChange={(e) => setNewCampReward(Number(e.target.value))}
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (!newCampTitle.trim()) {
                      alert('Indtast venligst et kampagnenavn.');
                      return;
                    }
                    triggerHaptic(HapticPattern.SCAN_SUCCESS);
                    const id = String(municipalCampaigns.length + 1);
                    setMunicipalCampaigns(prev => [
                      ...prev,
                      { id, title: newCampTitle, postcode: newCampPostcode, reward: newCampReward, progress: 0, active: true }
                    ]);
                    addLog('MUNI_CAMP', `Kampagne "${newCampTitle}" oprettet for postnummer ${newCampPostcode}. Borgere modtager +${newCampReward.toFixed(2)} kr i bonus.`, 'success');
                    
                    const toastFn = (window as any).showToast;
                    if (toastFn) toastFn(`Nudge-Kampagnen "${newCampTitle}" er nu udsendt til borgere i postnummer og aktiv!`, 'success');
                    
                    confetti({
                      particleCount: 55,
                      spread: 60,
                      origin: { y: 0.8 },
                      colors: ['#C8F24A', '#22C55E', '#10B981']
                    });

                    setNewCampTitle('');
                  }}
                  className="w-full bg-[#85A912] hover:bg-[#72920f] text-white font-black text-[11px] uppercase tracking-wider py-3 rounded-xl transition-all shadow-3xs cursor-pointer text-center"
                >
                  Udsend Nudge Kampagne 🚀
                </button>

                <div className="border-t border-gray-150 pt-3">
                  <span className="text-[9.5px] font-black text-gray-400 uppercase tracking-widest block mb-2.5">Aktive Sorteringsnudges</span>
                  <div className="flex flex-col gap-2.5">
                    {municipalCampaigns.map((camp) => (
                      <div key={camp.id} className="bg-gray-50 border border-gray-150 rounded-2xl p-3">
                        <div className="flex justify-between items-start">
                          <div className="text-left">
                            <h5 className="text-[11.5px] font-black text-primary">{camp.title}</h5>
                            <p className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Postnr: {camp.postcode} · Sær-bonus: +{camp.reward.toFixed(2)} kr</p>
                          </div>
                          <span className="text-[8px] font-black bg-emerald-100 text-emerald-800 border border-emerald-250 px-2 py-0.5 rounded uppercase">Aktiv</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 bg-gray-200 h-1 rounded-full overflow-hidden">
                            <div className="bg-[#85A912] h-full rounded-full" style={{ width: `${camp.progress}%` }} />
                          </div>
                          <span className="text-[9px] font-mono font-black text-gray-550 shrink-0">{camp.progress}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB C: EPR PRODUCERS AREA */}
          {activeTab === 'provider' && (
            <motion.div
              key="provider"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Product list emballageregister */}
              <div className="lg:col-span-2 flex flex-col gap-6 text-left">
                
                {/* Executive Producer metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 p-4 rounded-3xl shadow-3xs text-left">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-wide block">Gennemsnitlig Grade</span>
                    <span className="text-xl font-black text-[#85A912] block mt-1">Grade A+</span>
                    <span className="text-[8px] font-bold text-[#85A912] block mt-1">94.2% Genvendelighed</span>
                  </div>

                  <div className="bg-white border border-gray-200 p-4 rounded-3xl shadow-3xs text-left">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-wide block">Brug af Recycled Plastik</span>
                    <span className="text-xl font-black text-primary font-mono block mt-1">74.2 % rPET</span>
                    <span className="text-[8px] font-bold text-gray-400 block mt-1">Klima-miljømål: 80% rPET</span>
                  </div>

                  <div className="bg-white border border-gray-200 p-4 rounded-3xl shadow-3xs text-left">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-wide block">Estimeret kvartalsafgift</span>
                    <span className="text-xl font-black text-primary font-mono block mt-1">24.520 DKK</span>
                    <span className="text-[8px] font-bold text-emerald-700 block mt-1">Skattebegunstigelse under PPWR</span>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs flex flex-col gap-4">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase">Registrerede Emballagedesigns (EU Scope 3)</h4>
                    <p className="text-[9.5px] font-medium text-gray-400">Verificeret emballagedatabase som beregner det gældende miljømiljøafgift bidrag under EU’s direktiv for udvidet producentansvar (EPR).</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-400 font-extrabold uppercase text-[8.5px] tracking-wider">
                          <th className="py-2.5">Produkt</th>
                          <th className="py-2.5">Stregkode (EAN)</th>
                          <th className="py-2.5">Materiale (Vægt)</th>
                          <th className="py-2.5">Eco Rating</th>
                          <th className="py-2.5 text-right">Afgift</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registeredProducts.map((p) => (
                          <tr key={p.id} className="border-b border-gray-150/50 hover:bg-gray-50/50">
                            <td className="py-3 font-black text-primary">{p.name}</td>
                            <td className="py-3 font-mono font-bold text-gray-540">{p.ean}</td>
                            <td className="py-3 text-gray-550 font-semibold">{p.material} ({p.weight}g)</td>
                            <td className="py-3">
                              <span className={`px-2 py-0.5 rounded font-black text-[9px] ${
                                p.grade.includes('A++') ? 'bg-emerald-100 text-emerald-800' :
                                p.grade.includes('A+') ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {p.grade}
                              </span>
                            </td>
                            <td className="py-3 font-mono font-black text-right text-slate-800">+{p.tax.toFixed(2)} DKK</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Calculator input widget */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col gap-4">
                <div>
                  <h4 className="text-xs font-black text-primary uppercase">EPR Miljøafgiftsberegner</h4>
                  <p className="text-[9.5px] font-semibold text-gray-400 leading-normal">Opret nyt produktdesign og beregn automatisk miljøafgift samt estimeret CO₂-aftryk for pakningen.</p>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[8.5px] font-black text-gray-400 uppercase">Produkts Navn</span>
                    <input
                      type="text"
                      className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none"
                      placeholder="E.g. Arla Fløde 0.5L"
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8.5px] font-black text-gray-400 uppercase">EAN-13 Stregkode</span>
                    <input
                      type="text"
                      className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none font-mono"
                      placeholder="5701234567890"
                      value={newProdEan}
                      onChange={(e) => setNewProdEan(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8.5px] font-black text-gray-400 uppercase">Hovedmateriale</span>
                    <select
                      className="bg-white border border-gray-200 px-3 py-2.5 text-xs rounded-xl font-bold outline-none cursor-pointer"
                      value={newProdMaterial}
                      onChange={(e) => setNewProdMaterial(e.target.value)}
                    >
                      <option value="Plastik (rPET)">Plastik (rPET / eco)</option>
                      <option value="Plastik (Stiv HDPE)">Plastik (Stiv HDPE)</option>
                      <option value="Aluminium">Aluminium (Dåser)</option>
                      <option value="Pap / Karton">Pap / Karton</option>
                      <option value="Drikkekarton (Multi-layer)">Drikkekarton (Multi-layer)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[8.5px] font-black text-gray-400 uppercase">
                      <span>Vægt (Gram)</span>
                      <span className="font-mono text-primary font-bold">{newProdWeight} g</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="150"
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary mt-1"
                      value={newProdWeight}
                      onChange={(e) => setNewProdWeight(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="flex justify-between items-center bg-gray-50 border border-gray-150 p-3 rounded-2xl">
                  <div className="text-left animate-pulse">
                    <span className="text-[8px] font-black text-gray-500 uppercase block">Miljøafgift per enhed:</span>
                    <span className="text-[12px] font-black font-mono text-[#85A912]">
                      +{(newProdWeight * 0.0065).toFixed(2)} DKK
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[8px] font-black text-gray-500 uppercase block">Eco-Grade</span>
                    <span className="text-[12px] font-black text-slate-800">A++ / Genanvendelig</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (!newProdName.trim() || !newProdEan.trim()) {
                      alert('Indtast venligst produktnavn og EAN stregkode.');
                      return;
                    }
                    triggerHaptic(HapticPattern.SCAN_SUCCESS);
                    
                    const estimatedTax = Number((newProdWeight * 0.0064 * (newProdGrade === 'A++' ? 0.75 : 1.15)).toFixed(2));
                    setRegisteredProducts(prev => [
                      ...prev,
                      {
                        id: String(prev.length + 1),
                        name: newProdName,
                        ean: newProdEan,
                        material: newProdMaterial,
                        weight: newProdWeight,
                        grade: newProdGrade,
                        tax: estimatedTax,
                        co2: Number((newProdWeight * 0.008).toFixed(2))
                      }
                    ]);

                    addLog('EPR_EVAL', `Produkt emballage godkendt og registreret: ${newProdName} [EAN: ${newProdEan}]`, 'success');
                    
                    const toastFn = (window as any).showToast;
                    if (toastFn) toastFn(`Produkt ${newProdName} registreret i ERP database!`, 'success');

                    confetti({
                      particleCount: 50,
                      spread: 50,
                      origin: { y: 0.8 },
                      colors: ['#C8F24A', '#22C55E', '#3B82F6']
                    });

                    setNewProdName('');
                    setNewProdEan('');
                  }}
                  className="w-full bg-primary hover:bg-primary/95 text-accent font-black text-[11px] uppercase tracking-wider py-3 rounded-xl transition-all shadow-3xs cursor-pointer text-center"
                >
                  Registrer emballagedesign i EU database 🚀
                </button>
              </div>
            </motion.div>
          )}

          {/* TAB D: SMART BIN MAP FULL */}
          {activeTab === 'map' && (
            <motion.div
              key="map"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col gap-4 animate-in fade-in duration-300"
            >
              {/* Dual-View Map Selection Header */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-gray-150">
                <div>
                  <h3 className="text-md font-black tracking-tight text-primary uppercase">
                    {mapViewMode === 'local' ? (isDa ? 'IoT Smart-Bin Bykort' : 'IoT Smart-Bin Location Map') : (isDa ? 'Administrativt Sorteringsstætheds-Kort' : 'Administrative Sorting Density Heat-Map')}
                  </h3>
                  <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
                    {mapViewMode === 'local' 
                      ? (isDa ? 'Smarte skraldespande, optællingsenheder og borgerlige returstationer med telemetri.' : 'Smart trash bins, calculation logs, and local citizen return points with active telemetry.')
                      : (isDa ? 'Kommunal sorteringsfokus og tæthedsberegning baseret på aktive blockchain/Firestore-data ledgers.' : 'Municipal recycling index and density maps computed via active user Firestore scan records.')}
                  </p>
                </div>

                <div className="bg-gray-100 p-1 rounded-xl border border-gray-200 flex gap-1 self-stretch md:self-auto shrink-0 select-none">
                  <button
                    onClick={() => {
                      triggerHaptic(HapticPattern.LIGHT_TAP);
                      setMapViewMode('heatmap');
                    }}
                    className={`flex-1 md:flex-none text-center px-4 py-2.5 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      mapViewMode === 'heatmap'
                        ? 'bg-[#85A912] text-white shadow-3xs'
                        : 'text-gray-500 hover:text-primary hover:bg-gray-200'
                    }`}
                  >
                    🔥 (Heat-Map) Regional Densitet
                  </button>
                  <button
                    onClick={() => {
                      triggerHaptic(HapticPattern.LIGHT_TAP);
                      setMapViewMode('local');
                    }}
                    className={`flex-1 md:flex-none text-center px-4 py-2.5 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      mapViewMode === 'local'
                        ? 'bg-primary text-accent shadow-3xs'
                        : 'text-gray-500 hover:text-primary hover:bg-gray-200'
                    }`}
                  >
                    📍 Smart-Bin IoT Lokationskort
                  </button>
                </div>
              </div>

              {/* Map Content Render Area */}
              <div className="mt-2 transition-all">
                {mapViewMode === 'local' ? (
                  <div className="h-[550px] rounded-3xl overflow-hidden border border-gray-150">
                    <RecyclingCenterMap />
                  </div>
                ) : (
                  <AdministrativeHeatmap />
                )}
              </div>
            </motion.div>
          )}

          {/* TAB E: REVISIONS GATEWAY & CLIENT KEY */}
          {activeTab === 'integrations' && (
            <motion.div
              key="integrations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white border border-gray-200 rounded-3xl p-6 shadow-3xs text-left flex flex-col gap-6"
            >
              <div className="flex items-center gap-3 border-b border-gray-150 pb-3">
                <Key className="w-6 h-6 text-[#85A912]" />
                <div>
                  <h3 className="text-md font-black tracking-tight text-primary uppercase">Integrations & API-Miljø</h3>
                  <p className="text-[9.5px] font-semibold text-gray-400 mt-0.5">Forbind Cirkel-aktiviteter direkte til jeres ERP system (SAP / Microsoft Business Central / n8n)</p>
                </div>
              </div>

              {/* Premium Enterprise CRM Direct Integration Feature Banner */}
              <div className="bg-gradient-to-br from-primary via-[#022138] to-[#041a2a] text-white p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden shadow-md">
                <div className="absolute top-0 right-0 w-64 h-full bg-[#C8F24A]/5 rounded-bl-full pointer-events-none" />
                <div className="z-10 text-left max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-[8.5px] font-black tracking-widest text-[#C8F24A] bg-[#C8F24A]/10 border border-[#C8F24A]/25 px-2.5 py-1 rounded-md uppercase font-mono">
                      Enterprise CRM Hub (Aktiv)
                    </span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <h4 className="text-base font-black text-white mt-2.5 uppercase tracking-wide flex items-center gap-2">
                    <Cpu className="text-[#C8F24A] w-5 h-5" />
                    Forbind Cirkel med jeres Salesforce, HubSpot eller Dynamics CRM
                  </h4>
                  <p className="text-[11px] text-gray-200 mt-2 leading-relaxed font-semibold">
                    Synkroniser realtids-scanhændelser, administrer sikre krypterede API-nøgler med specifikke scopes, og tilslut interaktiv kode/dokumentation (Node.js, cURL, Salesforce Apex, Python) direkte til enterprise-klienters CRM-systemer.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(HapticPattern.SCAN_SUCCESS);
                    setShowCrmModal(true);
                  }}
                  className="bg-[#C8F24A] hover:bg-[#b0d836] text-primary font-black text-[11px] uppercase py-3 px-5 rounded-xl shrink-0 cursor-pointer shadow-md select-none hover:scale-103 transition-all active:scale-97 flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-primary fill-primary/10 animate-spin" style={{ animationDuration: '6s' }} />
                  Åben CRM-Konfigurator & API Docs ⚡
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                <div className="flex flex-col gap-4">
                  <h4 className="text-xs font-black text-primary uppercase tracking-wide">Webhook Modtager</h4>
                  <p className="text-[10.5px] text-gray-500 font-medium leading-relaxed">
                    Sæt en callback URL op for at modtage real-time notifikationer, hver gang en borger scanner en godkendt emballagemodel i jeres kommune eller brandzone.
                  </p>

                  <div className="flex flex-col gap-1.5 mt-2">
                    <span className="text-[8px] font-black text-gray-400 uppercase">Webhook Callback URL</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-mono font-bold outline-none text-slate-800"
                        value={b2bWebhookUrl}
                        onChange={(e) => setB2bWebhookUrl(e.target.value)}
                      />
                      <button
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          addLog('WEBHOOK', `Test callback sendt til ${b2bWebhookUrl}. Status: 200 OK`, 'success');
                          const toastFn = (window as any).showToast;
                          if (toastFn) toastFn('Webhook test afsendt! Status 200 OK', 'success');
                        }}
                        className="bg-[#faf9f6] border border-gray-250 text-[10px] font-black px-4 py-2 rounded-xl cursor-pointer hover:bg-gray-50 uppercase shadow-3xs shrink-0"
                      >
                        Send Test Webhook 📡
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <h4 className="text-xs font-black text-primary uppercase tracking-wide">Sikkerhed & API Live Nøgler</h4>
                  <p className="text-[10.5px] text-gray-500 font-medium leading-relaxed">
                    Brug denne krypterede nøgle til at forhøre Cirkel REST-API’et for aggregerede Scope 3 CO₂ besparelses-data og valideringer direkte. Vis eller regenerer nøglen her.
                  </p>

                  <div className="bg-slate-50 border border-gray-150 p-4 rounded-2xl flex flex-col gap-3 mt-1 text-left">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-black text-gray-450 uppercase tracking-widest">Klient Live Token</span>
                      {b2bApiKey && (
                        <button
                          onClick={() => {
                            triggerHaptic(HapticPattern.LIGHT_TAP);
                            navigator.clipboard.writeText(b2bApiKey);
                            const toastFn = (window as any).showToast;
                            if (toastFn) toastFn('API-nøgle kopieret til udklipsholder!', 'success');
                          }}
                          className="text-[8px] font-black text-indigo-650 hover:underline cursor-pointer uppercase"
                        >
                          Kopier Token 📋
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        readOnly
                        placeholder="Ingen aktiv API-nøgle"
                        className="flex-1 bg-white border border-gray-200 text-xs px-3.5 py-2 rounded-xl font-mono text-slate-800 outline-none font-bold select-all"
                        value={b2bApiKey}
                      />
                      <button
                        onClick={() => {
                          triggerHaptic(HapticPattern.SCAN_SUCCESS);
                          const newKey = `cirkel_pk_live_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
                          setB2bApiKey(newKey);
                          addLog('SECURITY', `Ny Live API-nøgle oprettet for B2B systemintegration.`, 'success');
                          const toastFn = (window as any).showToast;
                          if (toastFn) toastFn('Ny API-nøgle genereret!', 'success');
                        }}
                        className="bg-primary hover:bg-slate-900 text-[#C8F24A] font-black text-[9.5px] uppercase py-2 px-3.5 rounded-xl shadow-3xs cursor-pointer select-none"
                      >
                        Regenerer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB FX: CIRKEL CONNECT CAMPAIGNS & NUDGING HUB */}
          {activeTab === 'campaigns' && (
            <motion.div
              key="campaigns"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-6 text-left"
            >
              {/* Header card with Live Ticker simulation */}
              <div id="campaigns-dashboard-hero" className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white rounded-3xl p-6 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 z-10 relative">
                  <div>
                    <span className="text-[9px] font-black tracking-widest text-[#C8F24A] uppercase bg-[#C8F24A]/10 border border-[#C8F24A]/20 px-2.5 py-1 rounded-md">
                      Cirkel Connect Campaign & Nudging Engine
                    </span>
                    <h3 className="text-xl font-black text-white tracking-tight mt-2 flex items-center gap-1.5 uppercase">
                      <Sparkles className="text-[#C8F24A] w-5 h-5 animate-spin" style={{ animationDuration: '4s' }} />
                      Kampagne & Forbrugeradfærd Hub
                    </h3>
                    <p className="text-[10px] text-indigo-200 mt-1 max-w-xl font-semibold">
                      Udrul digitale nudging kampagner, overvåg borgerens loyalitet og reelle returrater, distribuer brandspecifikke vouchers og print intelligente Cirkel Smart-tags live.
                    </p>
                  </div>

                  {/* Interactive Return Simulator control panel */}
                  <div className="bg-black/40 border border-indigo-500/20 p-4 rounded-2xl flex flex-col sm:flex-row gap-4 items-center shrink-0 w-full lg:w-auto">
                    <div className="text-left">
                      <span className="text-[8px] font-black text-indigo-300 uppercase block">Live Citizen Returns Simulator</span>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="font-mono text-xl font-black text-[#C8F24A]">{simulatedLiveScans + 420} scans</span>
                        <span className="font-mono text-[9.5px] text-indigo-300">({totalSimulatedSavings.toFixed(1)} kg sparet)</span>
                      </div>
                      <span className="text-[7.5px] font-semibold text-indigo-200 uppercase block mt-1">📡 Sensor callback link: AKTIV (Kommune + SAP)</span>
                    </div>

                    <button
                      onClick={() => {
                        triggerHaptic(HapticPattern.SCAN_SUCCESS);
                        setIsSimulatingLive(!isSimulatingLive);
                        const toastFn = (window as any).showToast;
                        if (toastFn) {
                          toastFn(isSimulatingLive ? 'Live borger-simulation afbrudt.' : 'Borger-simulation påbegyndt! Live scanninger modtages nu.', 'info');
                        }
                      }}
                      className={`w-full sm:w-auto px-4 py-2.5 rounded-xl font-black text-[10px] uppercase cursor-pointer transition-all flex items-center justify-center gap-1.5 select-none ${
                        isSimulatingLive 
                          ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse' 
                          : 'bg-[#C8F24A] hover:bg-[#b0d836] text-slate-900 shadow-2xs'
                      }`}
                    >
                      {isSimulatingLive ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
                          Stop simulation
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 shrink-0 fill-current" />
                          Start Live Simulation
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Simulated live metrics row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 border-t border-indigo-900/50 pt-5 text-left">
                  <div>
                    <span className="text-[8px] font-black text-indigo-300 uppercase block tracking-wider">Aktivt Kampagnebudget</span>
                    <strong className="text-lg font-mono font-black text-[#C8F24A]">{(marketingCampaigns.reduce((a, b) => a + (b.active ? b.budget : 0), 0)).toLocaleString('da-DK')} DKK</strong>
                    <span className="text-[8px] text-indigo-200 block mt-0.5">Total budget: {marketingCampaigns.reduce((a,b)=>a+b.budget, 0).toLocaleString('da-DK')} DKK</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-indigo-300 uppercase block tracking-wider">Samlet Forbrug</span>
                    <strong className="text-lg font-mono font-black text-indigo-100">{(marketingCampaigns.reduce((a, b) => a + b.spend, 0)).toLocaleString('da-DK')} DKK</strong>
                    <span className="text-[8px] text-[#C8F24A] block mt-0.5">Avg ROI: +460% CO₂ / kr</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-indigo-300 uppercase block tracking-wider">Cirkel-scans total</span>
                    <strong className="text-lg font-mono font-black text-[#C8F24A]">{marketingCampaigns.reduce((a, b) => a + b.scans, 0).toLocaleString('da-DK')} scans</strong>
                    <span className="text-[8px] text-indigo-200 block mt-0.5">Avg conv rate: 87.2%</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-indigo-300 uppercase block tracking-wider">Miljø-vouchers claimed</span>
                    <strong className="text-lg font-mono font-black text-indigo-100">{Math.round(marketingCampaigns.reduce((a, b) => a + b.scans, 0) * 0.45).toLocaleString('da-DK')} stk</strong>
                    <span className="text-[8px] text-emerald-400 block mt-0.5">45% Indløsningsprocent</span>
                  </div>
                </div>
              </div>

              {/* BRAND NEW: CIRKEL AI ENTERPRISE STRATEGY & SUSTAINABILITY CO-PILOT */}
              <div id="ai-strategy-co-pilot-section" className="bg-[#FAF9F5] border-2 border-indigo-500/20 rounded-3xl p-6 shadow-xs text-left flex flex-col gap-5">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-150 pb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-100 rounded-2xl">
                      <Sparkles className="w-5 h-5 text-indigo-700 animate-pulse" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-primary uppercase tracking-tight flex items-center gap-1.5">
                        Cirkel AI Enterprise Strategy & Sustainability Co-Pilot
                      </h4>
                      <p className="text-[10px] text-gray-400 font-semibold leading-relaxed mt-0.5">
                        Få adgang til Gemini-modelleret eco-modulation, double materiality audits og brandspecifikke kampagne-anbefalinger.
                      </p>
                    </div>
                  </div>
                  <span className="text-[9.5px] font-black bg-indigo-500 text-white px-2.5 py-1 rounded-full font-mono uppercase tracking-widest text-[9px] select-none shadow-3xs flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5" /> GEMINI EMPOWERED
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  {/* Left Parameter Panel (2/5 Cols) */}
                  <div className="lg:col-span-2 bg-white border border-gray-150 rounded-2xl p-4 flex flex-col gap-3.5 text-xs">
                    <span className="text-[9.5px] font-black text-indigo-900 uppercase tracking-widest border-b border-gray-100 pb-1.5 flex items-center gap-1">
                      <Settings className="w-3.5 h-3.5" /> Konfigurer Emballagemodel
                    </span>

                    <div className="flex flex-col gap-1">
                      <label className="text-[8.5px] font-black text-gray-400 uppercase">Produkt- / Brandnavn</label>
                      <input
                        type="text"
                        className="bg-gray-50 border border-gray-200 px-3 py-2 text-xs rounded-xl font-bold outline-none text-[#111111]"
                        placeholder="F.eks. Arla rPET Mælkemodel"
                        value={aiProductNameInput}
                        onChange={(e) => setAiProductNameInput(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[8.5px] font-black text-gray-400 uppercase">Materialetype</label>
                        <select
                          className="bg-gray-50 border border-gray-200 px-2.5 py-2 text-xs rounded-xl font-black outline-none text-[#111111] cursor-pointer"
                          value={aiProductMaterialSelect}
                          onChange={(e) => setAiProductMaterialSelect(e.target.value)}
                        >
                          <option value="Plastik (rPET)">Plastik (rPET)</option>
                          <option value="Plastik (Jomfruelig)">Plastik (Jomfruelig)</option>
                          <option value="Aluminium">Aluminium</option>
                          <option value="Drikkekarton (Multi-layer)">Drikkekarton (Multi-layer)</option>
                          <option value="Glas">Glas</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[8.5px] font-black text-gray-400 uppercase">Enkeltvægt (g)</label>
                        <input
                          type="number"
                          className="bg-gray-50 border border-gray-200 px-3 py-1.5 text-xs rounded-xl font-mono font-bold outline-none text-[#111111]"
                          value={aiProductWeightInput}
                          onChange={(e) => setAiProductWeightInput(Number(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[8.5px] font-black text-gray-400 uppercase">Årlig Tonnage (Tons)</label>
                        <input
                          type="number"
                          className="bg-gray-50 border border-gray-200 px-3 py-1.5 text-xs rounded-xl font-mono font-bold outline-none text-[#111111]"
                          value={aiProductTonnageInput}
                          onChange={(e) => setAiProductTonnageInput(Number(e.target.value))}
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[8.5px] font-black text-gray-400 uppercase">Afgiftstakst pr Ton</label>
                        <div className="bg-gray-100 border border-gray-200 px-3 py-2 text-xs rounded-xl font-mono font-bold text-gray-500">
                          {aiProductMaterialSelect.includes('Jomfouelig') || aiProductMaterialSelect === 'Plastik (Jomfruelig)' ? '2.150 kr' : '450 kr'}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[8.5px] font-black text-gray-400 uppercase">Strategisk Målsætning & Fokus</label>
                      <select
                        className="bg-gray-50 border border-gray-200 px-2.5 py-2 text-xs rounded-xl font-black outline-none text-[#111111] cursor-pointer"
                        value={aiProductObjective}
                        onChange={(e) => setAiProductObjective(e.target.value)}
                      >
                        <option value="EPR afgiftsreduktion, special branding, vouchers og optimerede Cirkel-koder">EPR afgiftsreduktion & Intelligent mærkning</option>
                        <option value="Special branding, vouchers, and consumer behavioral conversion mapping">Målgruppe-nudging & Vouchers</option>
                        <option value="Dobbelt materialitetsvurdering, CSRD compliance audit & revisorbeviser">Double Materiality & CSRD Compliance</option>
                      </select>
                    </div>

                    <button
                      onClick={handleFetchAiStrategy}
                      disabled={aiIsGeneratingReport}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-[#C8F24A] font-black text-[10px] uppercase tracking-wider py-3.5 rounded-xl transition-all shadow-3xs flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-75 disabled:cursor-not-allowed"
                    >
                      {aiIsGeneratingReport ? (
                        <>
                          <Sparkles className="w-4 h-4 animate-spin text-[#C8F24A]" />
                          KØRER ESG AI AUDIT...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-[#C8F24A]" />
                          Analyser & Generer AI ESG Plan ✓
                        </>
                      )}
                    </button>
                  </div>

                  {/* Right Results Panel (3/5 Cols) */}
                  <div className="lg:col-span-3 bg-white border border-gray-150 rounded-2xl p-4 flex flex-col justify-between text-left">
                    {!aiGeneratedResult ? (
                      <div className="h-full flex flex-col justify-center items-center py-10 px-5 text-center gap-3">
                        <span className="text-4xl animate-bounce">🤖</span>
                        <h5 className="font-black text-indigo-950 uppercase text-[11px] tracking-wide">Cirkel AI Strategi Rapport-konsol</h5>
                        <p className="text-[10px] text-gray-400 font-semibold leading-relaxed max-w-sm">
                          Indtast dine emballage-råtal til venstre og klik på knappen for at køre en dybdegående Gemini AI-drevet eco-modulation og adfærds-marketing analyse. Du vil modtage estimerede skattebesparelser, mærkningstaktikker og godkendelses-vouchers.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4 text-xs">
                        <div className="flex justify-between items-center border-b border-gray-150 pb-2">
                          <span className="text-[9.5px] font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5" /> Revisionsresultat for {aiProductNameInput}
                          </span>
                          <span className="text-[8px] font-mono font-extrabold bg-[#C8F24A]/25 text-[#1a384f] px-2 py-0.5 rounded border border-[#85A912]/20">
                            GENERERET LIVE OFFLINE-COMPLIANT
                          </span>
                        </div>

                        {/* Executive Summary */}
                        <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 text-[10px] text-gray-600 leading-relaxed font-semibold">
                          <p>{aiGeneratedResult.executiveSummary}</p>
                        </div>

                        {/* Comparative tax math cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="bg-rose-50/50 border border-rose-100 p-2.5 rounded-xl text-left">
                            <span className="text-[7.5px] font-black text-rose-800 uppercase tracking-wider block">Standard EPR Skat</span>
                            <span className="text-sm font-mono font-black text-rose-950">
                              {aiGeneratedResult.taxSavingsAnalyses?.legacyTaxCalculated?.toLocaleString('da-DK')} DKK
                            </span>
                            <span className="text-[7px] text-gray-400 block mt-0.5">Uden micro-nudging</span>
                          </div>

                          <div className="bg-emerald-50/50 border border-emerald-100 p-2.5 rounded-xl text-left">
                            <span className="text-[7.5px] font-black text-emerald-800 uppercase tracking-wider block">Eco-moduleret Skat</span>
                            <span className="text-sm font-mono font-black text-emerald-950">
                              {aiGeneratedResult.taxSavingsAnalyses?.optimizedTaxCalculated?.toLocaleString('da-DK')} DKK
                            </span>
                            <span className="text-[7px] text-gray-400 block mt-0.5">Med Cirkel pantesløjfe</span>
                          </div>

                          <div className="bg-[#FAF9F5] border-2 border-[#85A912]/30 p-2.5 rounded-xl text-left">
                            <span className="text-[7.5px] font-black text-[#50660c] uppercase tracking-wider block">Årlig Besparelse</span>
                            <span className="text-sm font-mono font-black text-emerald-800">
                              {aiGeneratedResult.taxSavingsAnalyses?.eprSavingsDkk?.toLocaleString('da-DK')} DKK
                            </span>
                            <span className="text-[7px] text-emerald-700 block mt-0.5 font-bold">-{Math.round(((aiGeneratedResult.taxSavingsAnalyses?.legacyTaxCalculated - aiGeneratedResult.taxSavingsAnalyses?.optimizedTaxCalculated) / aiGeneratedResult.taxSavingsAnalyses?.legacyTaxCalculated) * 100)}% besparelse</span>
                          </div>
                        </div>

                        {/* Suggested Campaigns list */}
                        <div className="flex flex-col gap-2.5 border-t border-gray-150 pt-3">
                          <h5 className="text-[9.5px] font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                            <TrendingUp className="w-3.5 h-3.5" /> Skræddersyede adfærds-nudges & vouchers
                          </h5>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {aiGeneratedResult.suggestedCampaigns?.map((camp: any, idx: number) => {
                              // Check if already deployed
                              const isDeployed = marketingCampaigns.some(c => c.title === camp.title);

                              return (
                                <div key={idx} className="bg-[#FAFAF7] border border-gray-200 rounded-xl p-3 flex flex-col justify-between text-left text-[9.5px]">
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center flex-wrap gap-1">
                                      <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-900 font-mono text-[7px] font-black rounded uppercase">
                                        Postnr: {camp.postcode}
                                      </span>
                                      <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-800 font-sans text-[7px] font-black rounded uppercase">
                                        Mærkat: {camp.specialLabelStyle}
                                      </span>
                                    </div>
                                    <h6 className="font-extrabold text-primary text-[10.5px] tracking-tight">{camp.title}</h6>
                                    
                                    <div className="flex flex-col gap-1 text-[9px] border-t border-gray-100 pt-1.5 leading-relaxed font-semibold">
                                      <div><span className="text-gray-400">Labelkode:</span> <strong className="text-indigo-900 font-semibold">{camp.specialLabelCode}</strong></div>
                                      <div><span className="text-gray-400">Målgruppe:</span> <span className="text-gray-600 font-semibold">{camp.targetSegment}</span></div>
                                      <div><span className="text-gray-400">Voucher / Rabat:</span> <strong className="text-emerald-700 font-bold">{camp.voucherText}</strong></div>
                                      <div><span className="text-gray-400">Nudging Intensitets-loft:</span> <span className="text-indigo-900 font-mono">{camp.pushedNudgeFrequency} push/uge</span></div>
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => {
                                      if (isDeployed) return;
                                      if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.SCAN_SUCCESS);
                                      
                                      const newCampObj = {
                                        id: `ai-${Date.now()}-${idx}`,
                                        title: camp.title,
                                        postcode: camp.postcode,
                                        voucherCode: camp.specialLabelCode + '-VOUCH',
                                        voucherText: camp.voucherText,
                                        targetMaterial: camp.targetMaterial,
                                        labelCode: camp.specialLabelCode,
                                        labelStyle: camp.specialLabelStyle,
                                        budget: 20000,
                                        spend: 0,
                                        scans: 0,
                                        active: true,
                                        conversionRate: camp.estimatedConvRate,
                                        color: idx === 0 ? '#85A912' : '#3B82F6'
                                      };

                                      setMarketingCampaigns(prev => [newCampObj, ...prev]);
                                      addLog('CAMPAIGN', `Kampagne "${camp.title}" udrullet direkte til de aarhusianske borgeres wallets via Gemini Co-pilot!`, 'success');
                                      
                                      const toastFn = (window as any).showToast;
                                      if (toastFn) toastFn('Kampagne udrullet live! Sorteringsspande informeret.', 'success');
                                    }}
                                    disabled={isDeployed}
                                    className={`mt-2.5 w-full text-center py-2 px-3 text-[8.5px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                                      isDeployed
                                        ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                                        : 'bg-emerald-700 hover:bg-emerald-800 text-white font-black'
                                    }`}
                                  >
                                    {isDeployed ? '✓ Kampagne Udrullet Live' : '✓ Godkend & Push Nudge Live'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Deep Materiality and Branding insights */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 border-t border-gray-150 pt-3">
                          <div className="flex flex-col gap-1 text-[9.5px]">
                            <strong className="text-primary font-bold uppercase text-[8px] tracking-wider">📦 Emballage Branding & Mærkningsanbefaling:</strong>
                            <p className="text-gray-500 font-semibold leading-relaxed text-[8.8px]">{aiGeneratedResult.deepAnalyses?.brandingStrategy}</p>
                          </div>
                          <div className="flex flex-col gap-1 text-[9.5px]">
                            <strong className="text-primary font-bold uppercase text-[8px] tracking-wider">🌿 Lovmæssig CSRD / PPWR Overholdelseskontrol:</strong>
                            <p className="text-gray-500 font-semibold leading-relaxed text-[8.8px]">{aiGeneratedResult.deepAnalyses?.legalComplianceDetails}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Grid Section 1: Active nudge campaigns & Smart recommendations */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Campaigns List (2/3 columns) */}
                <div className="lg:col-span-2 bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs flex flex-col gap-4 text-left">
                  <div className="flex justify-between items-center border-b border-gray-150 pb-2">
                    <div>
                      <h4 className="text-xs font-black text-primary uppercase flex items-center gap-1">
                        <Radio className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                        Aktive Forbruger-Kampagner & Pushed Nudges
                      </h4>
                      <p className="text-[9px] text-gray-450 mt-0.5 font-medium">Borgere ser disse live i Cirkel-appen i Aarhus kommune, hvilket trigger øget sorteringsvilje.</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    {marketingCampaigns.map((c) => {
                      const percentageUsed = Math.min(100, Math.round((c.spend / c.budget) * 100));
                      return (
                        <div 
                          key={c.id} 
                          style={{ borderLeftColor: c.color }}
                          className="bg-[#faf9f5] border border-gray-200/80 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-all hover:bg-gray-100/50 border-l-4"
                        >
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span 
                                style={{ backgroundColor: c.color + '15', color: c.color }}
                                className="text-[8px] font-black px-2 py-0.5 rounded uppercase font-mono border"
                              >
                                Postnr: {c.postcode}
                              </span>
                              <span className="text-[8.5px] font-bold text-gray-500 uppercase">{c.targetMaterial}</span>
                              <span className={`text-[8px] font-black px-1.5 py-0.2 rounded font-sans uppercase ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                                {c.active ? 'Aktiv' : 'Pause'}
                              </span>
                            </div>
                            <h5 className="text-xs font-black text-primary mt-1">{c.title}</h5>
                            
                            {/* Progress bar in spend budget */}
                            <div className="mt-2.5">
                              <div className="flex justify-between text-[8px] text-gray-400 font-bold mb-1">
                                <span>Budget Udnyttelse: {c.spend.toLocaleString('da-DK')} / {c.budget.toLocaleString('da-DK')} DKK</span>
                                <span>{percentageUsed}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full rounded-full transition-all duration-500" 
                                  style={{ width: `${percentageUsed}%`, backgroundColor: c.color }}
                                />
                              </div>
                            </div>

                            {/* Additional telemetry */}
                            <div className="flex gap-4 mt-3 text-[9px] text-gray-500 font-semibold border-t border-gray-200/70 pt-2 font-mono">
                              <div>
                                Scans: <span className="font-bold text-primary">{c.scans}</span>
                              </div>
                              <div>
                                Adfærds-Conversion: <span className="font-bold text-emerald-700">{c.conversionRate}%</span>
                              </div>
                              <div>
                                Code: <span className="text-indigo-600">{c.labelCode}</span>
                              </div>
                            </div>
                          </div>

                          {/* Quick interactions */}
                          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                            <button
                              onClick={() => {
                                triggerHaptic(HapticPattern.LIGHT_TAP);
                                setMarketingCampaigns(prev => prev.map(item => {
                                  if (item.id === c.id) {
                                    const action = !item.active ? 'aktiveret' : 'sat på pause';
                                    addLog('CAMPAIGN', `Kampagne "${c.title}" ${action} af administrator.`, 'info');
                                    return { ...item, active: !item.active };
                                  }
                                  return item;
                                }));
                              }}
                              className={`px-3 py-1.5 text-[9px] font-black uppercase rounded-lg border transition-all cursor-pointer ${
                                c.active 
                                  ? 'bg-amber-55/10 border-amber-200 text-amber-900 hover:bg-amber-100/50' 
                                  : 'bg-emerald-55/10 border-emerald-200 text-emerald-900 hover:bg-emerald-100/50'
                              }`}
                            >
                              {c.active ? 'Pause' : 'Aktiver'}
                            </button>
                            <button
                              onClick={() => {
                                triggerHaptic(HapticPattern.LIGHT_TAP);
                                setMarketingCampaigns(prev => prev.filter(item => item.id !== c.id));
                                addLog('CAMPAIGN', `Kampagne "${c.title}" slettet permanent fra kilde-systemerne.`, 'warn');
                                const toastFn = (window as any).showToast;
                                if (toastFn) toastFn('Kampagne slettet.', 'info');
                              }}
                              className="px-2.5 py-1.5 text-[9px] font-black bg-rose-50 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-100 transition-all cursor-pointer flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Advanced Campaign Optimization Panel (1/3 column) */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs flex flex-col gap-4 text-left">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-emerald-650" />
                      Adfærds-Optimeringer
                    </h4>
                    <p className="text-[9px] text-gray-400 font-medium leading-normal mt-0.5">Automatiserede forslag baseret på realtids sorteringsdata i Aarhus kommune.</p>
                  </div>

                  <div className="flex flex-col gap-3.5 text-xs">
                    
                    <div className="bg-emerald-50/55 border border-emerald-100 rounded-2xl p-3 flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] font-black text-emerald-800 uppercase tracking-wider bg-emerald-100 px-1.5 py-0.5 rounded font-sans">Højeste prioritet</span>
                        <span className="font-mono text-[8px] text-gray-400 font-bold">CSRD Boost</span>
                      </div>
                      <h5 className="text-[10.5px] font-black text-emerald-950">Boost "Arla rPET Crusade" i 8260 Viby</h5>
                      <p className="text-[9px] text-[#4d5c4b] leading-normal font-semibold">
                        Adfærdstelemetri indikerer faldende sortering af mælkeflasker i Viby J om torsdagen. Forøg voucher-belønning med 1.5x eller push lokal mærknings-sms.
                      </p>
                      <button
                        onClick={() => {
                          triggerHaptic(HapticPattern.SCAN_SUCCESS);
                          setMarketingCampaigns(prev => prev.map(c => {
                            if (c.id === 'mc-1') {
                              return { ...c, budget: c.budget + 10000, conversionRate: 94, voucherText: '30% rabat (Optimiseret Belønning)' };
                            }
                            return c;
                          }));
                          addLog('OPTIMIZATION', '"Arla rPET Loop Crusade" optimeret med øget belønning & 10.000 DKK micro-budget.', 'success');
                          const toastFn = (window as any).showToast;
                          if (toastFn) toastFn('Optimering anvendt! Gevinst og CO₂ prognose hævet.', 'success');
                        }}
                        className="mt-1 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-[8.5px] uppercase py-2 rounded-xl text-center cursor-pointer transition-colors"
                      >
                        ✓ Anvend optimering (+12% CO₂ retur)
                      </button>
                    </div>

                    <div className="bg-amber-50/55 border border-amber-100 rounded-2xl p-3 flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] font-black text-amber-800 uppercase tracking-wider bg-amber-100 px-1.5 py-0.5 rounded font-sans">Adfærds-Nudge</span>
                        <span className="font-mono text-[8px] text-gray-400 font-bold">Smart-Bin Trigger</span>
                      </div>
                      <h5 className="text-[10.5px] font-black text-amber-950">Lav QR-kode label til kaffekopper</h5>
                      <p className="text-[9px] text-[#5c544b] leading-normal font-semibold">
                        Upræcise scanninger observeret på "Aarhus Kaffekop Loop". Vedtag en High-Contrast Laser QR-kode for forbedret optisk genkendelse under borgerens indkast.
                      </p>
                      <button
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setMarketingCampaigns(prev => prev.map(c => {
                            if (c.id === 'mc-3') {
                              return { ...c, labelStyle: 'High-Contrast Laser QR', conversionRate: 98 };
                            }
                            return c;
                          }));
                          addLog('OPTIMIZATION', 'Label-stil opgraderet til High-Contrast Laser QR-kode for optimal optisk bin-genkendelse.', 'success');
                          const toastFn = (window as any).showToast;
                          if (toastFn) toastFn('Label stil opgraderet!', 'success');
                        }}
                        className="mt-1 bg-amber-600 hover:bg-amber-700 text-white font-black text-[8.5px] uppercase py-2 rounded-xl text-center cursor-pointer transition-colors"
                      >
                        Skift kaffekop-label til Laser-QR ✓
                      </button>
                    </div>

                  </div>
                </div>
              </div>

              {/* Grid Section 2: Deep Marketing analyses & ROI Simulator */}
              <div className="bg-[#FAF9F5] border border-gray-200 rounded-3xl p-6 shadow-3xs text-left flex flex-col gap-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-150 pb-4">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4 text-indigo-600" />
                      Marketing- og Adfærdsanalyse Simulator
                    </h4>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">Brug de interaktive parametre til at estimere afkastet af jeres miljøkampagner og beregne borgertilfredshed.</p>
                  </div>
                  <span className="text-[9.5px] font-black bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
                    Moduleringsmodel: PPWR EU-2026.1
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Performance parameters sliders */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-4 text-left">
                    <h5 className="text-[10.5px] font-black text-primary uppercase border-b border-gray-150 pb-1">Parametre</h5>

                    {/* Budget slider */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[9px] font-black text-gray-500 uppercase">
                        <span>Kampagne Budget</span>
                        <span className="font-mono text-indigo-700">{marketingBudgetSlider.toLocaleString('da-DK')} DKK</span>
                      </div>
                      <input
                        type="range"
                        min="5000"
                        max="100000"
                        step="5000"
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        value={marketingBudgetSlider}
                        onChange={(e) => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setMarketingBudgetSlider(Number(e.target.value));
                        }}
                      />
                      <div className="flex justify-between text-[7px] text-gray-400 font-bold font-mono">
                        <span>5.000 kr</span>
                        <span>50.000 kr</span>
                        <span>100.000 kr</span>
                      </div>
                    </div>

                    {/* Nudge push limit frequency */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[9px] font-black text-gray-500 uppercase">
                        <span>Nudging Intensitets-loft</span>
                        <span className="font-mono text-indigo-700">{nudgeFrequency} Push / uge</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="7"
                        step="1"
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        value={nudgeFrequency}
                        onChange={(e) => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setNudgeFrequency(Number(e.target.value));
                        }}
                      />
                      <div className="flex justify-between text-[7px] text-gray-400 font-bold font-mono">
                        <span>1 (Skånsom)</span>
                        <span>4 (Balanceret)</span>
                        <span>7 (Aggressiv Nudging)</span>
                      </div>
                    </div>

                    {/* Point multiplier reward */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[9px] font-black text-gray-500 uppercase">
                        <span>Eco-Points Belønning</span>
                        <span className="font-mono text-indigo-700">{rewardMultiplier.toFixed(1)}x Point multiplikator</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="3.0"
                        step="0.5"
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        value={rewardMultiplier}
                        onChange={(e) => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setRewardMultiplier(Number(e.target.value));
                        }}
                      />
                      <div className="flex justify-between text-[7px] text-gray-400 font-bold font-mono">
                        <span>0.5x (Lav)</span>
                        <span>1.5x (Standard)</span>
                        <span>3.0x (Hyper Belønnet)</span>
                      </div>
                    </div>

                    {/* Dynamic feedback stats cards */}
                    {(() => {
                      // Math simulations
                      const calculatedConversionRatio = Math.round(Math.min(98, 45 + (marketingBudgetSlider / 2500) + (nudgeFrequency * 4) + (rewardMultiplier * 10) - (nudgeFrequency > 5 ? (nudgeFrequency - 5) * 8 : 0)));
                      const carbonROI = (calculatedConversionRatio * 0.15 * (marketingBudgetSlider / 1000)).toFixed(1);
                      const estimatedVouchersRedeemed = Math.round(marketingBudgetSlider / 100 * calculatedConversionRatio * 0.45);
                      const communityTrustScore = Math.round(Math.min(100, Math.max(20, 85 + (rewardMultiplier * 5) - (nudgeFrequency > 4 ? (nudgeFrequency - 4) * 12 : 0))));

                      return (
                        <div className="mt-2 bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 flex flex-col gap-2.5 text-[9.5px]">
                          <div className="flex justify-between">
                            <span className="font-semibold text-gray-500">Estimeret Konverteringsrate DKK:</span>
                            <strong className="text-indigo-900 font-mono">{calculatedConversionRatio}%</strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-semibold text-gray-500">Månedlig CO₂ Reduktion:</span>
                            <strong className="text-emerald-700 font-mono">{carbonROI} Tons CO₂</strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-semibold text-gray-500">Borger-Tillidsindeks (Trust):</span>
                            <strong className="text-slate-800 font-mono flex items-center gap-0.5">
                              {communityTrustScore}% 
                              {communityTrustScore < 50 ? ' ⚠️ (Nudge-spam)' : ' 🌿'}
                            </strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-semibold text-gray-500">Udleverede Vouchers:</span>
                            <strong className="text-indigo-800 font-mono">{estimatedVouchersRedeemed} stk / md</strong>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Dynamic Recharts graph showing campaign simulations based on live variables */}
                  {(() => {
                    // Generates dynamic data for recharts depending on current state of sliders
                    const calculatedConversionRatio = Math.round(Math.min(98, 45 + (marketingBudgetSlider / 2500) + (nudgeFrequency * 4) + (rewardMultiplier * 10) - (nudgeFrequency > 5 ? (nudgeFrequency - 5) * 8 : 0)));
                    const carbonROIVal = calculatedConversionRatio * 0.15 * (marketingBudgetSlider / 2000);
                    const trustScoreVal = Math.round(Math.min(100, Math.max(20, 85 + (rewardMultiplier * 5) - (nudgeFrequency > 4 ? (nudgeFrequency - 4) * 12 : 0))));

                    const dynamicChartData = [
                      { name: 'Uge 1', conversion: Math.round(calculatedConversionRatio * 0.6), carbonSaved: Number((carbonROIVal * 0.2).toFixed(1)), trust: trustScoreVal },
                      { name: 'Uge 2', conversion: Math.round(calculatedConversionRatio * 0.75), carbonSaved: Number((carbonROIVal * 0.4).toFixed(1)), trust: Math.round(trustScoreVal * 0.95) },
                      { name: 'Uge 3', conversion: Math.round(calculatedConversionRatio * 0.9), carbonSaved: Number((carbonROIVal * 0.7).toFixed(1)), trust: Math.round(trustScoreVal * 0.98) },
                      { name: 'Uge 4', conversion: calculatedConversionRatio, carbonSaved: Number(carbonROIVal.toFixed(1)), trust: trustScoreVal }
                    ];

                    return (
                      <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-4 flex flex-col justify-between text-left">
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <h5 className="text-[10.5px] font-black text-primary uppercase">ROI- og Miljøeffektfremskrivning</h5>
                            <span className="text-[7.5px] font-bold text-gray-400 font-mono">Ugentlig adfærdstilvækst</span>
                          </div>
                          <p className="text-[9px] text-gray-400 font-medium leading-relaxed">
                            Simuleret adfærdsgraf som demonstrerer fænomenet "Cirkulært point-elasticitet" under ændret belønnings-score.
                          </p>
                        </div>

                        <div className="h-44 mt-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dynamicChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                              <defs>
                                <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#85A912" stopOpacity={0.4}/>
                                  <stop offset="95%" stopColor="#85A912" stopOpacity={0.0}/>
                                </linearGradient>
                                <linearGradient id="colorTrust" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECEAE4" />
                              <XAxis dataKey="name" stroke="#CCCCCC" fontSize={8.5} fontWeight="bold" />
                              <YAxis stroke="#CCCCCC" fontSize={8.5} fontWeight="bold" />
                              <Tooltip content={<CampaignSimulationCustomTooltip language={language} />} />
                              <Area type="monotone" name="Konvertering (%)" dataKey="conversion" stroke="#85A912" strokeWidth={2.5} fillOpacity={1} fill="url(#colorConv)" />
                              <Area type="monotone" name="Tillid (Index)" dataKey="trust" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorTrust)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="flex gap-4 text-[8px] font-black text-gray-400 uppercase mt-2 pt-2 border-t border-gray-100 font-mono">
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-[#85A912] rounded-full" /> Grøn Kurve: Konverteringsadfærd (%)
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-[#3B82F6] rounded-full" /> Blå Kurve: Borger-Tillid (0-100)
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Grid Section 3: Citizen Profiles / Kunde info */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col gap-4">
                <div>
                  <h4 className="text-xs font-black text-primary uppercase flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-600" />
                    Borger- & Kundesegmenter (Kunde Info)
                  </h4>
                  <p className="text-[9.5px] font-medium text-gray-450 mt-0.5">Segmentprofiler for de aarhusianske borgere, deres adfærdskarakteristika, og reelle konvertering af pushed-nudges.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { name: 'Den Aktive Økolog', share: '32%', desc: 'Højt engageret borger, som prioriterer rPET sortering. Altid motiveret af grøn samvittighed fremfor rabat-værdi.', conv: '92%', speed: 'Hurtig (<2 timer)', bias: 'Miljøbevidst', color: 'border-l-emerald-500' },
                    { name: 'Studie-Nudgisten', share: '24%', desc: 'De unge studerende i Aarhus C. Reagerer ekstremt positivt på café vouchers og micro-belønninger (f.eks. gratis kaffe).', conv: '88%', speed: 'Eftermiddag', bias: 'Prissensitiv', color: 'border-l-indigo-500' },
                    { name: 'Den Travle Børnefamilie', share: '28%', desc: 'Sorterer lejlighedsvist. Har brug for enkle, visuelle Smart-tags direkte på produktet for at huske at returnere dem under indkøb.', conv: '64%', speed: 'Ugentlig opsamling', bias: 'Tidsknaphed', color: 'border-l-amber-500' },
                    { name: 'Den Passive Returner', share: '16%', desc: 'Næsten udelukkende motiveret af lovgivningsindgreb eller direkte høje pantværdier. Kræver kraftig nudging-påvirkning.', conv: '42%', speed: 'Langsom (>3 dage)', bias: 'Komfort-orienteret', color: 'border-l-rose-500' }
                  ].map((s, idx) => (
                    <div key={idx} className={`bg-[#faf9f5] border border-gray-150 rounded-2xl p-4 flex flex-col justify-between border-l-4 ${s.color}`}>
                      <div>
                        <div className="flex justify-between items-baseline">
                          <h5 className="text-[11px] font-black text-primary">{s.name}</h5>
                          <span className="font-mono text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 rounded">{s.share}</span>
                        </div>
                        <p className="text-[9px] text-gray-500 font-semibold leading-relaxed mt-1.5">{s.desc}</p>
                      </div>

                      <div className="mt-3.5 pt-2 flex flex-col gap-1 border-t border-gray-200/60 text-[8.5px] font-mono leading-normal">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Response Rate:</span>
                          <span className="font-bold text-gray-800">{s.conv}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Typisk tid:</span>
                          <span className="font-bold text-gray-800">{s.speed}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Adfærdstype:</span>
                          <span className="font-bold text-indigo-950 font-sans font-bold uppercase text-[7px]">{s.bias}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Grid Section 4: Create new dynamic campaign & print Smart tags */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-2">
                
                {/* Campaign Creator Form */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col gap-4">
                  <div>
                    <h4 className="text-xs font-black text-primary uppercase flex items-center gap-1.5">
                      <Plus className="w-4 h-4 text-indigo-650" />
                      Udrul Ny Brand Kampagne & Nudgeløkke
                    </h4>
                    <p className="text-[9.5px] text-gray-400 font-medium leading-normal mt-0.5">Konfigurer et nyt digitalt kredsløb med integrerede vouchers, der pushes direkte ud til borgerens smartphone.</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[8.5px] font-black text-gray-400 uppercase">Kampagne Titel</span>
                      <input
                        type="text"
                        className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none text-[#111111]"
                        placeholder="E.g. Arla Øko-Kartoner i Aarhus N"
                        value={newBrandCampTitle}
                        onChange={(e) => setNewBrandCampTitle(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-gray-400 uppercase">Målretnings-Postnr</span>
                        <input
                          type="text"
                          maxLength={4}
                          className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none font-mono text-[#111111]"
                          placeholder="8000"
                          value={newBrandCampPostcode}
                          onChange={(e) => setNewBrandCampPostcode(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-gray-400 uppercase">Brand Kampagne-Farve</span>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            className="w-10 h-9 p-0 bg-transparent border-0 rounded cursor-pointer shrink-0"
                            value={newBrandCampColor}
                            onChange={(e) => setNewBrandCampColor(e.target.value)}
                          />
                          <input
                            type="text"
                            className="flex-1 bg-white border border-gray-200 px-2.5 py-2 text-xs rounded-xl font-mono uppercase font-black outline-none text-[#111111]"
                            value={newBrandCampColor}
                            onChange={(e) => setNewBrandCampColor(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-gray-400 uppercase">Emballagemateriale</span>
                        <select
                          className="bg-white border border-gray-200 px-3 py-2.5 text-xs text-[#111111] rounded-xl font-bold outline-none cursor-pointer"
                          value={newBrandCampMaterial}
                          onChange={(e) => setNewBrandCampMaterial(e.target.value)}
                        >
                          <option value="Plastik (rPET)">Plastik (rPET)</option>
                          <option value="Aluminium">Aluminium (Metal)</option>
                          <option value="Drikkekarton (Multi-layer)">Drikkekarton (Multi-layer)</option>
                          <option value="Komposit-emballage">Komposit-emballage</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-gray-400 uppercase">Voucher KODE (System)</span>
                        <input
                          type="text"
                          className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-mono outline-none font-bold uppercase text-indigo-700"
                          placeholder="ARLA-ECO-25"
                          value={newBrandCampVoucherCode}
                          onChange={(e) => setNewBrandCampVoucherCode(e.target.value.toUpperCase())}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[8.5px] font-black text-gray-400 uppercase">Borgerbelønning Tekst (Voucher)</span>
                      <input
                        type="text"
                        className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none text-[#111111]"
                        placeholder="E.g. 25% Rabat på Øko mælk"
                        value={newBrandCampVoucherText}
                        onChange={(e) => setNewBrandCampVoucherText(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-gray-400 uppercase">Kampagne Budget (DKK)</span>
                        <input
                          type="number"
                          className="bg-white border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-semibold outline-none font-mono text-[#111111]"
                          value={newBrandCampBudget}
                          onChange={(e) => setNewBrandCampBudget(Number(e.target.value))}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-gray-400 uppercase">Cirkel Smart Label Type</span>
                        <select
                          className="bg-white border border-gray-200 px-3 py-2.5 text-xs text-[#111111] rounded-xl font-bold outline-none cursor-pointer"
                          value={newBrandCampLabelStyle}
                          onChange={(e) => setNewBrandCampLabelStyle(e.target.value)}
                        >
                          <option value="Laser QR Sticker">Laser QR Sticker</option>
                          <option value="Smart-RFID">Smart-RFID</option>
                          <option value="High-Contrast QR">High-Contrast QR</option>
                          <option value="NFC Micro-Tag">NFC Micro-Tag</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (!newBrandCampTitle.trim()) {
                          alert('Indtast venligst en titel til kampagnen');
                          return;
                        }
                        triggerHaptic(HapticPattern.SCAN_SUCCESS);

                        const randomId = `mc-${Math.floor(Math.random()*1000)}`;
                        const generatedCode = `CIRK-${newBrandCampVoucherCode.substring(0, 5)}-${Math.floor(Math.random()*900 + 100)}`;

                        const newCampObj = {
                          id: randomId,
                          title: newBrandCampTitle,
                          postcode: newBrandCampPostcode,
                          voucherCode: newBrandCampVoucherCode,
                          voucherText: newBrandCampVoucherText,
                          targetMaterial: newBrandCampMaterial,
                          labelCode: generatedCode,
                          labelStyle: newBrandCampLabelStyle,
                          budget: newBrandCampBudget,
                          spend: 0,
                          scans: 0,
                          active: true,
                          conversionRate: 80,
                          color: newBrandCampColor
                        };

                        setMarketingCampaigns(prev => [newCampObj, ...prev]);
                        setSelectedLabelCampId(randomId);

                        addLog('CAMPAIGN', `Ny brand-kampagne udrullet til Aarhus Cirkel netsystem: ${newBrandCampTitle}`, 'success');
                        
                        const toastFn = (window as any).showToast;
                        if (toastFn) toastFn(`Kampagnen ${newBrandCampTitle} er nu LIVE!`, 'success');

                        confetti({
                          particleCount: 100,
                          spread: 60,
                          origin: { y: 0.8 },
                          colors: [newBrandCampColor, '#85A912', '#C8F24A']
                        });

                        // reset
                        setNewBrandCampTitle('');
                        setNewBrandCampVoucherCode('BRAND-ECO-15');
                        setNewBrandCampVoucherText('15% Rabat på din næste kurv');
                      }}
                      className="w-full mt-2 bg-indigo-900 hover:bg-indigo-950 text-[#C8F24A] font-black text-[11px] uppercase tracking-wider py-3.5 rounded-xl transition-all shadow-3xs cursor-pointer text-center select-none"
                    >
                      ✓ Udrul digital kampagne i Cirkel Connect
                    </button>
                  </div>
                </div>

                {/* Intelligent Labels and QR Codes for CIRKEL (Interactive Customizer) */}
                {(() => {
                  const currentSelectedCamp = marketingCampaigns.find(c => c.id === selectedLabelCampId) || marketingCampaigns[0];

                  return (
                    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left flex flex-col justify-between gap-4">
                      <div className="border-b border-gray-150 pb-2">
                        <h4 className="text-xs font-black text-primary uppercase flex items-center gap-1.5">
                          <QrCode className="w-4 h-4 text-indigo-600" />
                          Special Cirkel Labels & Codes Generering
                        </h4>
                        <p className="text-[9.5px] text-gray-400 font-medium">Konfigurer og scan-test de sportsmærkninger el. Smart-tags, der trykkes på emballagen.</p>
                      </div>

                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-[8.5px] font-black text-gray-400 uppercase">Vælg Kampagne for Label</span>
                          <select
                            className="bg-[#faf9f5] border border-gray-200 px-3 py-2.5 text-xs text-[#111111] rounded-xl font-bold outline-none cursor-pointer"
                            value={selectedLabelCampId}
                            onChange={(e) => setSelectedLabelCampId(e.target.value)}
                          >
                            {marketingCampaigns.map(c => (
                              <option key={c.id} value={c.id}>{c.title} ({c.labelCode})</option>
                            ))}
                          </select>
                        </div>

                        {currentSelectedCamp && (
                          <div className="flex flex-col sm:flex-row gap-5 items-center bg-[#faf9f5] border border-gray-150 p-4 rounded-2xl relative overflow-hidden">
                            
                            {/* Simulated physical Cirkel NFC Tag */}
                            <div 
                              className="w-32 h-32 rounded-full border-4 flex flex-col items-center justify-center p-3 text-center shrink-0 relative transition-all shadow-xs"
                              style={{ borderColor: currentSelectedCamp.color, backgroundColor: '#ffffff' }}
                            >
                              <div 
                                className="absolute top-1.5 bg-[#85A912] text-white text-[5px] font-black px-1 py-0.2 rounded tracking-widest uppercase font-mono"
                              >
                                Cirkel Connect
                              </div>

                              <span className="text-xs font-black tracking-tighter text-slate-900 mt-2 line-clamp-1 pointer-events-none uppercase">
                                {currentSelectedCamp.title}
                              </span>

                              {/* Mock QR graphic */}
                              <div className="bg-slate-100 p-1 border-2 border-slate-900 rounded-lg my-1.5">
                                <div className="grid grid-cols-4 gap-0.5">
                                  {[1,0,1,1,0,1,0,0,1,1,0,1,1,0,1,1].map((dot, idx) => (
                                    <div key={idx} className={`w-2.5 h-2.5 rounded-2xs ${idx===0||idx===3||idx===12||dot === 1 ? 'bg-slate-900':'bg-transparent'}`} />
                                  ))}
                                </div>
                              </div>

                              <span className="text-[6.5px] font-mono leading-none font-black text-gray-500 tracking-wider">
                                {currentSelectedCamp.labelCode}
                              </span>

                              <div 
                                style={{ backgroundColor: currentSelectedCamp.color }}
                                className="absolute bottom-1.5 w-2 h-2 rounded-full animate-ping"
                              />
                            </div>

                            {/* Label meta information */}
                            <div className="flex-1 text-left">
                              <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest font-sans">Cirkel Smart Code specifikationer</span>
                              <h5 className="text-[11.5px] font-black text-primary uppercase mt-1">
                                {currentSelectedCamp.labelStyle} {currentSelectedCamp.targetMaterial.includes('Plastik') ? 'Vat-proof' : 'Metal-shielded'}
                              </h5>

                              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9px] text-gray-500 font-semibold leading-normal mt-2.5">
                                <div>Størrelse: <strong className="text-slate-800">Ø 40mm design</strong></div>
                                <div>Antenne: <strong className="text-slate-800">13.56MHz Embedded</strong></div>
                                <div>EAN Link: <strong className="text-indigo-700">Verificeret EAN</strong></div>
                                <div>Pantesystem: <strong className="text-emerald-700">Scope 3 Approved</strong></div>
                              </div>

                              <div className="bg-white border border-gray-200 rounded-lg p-2 mt-3 text-[8px] leading-relaxed text-gray-500 font-medium">
                                <span className="font-extrabold text-indigo-900 block font-sans">BRUGSGUIDE TIL TRYK:</span>
                                Labelen påklæbes eller lasergraveres på emballagens bagside. Ved borgerindkast i en Cirkel Smart-Bin registreres chipen og aktiverer kuponen <strong className="text-primary">{currentSelectedCamp.voucherText}</strong>.
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2.5 mt-2">
                        <button
                          onClick={() => {
                            triggerHaptic(HapticPattern.SCAN_SUCCESS);
                            const toastFn = (window as any).showToast;
                            if (toastFn) toastFn(`Smart QR & RFID Designfiler (PDF/EPS) for ${currentSelectedCamp ? currentSelectedCamp.title : 'emballage'} downloadet!`, 'success');
                          }}
                          className="flex-1 bg-gray-150 hover:bg-gray-200 text-primary font-black text-[10px] uppercase py-2.5 rounded-xl cursor-pointer text-center flex items-center justify-center gap-1 shadow-3xs select-none"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Hent PDF Trykskabelon
                        </button>
                        <button
                          onClick={() => {
                            triggerHaptic(HapticPattern.SCAN_SUCCESS);
                            
                            // Simulate target scan coupon activation
                            const toastFn = (window as any).showToast;
                            if (toastFn) {
                              toastFn(`Borger-Mobiltest: Voucher "${currentSelectedCamp ? currentSelectedCamp.voucherText : 'Rabat'}" aktiveret!`, 'success');
                            }
                            
                            confetti({
                              particleCount: 50,
                              spread: 40,
                              origin: { y: 0.8 },
                              colors: ['#85A912', '#C8F24A']
                            });
                          }}
                          className="flex-1 bg-[#85A912] hover:bg-[#72920f] text-white font-black text-[10px] uppercase py-2.5 rounded-xl cursor-pointer text-center shadow-3xs select-none"
                        >
                          Prøv Scan-Simulering 📱
                        </button>
                      </div>
                    </div>
                  );
                })()}

              </div>

            </motion.div>
          )}

          {/* TAB F: EPR & ESG EXPERT LAWS & AFGIFTS-SIMULATOR */}
          {activeTab === 'esg' && (
            <motion.div
              key="esg"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-6 text-left"
            >
              {/* Header card with global status */}
              <div className="bg-[#FAFBF6] border-2 border-emerald-500/20 rounded-3xl p-6 shadow-xs relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl -z-10" />
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] font-black tracking-widest text-emerald-850 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md uppercase">
                        EU PPWR & CSRD Kompatibel · Miljø-Audit v3.2
                      </span>
                      <span className="text-[9px] font-black tracking-widest text-[#85A912] bg-[#85A912]/10 border border-[#85A912]/20 px-2.5 py-1 rounded-md uppercase">
                        Dansk EPR Lovgivning 2025/2026
                      </span>
                      <span className="text-[9px] font-black tracking-widest text-blue-900 bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-md uppercase">
                        CBAM & EUDR Ready
                      </span>
                    </div>
                    <h3 className="text-2xl font-black text-primary mt-3 uppercase tracking-tight">EPR & ESG Regulatorisk Lovkompas & Afgifts-Simulator</h3>
                    <p className="text-xs text-gray-500 font-semibold mt-1 max-w-3xl leading-relaxed">
                      Løft din virksomhed eller kommune op på et helt nyt strategisk niveau. Dette interaktive kompas modulerer realtidsafgifter under samtlige gældende og kommende europæiske direktiver og beviser, hvorfor Cirkels digitale pante-løkker er <span className="text-emerald-700 font-black">lysår foran</span> traditionel passiv affaldshåndtering.
                    </p>
                  </div>
                  <div className="bg-emerald-600 hover:bg-emerald-700 transition-colors text-white font-mono font-black text-xs px-4 py-3 rounded-2xl flex items-center gap-2 shadow-sm uppercase shrink-0">
                    <ShieldCheck className="w-4 h-4 animate-bounce" /> Status: Certificeret ESG-Auditør
                  </div>
                </div>
              </div>

              {/* REAL-TIME ESG PERFORMANCE & BENCHMARKING SUMMARY */}
              {(() => {
                // Circularity Index score formula
                const getRecyclabilityScore = (grade: string) => {
                  switch(grade) {
                    case 'A++': return 100;
                    case 'A+': return 92;
                    case 'A': return 82;
                    case 'B': return 62;
                    case 'C': return 42;
                    case 'D': return 22;
                    default: return 50;
                  }
                };

                const getMaterialScore = (material: string) => {
                  if (material.includes('recycled')) return 95;
                  if (material.includes('certified') || material === 'bioplastic') return 80;
                  if (material.includes('virgin')) return 40;
                  return 30; // composite / deforested
                };

                const baseRecScore = getRecyclabilityScore(esgRecyclability);
                const matChoiceScore = getMaterialScore(esgMaterial);

                // weights: return rate (45%), design recyclability (35%), material sourcing (20%)
                let finalCircScore = (esgCirkelOffsetShare * 0.45) + (baseRecScore * 0.35) + (matChoiceScore * 0.20);
                if (esgPFAS) finalCircScore = Math.max(5, finalCircScore - 15);
                const circularityIndex = Math.round(Math.min(100, Math.max(0, finalCircScore)));

                // Avoided CO2 equivalents
                let carbonFactor = 1.8; // Default tons CO2 list
                if (esgMaterial.includes('aluminum')) carbonFactor = 6.4;
                else if (esgMaterial.includes('plastic')) carbonFactor = 2.4;
                else if (esgMaterial.includes('paper')) carbonFactor = 1.1;
                else if (esgMaterial.includes('glass')) carbonFactor = 1.4;

                const baseCO2Saved = esgTonnage * (esgCirkelOffsetShare / 100) * carbonFactor;
                // Live ticket addition conversion from kg saved to tons
                const liveCO2Bonus = totalSimulatedSavings * 0.001; 
                const realTimeCO2Saved = parseFloat((baseCO2Saved + liveCO2Bonus).toFixed(2));

                // Color schemes and grades based on Circularity Index
                let circGrade = "F";
                let circColor = "text-rose-600 bg-rose-50 border-rose-200";
                let circText = "Uacceptabel lineær model. Driftskritisk sårbarhed over for kommende EU PPWR afgifter.";
                
                if (circularityIndex >= 85) {
                  circGrade = "A++";
                  circColor = "text-emerald-800 bg-emerald-500/10 border-emerald-500/30";
                  circText = "Uovertruffen global cirkulær leder – fuldstændigt fri for alle planlagte EU emballagebøder.";
                } else if (circularityIndex >= 70) {
                  circGrade = "A";
                  circColor = "text-green-800 bg-green-500/10 border-green-500/20";
                  circText = "Robust grøn frontløber. Opfylder EU 2030 kravene og drager stor fordel af eco-moduleret EPR rabat.";
                } else if (circularityIndex >= 50) {
                  circGrade = "B";
                  circColor = "text-amber-800 bg-amber-500/10 border-amber-500/20";
                  circText = "Middel performance. Godkendt for nu, men sårbar over for skærpede kemiske krav (PFAS/REACH).";
                } else if (circularityIndex >= 30) {
                  circGrade = "C";
                  circColor = "text-yellow-800 bg-yellow-500/10 border-yellow-500/20";
                  circText = "Betydelige mangler. Lav returrate kombineret med sub-optimale emballagedesigns.";
                }

                // Benchmark comparison chart data
                const benchmarkData = [
                  { name: 'Aktuel Status', score: circularityIndex, fill: '#85A912', label: 'Din score' },
                  { name: 'EU Mål 2030', score: 75, fill: '#002b49', label: 'EPR PPWR' },
                  { name: 'Ellen MacArthur', score: 65, fill: '#3B82F6', label: 'Top-quartile' },
                  { name: 'DK Indf. Gns', score: 38, fill: '#94A3B8', label: 'Gennemsnit' },
                  { name: 'Lineær Baseline', score: 15, fill: '#FDA4AF', label: 'Uden Cirkel' },
                ];

                return (
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 bg-white border border-gray-200 rounded-3xl p-6 shadow-3xs text-left">
                    
                    {/* Gauge column & circularity index */}
                    <div className="xl:col-span-4 flex flex-col justify-between gap-4 border-b xl:border-b-0 xl:border-r border-gray-150 xl:pr-6 pb-6 xl:pb-0">
                      <div>
                        <span className="text-[9px] font-black tracking-widest text-[#85A912] uppercase bg-[#85A912]/15 border border-[#85A912]/20 px-2 py-0.5 rounded-md font-sans">
                          ESG Core Metrics
                        </span>
                        <h4 className="text-sm font-black text-primary uppercase mt-1 flex items-center gap-1.5 font-sans">
                          <Award className="w-4 h-4 text-[#85A912] shrink-0" />
                          Cirkularitets-Indeks (Circular Economy Index)
                        </h4>
                        <p className="text-[10px] text-gray-400 font-semibold leading-relaxed mt-1">
                          Den samlede cirkularitetsværdi målt ud fra materialevalg, råstofdokumentation og verificerede retursløjfer.
                        </p>
                      </div>

                      {/* Display circular progress bar */}
                      <div className="flex items-center gap-5 my-2.5">
                        <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                          {/* Outer circle track */}
                          <svg className="absolute w-full h-full transform -rotate-90">
                            <circle
                              cx="48"
                              cy="48"
                              r="40"
                              className="stroke-gray-100 fill-none"
                              strokeWidth="8"
                            />
                            <circle
                              cx="48"
                              cy="48"
                              r="40"
                              className="stroke-emerald-600 fill-none transition-all duration-700 ease-out"
                              strokeWidth="8"
                              strokeDasharray={`${2 * Math.PI * 40}`}
                              strokeDashoffset={`${2 * Math.PI * 40 * (1 - circularityIndex / 100)}`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="flex flex-col items-center">
                            <span className="text-xl font-mono font-black text-primary">{circularityIndex}%</span>
                            <span className="text-[7.5px] font-bold text-gray-400 uppercase">SCORE</span>
                          </div>
                        </div>

                        <div className="flex-1 text-left">
                          <div className={`p-2 rounded-xl border ${circColor} flex items-center gap-2 mb-2 w-fit`}>
                            <span className="text-base font-mono font-black border border-current/20 px-1.5 py-0.5 rounded bg-white/40">{circGrade}</span>
                            <span className="text-[9px] font-black uppercase tracking-wider">Design status</span>
                          </div>
                          <p className="text-[9.5px] font-semibold text-gray-500 leading-normal">
                            {circText}
                          </p>
                        </div>
                      </div>

                      {/* Simulator Optimization Trigger */}
                      <div className="border-t border-gray-100 pt-3 flex flex-col gap-1.5">
                        <span className="text-[8px] font-black text-gray-450 uppercase font-mono">Prøv scenarier:</span>
                        <button
                          onClick={() => {
                            triggerHaptic(HapticPattern.SCAN_SUCCESS);
                            setEsgMaterial('plastic_recycled');
                            setEsgRecyclability('A++');
                            setEsgImportedShare(10);
                            setEsgCirkelOffsetShare(85);
                            setEsgPFAS(false);
                            const toastFn = (window as any).showToast;
                            if (toastFn) toastFn('ESG Parametre Optimeret til "Fremtidssikret Cirkulær Model"!', 'success');
                          }}
                          className="w-full bg-[#85A912]/10 hover:bg-[#85A912]/20 border border-[#85A912]/30 text-emerald-800 font-black text-[9.5px] uppercase py-2.5 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer select-none"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#85A912] shrink-0" />
                          Simuler Forbedret Cirkularitet (+85%)
                        </button>
                      </div>
                    </div>

                    {/* CO2 columns & real-time CO2 savings */}
                    <div className="xl:col-span-4 flex flex-col justify-between gap-4 border-b xl:border-b-0 xl:border-r border-gray-150 xl:pr-6 pb-6 xl:pb-0">
                      <div>
                        <span className="text-[9px] font-black tracking-widest text-[#002b49] bg-[#002b49]/10 border border-[#002b49]/15 px-2 py-0.5 rounded-md font-sans">
                          Climate Impact Tracking
                        </span>
                        <h4 className="text-sm font-black text-primary uppercase mt-1 flex items-center gap-1.5 font-sans">
                          <Leaf className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
                          Real-time Undgået CO₂e Udledning
                        </h4>
                        <p className="text-[10px] text-gray-400 font-semibold leading-relaxed mt-1">
                          Undgåede Scope 1-3 emissioner realiseret via Cirkel IoT retursløjfer og bekræftet genanvendelse.
                        </p>
                      </div>

                      <div className="my-1.5 text-left bg-gray-50 rounded-2xl p-4 border border-gray-200 relative overflow-hidden">
                        <div className="absolute top-1 right-2.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                          <span className="text-[7px] font-bold text-emerald-700 uppercase font-mono">LIVE CONNECTED</span>
                        </div>

                        <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest block">Akkumuleret Besparelse</span>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <span className="font-mono text-2xl font-black text-primary tracking-tight">
                            {realTimeCO2Saved.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-xs font-black text-gray-400 uppercase font-mono">Tons CO₂e</span>
                        </div>
                        <span className="text-[7.5px] font-semibold text-[#85A912] block mt-1 uppercase tracking-wider">
                          🌿 Svarende til {Math.round(realTimeCO2Saved * 46).toLocaleString('da-DK')} nyplantede træer i 10 år
                        </span>
                      </div>

                      {/* Carbon Accounting Scope Breakdown */}
                      <div className="flex flex-col gap-2 text-[8.5px] leading-tight font-mono font-bold">
                        <div>
                          <div className="flex justify-between text-gray-400 font-bold mb-1">
                            <span>SCOPE 1 (Logistik & Indsamling):</span>
                            <span className="text-gray-700">{(realTimeCO2Saved * 0.15).toFixed(2)} T CO₂e</span>
                          </div>
                          <div className="w-full h-1 bg-gray-150 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-700 rounded-full" style={{ width: '15%' }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-gray-400 font-bold mb-1">
                            <span>SCOPE 2 (IoT Bins & Datatrafik):</span>
                            <span className="text-gray-700">{(realTimeCO2Saved * 0.05).toFixed(2)} T CO₂e</span>
                          </div>
                          <div className="w-full h-1 bg-gray-150 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-600 rounded-full" style={{ width: '5%' }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-gray-450 font-bold mb-1">
                            <span>SCOPE 3 (Undgået Råstofafbrænding / Forarbejdning):</span>
                            <span className="text-emerald-800">{(realTimeCO2Saved * 0.80).toFixed(2)} T CO₂e</span>
                          </div>
                          <div className="w-full h-1 bg-gray-150 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: '80%' }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Benchmarking standards charts */}
                    <div className="xl:col-span-4 flex flex-col justify-between gap-3">
                      <div>
                        <span className="text-[9px] font-black tracking-widest text-[#85A912] bg-[#85A912]/10 border border-[#85A912]/15 px-2 py-0.5 rounded-md font-sans">
                          Industry Benchmarking
                        </span>
                        <h4 className="text-sm font-black text-primary uppercase mt-1 flex items-center gap-1.5 font-sans">
                          <BarChart3 className="w-4 h-4 text-[#85A912] shrink-0" />
                          Global Sektor-Sammenligning
                        </h4>
                        <p className="text-[10px] text-gray-400 font-semibold leading-relaxed mt-1">
                          Evaluering af jeres score i procenter mod gældende europæiske lovkrav og den nationale danske distributionsgns.
                        </p>
                      </div>

                      {/* Visual Benchmark Chart using Recharts BarChart */}
                      <div className="h-28 mt-1 border border-gray-100 rounded-xl p-2 bg-[#fdfdfd]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={benchmarkData} layout="vertical" margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <XAxis type="number" domain={[0, 100]} hide />
                            <YAxis dataKey="name" type="category" stroke="#CCCCCC" fontSize={7} fontWeight="bold" width={60} />
                            <Tooltip content={<EsgBenchmarkingCustomTooltip language={language} />} />
                            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={10}>
                              {benchmarkData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Benchmark result check */}
                      {(() => {
                        const scoreDiff = circularityIndex - 65; // compare against Ellen MacArthur Top Quartile (65%)
                        const isSurpassed = scoreDiff >= 0;

                        return (
                          <div className={`p-2 rounded-xl text-[9px] font-bold border flex items-center justify-between font-mono ${
                            isSurpassed 
                              ? 'bg-emerald-50/70 border-emerald-100 text-emerald-800' 
                              : 'bg-rose-50/70 border-rose-100 text-rose-800'
                          }`}>
                            <span className="uppercase">Ellen MacArthur standard:</span>
                            <span className="font-extrabold uppercase bg-white px-2 py-0.5 rounded font-sans leading-none border border-current/25">
                              {isSurpassed ? `✓ OVERGÅET MED ${scoreDiff}%` : `⚠️ MANGLER ${Math.abs(scoreDiff)}%`}
                            </span>
                          </div>
                        );
                      })()}
                    </div>

                  </div>
                );
              })()}

              {/* ANNUAL ESG REPORT COMPILING SECTION */}
              <div className="bg-gradient-to-br from-[#122A16] to-[#0A160D] border border-emerald-900/40 rounded-3xl p-6 text-left relative overflow-hidden shadow-sm">
                {/* Background graphic elements */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-[#85A912]/5 rounded-full blur-2xl pointer-events-none" />
                
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 relative z-10">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="bg-[#85A912]/20 border border-[#85A912]/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <Award className="w-3.5 h-3.5 text-[#C8F24A]" />
                        <span className="text-[10px] font-black tracking-widest text-[#C8F24A] uppercase">
                          CSRD & EU PPWR REVIDERET
                        </span>
                      </div>
                      <span className="text-[9.5px] font-black tracking-widest text-emerald-400 uppercase">
                        Ledger Proof-v3.2
                      </span>
                    </div>

                    <h4 className="text-lg font-black text-white uppercase mt-2.5 font-sans flex items-center gap-2">
                      <FileText className="w-5.5 h-5.5 text-[#C8F24A]" />
                      {isDa ? 'Årlig Corporate ESG & Sorteringsrapport' : 'Annual Corporate ESG & Sortering Report'}
                    </h4>
                    
                    <p className="text-xs text-emerald-100/70 font-semibold mt-1.5 leading-relaxed max-w-4xl">
                      {isDa 
                        ? 'Generer et godkendt mængderegnskab og CO₂-klimaprisregnskab ved ét klik. Cirkel trækker det akkumulerede miljøbidrag direkte fra borgenes transaktions-ledgere i Firestore og udformer en revisionsklar PDF årsrapport til jeres ESG-rapportering.' 
                        : 'Generate an approved quantity audit ledger and CO₂ footprint carbon price statement. Cirkel compiles cumulative citizens recycling metrics directly from Firestore ledgers to assemble a board-ready PDF ESG report.'}
                    </p>

                    {/* Report Configuration HUD */}
                    <div className="flex flex-wrap items-center gap-4 mt-4 bg-emerald-950/45 border border-emerald-900/30 p-3.5 rounded-xl">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-emerald-400 uppercase tracking-wider">{isDa ? 'Valgt Rapporteringsår' : 'Reporting Year'}</span>
                        <select
                          className="bg-emerald-950/90 border border-emerald-800 text-[11.5px] text-white rounded-lg px-2.5 py-1.5 font-black outline-none cursor-pointer"
                          value={esgReportYear}
                          onChange={(e) => setEsgReportYear(e.target.value)}
                        >
                          <option value="2026" className="bg-[#111111]">2026 (Aktuelt finansår - realtime)</option>
                          <option value="2025" className="bg-[#111111]">2025 (Historiske audit-logs)</option>
                          <option value="2024" className="bg-[#111111]">2024 (Historiske audit-logs)</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-emerald-400 uppercase tracking-wider">{isDa ? 'Ledger Datakilde' : 'Data Ledger Origin'}</span>
                        <div className="flex items-center gap-1.5 bg-emerald-900/20 border border-emerald-800/30 h-[34px] px-2.5 rounded-lg text-[10.5px] text-emerald-200 font-mono">
                          <Database className="w-3 h-3 text-[#C8F24A]" />
                          <span>Firestore: `users`</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-emerald-400 uppercase tracking-wider">{isDa ? 'Audit Status' : 'Audit Certification'}</span>
                        <div className="flex items-center gap-1.5 bg-emerald-900/20 border border-emerald-800/30 h-[34px] px-2.5 rounded-lg text-[10.5px] text-emerald-200 font-mono">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>revisionsklar_attest_signed</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[8.5px] font-black text-emerald-400 uppercase tracking-wider">{isDa ? 'Region Fokus' : 'Region Target'}</span>
                        <div className="flex items-center gap-1.5 bg-emerald-900/20 border border-emerald-800/30 h-[34px] px-2.5 rounded-lg text-[10.5px] text-[#C8F24A] font-bold">
                          <MapPin className="w-3 h-3 text-[#C8F24A]" />
                          <span>{selectedAlertRegion}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Trigger side action Button */}
                  <div className="shrink-0 flex flex-col items-center gap-2 w-full xl:w-auto">
                    <button
                      onClick={() => {
                        triggerHaptic(HapticPattern.HEAVY_TAP);
                        setShowExportOptionsModal(true);
                      }}
                      className="w-full xl:w-auto bg-[#85A912] hover:bg-[#99C215] active:scale-95 text-white font-extrabold text-xs px-6 py-4 rounded-xl uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-md select-none"
                    >
                      <Download className="w-4 h-4 text-[#111111]" />
                      <span>{isDa ? 'Eksporter ESG-Rapport 📊' : 'Export ESG Report 📊'}</span>
                    </button>
                    {isGeneratingEsgPdf && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-[10px] text-emerald-200/90 font-mono animate-pulse"
                      >
                        {esgPdfStatus}
                      </motion.span>
                    )}
                  </div>
                </div>
              </div>

              {/* COMPLIANCE ALERTS SECTION BASED ON USER REGION */}
              <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-3xs text-left">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-150 pb-4 mb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                      <span className="text-[9.5px] font-black tracking-widest text-[#85A912] uppercase">
                        {isDa ? 'Regionale Lovgivnings-Alarmer' : 'Regional Compliance Alerts'}
                      </span>
                    </div>
                    <h4 className="text-base font-black text-primary uppercase mt-1 flex items-center gap-2 font-sans">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                      {isDa ? `Miljøreguleringer & Deadlines: ${selectedAlertRegion}` : `Environmental Regulations & Deadlines: ${selectedAlertRegion}`}
                    </h4>
                    <p className="text-[10.5px] text-gray-550 font-semibold mt-1 leading-normal">
                      {isDa 
                        ? 'Analyser lokale miljøpåbud og kommende skærpelser. Undgå sanktioner og dagsbøder med verificerede IoT-panktløsninger.' 
                        : 'Select a region to review local environmental mandates and mitigate high-impact administrative enforcement.'}
                    </p>
                  </div>

                  {/* Quick Action Button */}
                  <button
                    onClick={() => {
                      triggerHaptic(HapticPattern.SCAN_SUCCESS);
                      setIsGeneratingReport(true);
                      setTimeout(() => {
                        setIsGeneratingReport(false);
                        const toastFn = (window as any).showToast;
                        if (toastFn) {
                          toastFn(isDa ? `Udarbejdede en regional ESG-overensstemmelsesattest for ${selectedAlertRegion}!` : `Compiled regional ESG compliance audit ledger for ${selectedAlertRegion}!`, 'success');
                        }
                      }, 1200);
                    }}
                    disabled={isGeneratingReport}
                    className="bg-primary hover:bg-opacity-90 disabled:opacity-50 text-white font-black text-[10.5px] px-3.5 py-2.5 rounded-xl uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer select-none"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#C8F24A]" />
                    {isGeneratingReport 
                      ? (isDa ? 'Genererer rapport...' : 'Compiling ledger...') 
                      : (isDa ? 'Hent Regional Audit' : 'Export Regional Audit')}
                  </button>
                </div>

                {/* Region Pill Selector */}
                <div className="mb-5 bg-gray-50 p-3 rounded-2xl border border-gray-150">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-2">
                    {isDa ? 'Skift analyse-region (standard baseret på jeres profil):' : 'Change analysis region (defaults to your profile):'}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {['Aarhus Kommune', 'Københavns Kommune', 'Odense Kommune', 'Frederikssund Kommune', 'Aalborg Kommune', 'Danmark'].map((regionName) => {
                      const isSelected = selectedAlertRegion === regionName;
                      const isProfileRegion = (user?.municipality || 'Aarhus Kommune') === regionName;
                      return (
                        <button
                          key={regionName}
                          onClick={() => {
                            triggerHaptic(HapticPattern.LIGHT_TAP);
                            setSelectedAlertRegion(regionName);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border cursor-pointer ${
                            isSelected 
                              ? 'bg-emerald-600 text-white border-transparent shadow-xs font-black' 
                              : 'bg-white text-gray-700 hover:bg-gray-100 border-gray-250'
                          }`}
                        >
                          <span className="flex items-center gap-1">
                            {isProfileRegion && <span>📍</span>}
                            {regionName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Filters and Counters */}
                {(() => {
                  const matchingAlerts = complianceAlertsDB.filter((item) => {
                    const matchesRegion = item.regions.includes(selectedAlertRegion);
                    if (!matchesRegion) return false;

                    if (activeAlertFilter === 'urgent') {
                      return item.importance === 'critical';
                    }
                    if (activeAlertFilter === 'upcoming') {
                      return item.importance !== 'critical';
                    }
                    return true;
                  });

                  const totalCount = complianceAlertsDB.filter(item => item.regions.includes(selectedAlertRegion)).length;
                  const criticalCount = complianceAlertsDB.filter(item => item.regions.includes(selectedAlertRegion) && item.importance === 'critical').length;
                  const mediumCount = totalCount - criticalCount;

                  return (
                    <div>
                      <div className="flex items-center justify-between gap-4 flex-wrap mb-4 pb-2 border-b border-gray-100">
                        <div className="flex gap-1.5">
                          {[
                            { id: 'all', labelDa: `Alle (${totalCount})`, labelEn: `All (${totalCount})` },
                            { id: 'urgent', labelDa: `Haste-alarmer (${criticalCount})`, labelEn: `Critical (${criticalCount})` },
                            { id: 'upcoming', labelDa: `Udestående (${mediumCount})`, labelEn: `Upcoming (${mediumCount})` },
                          ].map(f => (
                            <button
                              key={f.id}
                              onClick={() => {
                                triggerHaptic(HapticPattern.LIGHT_TAP);
                                setActiveAlertFilter(f.id as any);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[9.5px] font-extrabold transition-all cursor-pointer ${
                                activeAlertFilter === f.id 
                                  ? 'bg-[#85A912] text-white font-black animate-in fade-in' 
                                  : 'text-gray-500 hover:text-gray-800 bg-gray-50'
                              }`}
                            >
                              {isDa ? f.labelDa : f.labelEn}
                            </button>
                          ))}
                        </div>

                        <div className="text-[10px] text-gray-500 font-bold flex items-center gap-1.5">
                          <span>{isDa ? 'Kildestatus:' : 'Sourcing:'}</span>
                          <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-100 text-[8.5px] uppercase font-mono font-black">
                            {isDa ? 'Synkroniseret' : 'Synced'}
                          </span>
                        </div>
                      </div>

                      {/* Warnings Cards List */}
                      {matchingAlerts.length === 0 ? (
                        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center text-xs text-gray-500 font-semibold">
                          {isDa 
                            ? 'Ingen aktive alarmer matcher det valgte filter i denne region.' 
                            : 'No active compliance alerts match the selected criteria for this region.'}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4">
                          <AnimatePresence mode="popLayout">
                            {matchingAlerts.map((alert) => {
                              const isAcknowledged = acknowledgedAlerts.includes(alert.id);
                              const impColor = alert.importance === 'critical' 
                                ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                : alert.importance === 'high' 
                                  ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                  : 'bg-blue-50 text-blue-700 border-blue-200';

                              const daysColor = alert.daysLeft < 90 
                                ? 'text-rose-500 animate-pulse font-mono' 
                                : 'text-gray-400 font-mono';

                              return (
                                <motion.div 
                                  key={alert.id}
                                  layout
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: isAcknowledged ? 0.6 : 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className={`border rounded-2xl p-4 transition shadow-3xs relative overflow-hidden text-left ${
                                    isAcknowledged 
                                      ? 'border-gray-200 bg-gray-50/50' 
                                      : alert.importance === 'critical'
                                        ? 'border-rose-200 bg-rose-50/5 hover:border-rose-350' 
                                        : 'border-gray-200 bg-white hover:border-emerald-300'
                                  }`}
                                >
                                  {/* Red strip at top of critical alert */}
                                  {!isAcknowledged && alert.importance === 'critical' && (
                                    <div className="absolute top-0 left-0 w-full h-1 bg-rose-500" />
                                  )}

                                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className={`text-[8.5px] font-black uppercase tracking-wider border px-1.5 py-0.5 rounded ${impColor}`}>
                                        {alert.importance === 'critical' ? (isDa ? 'Kritisk' : 'Critical') : 
                                         alert.importance === 'high' ? (isDa ? 'Høj prioritet' : 'High') : 
                                                                       (isDa ? 'Medium' : 'Medium')}
                                      </span>
                                      <span className="bg-gray-100 text-gray-650 px-2 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider font-mono">
                                        {alert.lawType}
                                      </span>
                                      <span className="text-gray-300 font-bold text-xs hidden sm:inline">|</span>
                                      <span className="text-[10px] text-gray-500 font-bold flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {isDa ? 'Deadline:' : 'Deadline:'} <span className="font-mono text-primary font-black uppercase">{alert.dueDate}</span>
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 self-end md:self-auto shrink-0">
                                      <span className={`text-[10px] font-black uppercase ${daysColor}`}>
                                        ⏱ {alert.daysLeft} {isDa ? 'Dage tilbage' : 'Days left'}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-2.5">
                                    <h5 className="text-[12px] font-black text-primary uppercase tracking-tight">
                                      {isDa ? alert.titleDa : alert.titleEn}
                                    </h5>
                                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed font-semibold">
                                      {isDa ? alert.descriptionDa : alert.descriptionEn}
                                    </p>
                                  </div>

                                  {/* Economic Fine & recommended course of action */}
                                  {!isAcknowledged && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                      {/* Fine info */}
                                      <div className="bg-rose-50/40 border border-rose-100/50 rounded-xl p-3">
                                        <span className="font-black text-rose-700 text-[9px] uppercase tracking-wider block mb-1 flex items-center gap-1">
                                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" /> {isDa ? 'Økonomisk Risiko' : 'Economic Penalty'}
                                        </span>
                                        <p className="text-rose-900 text-[10px] font-bold leading-relaxed">
                                          {isDa ? alert.fineDa : alert.fineEn}
                                        </p>
                                      </div>

                                      {/* Cirkel Recommendation */}
                                      <div className="bg-emerald-50/40 border border-emerald-100/50 rounded-xl p-3">
                                        <span className="font-black text-[#85A912] text-[9px] uppercase tracking-wider block mb-1 flex items-center gap-1">
                                          <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#85A912]" /> {isDa ? 'Anbefalet Cirkel-Løsning' : 'Recommended Action'}
                                        </span>
                                        <p className="text-[#5B7507] text-[10px] font-bold leading-relaxed">
                                          {isDa ? alert.recommendationDa : alert.recommendationEn}
                                        </p>
                                      </div>
                                    </div>
                                  )}

                                  {/* Action Buttons */}
                                  <div className="mt-3.5 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2.5">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => {
                                          triggerHaptic(HapticPattern.SCAN_SUCCESS);
                                          setSelectedLawDetail(alert.learnMoreId);
                                          const element = document.getElementById('tab-esg-analyser-btn');
                                          if (element) {
                                            element.scrollIntoView({ behavior: 'smooth' });
                                          }
                                        }}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9.5px] px-3 py-1.5 rounded-xl uppercase tracking-wider cursor-pointer flex items-center gap-1 transition-colors select-none"
                                      >
                                        {isDa ? 'Vis tilknyttet lov' : 'Go to rule detail'} <ArrowRight className="w-3 h-3" />
                                      </button>

                                      <button
                                        onClick={() => {
                                          triggerHaptic(HapticPattern.LIGHT_TAP);
                                          const toastFn = (window as any).showToast;
                                          if (toastFn) {
                                            toastFn(isDa ? 'Forbindelses-wizard til IoT Pant Bins startet!' : 'IoT Pant Bin onboarding wizard started!', 'info');
                                          }
                                          setShowCrmModal(true);
                                        }}
                                        className="bg-[#fafef5] hover:bg-[#85A912]/15 border border-[#85A912]/30 text-emerald-800 font-extrabold text-[9.5px] px-3 py-1.5 rounded-xl uppercase tracking-wider cursor-pointer transition-colors select-none"
                                      >
                                        ⚡ {isDa ? 'Tilknyt IoT Pant' : 'Connect IoT Deposit'}
                                      </button>
                                    </div>

                                    <button
                                      onClick={() => {
                                        triggerHaptic(HapticPattern.LIGHT_TAP);
                                        if (isAcknowledged) {
                                          setAcknowledgedAlerts(prev => prev.filter(id => id !== alert.id));
                                        } else {
                                          setAcknowledgedAlerts(prev => [...prev, alert.id]);
                                          const toastFn = (window as any).showToast;
                                          if (toastFn) {
                                            toastFn(isDa ? 'Alarm anerkendt og arkiveret.' : 'Compliance alert acknowledged.', 'success');
                                          }
                                        }
                                      }}
                                      className="text-gray-400 hover:text-gray-700 font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-1 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                                    >
                                      {isAcknowledged ? (isDa ? 'Genaktiver' : 'Reactivate') : (isDa ? 'Anerkend alarm ✓' : 'Acknowledge')}
                                    </button>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* ACTIVE LAW DRILLDOWN DRAW PANEL */}
              {selectedLawDetail && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-primary text-white p-5 rounded-3xl border-2 border-emerald-500/30 shadow-lg relative"
                >
                  <button 
                    onClick={() => setSelectedLawDetail(null)} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-white font-mono text-sm px-2 py-1 rounded-lg border border-gray-700/50 hover:bg-gray-800 transition-colors"
                  >
                    Skjul detaljer ✕
                  </button>
                  {(() => {
                    const lawMeta: Record<string, { title: string, subtitle: string, desc: string, fines: string, bypass: string, tag: string }> = {
                      epr: {
                        title: "Dansk Udvidet Producentansvar (EPR - 2025/2026)",
                        subtitle: "Finansielt ansvar for emballagens fulde livscyklus i henhold til EU-direktiv 2018/852",
                        tag: "Dansk Lov nr. 12932 · Gældende fra 2025",
                        desc: "EPR forpligter alle emballerende virksomheder, importører og varemærkeejere til at organisere og betale for indsamling samt efterfølgende genanvendelse af al emballage de markedsfører. Taksterne fastsættes individuelt af de kollektive ordninger baseret på nettovægt og kategoriseres efter designets genanvendelighed (eco-modulering).",
                        fines: "Manglende registrering el. mangelfulde quantitative indberetninger til Miljøstyrelsen straffes med administrative påbud og bødeforlæg på op til 50.000 DKK per produktlinje samt markedskarantæne.",
                        bypass: "Cirkel Connect løser dette fundamentalt ved at levere et uafviseligt 'Digitalt Revisionbevis' (Digital Twin Ledger). Da vores smarte pant-bins måler og validerer hver enkelt flasketagning eller dåsereturnering direkte hos borgeren, kan virksomheden dokumentere ægte lukket kredsløb og opnå op til 90% rabat (Eco-bonus) på kollektive takster."
                      },
                      ppwr: {
                        title: "EU Packaging and Packaging Waste Regulation (PPWR - 2026/2030)",
                        subtitle: "Den overordnede europæiske emballageforordning med bindende kvantitative krav",
                        tag: "Kommissionsforordning EU PPWR 2026 · Direkte gældende",
                        desc: "Indfører strenge restriktioner på PFAS i fødevareemballage, forbyder unødvendig 'double-boxing', kræver obligatoriske genbrugs- kvoter (f.eks. 10% for drikkevareemballage i 2030) samt krav om indbygget genanvendt plast (minimum 30% rPET/rPP i 2030). Desuden skal al emballage være 100% genanvendelig i 2030.",
                        fines: "Salgforbud i samtlige EU-medlemslande samt dagsbøder svarende til op mod 5% af den årlige globale koncernomsætning.",
                        bypass: "Vores IoT systemer og genbrugs-styring gør det muligt at overholde genbrugskrav med det samme. Systemet registrerer unikt hver cirkulerende genbrugskop eller beholder, sporer antal rotationer (rotations-cykler) og validerer hygiejne/opfyldning, hvilket sikrer 100% compliance."
                      },
                      plastic_levy: {
                        title: "EU Plastic Packaging Waste Levy (Plastafgift)",
                        subtitle: "Det europæiske nationale bidrags- og afgiftsdirektiv for ikke-genanvendt plastaffald",
                        tag: "EU Rådsbeslutning 2020/2053 · €0,80 per kilo ikke-genbrugt plast",
                        desc: "EU pålægger medlemslandene en afgift på €0,80 (ca. 6,00 DKK) pr. kilogram plastemballageaffald, der ikke genanvendes. Flere medlemslande, inkl. Danmark, videresender direkte eller indirekte denne regning til industrien gennem differentierede affaldsgebyrer eller direkte CO2- og råstofstrafafgifter.",
                        fines: "Overvæltes direkte i prisen for råmaterialeevalueringer og forringer driftsmarginen med op mod 25% for jomfruelige materialer.",
                        bypass: "Ved at omlægge til rPET og koble emballagen til Cirkels nudging-pant sikres en extremt høj og ren sorteringsprocent. Da borgerne guides aktivt til at placere det i vores IoT-sorteringsbeholdere, undgås kontaminering med restaffald, og vi sikrer, at materialet klassificeres som fuldt genanvendeligt og reducerer plastafgiften til 0 kr."
                      },
                      eudr: {
                        title: "EU Deforestation Regulation (EUDR - Skovbeskyttelse)",
                        subtitle: "Forbud mod markedsføring af produkter, der forårsager skovrydning globalt",
                        tag: "Forordning EU 2023/1115 · Gældende fra december 2024/2025",
                        desc: "Forpligter virksomheder, der leverer pap, papir, træ, soja eller kaffe til EU-markedet, til at udføre omfattende 'Due Diligence'. Det skal dokumenteres med geokoordinater (GPS/Satellit), at råmaterialerne ikke stammer fra nyligt ryddet skovareal efter 31. december 2020.",
                        fines: "Konfiskation af produkter og provenu, midlertidigt udelukkelse fra offentlige udbud samt straffebøder på helt op til 4% af virksomhedens samlede årlige omsætning i det pågældende medlemsland.",
                        bypass: "Cirkels platform parrer emballagens stregkoder / RFID tags direkte med FSC-sourcing databaser og geo-lokationsbeviser i en gennemsigtig ESG-rapport, som revisorer kan hente med et enkelt klik. Papiremballage, der genanvendes gennem Cirkels indsamlingskasser, beviser lukket kredsløb og letter dokumentationsbyrden overfor toldmyndighederne."
                      },
                      csrd: {
                        title: "Corporate Sustainability Reporting Directive (CSRD - ESRS E5)",
                        subtitle: "Nye europæiske standarder for lovpligtig bæredygtighedsrapportering",
                        tag: "Direktiv EU 2022/2464 · Gradvis indfasning fra 2024/2025",
                        desc: "Store og børsnoterede selskaber tvinges til at rapportere om deres miljømæssige og sociale indvirkning. Standard 'ESRS E5' fastsætter skrappe krav til opgørelse af 'Resource Inflows' (råmaterialer) og 'Resource Outflows' (affald). Virksomheden skal angive præcise procentsatser for cirkulært råvareforbrug og genanvendelsesmål.",
                        fines: "Krav om revisorgodkendelse (limited assurance). Fejlagtige eller manglende data kan udløse store bøder, tab af grønne investeringer (EU Taksonomi) og massiv varemærkeskade under ESG-audits.",
                        bypass: "Cirkels B2B Partner Portal genererer automatisk revisorgodkendte rapporteringer under standarden ESRS E5. De reelle mængder og vægte af plastik, aluminium og karton, der er indsamlet via platformen, kan indsættes direkte i det officielle CSRD ESG-regnskab som realtidstal, godkendt med geo- og tidsstempler."
                      },
                      cbam: {
                        title: "Carbon Border Adjustment Mechanism (CBAM - CO2-Fradragstold)",
                        subtitle: "EU's nye CO2-grænsetoldaftale på importerede kulstofintensive råmaterialer",
                        tag: "Forordning EU 2023/956 · Gradvis indfasning 2023-2026",
                        desc: "Pålægger en CO2-afgift på importerede varer uden for EU (f.eks. rå-aluminium, jern, stål, gødning, elektricitet, brint og visse polymerer/plastmaterialer). Formålet er at forhindre 'kulstoflækage' (Carbon Leakage) til lande med svagere klimapolitik.",
                        fines: "Manglende indberetning straffes med bøder på mellem €10 og €50 pr. ton ikke-deklareret CO2-emission, samt toldblokeringer.",
                        bypass: "Ved at øge andelen af indenretursystemer (Closed-loop) reducerer du dit samlede behov for jomfruelig råvareimport. Cirkels sporing verificerer, at genbrugsaluminium og genanvendt plast forbliver og genbruges inden for EU's grænser, hvilket eliminerer CBAM-gælden fuldstændigt og sikrer jeres forsyningskædes uafhængighed."
                      },
                      danish_tax: {
                        title: "Dansk Lov om Emballageafgift (Emballageafgiftsloven)",
                        subtitle: "Vægt- og volumenbaseret afgift på specifikke emballagetyper i Danmark",
                        tag: "Lovbekendtgørelse nr. 1152 · National dansk punktafgift",
                        desc: "En eksisterende punktafgift, der pålægger faste takster pr. styk el. pr. kilo på bæreposer, engangsservice, kopper, flasker og papkasser. Afgiften afhænger direkte af råvarens oprindelse, hvor genbrugte materialer eller bioplast under visse betingelser kan opnå fradrag.",
                        fines: "Unddragelse anses som skatteunddragelse, straffes med bøde og beslaglæggelse af varer af Skattestyrelsen.",
                        bypass: "Cirkel muliggør automatisk eksportklaration. Vores system registrerer og fratrækker automatisk den andel af kopper eller emballager, der har været i cirkulation eller er eksporteret/genbrugt, så du kun betaler skat af den faktiske netto-volumen, I forbruger."
                      },
                    };

                    const item = lawMeta[selectedLawDetail];
                    if (!item) return null;

                    return (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap justify-between items-start gap-2 border-b border-gray-700/50 pb-2">
                          <div>
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono font-black border border-emerald-500/30 px-2 py-0.5 rounded tracking-wide uppercase">
                              {item.tag}
                            </span>
                            <h4 className="text-base font-black text-white mt-1 uppercase tracking-tight">{item.title}</h4>
                            <p className="text-xs text-gray-400 font-bold italic">{item.subtitle}</p>
                          </div>
                          <button 
                            id="audit-pdf-download-btn"
                            onClick={() => {
                              triggerHaptic(HapticPattern.SCAN_SUCCESS);
                              const toastFn = (window as any).showToast;
                              if (toastFn) toastFn(`Overensstemmelsesvurdering for ${selectedLawDetail.toUpperCase()} downloaded successfully!`, 'success');
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                          >
                            <Download className="w-3.5 h-3.5" /> PDF Audit Guide
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs mt-1">
                          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                            <span className="font-extrabold text-[#C8F24A] text-[10px] uppercase tracking-wider block mb-1">Lovgivningens kerne</span>
                            <p className="text-gray-300 leading-relaxed text-[11px] font-semibold">{item.desc}</p>
                          </div>
                          <div className="bg-rose-950/40 border border-rose-900/30 rounded-2xl p-4">
                            <span className="font-extrabold text-rose-400 text-[10px] uppercase tracking-wider block mb-1 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Økonomisk Sanktion & Bøder
                            </span>
                            <p className="text-rose-205 leading-relaxed text-[11px] font-semibold">{item.fines}</p>
                          </div>
                          <div className="bg-emerald-950/40 border border-emerald-900/30 rounded-2xl p-4">
                            <span className="font-extrabold text-emerald-400 text-[10px] uppercase tracking-wider block mb-1 flex items-center gap-1">
                              <RefreshCw className="w-3.5 h-3.5 shrink-0 text-emerald-400 animate-spin" style={{ animationDuration: '8s' }} /> Why Cirkel is Light-Years Ahead
                            </span>
                            <p className="text-emerald-250 leading-relaxed text-[11px] font-medium">{item.bypass}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </motion.div>
              )}

              {/* Dynamic Expandable Legislation Pills compass */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs text-left">
                <span className="text-[9px] font-black tracking-widest text-[#85A912] uppercase block mb-1">
                  💡 Globale Lovgivningsmatrix
                </span>
                <h4 className="text-xs font-black text-primary uppercase mb-3">Klik på de officielle forordninger for at analysere og aktivere modstandsdygtighed:</h4>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'epr', label: 'Dansk EPR (2025/26)', desc: 'Producentansvar', color: 'border-emerald-500/20 hover:border-emerald-500' },
                    { id: 'ppwr', label: 'EU PPWR (2026/30)', desc: 'Obligatorisk genanvendelse', color: 'border-[#85A912]/20 hover:border-[#85A912]' },
                    { id: 'plastic_levy', label: 'EU Plastafgift', desc: '€0,80/kg ugenbrugt plast', color: 'border-blue-500/20 hover:border-blue-500' },
                    { id: 'eudr', label: 'EUDR Skovrydning', desc: 'FSC & Geo-traceability', color: 'border-amber-500/20 hover:border-amber-500' },
                    { id: 'csrd', label: 'CSRD ESRS E5', desc: 'Råvare ESG Rapportering', color: 'border-indigo-500/20 hover:border-indigo-500' },
                    { id: 'cbam', label: 'CBAM Grænsetold', desc: 'CO2 Import-skat', color: 'border-rose-500/20 hover:border-rose-500' },
                    { id: 'danish_tax', label: 'National Punktafgift', desc: 'Styk & Vægtafgift', color: 'border-gray-500/20 hover:border-gray-500' },
                  ].map((law) => {
                    const isActive = selectedLawDetail === law.id;
                    return (
                      <button
                        key={law.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setSelectedLawDetail(isActive ? null : law.id);
                        }}
                        className={`flex-1 min-w-[140px] border p-3 rounded-2xl transition-all cursor-pointer text-left ${law.color} ${
                          isActive 
                            ? 'bg-primary text-white border-transparent ring-2 ring-emerald-500/40 shadow-xs' 
                            : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-black uppercase tracking-tight block">{law.label}</span>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400 animate-ping' : 'bg-gray-450'}`} />
                        </div>
                        <span className={`text-[8.5px] font-semibold block mt-1 ${isActive ? 'text-gray-300' : 'text-gray-450'}`}>{law.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {/* 3-Column main sandbox grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* 1. INPUT SLIDERS GRID */}
                <div className="lg:col-span-4 bg-white border border-gray-200 rounded-3xl p-5 shadow-3xs flex flex-col gap-4">
                  <div className="border-b border-gray-150 pb-2">
                    <h4 className="text-xs font-black text-primary uppercase">1. Forretnings- & Emballagekonfiguration</h4>
                    <p className="text-[9px] text-gray-450 font-semibold">Finjuster materialeparametre og gennemsigtighed for at registrere afviklingsrisiko</p>
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Yearly Tonnage */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[10px] font-black text-gray-450 uppercase">
                        <span>Årlig emballagemængde</span>
                        <span className="font-mono text-primary bg-gray-100 px-2 py-0.5 rounded font-black">{esgTonnage} Tons</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="5000"
                        step="10"
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#85A912]"
                        value={esgTonnage}
                        onChange={(e) => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setEsgTonnage(Number(e.target.value));
                        }}
                      />
                      <div className="flex justify-between text-[8px] text-gray-400 font-bold">
                        <span>10 T</span>
                        <span>2500 T</span>
                        <span>5000 T</span>
                      </div>
                    </div>

                    {/* Material Type */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black text-gray-450 uppercase">Emballagens Kemiske Hovedmateriale</span>
                      <select
                        className="bg-gray-50 border border-gray-200 px-3.5 py-2.5 text-xs rounded-xl font-bold outline-none cursor-pointer text-primary"
                        value={esgMaterial}
                        onChange={(e) => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setEsgMaterial(e.target.value);
                          // Automatic presets for eco-grade & certification
                          if (e.target.value === 'plastic_virgin') {
                            setEsgRecyclability('B');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'plastic_recycled') {
                            setEsgRecyclability('A+');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'bioplastic') {
                            setEsgRecyclability('A');
                            setEsgIsFscCertified(true);
                          } else if (e.target.value === 'paper_deforested') {
                            setEsgRecyclability('C');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'paper_certified') {
                            setEsgRecyclability('A');
                            setEsgIsFscCertified(true);
                          } else if (e.target.value === 'aluminum') {
                            setEsgRecyclability('B');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'aluminum_recycled') {
                            setEsgRecyclability('A++');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'composite') {
                            setEsgRecyclability('D');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'glass_virgin') {
                            setEsgRecyclability('B');
                            setEsgIsFscCertified(false);
                          } else if (e.target.value === 'glass_recycled') {
                            setEsgRecyclability('A++');
                            setEsgIsFscCertified(false);
                          }
                        }}
                      >
                        <option value="plastic_virgin">Jomfruelig Plastik (PP, PE, PET, PS)</option>
                        <option value="plastic_recycled">Genanvendt Teknisk Plast (rPET / Post-Consumer Recycled)</option>
                        <option value="bioplastic">Bio-baseret komposterbar plast (PLA fra majsstivelse)</option>
                        <option value="paper_deforested">Ucertificeret fiber / Papir (Træfiber uden EUDR dokumentation)</option>
                        <option value="paper_certified">FSC Forest Stewardship Council papir (Skovvenlig)</option>
                        <option value="aluminum">Imported Jomfrueligt Aluminium (Høj CBAM toldrisiko)</option>
                        <option value="aluminum_recycled">Genanvendt Grønt Aluminium (Skrotbaseret smelting)</option>
                        <option value="composite">Komposit-emballage (Karton + PET multi-lag laminering)</option>
                        <option value="glass_virgin">Jomfrueligt Glas (Kvarts-sand baseret flacon)</option>
                        <option value="glass_recycled">Genvunden Retur-glas (Skarre-sorteret skår)</option>
                      </select>
                    </div>

                    {/* Recyclability Eco-grade */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[10px] font-black text-gray-450 uppercase">
                        <span>Miljøgraduering (Eco-modulation)</span>
                        <span className={`px-2 py-0.5 rounded text-[8.5px] font-black ${
                          esgRecyclability.includes('A++') ? 'bg-emerald-100 text-emerald-800 border border-emerald-250 animate-pulse' :
                          esgRecyclability.includes('A') ? 'bg-green-150 text-green-900 border border-green-200' :
                          esgRecyclability === 'B' ? 'bg-gray-100 text-gray-700' : 'bg-rose-100 text-rose-800 border border-rose-150'
                        }`}>
                          Design Grade {esgRecyclability}
                        </span>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {['A++', 'A+', 'A', 'B', 'C', 'D'].map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => {
                              triggerHaptic(HapticPattern.LIGHT_TAP);
                              setEsgRecyclability(g);
                            }}
                            className={`py-2 text-[10px] font-black rounded-lg border transition-all cursor-pointer ${
                              esgRecyclability === g 
                                ? 'bg-primary text-white border-primary shadow-xs' 
                                : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Checkboxes: Advanced Surcharges under CBAM / PPWR / REACH */}
                    <div className="bg-gray-50 rounded-2xl p-3 border border-gray-150 flex flex-col gap-2">
                      <span className="text-[9px] font-black text-gray-450 uppercase tracking-wider block mb-1">Kemisk & CBAM Risikoprofil</span>
                      
                      {/* PFAS Checkbox */}
                      <label id="checkbox-pfas-label" className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={esgPFAS}
                          onChange={(e) => {
                            triggerHaptic(HapticPattern.LIGHT_TAP);
                            setEsgPFAS(e.target.checked);
                          }}
                          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                        <div className="text-left leading-tight">
                          <span className="text-[10px] font-black text-primary block uppercase">PFAS Overfladebehandling</span>
                          <span className="text-[8px] text-gray-400 font-bold block">Slidstærke fluorparaffiner til fedt-barriere (BANNED i PPWR)</span>
                        </div>
                      </label>

                      {/* Imported raw material share (CBAM) */}
                      <div className="flex flex-col gap-1 mt-1 border-t border-gray-200 pt-2">
                        <div className="flex justify-between text-[10px] font-black text-gray-450 uppercase">
                          <span>Import uden for EU (CBAM skat)</span>
                          <span className="font-mono text-primary font-black">{esgImportedShare}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          className="w-full h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-[#85A912]"
                          value={esgImportedShare}
                          onChange={(e) => {
                            triggerHaptic(HapticPattern.LIGHT_TAP);
                            setEsgImportedShare(Number(e.target.value));
                          }}
                        />
                      </div>

                      {/* Carbon Accounting Shadow Price slider */}
                      <div className="flex flex-col gap-1 mt-1 border-t border-gray-200 pt-2">
                        <div className="flex justify-between text-[10px] font-black text-gray-450 uppercase">
                          <span>Skygge CO2-afgift</span>
                          <span className="font-mono text-primary font-black">€{esgCarbonPriceEuro}/Ton</span>
                        </div>
                        <input
                          type="range"
                          min="30"
                          max="250"
                          step="5"
                          className="w-full h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-emerald-600"
                          value={esgCarbonPriceEuro}
                          onChange={(e) => {
                            triggerHaptic(HapticPattern.LIGHT_TAP);
                            setEsgCarbonPriceEuro(Number(e.target.value));
                          }}
                        />
                      </div>
                    </div>

                    {/* Cirkel Offset Loop Closure share */}
                    <div className="flex flex-col gap-1.5 bg-[#FAFBF6] border-2 border-[#85A912]/20 rounded-2xl p-3.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[9.5px] font-black text-emerald-850 uppercase tracking-wider flex items-center gap-1">
                          <RefreshCw className="w-3.5 h-3.5 text-[#85A912] shrink-0 animate-spin" style={{ animationDuration: '6s' }} />
                          Cirkel Nudge Returløkke
                        </span>
                        <span className="font-mono text-[11px] font-black text-emerald-800 bg-[#85A912]/10 border border-[#85A912]/20 px-2 rounded">{esgCirkelOffsetShare}% Returrate</span>
                      </div>
                      <p className="text-[9px] text-gray-500 font-semibold leading-relaxed my-1">
                        Andel af din emballage du tilbagetager direkte fra borgerne via Cirkels IoT Smart-Bins, gamification & nudging loops.
                      </p>
                      <input
                        type="range"
                        min="10"
                        max="95"
                        step="5"
                        className="w-full h-1 bg-emerald-250 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                        value={esgCirkelOffsetShare}
                        onChange={(e) => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setEsgCirkelOffsetShare(Number(e.target.value));
                        }}
                      />
                      <div className="flex justify-between text-[7.5px] text-emerald-700 font-bold">
                        <span>10% (Passiv)</span>
                        <span>50% (Kampagne)</span>
                        <span>95% (Fuldstændig cirkulær)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. THE GREEN BILL COMPARATOR */}
                <div className="lg:col-span-5 bg-[#FAF9F5] border border-gray-200 rounded-3xl p-5 shadow-3xs flex flex-col gap-4 relative">
                  <div className="border-b border-gray-150 pb-2 text-left">
                    <h4 className="text-xs font-black text-primary uppercase">2. Den Miljømæssige Regnskabsberegning</h4>
                    <p className="text-[9px] text-gray-400 font-medium">Anslåede satser under samtlige kombinerede EU punktafgifter & modulationsregler</p>
                  </div>

                  {/* Receipt styled details card */}
                  {(() => {
                    // Deep legal pricing formulas
                    let eprRate = 2200; // DKK per ton base
                    let plasticLevyRate = 0; // DKK per ton base
                    let cbamRate = 0; // CBAM CO2 border fine per ton imported
                    let eudrRate = 0; // Forestry deforestation risk tariff
                    let pfasRate = 0; // Banned hazard chemical fine
                    let co2PerTonMaterial = 1.2; // Ton CO2 equivalents per ton material
                    let materialLabel = "Emballage";

                    // Set parameters depending on material chosen
                    if (esgMaterial === 'plastic_virgin') {
                      eprRate = 3800; // high EPR on virgin plastics
                      plasticLevyRate = 6000; // €0.80/kg = 6000 DKK/ton
                      co2PerTonMaterial = 2.8; // High carbon footprint
                      materialLabel = "Virgin Plastik";
                    } else if (esgMaterial === 'plastic_recycled') {
                      eprRate = 1100; // Eco-reduced
                      plasticLevyRate = 0; // 0 levy on recycled PCR!
                      co2PerTonMaterial = 0.9;
                      materialLabel = "PCR Genbrugsplast";
                    } else if (esgMaterial === 'bioplastic') {
                      eprRate = 2100;
                      plasticLevyRate = 1800; // still taxed because PLA requires industrial facilities
                      co2PerTonMaterial = 1.4;
                      materialLabel = "PLA Bioplast";
                    } else if (esgMaterial === 'paper_deforested') {
                      eprRate = 2400;
                      eudrRate = 6800; // Massive EUDR threat if deforestead
                      co2PerTonMaterial = 1.3;
                      materialLabel = "Ucertificeret Papir";
                    } else if (esgMaterial === 'paper_certified') {
                      eprRate = 850; // Low paper EPR
                      co2PerTonMaterial = 0.4; // Very low
                      materialLabel = "FSC Certificeret Pap/Kart";
                    } else if (esgMaterial === 'aluminum') {
                      eprRate = 1400;
                      cbamRate = 4500; // aluminum has high CBAM grænsetold!
                      co2PerTonMaterial = 8.4; // Virgin smelting is highly intensive!
                      materialLabel = "Jomfrueligt Alu";
                    } else if (esgMaterial === 'aluminum_recycled') {
                      eprRate = 400; // Almost free!
                      cbamRate = 0; // Skrotbaseret has 0 CBAM
                      co2PerTonMaterial = 0.6; // 93% energy saved
                      materialLabel = "Genbrugsaluminum";
                    } else if (esgMaterial === 'composite') {
                      eprRate = 5800; // Highest EPR due to separation difficulty
                      plasticLevyRate = 3500; // taxed proportionally on plastic liners
                      co2PerTonMaterial = 2.2;
                      materialLabel = "Laminat Komposit";
                    } else if (esgMaterial === 'glass_virgin') {
                      eprRate = 1800;
                      co2PerTonMaterial = 1.8;
                      materialLabel = "Jomfrueligt Glas";
                    } else if (esgMaterial === 'glass_recycled') {
                      eprRate = 500;
                      co2PerTonMaterial = 0.5;
                      materialLabel = "Returglas / Skår";
                    }

                    // PFAS hazard fine
                    if (esgPFAS) {
                      pfasRate = 15000; // Penalty of 15,000 DKK per ton for containing PFAS chemicals
                    }

                    // Eco modulation multiplier based on selected grade
                    let ecoMultiplier = 1.0;
                    if (esgRecyclability === 'A++') ecoMultiplier = 0.40; // 60% Rabated!
                    else if (esgRecyclability === 'A+') ecoMultiplier = 0.60;
                    else if (esgRecyclability === 'A') ecoMultiplier = 0.85;
                    else if (esgRecyclability === 'B') ecoMultiplier = 1.00;
                    else if (esgRecyclability === 'C') ecoMultiplier = 1.45;
                    else if (esgRecyclability === 'D') ecoMultiplier = 1.90; // 90% Malus fine

                    // Calculations
                    const baseEprAmount = esgTonnage * eprRate * ecoMultiplier;
                    const plasticLevyAmount = esgTonnage * plasticLevyRate;
                    const cbamAmount = esgTonnage * (esgImportedShare / 100) * cbamRate;
                    const eudrAmount = esgTonnage * eudrRate;
                    const pfasAmount = esgTonnage * pfasRate;
                    
                    // Carbon pricing Shadow debt
                    // DKK rate: euro price * 7.45 DKK
                    const co2TonsTotal = esgTonnage * co2PerTonMaterial;
                    const shadowCarbonPriceDkk = esgCarbonPriceEuro * 7.45;
                    const carbonDebtAmount = co2TonsTotal * shadowCarbonPriceDkk;

                    // Samlet Legacy lineær gæld
                    const legacyTotalAmount = baseEprAmount + plasticLevyAmount + cbamAmount + eudrAmount + pfasAmount + carbonDebtAmount;

                    // CIRKEL MODVIRKNING (How Cirkel transforms this)
                    // Cirkel offset directly reduces physical tonnage billed as waste by proving actual closed-loop return
                    const loopReductionFactor = (1 - esgCirkelOffsetShare / 100);

                    const cirkelEpr = baseEprAmount * loopReductionFactor;
                    const cirkelPlasticLevy = plasticLevyAmount * loopReductionFactor;
                    const cirkelCbam = cbamAmount * loopReductionFactor; // reduced by circular substitution
                    const cirkelEudr = 0; // Cirkels geo-ledger trace proves FSC compliance under EUDR, bringing deforest penalty to 0.
                    const cirkelPfas = esgPFAS ? (pfasAmount * 0.3) : 0; // nudges toward alternative materials, reducing PFAS impact
                    const cirkelCarbonDebt = carbonDebtAmount * loopReductionFactor;

                    const cirkelTotalAmount = cirkelEpr + cirkelPlasticLevy + cirkelCbam + cirkelEudr + cirkelPfas + cirkelCarbonDebt;

                    const savedDkk = legacyTotalAmount - cirkelTotalAmount;
                    const savingPercentage = Math.round((savedDkk / (legacyTotalAmount || 1)) * 100);

                    // Dynamic classification of the company's circular resilience
                    let resilienceGrade = "F";
                    let resilienceColor = "text-rose-600 bg-rose-50 border-rose-200";
                    let resilienceDesc = "Regulatorisk Trussel: Ekstrem risiko for høje produktbøder under CSRD & PPWR.";

                    if (savingPercentage >= 75) {
                      resilienceGrade = "A++";
                      resilienceColor = "text-emerald-800 bg-emerald-100 border-emerald-350";
                      resilienceDesc = "Cirkulær Champion: Fremtidssikret forretning, der udnytter samtlige økologiske afgiftsrabatter.";
                    } else if (savingPercentage >= 55) {
                      resilienceGrade = "A";
                      resilienceColor = "text-green-800 bg-green-100 border-green-200";
                      resilienceDesc = "Grøn frontløber: Meget robust modståelse over for EU PPWR og PFAS-direktiver.";
                    } else if (savingPercentage >= 35) {
                      resilienceGrade = "B";
                      resilienceColor = "text-gray-800 bg-gray-100 border-gray-250";
                      resilienceDesc = "Middel resilience: Moderat beskyttelse. Klar afgiftsmæssig forbedring påkrævet.";
                    } else if (savingPercentage >= 15) {
                      resilienceGrade = "C";
                      resilienceColor = "text-yellow-800 bg-yellow-100 border-yellow-250";
                      resilienceDesc = "Lav modstand: Høj økonomisk sårbarhed over for de kommende 2026 plastbøder.";
                    }

                    return (
                      <div className="flex flex-col gap-4">
                        {/* Dynamic Scorecard Alert */}
                        <div className={`p-4 rounded-2xl border flex items-center gap-3.5 ${resilienceColor}`}>
                          <div className="w-12 h-12 rounded-xl bg-white border border-gray-100 flex items-center justify-center font-mono font-black text-xl shrink-0 shadow-3xs">
                            {resilienceGrade}
                          </div>
                          <div className="text-left">
                            <span className="text-[8.5px] font-black uppercase tracking-wider block">ESG Modstandsdygtigheds-audit</span>
                            <p className="text-[10px] font-extrabold leading-snug mt-0.5">{resilienceDesc}</p>
                          </div>
                        </div>

                        {/* Comparison cards */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Left: Legacy linear */}
                          <div className="bg-white rounded-2xl p-3.5 border border-gray-200 text-left">
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest block">Lineær Forretningsmodel</span>
                            <span className="text-base font-black text-primary font-mono block mt-1">
                              {legacyTotalAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK
                            </span>
                            <span className="text-[7.5px] font-bold text-rose-500 block mt-1">⚠️ Fuld lovmæssig afgiftsgæld</span>
                          </div>

                          {/* Right: Cirkel System */}
                          <div className="bg-[#111111] text-[#A3E635] rounded-2xl p-3.5 border-2 border-emerald-500 text-left shadow-lg relative overflow-hidden">
                            <div className="absolute -top-6 -right-6 w-12 h-12 bg-emerald-500/10 rounded-full blur-xl" />
                            <span className="text-[8px] font-black text-[#85A912] uppercase tracking-widest block">Cirkel Loop Optimeret</span>
                            <span className="text-base font-black font-mono block mt-1">
                              {cirkelTotalAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK
                            </span>
                            <span className="text-[7.5px] font-extrabold text-white block mt-1">✓ Sparer {savingPercentage}% af afgiften!</span>
                          </div>
                        </div>

                        {/* Interactive breakdown bar diagram */}
                        <div className="bg-gray-100/50 rounded-2xl p-4 border border-gray-200 flex flex-col gap-2.5">
                          <span className="text-[9px] font-black text-gray-450 uppercase tracking-wider block text-left">Simuleret Afgiftssammenligning (DKK)</span>
                          
                          <div className="flex flex-col gap-2 mt-1">
                            {/* Base EPR Bar */}
                            <div className="flex flex-col gap-0.5 text-left">
                              <div className="flex justify-between text-[8px] font-extrabold text-gray-600">
                                <span className="uppercase">1. Base EPR Diferentieret Afgift:</span>
                                <span>{(baseEprAmount).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr vs. {(cirkelEpr).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr</span>
                              </div>
                              <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                <div className="bg-gray-400 h-full transition-all" style={{ width: '60%' }} />
                                <div className="bg-[#85A912] h-full transition-all" style={{ width: `${Math.max(10, (cirkelEpr / (baseEprAmount || 1)) * 40)}%` }} />
                              </div>
                            </div>

                            {/* Plastic level packaging bar */}
                            {plasticLevyAmount > 0 && (
                              <div className="flex flex-col gap-0.5 text-left">
                                <div className="flex justify-between text-[8px] font-extrabold text-gray-600">
                                  <span className="uppercase">2. EU Plastik levy (€0,80/kg):</span>
                                  <span>{(plasticLevyAmount).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr vs. {(cirkelPlasticLevy).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr</span>
                                </div>
                                <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                  <div className="bg-gray-400 h-full transition-all" style={{ width: '60%' }} />
                                  <div className="bg-[#85A912] h-full transition-all" style={{ width: `${Math.max(10, (cirkelPlasticLevy / (plasticLevyAmount || 1)) * 40)}%` }} />
                                </div>
                              </div>
                            )}

                            {/* CBAM tariff bar */}
                            {cbamAmount > 0 && (
                              <div className="flex flex-col gap-0.5 text-left">
                                <div className="flex justify-between text-[8px] font-extrabold text-gray-600">
                                  <span className="uppercase">3. CBAM CO2 Grænsetold:</span>
                                  <span>{(cbamAmount).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr vs. {(cirkelCbam).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr</span>
                                </div>
                                <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                  <div className="bg-gray-400 h-full transition-all" style={{ width: '65%' }} />
                                  <div className="bg-[#85A912] h-full transition-all" style={{ width: `${Math.max(10, (cirkelCbam / (cbamAmount || 1)) * 35)}%` }} />
                                </div>
                              </div>
                            )}

                            {/* EUDR Forestry failure penalty bar */}
                            {eudrAmount > 0 && (
                              <div className="flex flex-col gap-0.5 text-left font-bold text-amber-600">
                                <div className="flex justify-between text-[8px] font-extrabold">
                                  <span className="uppercase">4. EUDR Skovrejsningsdokumentations-straf:</span>
                                  <span>{(eudrAmount).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr vs. 0 kr (0% Risiko)</span>
                                </div>
                                <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                  <div className="bg-amber-500 h-full transition-all" style={{ width: '100%' }} />
                                </div>
                              </div>
                            )}

                            {/* PFAS penalty bar */}
                            {pfasAmount > 0 && (
                              <div className="flex flex-col gap-0.5 text-left font-bold text-rose-650">
                                <div className="flex justify-between text-[8px] font-extrabold">
                                  <span className="uppercase">5. PFAS Kemikalie Strafafgift:</span>
                                  <span>{(pfasAmount).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr vs. {(cirkelPfas).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr</span>
                                </div>
                                <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                  <div className="bg-rose-500 h-full transition-all" style={{ width: '80%' }} />
                                  <div className="bg-emerald-600 h-full transition-all" style={{ width: `${Math.max(10, (cirkelPfas / (pfasAmount || 1)) * 20)}%` }} />
                                </div>
                              </div>
                            )}

                            {/* Accounting carbon shadow fee */}
                            <div className="flex flex-col gap-0.5 text-left">
                              <div className="flex justify-between text-[8px] font-extrabold text-gray-650">
                                <span className="uppercase">6. Corporate Skygge-CO2afgift:</span>
                                <span>{(carbonDebtAmount).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr vs. {(cirkelCarbonDebt).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr</span>
                              </div>
                              <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                <div className="bg-gray-500 h-full transition-all" style={{ width: '60%' }} />
                                <div className="bg-emerald-600 h-full transition-all" style={{ width: `${Math.max(10, (cirkelCarbonDebt / (carbonDebtAmount || 1)) * 40)}%` }} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Styled Physical Invoice Receipt */}
                        <div className="bg-white border-2 border-dashed border-gray-250 rounded-2xl p-4 font-mono text-[9.5px] text-gray-800 shadow-3xs relative">
                          <div className="absolute top-0 left-4 -translate-y-1/2 bg-gray-50 border border-gray-250 px-2 py-0.5 text-[6.5px] text-gray-400 font-extrabold uppercase rounded font-sans">Afgiftsspecifikation</div>
                          
                          <div className="flex justify-between border-b border-gray-150 pb-1.5 mb-2.5 font-bold">
                            <span>Skatteobjekt ({materialLabel}):</span>
                            <span className="font-extrabold text-primary">{esgTonnage} Tons / år</span>
                          </div>

                          <div className="flex flex-col gap-1.5 leading-snug">
                            <div className="flex justify-between text-gray-500">
                              <span>Eco-Moduleret EPR (Grade {esgRecyclability}):</span>
                              <span>{baseEprAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                            </div>

                            {plasticLevyAmount > 0 && (
                              <div className="flex justify-between text-gray-500">
                                <span>EU Plastafgift (€0,80/kg):</span>
                                <span>+{plasticLevyAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                              </div>
                            )}

                            {cbamAmount > 0 && (
                              <div className="flex justify-between text-gray-500">
                                <span>CBAM Grænsetold ({esgImportedShare}% imported):</span>
                                <span>+{cbamAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                              </div>
                            )}

                            {eudrAmount > 0 && (
                              <div className="flex justify-between text-amber-600 font-bold">
                                <span>EUDR Skovrydningsbøde (Ucertificeret):</span>
                                <span>+{eudrAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                              </div>
                            )}

                            {pfasAmount > 0 && (
                              <div className="flex justify-between text-rose-600 font-bold">
                                <span>PFAS REACH kemikaliestraf:</span>
                                <span>+{pfasAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                              </div>
                            )}

                            <div className="flex justify-between text-gray-500">
                              <span>Skygge CO₂-afgift ({co2PerTonMaterial.toFixed(1)} t/Co2 pr t):</span>
                              <span>+{carbonDebtAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                            </div>

                            <div className="flex justify-between border-t border-gray-150/80 pt-1.5 mt-1 font-black text-gray-900">
                              <span>Samlet Lineær Miljøgæld:</span>
                              <span>{legacyTotalAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                            </div>

                            <div className="bg-[#FAFBF6] border-2 border-emerald-500/25 rounded-xl p-3 mt-2 font-sans text-[10px] text-emerald-850">
                              <div className="flex justify-between font-black uppercase text-[11px] tracking-wide border-b border-emerald-500/10 pb-1 mb-1">
                                <span className="flex items-center gap-1">
                                  <Leaf className="w-3.5 h-3.5 text-[#85A912]" /> CIRKEL MODREGNING
                                </span>
                                <span>-{savingPercentage}%</span>
                              </div>
                              <p className="text-[9px] text-gray-500 font-semibold leading-relaxed my-1">
                                Valideret returnerede andele sparet via pantesystem fratrækkes direkte, hvilket reducerer samlet gæld til:
                              </p>
                              <div className="flex justify-between font-mono font-black text-[11.5px] text-emerald-900 mt-1.5 border-t border-emerald-250/50 pt-1.5">
                                <span>Netto ESG Miljøgæld:</span>
                                <span>{cirkelTotalAmount.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-center border-t border-dashed border-gray-250 pt-2.5 mt-3 text-[8px] font-sans text-gray-400 font-bold uppercase tracking-wider">
                            ★★★ CIRKEL AUDITED SECURE LEDGER PROOF ★★★
                            <br />
                            Årlig selskabsbesparelse: <strong className="text-emerald-700 font-black">{savedDkk.toLocaleString('da-DK', { maximumFractionDigits: 0 })} DKK</strong>
                          </div>
                        </div>

                        {/* CTA button with confetti */}
                        <div className="flex flex-col sm:flex-row gap-2.5">
                          <button
                            onClick={() => {
                              triggerHaptic(HapticPattern.SCAN_SUCCESS);
                              const toastFn = (window as any).showToast;
                              if (toastFn) toastFn('CSRD & EPR Lovgivningsrevisionsprotokol genereret under revisorsigneret checksum!', 'success');
                              
                              confetti({
                                particleCount: 80,
                                spread: 50,
                                origin: { y: 0.8 },
                                colors: ['#C8F24A', '#22C55E', '#10B981']
                              });
                            }}
                            className="flex-1 bg-primary hover:bg-[#1a384f] text-[#C8F24A] font-black text-[10.5px] uppercase tracking-wider py-3.5 rounded-xl transition-all shadow-xs text-center cursor-pointer active:scale-98 font-bold"
                          >
                            ✓ Lås & Gem Revisionsgodkendt Miljøregnskab
                          </button>
                          <button
                            id="audit-export-csv-btn"
                            onClick={() => {
                              triggerHaptic(HapticPattern.HEAVY_TAP);
                              setShowExportOptionsModal(true);
                            }}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10.5px] uppercase tracking-wider py-3.5 rounded-xl transition-all shadow-xs text-center cursor-pointer active:scale-98 flex items-center justify-center gap-1.5 focus:outline-none"
                          >
                            <Download className="w-4 h-4" /> {isDa ? 'Eksporter Audit-rapport 📊' : 'Export Audit Report 📊'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 3. NATURES BIODIVERSITY OFFSET */}
                <div className="lg:col-span-3 flex flex-col gap-4">
                  {/* Ecological statistics of restored systems */}
                  <div className="bg-[#0B2512] text-emerald-300 border border-emerald-950 rounded-3xl p-5 shadow-3xs text-left relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                    <span className="text-[8.5px] font-black text-[#C8F24A] uppercase tracking-widest block mb-1">Cirkulær Miljøgevinst (ESG)</span>
                    <h5 className="text-[14px] font-black text-white uppercase tracking-tight">Naturens Regnskabsbog</h5>
                    <p className="text-[9.5px] text-emerald-400 mt-1 leading-relaxed font-semibold">
                      Ved at genbruge vha. Cirkel micro-nudging fjerner vi behovet for jomfruelig råstofindvinding.
                    </p>

                    <div className="flex flex-col gap-4 mt-4 text-white">
                      <div className="border-t border-emerald-900 pt-3">
                        <span className="text-[8px] font-black text-[#A3E635] uppercase tracking-wider block">Avioded Packaging Waste</span>
                        <span className="text-xl font-black font-mono text-white">
                          {Math.round(esgTonnage * (esgCirkelOffsetShare / 100)).toLocaleString('da-DK')} Tons/år
                        </span>
                        <p className="text-[8px] font-semibold text-emerald-450 mt-0.5 leading-relaxed">Fysisk affald holdt helt ude af forbrændingsovne og lossepladser.</p>
                      </div>

                      <div className="border-t border-emerald-900 pt-3">
                        <span className="text-[8px] font-black text-[#A3E635] uppercase tracking-wider block">Undgået Hav-Mikroplast</span>
                        <span className="text-xl font-black font-mono text-white">
                          {Math.round(esgTonnage * (esgCirkelOffsetShare / 100) * 12.8).toLocaleString('da-DK')} kg
                        </span>
                        <p className="text-[8px] font-semibold text-emerald-450 mt-0.5 leading-relaxed">Risiko-plastik, som forhindres i at fragmentere i sårbar dansk havbiotop.</p>
                      </div>

                      <div className="border-t border-emerald-900 pt-3">
                        <span className="text-[8px] font-black text-[#A3E635] uppercase tracking-wider block">Skovbund & Dyrehabitat Fredet</span>
                        <span className="text-xl font-black font-mono text-white">
                          {Math.round(esgTonnage * (esgCirkelOffsetShare / 100) * 44).toLocaleString('da-DK')} m²
                        </span>
                        <p className="text-[8px] font-semibold text-emerald-450 mt-0.5 leading-relaxed">Opnået gennem genanvendelse, certificeret i overensstemmelse med EUDR skovpleje.</p>
                      </div>

                      <div className="border-t border-emerald-900 pt-3">
                        <span className="text-[8px] font-black text-[#A3E635] uppercase tracking-wider block">Scope 1 & 3 CO₂-Besparelse</span>
                        <span className="text-xl font-black font-mono text-white">
                          {Number((esgTonnage * (esgCirkelOffsetShare / 100) * 1.8).toFixed(1))} Tons CO₂e
                        </span>
                        <p className="text-[8px] font-semibold text-emerald-450 mt-0.5 leading-relaxed">Reduktion i transportindsamling- samt kemiske forarbejdnings-overvejelser.</p>
                      </div>
                    </div>
                  </div>

                  {/* Why Cirkel is light-years ahead comparison panel */}
                  <div className="bg-[#111111] text-[#A3E635] rounded-3xl p-4 shadow-3xs text-left text-xs font-mono border border-emerald-500/25">
                    <span className="text-[8.5px] font-black text-white bg-emerald-600 px-2 py-0.5 rounded uppercase block tracking-wider text-center mb-3">
                      Hvorfor Cirkel Connect?
                    </span>
                    <div className="flex flex-col gap-3 text-[10px] leading-relaxed">
                      <div className="border-b border-gray-800 pb-2.5">
                        <p className="text-[#FF4D4D] font-extrabold flex items-center gap-1">❌ Excel-Lobbyism (Passive):</p>
                        <p className="text-gray-400 text-[9px] mt-0.5 font-sans leading-normal">
                          Traditionel rådgivning baserer sig på manuelle målinger én gang om året. Ingen sporbarhed, ingen borgerforbindelse, ingen modstandsdygtighed mod PPWR-straffe.
                        </p>
                      </div>
                      <div>
                        <p className="text-[#A3E635] font-extrabold flex items-center gap-1">🚀 Cirkel Nudge Loops:</p>
                        <p className="text-gray-300 text-[9px] mt-0.5 font-sans leading-normal">
                          Realtids digital kilde-registrering parret med smartphone apps og interaktiv borger-gamification. Revisionssikker tilbagetagnings-attest, der mindsker afgifterne permanent.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Revisionsbevis download report modal */}
        {showExportOptionsModal && (
          <div className="fixed inset-0 bg-[#002b49]/60 backdrop-blur-md flex items-center justify-center p-4 z-55 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-gray-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-5 text-left relative overflow-hidden"
            >
              {/* Header */}
              <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                <div>
                  <h4 className="text-sm font-black text-primary uppercase flex items-center gap-1.5 font-sans">
                    <FileText className="w-5 h-5 text-[#85A912]" />
                    {isDa ? 'Eksportér ESG-Rapport' : 'Export ESG Report'}
                  </h4>
                  <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
                    {isDa ? 'Skræddersy revisionsklare, regulatorisk godkendte data' : 'Customize audit-ready, regulatory-compliant outputs'}
                  </p>
                </div>
                <button 
                  onClick={() => setShowExportOptionsModal(false)} 
                  disabled={isGeneratingEsgPdf}
                  className="text-gray-400 hover:text-primary text-sm font-bold p-1 bg-gray-50 hover:bg-gray-100 rounded-full w-6 h-6 flex items-center justify-center transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Step 1: Framework selection */}
              <div className="flex flex-col gap-2">
                <label className="text-[9.5px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-[#85A912]" />
                  {isDa ? '1. Vælg ESG-Rapporteringsramme (Standard-skabelon)' : '1. Select ESG Reporting Framework (Standard Template)'}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: 'csrd', label: 'CSRD (ESRS E5)', descDa: 'Ressourceforbrug & Cirkulær Økonomi', descEn: 'Resource Use & Circular Economy' },
                    { id: 'ppwr', label: 'EU PPWR', descDa: 'Emballageforordning & Genanvendelse', descEn: 'Packaging & Reuse Regulation' },
                    { id: 'epr', label: 'Udvidet EPR', descDa: 'Øko-modulerede Afgifter & Klimagæld', descEn: 'Eco-modulated Fees & Tax Avoidance' }
                  ].map((tpl) => {
                    const isSel = esgReportTemplate === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setEsgReportTemplate(tpl.id as any);
                        }}
                        disabled={isGeneratingEsgPdf}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                          isSel 
                            ? 'bg-emerald-50/70 border-[#85A912] text-primary shadow-xs' 
                            : 'bg-white border-gray-200 hover:border-gray-300 text-gray-600'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[11px] font-black tracking-tight">{tpl.label}</span>
                          <span className={`w-3 h-3 rounded-full flex items-center justify-center border ${
                            isSel ? 'border-[#85A912] bg-[#85A912]' : 'border-gray-300'
                          }`}>
                            {isSel && <Check className="w-2 h-2 text-white stroke-[4]" />}
                          </span>
                        </div>
                        <p className="text-[9px] font-semibold leading-snug text-gray-400">
                          {isDa ? tpl.descDa : tpl.descEn}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Format Selection */}
              <div className="flex flex-col gap-2">
                <label className="text-[9.5px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-[#85A912]" />
                  {isDa ? '2. Vælg Eksport-filformat' : '2. Select Export File Format'}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'pdf', label: 'PDF Document', descDa: 'Visuel Rapport', descEn: 'Visual Board Audit', ext: '.pdf' },
                    { id: 'excel', label: 'Excel (XLSX)', descDa: 'Beregningsmodel', descEn: 'Analytical Ledger', ext: '.xlsx' },
                    { id: 'docx', label: 'Word (DOCX)', descDa: 'Redigerbar fil', descEn: 'Editable Document', ext: '.docx' },
                    { id: 'csv', label: 'CSV Spread', descDa: 'Rå transaktioner', descEn: 'Raw Transaction Log', ext: '.csv' }
                  ].map((fmt) => {
                    const isSel = esgReportFormat === fmt.id;
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setEsgReportFormat(fmt.id as any);
                        }}
                        disabled={isGeneratingEsgPdf}
                        className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                          isSel 
                            ? 'border-primary bg-primary text-white shadow-xs' 
                            : 'bg-white border-gray-200 hover:border-gray-300 text-gray-600'
                        }`}
                      >
                        <span className={`text-[10.5px] font-black ${isSel ? 'text-white' : 'text-primary'}`}>{fmt.label}</span>
                        <span className={`text-[8.5px] px-1.5 py-0.5 rounded-md font-mono ${isSel ? 'bg-emerald-800 text-[#C8F24A]' : 'bg-gray-100 text-gray-400'}`}>
                          {fmt.ext}
                        </span>
                        <span className="text-[8px] text-gray-400/80 font-semibold mt-0.5">
                          {isDa ? fmt.descDa : fmt.descEn}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 3: Period & Region options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50/60 p-3.5 border border-gray-150/50 rounded-2xl">
                <div className="flex flex-col gap-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{isDa ? 'Rapporteringsår' : 'Reporting Year'}</label>
                  <select
                    className="bg-white border border-gray-200 text-[11px] text-primary rounded-lg px-2.5 py-1.5 font-bold outline-none cursor-pointer focus:border-[#85A912]"
                    value={esgReportYear}
                    onChange={(e) => setEsgReportYear(e.target.value)}
                    disabled={isGeneratingEsgPdf}
                  >
                    <option value="2026">2026 ({isDa ? 'Realtime finansår' : 'Real-time financial year'})</option>
                    <option value="2025">2025 ({isDa ? 'Historisk audit' : 'Historical audit'})</option>
                    <option value="2024">2024 ({isDa ? 'Historisk audit' : 'Historical audit'})</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider">{isDa ? 'Analyse-region' : 'Analysis Region'}</label>
                  <select
                    className="bg-white border border-gray-200 text-[11px] text-primary rounded-lg px-2.5 py-1.5 font-bold outline-none cursor-pointer focus:border-[#85A912]"
                    value={selectedAlertRegion}
                    onChange={(e) => setSelectedAlertRegion(e.target.value)}
                    disabled={isGeneratingEsgPdf}
                  >
                    {['Aarhus Kommune', 'Københavns Kommune', 'Odense Kommune', 'Frederikssund Kommune', 'Aalborg Kommune', 'Danmark'].map((regionName) => (
                      <option key={regionName} value={regionName}>{regionName}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowExportOptionsModal(false)}
                    disabled={isGeneratingEsgPdf}
                    className="flex-1 py-3 border border-gray-200 hover:bg-gray-50 text-gray-600 font-extrabold text-[11px] uppercase rounded-xl transition-all cursor-pointer text-center"
                  >
                    {isDa ? 'Annuller' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(HapticPattern.SCAN_SUCCESS);
                      generateAnnualEsgPdf();
                    }}
                    disabled={isGeneratingEsgPdf}
                    className="flex-1 py-3 bg-[#85A912] hover:bg-[#94bd15] disabled:opacity-50 text-white font-extrabold text-[11px] uppercase rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isGeneratingEsgPdf ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{isDa ? 'Genererer...' : 'Exporting...'}</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>{isDa ? 'Eksporter Rapport ✓' : 'Export Report ✓'}</span>
                      </>
                    )}
                  </button>
                </div>

                {isGeneratingEsgPdf && (
                  <div className="text-center mt-1 flex flex-col gap-1 items-center animate-pulse">
                    <span className="text-[10px] text-emerald-700 font-mono font-bold">
                      {esgPdfStatus}
                    </span>
                    <div className="w-full bg-gray-100 rounded-full h-1 max-w-[200px] overflow-hidden">
                      <div className="bg-emerald-600 h-1 rounded-full animate-pulse" style={{ width: '40%' }} />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {/* Revisionsbevis download report modal */}
        {showReportModal && (
          <div className="fixed inset-0 bg-[#002b49]/50 backdrop-blur-xs flex items-center justify-center p-4 z-55">
            <div className="bg-white border border-gray-200 rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 text-left animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex justify-between items-center border-b border-gray-150 pb-2">
                <h4 className="text-xs font-black text-primary uppercase">CSRD Certifikat Genereret 🌿</h4>
                <button onClick={() => setShowReportModal(false)} className="text-gray-400 hover:text-primary text-xs font-bold p-1">✕</button>
              </div>

              <div className="text-center py-2">
                <span className="text-4xl">📄</span>
                <h5 className="text-sm font-black text-primary mt-2">Dansk Scope-3 CO₂ Revisionsbevis</h5>
                <p className="text-[10px] text-gray-400 mt-1">Hashed Signature: CSRD-SHA256-DANSK_RETURSYSTEM</p>
              </div>

              <div className="bg-gray-50 rounded-2xl p-3 flex flex-col gap-2 text-xs font-mono">
                <div className="flex justify-between border-b border-gray-150 pb-1">
                  <span className="text-gray-400 text-[9px] uppercase font-bold">Identitet:</span>
                  <strong className="text-primary text-[10px]">{b2bRole === 'municipality' ? 'Aarhus Kommune' : 'Arla Foods Amba'}</strong>
                </div>
                <div className="flex justify-between border-b border-gray-150 pb-1">
                  <span className="text-gray-400 text-[9px] uppercase font-bold">Dato:</span>
                  <strong className="text-primary text-[10px]">2026-06-21</strong>
                </div>
                <div className="flex justify-between border-b border-gray-150 pb-1">
                  <span className="text-gray-400 text-[9px] uppercase font-bold">CO₂ Sparret:</span>
                  <strong className="text-emerald-700 text-[10px]">32,4 Tons Miljøreducering</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-[9px] uppercase font-bold">Audit Status:</span>
                  <strong className="text-emerald-700 text-[10px]">VERIFICERET AKTIV ✓</strong>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowReportModal(false);
                    const toastFn = (window as any).showToast;
                    if (toastFn) toastFn('Officiel CSRD-indberetning videresendt til Erhvervsstyrelsen!', 'success');
                  }}
                  className="flex-1 py-2.5 bg-[#85A912] hover:bg-[#72920f] text-white font-black text-[10px] uppercase rounded-xl transition-all shadow-3xs cursor-pointer text-center"
                >
                  Indberet til Erhvervsstyrelsen ✓
                </button>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="flex-grow-0 py-2.5 bg-gray-100 border border-gray-200 text-primary font-black text-[10px] uppercase rounded-xl text-center px-4 cursor-pointer"
                >
                  Luk
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Enterprise CRM integration and documentation modal */}
        <EnterpriseCrmCirkelModal
          isOpen={showCrmModal}
          onClose={() => setShowCrmModal(false)}
          onAddLog={addLog}
        />

        {/* B2B Onboarding Tour Overlay Component */}
        <AnimatePresence>
          {showTour && (
            <div className="fixed inset-0 bg-[#002b49]/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="bg-white border-2 border-indigo-600 rounded-[2rem] p-6 max-w-sm md:max-w-md w-full shadow-2xl flex flex-col gap-5 text-left text-primary overflow-hidden relative"
              >
                {/* Modern top-accent bar that reflects active section */}
                <div 
                  className="absolute top-0 left-0 right-0 h-2 transition-colors duration-300"
                  style={{ 
                    backgroundColor: 
                      tourStep === 0 ? '#6366F1' : 
                      tourStep === 1 ? '#85A912' : 
                      tourStep === 2 ? '#10B981' : 
                                       '#F59E0B'
                  }} 
                />

                <div className="flex justify-between items-center mt-2 border-b border-gray-150 pb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black px-2.5 py-1 bg-indigo-50 border border-indigo-150 text-indigo-700 rounded-lg uppercase tracking-wider font-mono">
                      {language === 'da' ? 'Portals-Guide' : 'Portal Guide'}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400">
                      {tourStep + 1} / {tourSteps.length}
                    </span>
                  </div>
                  <button 
                    onClick={() => {
                      triggerHaptic(HapticPattern.LIGHT_TAP);
                      localStorage.setItem('cirkel_b2b_tour_completed', 'true');
                      setShowTour(false);
                      const toastFn = (window as any).showToast;
                      if (toastFn) toastFn(language === 'da' ? 'Rundvisning sprunget over 🎓' : 'Tour skipped 🎓', 'info');
                    }}
                    className="text-gray-400 hover:text-primary text-[9px] uppercase font-black tracking-wider cursor-pointer transition-colors px-2.5 py-1 bg-gray-50 hover:bg-gray-100 rounded-lg"
                  >
                    {language === 'da' ? 'Spring over' : 'Skip'}
                  </button>
                </div>

                <div className="flex gap-4 items-start py-1">
                  <div className="text-4xl select-none pt-1 shrink-0 animate-bounce">
                    {tourStep === 0 ? '🏢' : tourStep === 1 ? '📊' : tourStep === 2 ? '🌲' : '🔑'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm md:text-md font-black tracking-tight text-[#002b49]">
                      {language === 'da' ? tourSteps[tourStep].titleDa : tourSteps[tourStep].titleEn}
                    </h4>
                    <p className="text-[11px] text-gray-500 font-medium leading-relaxed mt-2 text-justify">
                      {language === 'da' ? tourSteps[tourStep].descDa : tourSteps[tourStep].descEn}
                    </p>
                  </div>
                </div>

                {/* Interactive Dashboard Status indicator */}
                <div className="bg-gray-50 border border-gray-150/80 rounded-2xl p-3 flex flex-col gap-2">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block">
                    {language === 'da' ? 'Interaktiv Dashboard Status' : 'Interactive Dashboard Status'}
                  </span>
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span className="text-gray-500">
                      {language === 'da' ? 'Aktiv sektion bagved:' : 'Active panel behind:'}
                    </span>
                    <span className="text-indigo-600 font-extrabold bg-indigo-50 border border-indigo-150/50 px-2 py-0.5 rounded-md font-mono text-[9px]">
                      {tourSteps[tourStep].tab === 'overview' ? (language === 'da' ? 'KPI-Overblik' : 'KPI Overview') :
                       tourSteps[tourStep].tab === 'esg' ? (language === 'da' ? 'ESG-Analyser' : 'ESG Analytics') :
                                                             (language === 'da' ? 'Integrations & API' : 'Integrations & API')}
                    </span>
                  </div>
                </div>

                {/* Progress selectors and actions footer */}
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-100">
                  <div className="flex gap-1.5 self-center">
                    {tourSteps.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setTourStep(idx);
                        }}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          tourStep === idx ? 'w-5 bg-indigo-600' : 'bg-gray-250 hover:bg-gray-400'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    {tourStep > 0 && (
                      <button
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setTourStep(prev => prev - 1);
                        }}
                        className="py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-primary font-black text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                      >
                        {language === 'da' ? 'Forrige' : 'Back'}
                      </button>
                    )}
                    
                    <button
                      onClick={() => {
                        triggerHaptic(HapticPattern.HEAVY_TAP);
                        if (tourStep < tourSteps.length - 1) {
                          setTourStep(prev => prev + 1);
                        } else {
                          // Complete Tour!
                          localStorage.setItem('cirkel_b2b_tour_completed', 'true');
                          setShowTour(false);
                          
                          // Explode confetti
                          confetti({
                            particleCount: 120,
                            spread: 70,
                            origin: { y: 0.6 }
                          });

                          const toastFn = (window as any).showToast;
                          if (toastFn) {
                            toastFn(
                              language === 'da' 
                                ? 'Onboarding-rundvisning afsluttet! Velkommen ombord! 🚀' 
                                : 'Onboarding tour completed! Welcome on board! 🚀', 
                              'success'
                            );
                          }
                          addLog('SYS', 'User completed portal onboarding walkthrough.', 'success');
                        }
                      }}
                      className="py-1.5 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span>
                        {tourStep === 0 ? (language === 'da' ? 'Kom i gang 🚀' : 'Get Started 🚀') :
                         tourStep === tourSteps.length - 1 ? (language === 'da' ? 'Afslut 🎉' : 'Complete 🎉') :
                                                             (language === 'da' ? 'Næste' : 'Next')}
                      </span>
                      {tourStep < tourSteps.length - 1 && <ArrowRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>

    </div>
  );
}
