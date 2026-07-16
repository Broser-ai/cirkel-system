import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { ScanResult, UserProfile } from '../types';
import { Camera, Upload, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, RefreshCw, Sparkles, Smile, Compass, QrCode, Check, Link, HelpCircle, Info, X, ExternalLink, MessageSquare, Send, Trash2 } from 'lucide-react';
import jsQR from 'jsqr';
import RecyclingCenterMap from './RecyclingCenterMap';
import WasteBinLocator from './WasteBinLocator';
import { useLanguage } from '../lib/i18n';
import { triggerHaptic, HapticPattern } from '../lib/haptics';
import { getKommuneFromCoords } from '../lib/dawa';
// Integration-Audit #2 (accepteret 2026-07-16): dynamisk pant-sats via useDynamicDeposit
import { useDynamicDeposit } from '../hooks/useDynamicDeposit';

interface ScanTabProps {
  user: UserProfile;
  onChangeUser: (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => void;
  bal: number;
  onShowToast?: (message: string, type?: 'success' | 'info' | 'error' | 'co2', co2Value?: string) => void;
}

// Preset products for fast zero-camera testing
const PRESET_PRODUCTS = [
  { id: 'skyr', name: 'Arla® Skyr Naturel 450g', icon: '🥛' },
  { id: 'carlsberg', name: 'Carlsberg Pilsner 33cl Glass', icon: '🍺' },
  { id: 'cola', name: 'Coca-Cola Zero 0.5L PET', icon: '🥤' },
  { id: 'karton', name: 'Coop økologisk Letmælk 1L', icon: '🥛' },
  { id: 'chips', name: 'Kims Havsalt Chips 140g', icon: '🥔' },
];

const PRESET_QR_CODES = [
  { id: 'qr_arla', name: 'Arla® Mælkescan (QR)', icon: '🥛', code: 'https://cirkel.dk/guide?type=pap-mælk&EAN=5701122334411' },
  { id: 'qr_cola', name: 'Coca-Cola Pant (QR)', icon: '🥤', code: 'https://cirkel.dk/guide?type=pet-flaske&EAN=5449000214911' },
  { id: 'qr_carlsberg', name: 'Carlsberg Glas (QR)', icon: '🍺', code: 'https://cirkel.dk/guide?type=glas-flaske&EAN=5701041011221' },
  { id: 'qr_royal', name: 'Aludåse Metal (QR)', icon: '🥫', code: 'https://cirkel.dk/guide?type=metal-daase&EAN=5702030405061' },
  { id: 'qr_kims', name: 'Kims Chips (QR)', icon: '🍟', code: 'https://cirkel.dk/guide?type=chips-pose&EAN=5701234560012' }
];

const RECYCLING_TIPS = [
  {
    id: 1,
    emoji: '🧼',
    title: 'Rens og tør',
    text: 'Skyl mælkekartonen og plastbægeret overfladisk. Rester forringer kvaliteten af genvundet pap & plast markant!',
    category: 'RENGØRING',
    colorClass: 'from-blue-50/70 to-indigo-50/50 border-blue-200 text-blue-950'
  },
  {
    id: 2,
    emoji: '🧴',
    title: 'Låg & kapsler',
    text: 'Skru plastlåget af emballagen. Flasker sorteres separat fra selve plastdunken for meget bedre genanvendelse.',
    category: 'SORTERING',
    colorClass: 'from-amber-50/70 to-orange-50/50 border-amber-200 text-amber-950'
  },
  {
    id: 3,
    emoji: '📱',
    title: 'Elektronik-guld',
    text: 'Over 99% af metallerne i gamle mobiltelefoner kan genbruges. Aflever dem altid i genbrugshusets dertil indrettede kasser.',
    category: 'GENANVENDELSE',
    colorClass: 'from-purple-50/70 to-pink-50/50 border-purple-200 text-purple-950'
  },
  {
    id: 4,
    emoji: '🥫',
    title: 'Dåser & metal',
    text: 'Genanvendelse af aluminium kræver kun 5% af den energi, der skal bruges til at fremstille nyt. Husk panten!',
    category: 'ENERGI',
    colorClass: 'from-emerald-50/70 to-teal-50/50 border-emerald-250 text-emerald-950'
  },
  {
    id: 5,
    emoji: '📦',
    title: 'Fold dine kasser',
    text: 'Ved at mase papkasser sparer du op til 70% plads i renovationstankene, så affaldsvognene undgår unødig kørsel.',
    category: 'PAKNING',
    colorClass: 'from-teal-50/70 to-cyan-50/50 border-teal-200 text-teal-950'
  },
  {
    id: 6,
    emoji: '🍕',
    title: 'Glem pizzabakken',
    text: 'Papkasser fra pizza må *ikke* komme i den rene papbeholder på grund af fedt og madrester. Sorter som restaffald.',
    category: 'MADRESTER',
    colorClass: 'from-rose-50/70 to-red-50/50 border-rose-250 text-rose-955'
  },
  {
    id: 7,
    emoji: '🍌',
    title: 'Grøn bio-energi',
    text: 'Mad- og bioaffald omdannes til grøn fjernvarme, el samt gødning til markerne. Hver bananskræl tæller med!',
    category: 'BIOGAS',
    colorClass: 'from-yellow-50/80 to-amber-50/50 border-yellow-250 text-amber-955'
  }
];

interface QRResultDetails {
  productName: string;
  materialShort: string;
  grade: string;
  co2Saved: string;
  waterSaved: string;
  energySaved: string;
  pantValue: string;
  materialType: string;
  recyclablePercent: string;
  manufacturer: string;
  packagingWeight: string;
  circularScore: string;
  eprStatus: string;
  sortingType: string;
  sortingInstructions: string;
  decodedRaw: string;
  qrScannerIcon?: string;
  didYouKnow?: string;
}

const parseQRContent = (qrData: string, municipality: string): QRResultDetails => {
  const dataLower = qrData.toLowerCase();
  
  if (dataLower.includes('pap-mælk') || dataLower.includes('letmælk') || qrData.includes('5701122334411')) {
    return {
      productName: 'Arla® Økologisk Letmælk 1L',
      materialShort: 'Flydende papkarton · QR: 5701122334411',
      grade: 'A',
      co2Saved: '45g',
      waterSaved: '1.2L',
      energySaved: '0.4kWh',
      pantValue: '0.00',
      materialType: 'FSC-Certificeret Karton med biologisk barriere',
      recyclablePercent: '92%',
      manufacturer: 'Arla Foods Amba',
      packagingWeight: '28g',
      circularScore: '94',
      eprStatus: 'Registreret & Afgift betalt ✓',
      sortingType: 'Mad- & drikkekartoner',
      sortingInstructions: `Skyl kartonen fri for rester, fold den sammen for at spare plads, og sorter som Mad- & drikkekartoner in ${municipality}.`,
      decodedRaw: qrData,
      qrScannerIcon: '🥛',
      didYouKnow: 'Vidste du, at mad- & drikkekartoner i dag genanvendes til spændende nye pap- og kartonprodukter? Fibrene i disse kartoner er af så høj og stærk kvalitet, at de kan genbruges op til 7-8 gange!'
    };
  }
  
  if (dataLower.includes('pet-flaske') || dataLower.includes('cola') || qrData.includes('5449000214911')) {
    return {
      productName: 'Coca-Cola Zero 0.5L PET-flaske',
      materialShort: 'Genanvendt plast · QR: 5449000214911',
      grade: 'A+',
      co2Saved: '60g',
      waterSaved: '2.5L',
      energySaved: '0.8kWh',
      pantValue: '1.50',
      materialType: '100% Recycled PET Plastik',
      recyclablePercent: '100%',
      manufacturer: 'Coca-Cola Europacific Partners',
      packagingWeight: '18g',
      circularScore: '98',
      eprStatus: 'Dansk Retursystem Pant A ✓',
      sortingType: '♻️ Pant A (Plastflaske)',
      sortingInstructions: `Skyl ikke, behold låget på for at bevare tætheden, og aflever i pantautomaten for 1,50 kr. i refusion.`,
      decodedRaw: qrData,
      qrScannerIcon: '🥤',
      didYouKnow: 'Vidste du, at en fuldt genanvendt rPET plastflaske sparer helt op til 75% af CO₂-udledningen sammenlignet med fremstilling af ny jomfruelig råolieplast!'
    };
  }
  
  if (dataLower.includes('glas-flaske') || dataLower.includes('carlsberg') || qrData.includes('5701041011221')) {
    return {
      productName: 'Carlsberg Pilsner 33cl Returflaske',
      materialShort: 'Grønt genbrugsglas · QR: 5701041011221',
      grade: 'A++',
      co2Saved: '110g',
      waterSaved: '3.1L',
      energySaved: '1.4kWh',
      pantValue: '1.00',
      materialType: 'Sodavand/øl-glas (Vaskbar)',
      recyclablePercent: '100%',
      manufacturer: 'Carlsberg Danmark A/S',
      packagingWeight: '210g',
      circularScore: '100',
      eprStatus: 'Dansk Retursystem Pant B ✓',
      sortingType: '🍺 Pant B (Glasflaske)',
      sortingInstructions: `Tøm flasken for indhold, behold den ubeskadiget og aflever i den lokale flaskeautomat for 1,00 kr. i refusion.`,
      decodedRaw: qrData,
      qrScannerIcon: '🍺',
      didYouKnow: 'Vidste du, at glas kan smeltes om uendeligt mange gange uden overhovedet at tabe kvalitet? Hver gang vi genbruger en returglasflaske, sparer vi store mængder kvartssand og kalk direkte fra naturen.'
    };
  }

  if (dataLower.includes('metal-daase') || dataLower.includes('royal') || qrData.includes('5702030405061')) {
    return {
      productName: 'Royal Pilsner 33cl Aluminiumsdåse',
      materialShort: 'Letvægts aluminium · QR: 5702030405061',
      grade: 'A+',
      co2Saved: '140g',
      waterSaved: '1.8L',
      energySaved: '1.9kWh',
      pantValue: '1.00',
      materialType: '99% Genanvendt Aluminium',
      recyclablePercent: '100%',
      manufacturer: 'Royal Unibrew A/S',
      packagingWeight: '12g',
      circularScore: '99',
      eprStatus: 'Dansk Retursystem Pant B ✓',
      sortingType: '🥫 Pant B (Alu-dåse)',
      sortingInstructions: `Tøm helt og aflever i den nærmeste pantautomat eller Cirkel Drop-Point for optimal genanvendelse bagefter.`,
      decodedRaw: qrData,
      qrScannerIcon: '🥫',
      didYouKnow: 'Vidste du, at omsmeltning af genanvendt aluminium kun kræer 5% af den energi, der oprindeligt skal til for at producere nyt metal? Det gør aluminiumsdåser til fantastiske cirkulære helte!'
    };
  }

  if (dataLower.includes('chips-pose') || dataLower.includes('kims') || qrData.includes('5701234560012')) {
    return {
      productName: 'Kims® Havsalt Kartoffelchips 140g',
      materialShort: 'Sammensat plastfolie · QR: 5701234560012',
      grade: 'B',
      co2Saved: '15g',
      waterSaved: '0.4L',
      energySaved: '0.2kWh',
      pantValue: '0.00',
      materialType: 'Flerlags komposit PP-plastfolie',
      recyclablePercent: '60%',
      manufacturer: 'Orkla Confectionery & Snacks',
      packagingWeight: '6g',
      circularScore: '65',
      eprStatus: 'Registreret ✓',
      sortingType: '🍟 Blød plastemballage',
      sortingInstructions: `Ryst chipsrester ud af posen, fold den sammen og læg i beholderen til Blød plast (eller restaffald afhængig af sorteringen i ${municipality}).`,
      decodedRaw: qrData,
      qrScannerIcon: '🍟',
      didYouKnow: 'Vidste du, at moderne chipsposer består af avanceret, ekstremt ultratynd flerlags-plastik? Det beskytter chips mod ilt og lys optimalt, og genanvendelsesteknologier kan i dag omdanne dem til nyttige industrielle plastfibre.'
    };
  }

  // Fallback for custom decoded QR values or generic links
  const isUrl = qrData.startsWith('http://') || qrData.startsWith('https://');
  const cleanLabel = isUrl ? qrData.replace('https://', '').replace('http://', '').split('/')[0] : qrData;
  
  return {
    productName: `QR-mærket emballage: ${cleanLabel.length > 25 ? cleanLabel.substring(0, 25) + '...' : cleanLabel}`,
    materialShort: `EAN/QR: ${qrData.length > 30 ? qrData.substring(0, 30) + '...' : qrData}`,
    grade: 'B+',
    co2Saved: '30g',
    waterSaved: '0.8L',
    energySaved: '0.5kWh',
    pantValue: '0.00',
    materialType: 'Blandet genanvendeligt emballage',
    recyclablePercent: '85%',
    manufacturer: 'Producent identificeret via QR-kode',
    packagingWeight: '14g',
    circularScore: '80',
    eprStatus: 'Registreret ✓',
    sortingType: '♻️ Genanvendelig emballage',
    sortingInstructions: `Skyl, rens og placér genstanden i den relevante genbrugsbeholder derhjemme i ${municipality}.`,
    decodedRaw: qrData,
    qrScannerIcon: '🔳',
    didYouKnow: 'Vidste du, at korrekt sortering og genanvendelse sparer miljøet for ca. 1/3 af emballagens oprindelige klimabelastning? Din daglige sortering tæller direkte med i det nationale klimaregnskab!'
  };
};

interface BinSuggestion {
  id: string;
  colorName: string;
  colorHex: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  picto: string;
  description: string;
  colorClass: string;
}

const STANDARD_DANISH_BINS = [
  { id: 'plast', label: 'Plastemballage', color: 'bg-purple-500', bgLight: 'bg-purple-50', text: 'text-purple-900', border: 'border-purple-200', activeGlow: 'shadow-[0_0_15px_rgba(168,85,247,0.55)]', icon: '🟣', translation: 'Plast & Plastfolie' },
  { id: 'pap_papir', label: 'Papir & Pap', color: 'bg-blue-500', bgLight: 'bg-blue-50', text: 'text-blue-900', border: 'border-blue-200', activeGlow: 'shadow-[0_0_15px_rgba(59,130,246,0.55)]', icon: '🔵', translation: 'Pap & Papir' },
  { id: 'karton', label: 'Mad & Drikkekarton', color: 'bg-emerald-600', bgLight: 'bg-emerald-50', text: 'text-emerald-950', border: 'border-emerald-200', activeGlow: 'shadow-[0_0_15px_rgba(16,185,129,0.55)]', icon: '🟢', translation: 'Mad- & Drikkekarton' },
  { id: 'glas_metal', label: 'Glas & Metal', color: 'bg-teal-500', bgLight: 'bg-teal-50', text: 'text-teal-900', border: 'border-teal-200', activeGlow: 'shadow-[0_0_15px_rgba(20,184,166,0.55)]', icon: '🐳', translation: 'Glas & Metal' },
  { id: 'madaffald', label: 'Madaffald', color: 'bg-green-600', bgLight: 'bg-green-50', text: 'text-green-900', border: 'border-green-200', activeGlow: 'shadow-[0_0_15px_rgba(34,197,94,0.55)]', icon: '🍏', translation: 'Biomadaffald' },
  { id: 'pant', label: 'Pantautomat', color: 'bg-amber-500', bgLight: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-200', activeGlow: 'shadow-[0_0_15px_rgba(245,158,11,0.55)]', icon: '🏧', translation: 'Returpant A/B/C' },
  { id: 'restaffald', label: 'Restaffald', color: 'bg-gray-600', bgLight: 'bg-gray-50', text: 'text-gray-900', border: 'border-gray-200', activeGlow: 'shadow-[0_0_15px_rgba(107,114,128,0.55)]', icon: '⚫', translation: 'Restaffald' }
];

const getSuggestedBin = (sortingType: string, materialType: string, productName: string): BinSuggestion => {
  const st = (sortingType || '').toLowerCase();
  const mt = (materialType || '').toLowerCase();
  const pn = (productName || '').toLowerCase();

  // 1. Pant (Dansk Retursystem)
  if (st.includes('pant') || pn.includes('pant') || pn.includes('coca-cola') || pn.includes('carlsberg') || pn.includes('royal')) {
    return {
      id: 'pant',
      colorName: 'Guld / Gul (Pantautomat)',
      colorHex: '#F59E0B',
      bgClass: 'bg-amber-50',
      textClass: 'text-amber-950',
      borderClass: 'border-amber-200',
      picto: '🏧',
      description: 'Flasker og dåser med pant (A, B eller C) skal indleveres i pantautomaten eller i et genbrugscenter mod kontant refusion.',
      colorClass: 'bg-amber-500'
    };
  }

  // 2. Plastik / Plast (Plastic)
  if (st.includes('plast') || mt.includes('plast') || mt.includes('hdpe') || mt.includes('pet') || mt.includes('pp5')) {
    return {
      id: 'plast',
      colorName: 'Lilla / Gul (Plastemballage)',
      colorHex: '#A855F7',
      bgClass: 'bg-purple-50',
      textClass: 'text-purple-950',
      borderClass: 'border-purple-200',
      picto: '🟣',
      description: 'Plastsortering i Danmark anvender den lilla eller gule farvekode for både hård og blød husholdningsplast.',
      colorClass: 'bg-purple-500'
    };
  }

  // 3. Mad- & drikkekartoner (Food & beverage cartons)
  if (st.includes('karton') || st.includes('mad- og drikke') || mt.includes('pap-mælk') || mt.includes('karton med biopolymer')) {
    return {
      id: 'karton',
      colorName: 'Mørkegrøn (Mad- & Drikkekartoner)',
      colorHex: '#059669',
      bgClass: 'bg-emerald-50',
      textClass: 'text-emerald-950',
      borderClass: 'border-emerald-200',
      picto: '🟢',
      description: 'Sorteres separat i beholderen til mad- & drikkekartoner. Skylles kortvarigt for mælkerester og mases flad.',
      colorClass: 'bg-emerald-600'
    };
  }

  // 4. Glas & Metal
  if (st.includes('glas') || mt.includes('glas') || pn.includes('glas')) {
    return {
      id: 'glas_metal',
      colorName: 'Aqua/Turkis (Glas & Flasker)',
      colorHex: '#14B8A6',
      bgClass: 'bg-teal-50',
      textClass: 'text-teal-950',
      borderClass: 'border-teal-200',
      picto: '🐳',
      description: 'Glas og emballageflasker uden pant skal tømmes helt og sorteres i den fælles glascontainer.',
      colorClass: 'bg-teal-500'
    };
  }

  if (st.includes('metal') || mt.includes('alu') || mt.includes('metal') || mt.includes('stål') || st.includes('dåse')) {
    return {
      id: 'glas_metal',
      colorName: 'Aqua/Turkis (Metal)',
      colorHex: '#14B8A6',
      bgClass: 'bg-teal-50',
      textClass: 'text-teal-950',
      borderClass: 'border-teal-200',
      picto: '🐳',
      description: 'Metalemballage som konservesdåser skal tømmes og afleveres fri for snavs i beholderen til genanvendeligt metal.',
      colorClass: 'bg-teal-500'
    };
  }

  // 5. Pap og Papir (Cardboard & Paper)
  if (st.includes('pap') || st.includes('papir') || mt.includes('papir') || mt.includes('pap')) {
    return {
      id: 'pap_papir',
      colorName: 'Lyseblå (Papir & Pap)',
      colorHex: '#3B82F6',
      bgClass: 'bg-blue-50',
      textClass: 'text-blue-955',
      borderClass: 'border-blue-200',
      picto: '🔵',
      description: 'Afleveres rent og tørt i pap- og papirbeholderen. Madrester samt vådt papir må ikke afleveres her.',
      colorClass: 'bg-blue-500'
    };
  }

  // 6. Madaffald / Bioaffald (Food waste)
  if (st.includes('biol') || st.includes('mad') || st.includes('madaffald') || st.includes('organisk')) {
    return {
      id: 'madaffald',
      colorName: 'Grøn (Madaffald)',
      colorHex: '#22C55E',
      bgClass: 'bg-green-50',
      textClass: 'text-green-950',
      borderClass: 'border-green-200',
      picto: '🍏',
      description: 'Alt spiseligt biologisk madaffald skal i de grønne bioaffaldsposer og derefter i madaffaldsbeholderen.',
      colorClass: 'bg-green-600'
    };
  }

  // Default / Fallback: Restaffald
  return {
    id: 'restaffald',
    colorName: 'Koksgrå (Restaffald)',
    colorHex: '#4B5563',
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-950',
    borderClass: 'border-gray-200',
    picto: '⚫',
    description: 'Blandet og ikke-genanvendeligt affald, der ikke passer ind under de øvrige særskilte kategorier.',
    colorClass: 'bg-gray-600'
  };
};

function LiveScanLabel() {
  const [labelIdx, setLabelIdx] = React.useState(0);
  const labels = [
    "Søger efter stregkode...",
    "Ret kameraet mod emballagen",
    "Automatisk genkendelse aktiv",
    "Klar til foto-verifikation"
  ];

  React.useEffect(() => {
    const timer = setInterval(() => {
      setLabelIdx((prev) => (prev + 1) % labels.length);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return <span>{labels[labelIdx]}</span>;
}

// Sparkly audio-haptic feedback trigger for scan & claim successes
function playScanSuccessFeedback() {
  // Vibration feedback
  triggerHaptic(HapticPattern.SCAN_SUCCESS);

  // Web Audio chime
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Deep modern "sonar-ping/bubble-pop" synth sound
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.2); // Elevates to C6

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);

    // High accent/shimmer frequency
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1567.98, now + 0.08); // G6 sparkle
    
    gain2.gain.setValueAtTime(0.06, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.25);
  } catch (error) {
    console.warn("Failed playing audio feedback:", error);
  }
}

const SMART_BINS_DATA = [
  { name: 'Cirkel IoT Smart-Spand Dokk1', address: 'Hack Kampmanns Plads 2, 8000 Aarhus C', lat: 56.1538, lng: 10.2135, city: 'Aarhus' },
  { name: 'Cirkel IoT Smart-Spand Banegårdspladsen', address: 'Banegårdspladsen 1, 8000 Aarhus C', lat: 56.1504, lng: 10.2045, city: 'Aarhus' },
  { name: 'Cirkel IoT Smart-Spand Åboulevarden', address: 'Åboulevarden 26, 8000 Aarhus C', lat: 56.1565, lng: 10.2095, city: 'Aarhus' },
  { name: 'Cirkel IoT Smart-Spand Salling', address: 'Østergade 25, 8000 Aarhus C', lat: 56.1558, lng: 10.2069, city: 'Aarhus' },
  { name: 'Cirkel IoT Smart-Spand Nørrebro Runddel', address: 'Nørrebrogade 120, 2200 København N', lat: 55.6948, lng: 12.5485, city: 'København' },
  { name: 'Cirkel IoT Smart-Spand Vesterport', address: 'Vesterbrogade 10, 1620 København V', lat: 55.6749, lng: 12.5621, city: 'København' }
];

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

// Custom high-performance confetti animations
const triggerConfettiScanned = () => {
  confetti({
    particleCount: 80,
    spread: 60,
    origin: { y: 0.6 },
    colors: ['#C8F24A', '#85A912', '#22C55E', '#3B82F6', '#F59E0B']
  });
};

const triggerConfettiGoal = () => {
  const duration = 1.8 * 1000;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.85 },
      colors: ['#C8F24A', '#85A912', '#22C55E', '#10B981', '#FFD700', '#FFFFFF']
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.85 },
      colors: ['#C8F24A', '#85A912', '#22C55E', '#10B981', '#FFD700', '#FFFFFF']
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  }());
};

interface ARComponent {
  id: string;
  name: string;
  material: string;
  type: 'recyclable' | 'landfill' | 'pant';
  x: number; // percentage from left
  y: number; // percentage from top
  desc: string;
  tip: string;
}

const getARComponents = (productName: string, materialType: string): ARComponent[] => {
  const name = (productName || '').toLowerCase();
  const mat = (materialType || '').toLowerCase();

  if (name.includes('arla') || name.includes('mælk') || name.includes('karton') || name.includes('skyr') || name.includes('juice')) {
    return [
      {
        id: 'cap',
        name: 'Plastiklåg / Skruelåg 🥛',
        material: 'PE-HD (Hård plast)',
        type: 'recyclable',
        x: 62,
        y: 18,
        desc: 'Skruelåget af hård HDPE-plast er fuldt genanvendeligt og værdifuldt for genbrugsindustrien.',
        tip: 'Skru altid låget på eller sorter det direkte i beholderen til Plast.'
      },
      {
        id: 'collar',
        name: 'Gevind / Plastkrave ⚙️',
        material: 'PE-LD (Blød plast)',
        type: 'recyclable',
        x: 62,
        y: 28,
        desc: 'Gevindet holder skruelåget fast på kartonen. Det skilles ad maskinelt under genbrug.',
        tip: 'Du behøver ikke skære plastikringen af kartonen – lad sorteringsanlægget gøre arbejdet!'
      },
      {
        id: 'body',
        name: 'Kartonkrop (Komposit) 📦',
        material: 'FSC-papir & PE-folie',
        type: 'recyclable',
        x: 48,
        y: 56,
        desc: 'Flerlags-emballage lavet af papirfibre med en tynd indre plastbarriere, der sorteres til mad- & drikkekartoner.',
        tip: 'Husk at skylle kartonen kort, ryste vandet ud, og mase den helt flad for at spare plads!'
      },
      {
        id: 'residual',
        name: 'Væskerester 💧',
        material: 'Biologisk mælkehinde',
        type: 'landfill',
        x: 48,
        y: 84,
        desc: 'Gamle mælkeprodukter kan skabe mug og forringe genvindingen af papirfibrene under transport.',
        tip: 'Tøm kartonen så godt du kan (den skal være "drypfri"), før du kasserer den.'
      }
    ];
  }

  if (name.includes('zero') || name.includes('coca') || name.includes('cola') || name.includes('pet') || name.includes('flaske')) {
    return [
      {
        id: 'cap',
        name: 'Skruelåg (Plast) 🧴',
        material: 'PE-HD Hård plast',
        type: 'recyclable',
        x: 50,
        y: 13,
        desc: 'Skruelåget presses om til granulat og bliver til nyt hårdt plastemballage.',
        tip: 'Skru låget tæt på flasken inden du panter den – så sikrer du, at låget også genanvendes!'
      },
      {
        id: 'label',
        name: 'Plastiketiket 🏷️',
        material: 'PP / Plastfolie',
        type: 'recyclable',
        x: 50,
        y: 50,
        desc: 'Den tynde omslagsfolie med grafik og ernæringsfakta adskilles let i svømme-synke anlægget på genbrugspladsen.',
        tip: 'Lad bare etiketten sidde på – den behøver ikke at blive pillet af.'
      },
      {
        id: 'body',
        name: 'Flaskekrop (Klar PET) 🍾',
        material: 'PET 1 (Rent plastik)',
        type: 'pant',
        x: 50,
        y: 78,
        desc: 'Rent og gennemsigtigt PET-plastik, som har den absolut højeste cirkulære genanvendelsesværdi.',
        tip: 'Flasken har PANT! Aflever den ubeskadiget i pantautomaten i butikken.'
      }
    ];
  }

  if (name.includes('royal') || name.includes('pilsner') || name.includes('carlsberg') || name.includes('retur') || name.includes('glas')) {
    const isMetal = name.includes('metal') || name.includes('aluminium') || name.includes('dåse') || name.includes('royal');
    return [
      {
        id: 'cap',
        name: isMetal ? 'Dåsetap 🥫' : 'Kronekapsel 👑',
        material: isMetal ? 'Aluminium' : 'Jern / Metal',
        type: isMetal ? 'pant' : 'recyclable',
        x: 50,
        y: 15,
        desc: isMetal ? 'Dåsetappen følger med aluminiumsdåsen og omsmeltes direkte.' : 'Jernkapslen sorteres særskilt og er yderst velegnet til omsmeltning.',
        tip: isMetal ? 'Undgå at rive dåsetappen af dåsen, lad den sidde fast.' : 'Kapsler skal sorteres i beholderen til Metal derhjemme!'
      },
      {
        id: 'body',
        name: isMetal ? 'Aluminiumsdåse 🔋' : 'Glasflaskevariation 🍾',
        material: isMetal ? 'Alu-legering' : 'Genbrugsglas',
        type: 'pant',
        x: 50,
        y: 65,
        desc: isMetal ? 'Ren aluminium. At genanvende aluminium sparer over 95% af den energi, der kræves til nyproduktion!' : 'Robust glas som kan renses og genpåfyldes helt op til 30-40 gange direkte.',
        tip: 'Aflever emballagen ubeskadiget i den nærmeste pantautomat for grøn bonus.'
      }
    ];
  }

  if (name.includes('kims') || name.includes('chips') || name.includes('pose') || name.includes('snack')) {
    return [
      {
        id: 'seam',
        name: 'Svejsesøm (Over/Under) 🔒',
        material: 'Smeltet plastkomposit',
        type: 'landfill',
        x: 50,
        y: 14,
        desc: 'Forseglingen i top og bund sikrer den beskyttende atmosfære inde i chipsposen.',
        tip: 'Hele posen skal sorteres i Restaffald, da lagene ikke kan skilles ad.'
      },
      {
        id: 'foil',
        name: 'Metalliseret beskyttelse ✨',
        material: 'Aluminium pådampet på plast',
        type: 'landfill',
        x: 53,
        y: 72,
        desc: 'En ultra-tynd barriere af aluminium limet uadskilleligt til plastik. Dette beskytter madvarer, men umuliggør mekanisk genanvendelse.',
        tip: 'Emballage med metallisk sølvfarve på indersiden skal sorteres som Restaffald.'
      },
      {
        id: 'outer',
        name: 'Plastik yderside 🎨',
        material: 'BOPP trykt plastik',
        type: 'landfill',
        x: 47,
        y: 44,
        desc: 'Eksternt tryk og laminering beskytter produktet, men kan ikke separeres til ren plastgenvinding.',
        tip: 'Sorteres som Restaffald for at forhindre, at metalliseret plast forurener den rene plaststrøm.'
      }
    ];
  }

  // Fallback default components
  return [
    {
      id: 'cap',
      name: 'Ydre låg / Lukning 🧢',
      material: 'Blandet plast eller metal',
      type: 'recyclable',
      x: 50,
      y: 18,
      desc: 'Topstykke, hætte eller forsegling, der holder produktet tæt omsluttet.',
      tip: 'Skru det af og sorter det separat, hvis det er lavet af et andet materiale end flasken/bøtten.'
    },
    {
      id: 'body',
      name: 'Beholderkrop / Emballage 🏛️',
      material: mat || 'Generisk emballage',
      type: 'recyclable',
      x: 50,
      y: 65,
      desc: 'Hoveddelen af emballagen, som udgør den største volumen.',
      tip: 'Tøm og skyl emballagen let (drypfri) før du kasserer den.'
    },
    {
      id: 'foil',
      name: 'Indvendig folielukning 🛡️',
      material: 'Aluminiumsfilm / Kombiplast',
      type: 'landfill',
      x: 50,
      y: 38,
      desc: 'Beskyttende membran, der sikrer friskhed og holdbarhed mod ilt.',
      tip: 'Træk folien helt af og sorter efter materiale – ofte er klistrede folier bedst til restaffald.'
    }
  ];
};

export default function ScanTab({ user, onChangeUser, bal, onShowToast }: ScanTabProps) {
  // Integration-Audit #2: PID-kalibreret pant fra api/deposit, fallback til "0,20"
  const dynamicDeposit = useDynamicDeposit();
  const { t, language } = useLanguage();
  const [phase, setPhase] = useState<'ready' | 'loading' | 'result'>('ready');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [scanMode, setScanMode] = useState<'ai' | 'qr'>('ai');
  const [showScannerHelp, setShowScannerHelp] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>({ lat: 56.1522, lng: 10.2037 });
  const [locatorMode, setLocatorMode] = useState<'smartbin' | 'station'>('smartbin');

  // High-tech Capture & Scan simulation animation overlay states
  const [isCapturingAnim, setIsCapturingAnim] = useState(false);
  const [capturedImagePreview, setCapturedImagePreview] = useState<string | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [capturingMsg, setCapturingMsg] = useState('');

  // AR Simulation overlay states
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [arXrayActive, setArXrayActive] = useState(false);

  // Reset selected AR component when scan result changes
  useEffect(() => {
    if (scanResult) {
      const comps = getARComponents(scanResult.productName, scanResult.materialType);
      if (comps.length > 0) {
        setSelectedCompId(comps[0].id);
      } else {
        setSelectedCompId(null);
      }
    } else {
      setSelectedCompId(null);
    }
  }, [scanResult]);

  // AI Sorteringsassistent Chat Integration
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'agent'; text: string }>>(() => {
    const saved = localStorage.getItem('cirkel_ai_chat_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback
      }
    }
    return [
      {
        sender: 'agent',
        text: 'Hej! Jeg er din Cirkel AI Sorteringsassistent. ♻️ Spørg mig om alt, f.eks. hvordan man sorterer specifikke emballagetyper, svære sammensatte materialer (komposit) eller de nyeste EU-emballageregler.'
      }
    ];
  });
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-save chat messages to localStorage
  useEffect(() => {
    localStorage.setItem('cirkel_ai_chat_history', JSON.stringify(chatMessages));
  }, [chatMessages]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatOpen]);

  const handleSendChatMessage = async (customText?: string) => {
    const textToSend = (customText || chatInput).trim();
    if (!textToSend) return;

    if (!customText) {
      setChatInput('');
    }

    const newUserMessage = { sender: 'user' as const, text: textToSend };
    const updatedMessages = [...chatMessages, newUserMessage];
    setChatMessages(updatedMessages);
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages })
      });
      const data = await response.json();
      if (data.success && data.reply) {
        setChatMessages(prev => [...prev, { sender: 'agent', text: data.reply }]);
        triggerHaptic(HapticPattern.LIGHT_TAP);
      } else {
        setChatMessages(prev => [...prev, { sender: 'agent', text: 'Beklager, men jeg mistede forbindelsen midlertidigt. Prøv lige igen!' }]);
        triggerHaptic(HapticPattern.ERROR_PATTERN);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatMessages(prev => [...prev, { sender: 'agent', text: 'Forbindelsesfejl. Kontroller venligst dit netværk og prøv igen.' }]);
      triggerHaptic(HapticPattern.ERROR_PATTERN);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Daily Check-in state variables
  const [todayStr] = useState(() => new Date().toISOString().split('T')[0]);
  const [scannedToday, setScannedToday] = useState(() => {
    return localStorage.getItem('cirkel_last_scan_date') === new Date().toISOString().split('T')[0];
  });
  
  // Daily Scans Count for personal goal tracking
  const [dailyScansCount, setDailyScansCount] = useState<number>(() => {
    const today = new Date().toISOString().split('T')[0];
    const savedDate = localStorage.getItem('cirkel_daily_count_date2');
    if (savedDate === today) {
      const val = localStorage.getItem('cirkel_daily_scans_count');
      return val ? Number(val) : 0;
    }
    return 0; // starts fresh for a new day
  });

  const incrementDailyScans = (amount = 1) => {
    const today = new Date().toISOString().split('T')[0];
    setDailyScansCount(prev => {
      const newVal = prev + amount;
      localStorage.setItem('cirkel_daily_count_date2', today);
      localStorage.setItem('cirkel_daily_scans_count', String(newVal));
      return newVal;
    });
  };

  const [rewardClaimed, setRewardClaimed] = useState(() => {
    return localStorage.getItem('cirkel_last_claim_date') === new Date().toISOString().split('T')[0];
  });
  const [showCheckinBonusCeleb, setShowCheckinBonusCeleb] = useState(false);
  const [showVerificationCeleb, setShowVerificationCeleb] = useState(false);
  const [verificationDetails, setVerificationDetails] = useState<{
    label: string;
    pant: number;
    points: number;
  } | null>(null);

  // Daily Missions Definition and Initialization
  const DEFAULT_MISSIONS = useMemo(() => [
    {
      id: 'm1_glass',
      type: 'glass' as const,
      title: 'Glasklar Mission',
      description: 'Scan eller registerér 3 glas-emballager (f.eks. ølflasker el. syltetøjsglas).',
      targetValue: 3,
      currentValue: 0,
      rewardPoints: 40,
      rewardDkk: 1.50,
      isCompleted: false,
      isClaimed: false,
      icon: '🍾'
    },
    {
      id: 'm2_pant',
      type: 'pant' as const,
      title: 'Pant-Entusiast',
      description: 'Scan emballager med en samlet pantværdi på mindst 2.50 kr i dag.',
      targetValue: 2.50,
      currentValue: 0.00,
      rewardPoints: 60,
      rewardDkk: 2.50,
      isCompleted: false,
      isClaimed: false,
      icon: '🥤'
    },
    {
      id: 'm3_scan_count',
      type: 'scan_count' as const,
      title: 'Sorterings-Spurt',
      description: 'Fuldfør i alt 4 godkendte scanninger/registreringer i dag.',
      targetValue: 4,
      currentValue: 0,
      rewardPoints: 80,
      rewardDkk: 4.00,
      isCompleted: false,
      isClaimed: false,
      icon: '🌳'
    }
  ], []);

  const [missions, setMissions] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    const saved = localStorage.getItem(`cirkel_missions_${today}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse missions:", e);
      }
    }
    return DEFAULT_MISSIONS;
  });

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`cirkel_missions_${today}`, JSON.stringify(missions));
  }, [missions, DEFAULT_MISSIONS]);

  const updateMissionProgress = (type: 'glass' | 'pant' | 'scan_count', increment: number) => {
    setMissions(prev => {
      const activeList = prev || DEFAULT_MISSIONS;
      return activeList.map((m: any) => {
        if (m.isClaimed) return m;
        if (m.type === type) {
          const nextVal = Number((m.currentValue + increment).toFixed(2));
          const completed = nextVal >= m.targetValue;
          return {
            ...m,
            currentValue: Math.min(nextVal, m.targetValue),
            isCompleted: completed
          };
        }
        return m;
      });
    });
  };

  const suggestedBin = scanResult 
    ? getSuggestedBin(scanResult.sortingType, scanResult.materialType, scanResult.productName)
    : null;

  const userLat = coords?.lat ?? 56.1522;
  const userLng = coords?.lng ?? 10.2037;

  const nearestSmartBin = useMemo(() => {
    const list = SMART_BINS_DATA.map(bin => {
      const distance = getDistanceKm(userLat, userLng, bin.lat, bin.lng);
      return { ...bin, distance };
    });
    list.sort((a, b) => a.distance - b.distance);
    return list[0];
  }, [userLat, userLng]);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Daily Recycling fact & Circular economy tip state
  const dailyTipIndex = useMemo(() => {
    const today = new Date();
    return today.getDate() % RECYCLING_TIPS.length;
  }, []);

  const [activeTipIndex, setActiveTipIndex] = useState(dailyTipIndex);
  const tipsCarouselRef = useRef<HTMLDivElement | null>(null);

  const scrollTips = (direction: 'left' | 'right') => {
    if (tipsCarouselRef.current) {
      const scrollAmount = 270; // card width + gap
      tipsCarouselRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  // Stop camera stream when leaving tab or phase changes
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Try to locate the user's municipality via reverse DAWA coordinate lookup on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setCoords({ lat: latitude, lng: longitude });
          try {
            const kommune = await getKommuneFromCoords(latitude, longitude);
            if (kommune) {
              onChangeUser(prev => {
                const updated = { ...prev, municipality: kommune };
                localStorage.setItem('cirkel_user', JSON.stringify(updated));
                return updated;
              });
            }
          } catch (e) {
            console.warn("DAWA lookup failed. Keeping fallback.", e);
          }
        },
        (error) => {
          console.warn("GPS lookup denied or failed. Defaulting municipality to Frederikssund Kommune.", error);
          // If default/fallback is still Aarhus, swap it to Frederikssund as requested when permission fails
          onChangeUser(prev => {
            if (prev.municipality === 'Aarhus' || prev.municipality === 'Aarhus Kommune' || !prev.municipality) {
              const updated = { ...prev, municipality: 'Frederikssund Kommune' };
              localStorage.setItem('cirkel_user', JSON.stringify(updated));
              return updated;
            }
            return prev;
          });
        },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 1000 * 60 * 30 }
      );
    } else {
      onChangeUser(prev => {
        if (prev.municipality === 'Aarhus' || prev.municipality === 'Aarhus Kommune' || !prev.municipality) {
          const updated = { ...prev, municipality: 'Frederikssund Kommune' };
          localStorage.setItem('cirkel_user', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
    }
  }, []);

  // Frame tick loop for real-time video frame QR decoding
  useEffect(() => {
    let frameId: number;
    let isActive = true;

    const tick = () => {
      if (!isActive) return;
      if (isCameraActive && scanMode === 'qr' && videoRef.current && phase === 'ready') {
        const video = videoRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          const canvas = canvasRef.current;
          if (canvas) {
            const context = canvas.getContext('2d');
            if (context) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
              try {
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: "dontInvert"
                });
                if (code && code.data) {
                  handleQRScanSuccess(code.data);
                  isActive = false;
                  return;
                }
              } catch (e) {
                // Keep trying next frames
              }
            }
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    };

    if (isCameraActive && scanMode === 'qr' && phase === 'ready') {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      isActive = false;
      cancelAnimationFrame(frameId);
    };
  }, [isCameraActive, scanMode, phase]);

  const handleQRScanSuccess = (qrText: string) => {
    // Show high-tech overlay details first
    setIsCapturingAnim(true);
    setCaptureFlash(true);
    setCapturingMsg('AFKODER QR-KODE...');
    playScanSuccessFeedback();

    setTimeout(() => {
      setCaptureFlash(false);
    }, 280);

    // Capture frozen frame preview if camera is active
    if (videoRef.current && canvasRef.current) {
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (context) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg');
          setCapturedImagePreview(dataUrl);
        }
      } catch (e) {
        console.warn("QR frame capture failed:", e);
      }
    }

    // Delay the actual API transition for the scanning simulation to finish
    setTimeout(() => {
      setIsCapturingAnim(false);
      setCapturedImagePreview(null);
      setPhase('loading');
      stopCamera();
      
      // Simulate nice scientific lookups
      setTimeout(() => {
        const parsed = parseQRContent(qrText, user.municipality);
        const data = {
          productName: parsed.productName,
          materialShort: parsed.materialShort,
          grade: parsed.grade,
          co2Saved: parsed.co2Saved,
          waterSaved: parsed.waterSaved,
          energySaved: parsed.energySaved,
          pantValue: parsed.pantValue,
          materialType: parsed.materialType,
          recyclablePercent: parsed.recyclablePercent,
          manufacturer: parsed.manufacturer,
          packagingWeight: parsed.packagingWeight,
          circularScore: parsed.circularScore,
          eprStatus: parsed.eprStatus,
          sortingType: parsed.sortingType,
          sortingInstructions: parsed.sortingInstructions,
          didYouKnow: parsed.didYouKnow
        };
        setScanResult(data);
        setPhase('result');
        triggerConfettiScanned();

        const toastFn = onShowToast || (window as any).showToast;
        if (toastFn) {
          toastFn(`Scannet: ${data.productName}! Materialepasset blev analyseret med succes.`, 'co2', data.co2Saved);
        }
      }, 1000);
    }, 1150);
  };

  const startCamera = async () => {
    setCameraError(null);
    setIsCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      setCameraError("Kameraet kunne ikke startes (tjek tilladelser eller prøv fil-upload).");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const executeImageScan = (base64String: string | null, productNameStr?: string) => {
    // 1. Trigger high-tech scan overlay first!
    setIsCapturingAnim(true);
    setCapturedImagePreview(base64String);
    setCaptureFlash(true);
    setCapturingMsg(productNameStr ? `ANALYSERER: ${productNameStr}` : 'SCANNER EMBALLAGE...');

    // Play acoustic and haptic feedback
    playScanSuccessFeedback();

    setTimeout(() => {
      setCaptureFlash(false);
    }, 280);

    // 2. Delay the actual API submission for the scanning simulation to finish
    setTimeout(() => {
      setIsCapturingAnim(false);
      setCapturedImagePreview(null);
      setPhase('loading');
      stopCamera();

      // Call server API route
      fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64String,
          productName: productNameStr || null,
          municipality: user.municipality,
          firebaseUid: (user as any).uid || user.id,
          email: user.email,
          fullName: user.fullName
        })
      })
      .then(res => res.json())
      .then(response => {
        if (response.success && response.data) {
          setScanResult(response.data);
          setPhase('result');
          playScanSuccessFeedback();
          triggerConfettiScanned();

          const toastFn = onShowToast || (window as any).showToast;
          if (toastFn) {
            toastFn(`Scannet: ${response.data.productName}! Materialepasset blev analyseret med succes.`, 'co2', response.data.co2Saved);
          }
        } else {
          throw new Error(response.error || "Uventet fejl");
        }
      })
      .catch(err => {
        console.error(err);
        // Fallback fallback in case of errors
        const fallbackResult = {
          productName: productNameStr || "Blandet plast-genstand",
          materialShort: "HDPE plast · EAN: 5700234567891",
          grade: "A",
          co2Saved: "35g",
          waterSaved: "0.9L",
          energySaved: "0.6kWh",
          pantValue: dynamicDeposit.amount_dkk, // Integration-Audit #2: PID-kalibreret
          materialType: "Polyethylen (HDPE)",
          recyclablePercent: "95%",
          manufacturer: "Generisk producent",
          packagingWeight: "15g",
          circularScore: "85",
          eprStatus: "Registreret ✓",
          sortingType: "♻️ Plastik (hård)",
          sortingInstructions: `Sorteringsanbefaling: Skyl, tøm helt for rester og læg i plastik-beholderen derhjemme i ${user.municipality}.`,
          didYouKnow: "Vidste du, at genanvendelse af blot 1 ton HDPE-plastik (som shampoo-flasker eller mælkelåg) sparer atmosfæren for næsten 1,5 ton CO₂ og reducerer vandforbruget med 90% i forhold til ny plast?"
        };
        setScanResult(fallbackResult);
        setPhase('result');
        playScanSuccessFeedback();
        triggerConfettiScanned();

        const toastFn = onShowToast || (window as any).showToast;
        if (toastFn) {
          toastFn(`Scannet: ${fallbackResult.productName}! Materialepasset blev analyseret med succes.`, 'co2', fallbackResult.co2Saved);
        }
      });
    }, 1150);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        if (scanMode === 'qr') {
          const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
          try {
            const decoded = jsQR(imgData.data, imgData.width, imgData.height);
            if (decoded && decoded.data) {
              handleQRScanSuccess(decoded.data);
              return;
            }
          } catch(e) {}
          const toastFn = onShowToast || (window as any).showToast;
          if (toastFn) {
            toastFn("Ingen QR-kode detekteret. Prøver normal AI-analyse...", "info");
          } else {
            alert("Ingen QR-kode detekteret på billedet. Prøver normal AI-analyse i stedet...");
          }
        }

        const dataUrl = canvas.toDataURL('image/jpeg');
        executeImageScan(dataUrl);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64Str = reader.result;
          
          if (scanMode === 'qr' && canvasRef.current) {
            const tempImg = new Image();
            tempImg.onload = () => {
              const canvas = canvasRef.current!;
              const context = canvas.getContext('2d');
              if (context) {
                canvas.width = tempImg.width;
                canvas.height = tempImg.height;
                context.drawImage(tempImg, 0, 0);
                const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
                try {
                  const decoded = jsQR(imgData.data, imgData.width, imgData.height);
                  if (decoded && decoded.data) {
                    handleQRScanSuccess(decoded.data);
                    return;
                  }
                } catch(e) {}
              }
              const toastFn = onShowToast || (window as any).showToast;
              if (toastFn) {
                toastFn("Ingen QR-kode fundet. Prøver normal AI-analyse...", "info");
              } else {
                alert("Ingen QR-kode fundet i den uploadede fil. Prøver normal AI-analyse...");
              }
              executeImageScan(base64Str);
            };
            tempImg.src = base64Str;
          } else {
            executeImageScan(base64Str);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerVerification = (pant: number, points: number, label: string) => {
    const balanceIncrease = Number(pant);
    const pointsIncrease = points;

    // Trigger haptic and chime first, so user experiences it right before/during confirmation modal!
    playScanSuccessFeedback();

    // Mark today as scanned
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('cirkel_last_scan_date', today);
    setScannedToday(true);
    incrementDailyScans(1);

    // Progress of Daily Missions completed dynamically
    updateMissionProgress('scan_count', 1);
    if (pant > 0) {
      updateMissionProgress('pant', pant);
    }
    if (scanResult) {
      const isGlass = scanResult.sortingType?.toLowerCase().includes('glas') || 
                      scanResult.materialType?.toLowerCase().includes('glas') ||
                      scanResult.productName?.toLowerCase().includes('glas') ||
                      scanResult.materialShort?.toLowerCase().includes('glas');
      if (isGlass) {
        updateMissionProgress('glass', 1);
      }
    }

    // Update user context
    onChangeUser(prev => {
      const updated = {
        ...prev,
        balance: Number((prev.balance + balanceIncrease).toFixed(2)),
        points: prev.points + pointsIncrease,
        scansCount: prev.scansCount + 1,
        streakDays: prev.streakDays + 1,
        co2SavedKg: Number((prev.co2SavedKg + 0.15).toFixed(1)), // assume average 150g carbon savings per scan
      };
      
      // Save changes to local storage
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });

    const toastFn = onShowToast || (window as any).showToast;
    if (toastFn) {
      toastFn(`Genbrug verificeret via ${label}! Saldo: +${balanceIncrease} DKK, Points: +${pointsIncrease} CP`, 'success', '150g');
    }

    setVerificationDetails({
      label,
      pant: balanceIncrease,
      points: pointsIncrease
    });
    setShowVerificationCeleb(true);
    triggerConfettiGoal();

    setPhase('ready');
    setScanResult(null);
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col min-h-[80vh] px-4 pt-4 pb-12">
      {/* Full screen scan confirmation flash overlay */}
      {captureFlash && (
        <motion.div 
          initial={{ opacity: 0.95 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 bg-white z-[9999] pointer-events-none"
        />
      )}

      {phase === 'ready' && (
        <div className="flex flex-col flex-1">
          {/* Logo, Status / Welcome bar */}
          <div className="flex justify-between items-center mb-4">
            <div className="text-left">
              <span className="text-xs font-bold text-muted-text uppercase tracking-wider">{t('hello')}, {user.fullName}! 👋</span>
              <h2 className="text-2xl font-black text-primary leading-tight">{t('scan_pkg')}</h2>
            </div>
            <div className="bg-primary/5 rounded-full py-1 px-4 border border-primary/10">
              <span className="text-xs font-bold text-primary">📍 {t('aarhus')}</span>
            </div>
          </div>

          {/* Consolidated Activity Dashboard: Daily Bonus + Missions */}
          <div className="bg-white border border-gray-200 rounded-3xl p-4 shadow-sm mb-4 text-left flex flex-col gap-3">
            {/* Header / Brand */}
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-base">⚡</span>
                <div>
                  <h3 className="text-xs font-black text-primary uppercase tracking-wider">Mit Aktivitetscenter</h3>
                  <p className="text-[9px] text-muted-text font-bold">Daglige mål og grønne bonusser</p>
                </div>
              </div>
              <span className="text-[8.5px] font-black text-primary bg-[#C8F24A]/30 border border-[#B0D73D]/50 px-2.5 py-0.5 rounded-lg uppercase tracking-wide">
                Nulstilles dgl.
              </span>
            </div>

            {/* Part A: Daily Check-in Bonus */}
            <div className="bg-gray-50 p-2.5 rounded-2xl flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🎁</span>
                  <div>
                    <h4 className="text-[10px] font-extrabold text-primary uppercase tracking-wide leading-none">{t('daily_bonus')}</h4>
                    <p className="text-[9px] text-muted-text font-bold mt-1">
                      {rewardClaimed 
                        ? 'Dagsbonus indoptjent ✓ (+2,00 DKK)' 
                        : scannedToday 
                          ? 'Dagsbonus klar til udbetaling!' 
                          : 'Fuldfør ét scan for at låse op (+2,00 DKK)'}
                    </p>
                  </div>
                </div>

                <div>
                  {rewardClaimed ? (
                    <span className="text-[8px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200 py-1 px-2 rounded-lg uppercase">
                      Løst ✓
                    </span>
                  ) : scannedToday ? (
                    <button
                      id="claim-daily-bonus-compact"
                      onClick={() => {
                        triggerHaptic(HapticPattern.SCAN_SUCCESS);
                        setRewardClaimed(true);
                        const today = new Date().toISOString().split('T')[0];
                        localStorage.setItem('cirkel_last_claim_date', today);
                        
                        onChangeUser(prev => {
                          const updated = {
                            ...prev,
                            balance: Number((prev.balance + 2.0).toFixed(2)),
                            points: prev.points + 15
                          };
                          localStorage.setItem('cirkel_user', JSON.stringify(updated));
                          return updated;
                        });
                        
                        setShowCheckinBonusCeleb(true);
                        triggerConfettiGoal();
                      }}
                      className="bg-amber-400 hover:bg-amber-500 text-primary py-1 px-2.5 rounded-lg text-[9px] font-black uppercase shadow-xs transition-all active:scale-95 cursor-pointer leading-none"
                    >
                      Indløs
                    </button>
                  ) : (
                    <button
                      id="simulate-fast-checkin-scan-btn"
                      onClick={() => {
                        playScanSuccessFeedback();
                        const today = new Date().toISOString().split('T')[0];
                        localStorage.setItem('cirkel_last_scan_date', today);
                        setScannedToday(true);
                        incrementDailyScans(1);

                        onChangeUser(prev => {
                          const updated = {
                            ...prev,
                            scansCount: prev.scansCount + 1,
                            co2SavedKg: Number((prev.co2SavedKg + 0.15).toFixed(1)),
                          };
                          localStorage.setItem('cirkel_user', JSON.stringify(updated));
                          return updated;
                        });
                      }}
                      className="text-primary hover:underline cursor-pointer text-[8.5px] font-black uppercase tracking-wider"
                    >
                      Hurtig-løs ⚡
                    </button>
                  )}
                </div>
              </div>

              {/* Progress status label */}
              <div className="flex gap-2 items-center text-[9px] font-bold text-muted-text">
                <div className={`w-2 h-2 rounded-full shrink-0 ${scannedToday ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span>{scannedToday ? 'Tillykke! Dagligt sorteringsbetingelse opfyldt ✓' : 'Mangler dagens første scanning (0/1)'}</span>
              </div>
            </div>

            {/* Part C: Daily Recycling Goal Progress */}
            {user.dailyRecyclingGoal !== 0 && (
              <div id="daily-recycling-goal-progress" className="bg-emerald-50/50 border border-emerald-150 p-3.5 rounded-2xl flex flex-col gap-2 pb-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-base select-none">🎯</span>
                    <div>
                      <h4 className="text-[10px] font-black text-emerald-950 uppercase tracking-widest leading-none">
                        {language === 'da' ? 'Dagligt Sorteringsmål' : 'Daily Recycling Goal'}
                      </h4>
                      <p className="text-[8.5px] text-emerald-800/85 font-black mt-1">
                        {language === 'da' 
                          ? `${dailyScansCount} af ${user.dailyRecyclingGoal ?? 3} emballager genanvendt` 
                          : `${dailyScansCount} of ${user.dailyRecyclingGoal ?? 3} items recycled`}
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] font-mono font-black text-emerald-900 bg-emerald-100/40 border border-emerald-250/20 px-2 py-0.5 rounded-md">
                    {Math.min(Math.round((dailyScansCount / (user.dailyRecyclingGoal ?? 3)) * 100), 100)}%
                  </span>
                </div>

                {/* Progress bar line */}
                <div className="w-full bg-emerald-100/50 rounded-full h-2.5 overflow-hidden border border-emerald-250/20">
                  <div 
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min((dailyScansCount / (user.dailyRecyclingGoal ?? 3)) * 100, 100)}%` }}
                  />
                </div>

                {/* Goal reached visual feedback */}
                {dailyScansCount >= (user.dailyRecyclingGoal ?? 3) && (
                  <div className="flex items-center gap-1.5 text-[8.5px] text-emerald-950 font-black tracking-wide bg-white/70 border border-emerald-150/45 p-1.5 rounded-xl mt-0.5 leading-none shadow-3xs animate-pulse-short">
                    <span className="animate-bounce shrink-0">🎉</span>
                    <span>
                      {language === 'da' 
                        ? 'Dagens mål indløst! Du gør en fantastisk grøn forskel for miljøet!' 
                        : "Today's goal completed! Excellent job sorting today!"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Part B: Daily Missions */}
            <div className="flex flex-col gap-2">
              <h4 className="text-[9px] font-extrabold text-muted-text uppercase tracking-wider">Mål & Missioner</h4>
              
              <div className="flex flex-col gap-1.5">
                {missions.map((mission: any) => {
                  const percent = Math.min(Math.round((mission.currentValue / mission.targetValue) * 100), 100);
                  return (
                    <div 
                      key={mission.id}
                      className="bg-gray-50/60 border border-gray-150 p-2.5 rounded-xl flex items-center justify-between gap-3 relative overflow-hidden transition-all"
                    >
                      <div className="flex items-center gap-2 max-w-[70%]">
                        <span className="text-lg w-7 h-7 rounded-lg bg-white shadow-3xs flex items-center justify-center shrink-0 border border-gray-100">
                          {mission.icon}
                        </span>
                        <div className="truncate">
                          <h5 className="text-[10px] font-black text-primary leading-tight uppercase truncate">
                            {mission.title}
                          </h5>
                          <p className="text-[8.5px] text-muted-text truncate">
                            {mission.description}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {mission.isClaimed ? (
                          <span className="text-[8px] font-black text-emerald-800 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded uppercase">
                            Indløst
                          </span>
                        ) : mission.isCompleted ? (
                          <button
                            id={`claim-mission-${mission.id}-compact-btn`}
                            onClick={() => {
                              triggerHaptic(HapticPattern.SCAN_SUCCESS);
                              setMissions(prev => {
                                const list = prev.map((m: any) => {
                                  if (m.id === mission.id) {
                                    return { ...m, isClaimed: true };
                                  }
                                  return m;
                                });
                                const today = new Date().toISOString().split('T')[0];
                                localStorage.setItem(`cirkel_missions_${today}`, JSON.stringify(list));
                                return list;
                              });

                              onChangeUser(prev => {
                                const updated = {
                                  ...prev,
                                  balance: Number((prev.balance + mission.rewardDkk).toFixed(2)),
                                  points: prev.points + mission.rewardPoints
                                };
                                localStorage.setItem('cirkel_user', JSON.stringify(updated));
                                return updated;
                              });

                              const toastFn = onShowToast || (window as any).showToast;
                              if (toastFn) {
                                toastFn(`Mission Fuldført! Modtaget +${mission.rewardDkk.toFixed(2)} DKK & +${mission.rewardPoints} CP`, 'co2', `${mission.rewardPoints} CP`);
                              }
                              triggerConfettiGoal();
                            }}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[9px] py-1 px-2 rounded-lg transition-transform active:scale-95 shadow-3xs uppercase cursor-pointer"
                          >
                            Hent
                          </button>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="text-[9.5px] font-black text-primary font-mono leading-none">
                              +{mission.rewardDkk.toFixed(2)} kr
                            </span>
                            <span className="text-[8px] text-primary/45 font-bold font-mono">
                              {mission.currentValue}/{mission.targetValue}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Micro progress status at extreme bottom */}
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gray-100">
                        <div 
                          className="h-full bg-[#C8F24A] transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Core Mode Selection (AI vs QR Scanner) */}
          <div className="bg-primary/5 p-1 rounded-2xl flex gap-1 border border-primary/5 mb-2.5 shrink-0">
            <button
              id="mode-ai-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setScanMode('ai');
                setManualName('');
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-black rounded-xl transition-all cursor-pointer uppercase tracking-wider ${
                scanMode === 'ai'
                  ? 'bg-primary text-accent shadow-sm shadow-black/10'
                  : 'text-primary/60 hover:text-primary hover:bg-primary/5'
              }`}
            >
              🧠 {t('ai_camera')}
            </button>
            <button
              id="mode-qr-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setScanMode('qr');
                setManualName('');
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-black rounded-xl transition-all cursor-pointer uppercase tracking-wider ${
                scanMode === 'qr'
                  ? 'bg-primary text-accent shadow-sm shadow-black/10'
                  : 'text-primary/60 hover:text-primary hover:bg-primary/5'
              }`}
            >
              🔳 {t('qr_scanner')}
            </button>
          </div>

          {/* Hvilken scan-metode skal jeg vælge trigger banner */}
          <div className="flex justify-end mb-4 px-1">
            <button
              id="scanner-help-toggle-btn"
              onClick={() => setShowScannerHelp(true)}
              className="text-[10px] font-extrabold text-muted-text hover:text-primary transition-all flex items-center gap-1.5 cursor-pointer bg-white border border-gray-200 rounded-lg px-2.5 py-1 shadow-2xs hover:shadow-xs active:scale-98"
            >
              <HelpCircle className="w-3.5 h-3.5 text-muted-text" />
              <span>{t('which_scan_method')}</span>
            </button>
          </div>

          {/* Core scan camera stage */}
          <div className="relative aspect-[4/3] bg-primary rounded-3xl overflow-hidden shadow-lg border border-primary/20 flex flex-col items-center justify-center text-center p-6 mb-6">
            {isCameraActive ? (
              <div className="absolute inset-0 w-full h-full flex flex-col justify-between">
                <video 
                  ref={videoRef}
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                
                {/* Visual Target brackets */}
                <div className="absolute top-6 left-6 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-lg pointer-events-none z-10 opacity-85" />
                <div className="absolute top-6 right-6 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-lg pointer-events-none z-10 opacity-85" />
                <div className="absolute bottom-20 left-6 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-lg pointer-events-none z-10 opacity-85" />
                <div className="absolute bottom-20 right-6 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-lg pointer-events-none z-10 opacity-85" />

                {/* Target Focus Reticle based on Mode */}
                {scanMode === 'ai' ? (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 border border-dashed border-accent/40 rounded-full flex items-center justify-center pointer-events-none z-10">
                    <div className="w-20 h-20 rounded-full bg-accent/5 border border-accent/20 animate-ping absolute" />
                    <div className="w-2.5 h-2.5 bg-accent rounded-full shadow-[0_0_8px_rgba(200,242,74,0.8)]" />
                  </div>
                ) : (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 border-2 border-accent rounded-3xl flex items-center justify-center pointer-events-none z-10 shadow-[0_0_20px_rgba(200,242,74,0.3)]">
                    <div className="absolute top-4 bottom-4 left-4 right-4 border border-dashed border-accent/30 rounded-2xl" />
                    <div className="w-4 h-4 border-t-2 border-l-2 border-accent absolute top-6 left-6 animate-pulse" />
                    <div className="w-4 h-4 border-t-2 border-r-2 border-accent absolute top-6 right-6 animate-pulse" />
                    <div className="w-4 h-4 border-b-2 border-l-2 border-accent absolute bottom-6 left-6 animate-pulse" />
                    <div className="w-4 h-4 border-b-2 border-r-2 border-accent absolute bottom-6 right-6 animate-pulse" />
                  </div>
                )}

                {/* Real-time Dynamic scanning hint ticker */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-primary/95 backdrop-blur-md border border-accent/20 px-4.5 py-1.5 rounded-full text-[10px] font-black text-accent tracking-wider uppercase z-20 flex items-center gap-1.5 shadow-lg whitespace-nowrap">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full animate-ping" />
                  {scanMode === 'ai' ? <LiveScanLabel /> : <span>Søger efter QR-koder...</span>}
                </div>

                {/* Laser scan effect overlay */}
                <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_15px_#C8F24A] top-1/2 -translate-y-1/2 animate-bounce z-15" />

                {/* Back & Capture controls overlaid */}
                <div className="absolute bottom-4 left-0 right-0 flex justify-between items-center px-6 z-20">
                  <button 
                    id="stop-camera-btn"
                    onClick={() => {
                      triggerHaptic(HapticPattern.LIGHT_TAP);
                      stopCamera();
                    }}
                    className="bg-primary/90 hover:bg-primary text-white border border-white/10 rounded-xl py-2.5 px-4 text-xs font-bold backdrop-blur-md cursor-pointer transition-transform active:scale-95 shadow-md"
                  >
                    Afbryd
                  </button>
                  <button 
                    id="capture-photo-btn"
                    onClick={() => {
                      triggerHaptic(HapticPattern.SCAN_START);
                      capturePhoto();
                    }}
                    className="w-15 h-15 rounded-full border-4 border-white bg-accent/95 hover:bg-accent hover:scale-105 active:scale-90 shadow-lg shadow-black/40 cursor-pointer transition-all flex items-center justify-center animate-pulse"
                    title={scanMode === 'ai' ? "Tag materialefoto" : "Afkod QR Code"}
                  >
                    {scanMode === 'ai' ? (
                      <div className="w-6 h-6 rounded-full border border-primary/20 bg-primary/10" />
                    ) : (
                      <QrCode className="w-6 h-6 text-primary" />
                    )}
                  </button>
                  <div className="w-12" /> {/* empty spacer */}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center border border-accent/20 animate-pulse">
                  {scanMode === 'ai' ? (
                    <Camera className="w-8 h-8 text-accent shrink-0" />
                  ) : (
                    <QrCode className="w-8 h-8 text-accent shrink-0" />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-white font-extrabold text-lg">
                    {scanMode === 'ai' ? 'Kamera scanning' : 'QR-kode scanner'}
                  </h3>
                  <p className="text-white/60 text-xs px-8 leading-relaxed">
                    {scanMode === 'ai' 
                      ? 'Peg kameraet mod emballagen eller indtast navnet for at generere et AI materialepas.'
                      : 'Ret kameraet mod producentens QR-kode eller EAN-stregkode for at hente sorteringsinstrukser.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 justify-center mt-2">
                  <button 
                    id="start-camera-btn"
                    onClick={() => {
                      triggerHaptic(HapticPattern.MEDIUM_TAP);
                      startCamera();
                    }}
                    className="bg-accent hover:opacity-95 text-primary text-sm font-extrabold py-3 px-6 rounded-xl shadow-md cursor-pointer transition-all active:scale-98"
                  >
                    {scanMode === 'ai' ? 'Start Kamera 📸' : 'Start QR Scanner 🔳'}
                  </button>
                  <button 
                    id="upload-image-btn"
                    onClick={() => {
                      triggerHaptic(HapticPattern.LIGHT_TAP);
                      fileInputRef.current?.click();
                    }}
                    className="bg-white/10 hover:bg-white/15 text-white border border-white/20 text-sm font-bold py-3 px-6 rounded-xl cursor-pointer transition-all active:scale-98 flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4 shrink-0" /> {scanMode === 'ai' ? 'Vælg Billede' : 'Upload QR Billede'}
                  </button>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                {cameraError && (
                  <p className="text-red-400 text-xs px-6 mt-1 font-medium">{cameraError}</p>
                )}
              </div>
            )}

            {/* Seamless High-Tech Scan HUD Overlay (Triggers on photo capture, QR detection, or file upload/preset testing) */}
            {isCapturingAnim && (
              <div id="high-tech-scan-overlay" className="absolute inset-0 w-full h-full z-30 bg-primary/20 flex flex-col justify-between p-4 overflow-hidden select-none">
                
                {/* Captured Image Freeze frame background */}
                {capturedImagePreview && (
                  <img 
                    src={capturedImagePreview} 
                    alt="Scan Capture" 
                    className="absolute inset-0 w-full h-full object-cover z-0 filter saturate-125 brightness-105" 
                  />
                )}

                {/* Shutter Camera Flash */}
                {captureFlash ? (
                  <motion.div 
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute inset-0 bg-white z-50 pointer-events-none"
                  />
                ) : (
                  <motion.div 
                    initial={{ opacity: 0.5 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.8 }}
                    className="absolute inset-0 bg-accent/20 z-40 pointer-events-none"
                  />
                )}

                {/* Subtle Pulse Rings indicating active processing of sustainability score */}
                <motion.div
                  className="absolute inset-0 border-4 border-accent rounded-3xl z-40 pointer-events-none mix-blend-screen"
                  animate={{ 
                    boxShadow: [
                      "inset 0 0 15px rgba(200,242,74,0.15)", 
                      "inset 0 0 45px rgba(200,242,74,0.55)", 
                      "inset 0 0 15px rgba(200,242,74,0.15)"
                    ],
                    borderColor: ["rgba(200,242,74,0.3)", "rgba(200,242,74,0.85)", "rgba(200,242,74,0.3)"]
                  }}
                  transition={{ 
                    duration: 1.4, 
                    repeat: Infinity, 
                    ease: "easeInOut" 
                  }}
                />

                {/* Cyber Matrix overlay grids */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.15)_0%,transparent_80%)] border-2 border-accent/25 pointer-events-none z-10 animate-pulse" />
                
                {/* Moving Green Laser Sweep line */}
                <motion.div 
                  initial={{ y: "-10%" }}
                  animate={{ y: "110%" }}
                  transition={{ duration: 1.15, ease: "easeInOut" }}
                  className="absolute left-0 right-0 h-1.5 bg-gradient-to-r from-transparent via-[#C8F24A] to-transparent shadow-[0_0_15px_#C8F24A] z-25 pointer-events-none"
                />

                {/* High Tech Reticles */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div className="relative w-44 h-44 border-2 border-dashed border-accent/50 rounded-full flex items-center justify-center">
                    
                    {/* Concentric subtle pulse halo for sustainability score processing */}
                    <motion.div 
                      className="absolute -inset-6 border-2 border-[#C8F24A]/30 rounded-full"
                      animate={{ 
                        scale: [1, 1.18, 1],
                        opacity: [0.25, 0.75, 0.25],
                        boxShadow: [
                          "0 0 0px rgba(200,242,74,0)",
                          "0 0 25px rgba(200,242,74,0.35)",
                          "0 0 0px rgba(200,242,74,0)"
                        ]
                      }}
                      transition={{ 
                        duration: 1.5, 
                        repeat: Infinity, 
                        ease: "easeInOut" 
                      }}
                    />

                    {/* Rotating digital outer dial */}
                    <motion.div 
                      className="absolute inset-0 border border-dotted border-[#C8F24A]/40 rounded-full"
                      animate={{ rotate: -360 }}
                      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                    />
                    
                    {/* Inner rotating brackets */}
                    <motion.div 
                      className="absolute w-36 h-36 border-t-2 border-b-2 border-[#C8F24A] rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                    />

                    {/* Locking targeting corners */}
                    <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#C8F24A] animate-pulse" />
                    <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#C8F24A] animate-pulse" />
                    <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#C8F24A] animate-pulse" />
                    <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#C8F24A] animate-pulse" />

                    {/* Status badge */}
                    <div className="bg-primary/95 border border-[#C8F24A]/30 text-[#C8F24A] font-mono text-[9px] font-black tracking-widest uppercase py-1 px-3 rounded shadow-lg z-30 animate-pulse text-center max-w-[130px] truncate">
                      {scanMode === 'qr' ? 'BEREGNER SCORE...' : (capturingMsg || 'SCANNER...')}
                    </div>
                  </div>
                </div>

                {/* Technical stats corners */}
                <div className="w-full flex justify-between text-left font-mono text-[8px] text-[#C8F24A]/80 z-20 pointer-events-none select-none">
                  <div className="flex flex-col gap-0.5">
                    <span>[SYS_MODE] {scanMode.toUpperCase()} BARCODE SCAN</span>
                    <span>[SYS_STAT] COMPUTING ENERGETIC INTEGRITY</span>
                    <span>[SYS_LOCK] DETECTED CODE STABLE</span>
                  </div>
                  <div className="text-right flex flex-col gap-0.5 font-sans font-bold">
                    <span>EPR_STATUS: VALIDATING</span>
                    <span>SUSTAINABILITY: CALCULATING...</span>
                    <span>LATENCY_MS: 18.5</span>
                  </div>
                </div>

                {/* Bottom scan ticker progress bar */}
                <div className="w-full mt-2 z-20 pointer-events-none select-none">
                  <div className="flex justify-between font-mono text-[8px] text-[#C8F24A]/85 uppercase font-black mb-0.5">
                    <span>SUSTAINABILITY SCORE ENGINE</span>
                    <span className="animate-pulse">PROCESSERER...</span>
                  </div>
                  <div className="w-full h-1 bg-primary/80 border border-accent/20 rounded-full overflow-hidden p-0.5">
                    <motion.div 
                      className="h-full bg-[#C8F24A] rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 1.15, ease: "easeOut" }}
                    />
                  </div>
                </div>

              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Quick preset selection based on current Scan Mode */}
          <div className="mb-6">
            <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-2.5">
              {scanMode === 'ai' ? 'Hurtig AI-test (uden kamera)' : 'Klik for at simulere QR-scanning (Interactive presets)'}
            </span>
            
            {scanMode === 'ai' ? (
              <div className="grid grid-cols-2 gap-2">
                {PRESET_PRODUCTS.map((prod) => (
                  <button
                    id={`preset-${prod.id}-btn`}
                    key={prod.id}
                    onClick={() => executeImageScan(null, prod.name)}
                    className="bg-white border border-gray-200 hover:border-primary rounded-xl p-3 text-left transition-all active:scale-98 flex items-center gap-2.5 shadow-sm cursor-pointer"
                  >
                    <span className="text-xl bg-primary/5 w-9 h-9 rounded-lg flex items-center justify-center shrink-0">{prod.icon}</span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-primary truncate">{prod.name}</p>
                      <p className="text-[10px] text-muted-text font-medium">Hent AI Materialepas</p>
                    </div>
                  </button>
                ))}
                
                {/* Type-in custom scanning */}
                <div className="col-span-2 bg-white border border-gray-200 rounded-xl p-3 flex gap-2 shadow-sm">
                  <input
                    id="custom-product-input"
                    type="text"
                    placeholder="Skriv produktnavn (f.eks. Mælkekarton...)"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-primary text-primary"
                  />
                  <button
                    id="scan-custom-input-btn"
                    onClick={() => manualName.trim() && executeImageScan(null, manualName.trim())}
                    disabled={!manualName.trim()}
                    className="bg-primary hover:opacity-95 text-white disabled:opacity-40 font-bold text-xs py-2 px-4 rounded-lg cursor-pointer transition-colors shrink-0"
                  >
                    AI Scan
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {PRESET_QR_CODES.map((qr) => (
                  <button
                    id={`preset-${qr.id}-btn`}
                    key={qr.id}
                    onClick={() => handleQRScanSuccess(qr.code)}
                    className="bg-white border border-gray-200 hover:border-emerald-500 rounded-xl p-3 text-left transition-all active:scale-98 flex items-center gap-2.5 shadow-sm cursor-pointer"
                    title={`Materialekode: ${qr.code}`}
                  >
                    <span className="text-xl bg-emerald-50 w-9 h-9 rounded-lg flex items-center justify-center shrink-0">{qr.icon}</span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-primary truncate">{qr.name}</p>
                      <p className="text-[10px] text-emerald-700 font-bold">Simuler scanning ✓</p>
                    </div>
                  </button>
                ))}

                {/* Custom QR Link Decoder input */}
                <div className="col-span-2 bg-white border border-gray-200 rounded-xl p-3 flex gap-2 shadow-sm">
                  <input
                    id="custom-qr-input"
                    type="text"
                    placeholder="Indtast QR-link eller EAN-stregkode (f.eks. 5701122334411)"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-primary text-primary"
                  />
                  <button
                    id="scan-custom-qr-btn"
                    onClick={() => {
                      if (manualName.trim()) {
                        handleQRScanSuccess(manualName.trim());
                        setManualName('');
                      }
                    }}
                    disabled={!manualName.trim()}
                    className="bg-primary hover:opacity-95 text-accent disabled:opacity-40 font-black text-xs py-2 px-4 rounded-lg cursor-pointer transition-colors shrink-0"
                  >
                    Afkod QR 🔳
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Unified Location Locator Hub: Selectable Smart Bins or Recycling Station */}
          <div className="mb-6 text-left">
            <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-2 px-1">
              Find Beholder & Genbrugsstation
            </span>
            <div className="bg-primary/5 p-1 rounded-2xl flex gap-1 border border-primary/5 mb-4 shadow-3xs">
              <button
                type="button"
                id="tab-select-smartbin"
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setLocatorMode('smartbin');
                }}
                className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center ${
                  locatorMode === 'smartbin'
                    ? 'bg-primary text-accent shadow-sm'
                    : 'text-primary/60 hover:text-primary'
                }`}
              >
                🗑️ Smart-Spand
              </button>
              <button
                type="button"
                id="tab-select-station"
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setLocatorMode('station');
                }}
                className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center ${
                  locatorMode === 'station'
                    ? 'bg-primary text-accent shadow-sm'
                    : 'text-primary/60 hover:text-primary'
                }`}
              >
                ♻️ Genbrugsplads
              </button>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-3xl p-1 shadow-sm overflow-hidden min-h-[380px] flex flex-col justify-start">
              {locatorMode === 'smartbin' ? (
                <WasteBinLocator user={user} onChangeUser={onChangeUser} />
              ) : (
                <RecyclingCenterMap />
              )}
            </div>
          </div>

          {/* Daily Circular Economy & Recycling Tips Carousel (Moved to bottom!) */}
          <div className="mb-6 flex flex-col gap-3 text-left">
            <div className="flex justify-between items-center px-1">
              <div className="flex items-center gap-1.5 font-sans">
                <Lightbulb className="w-4 h-4 text-amber-500 animate-pulse" />
                <h3 className="text-xs font-black text-primary uppercase tracking-wider">Cirkulære Dagstips</h3>
              </div>
              <div className="flex gap-1.5">
                <button
                  id="prev-tip-btn"
                  onClick={() => scrollTips('left')}
                  className="w-7 h-7 bg-white border border-gray-200 rounded-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 cursor-pointer shadow-3xs transition-all"
                  title="Forrige tip"
                >
                  <ChevronLeft className="w-4 h-4 text-primary" />
                </button>
                <button
                  id="next-tip-btn"
                  onClick={() => scrollTips('right')}
                  className="w-7 h-7 bg-white border border-gray-200 rounded-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 cursor-pointer shadow-3xs transition-all"
                  title="Næste tip"
                >
                  <ChevronRight className="w-4 h-4 text-primary" />
                </button>
              </div>
            </div>

            {/* Carousel track */}
            <div 
              ref={tipsCarouselRef}
              className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
              style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
            >
              {RECYCLING_TIPS.map((tip, idx) => {
                const isTodayTip = idx === dailyTipIndex;
                return (
                  <motion.div
                    key={tip.id}
                    id={`recycling-tip-card-${tip.id}`}
                    whileHover={{ scale: 1.01, y: -2 }}
                    className={`min-w-[250px] max-w-[250px] bg-gradient-to-br ${tip.colorClass} border rounded-2xl p-4 flex flex-col justify-between gap-2 shadow-2xs shrink-0 snap-align-start transition-all relative overflow-hidden ${
                      isTodayTip ? 'ring-2 ring-amber-400 border-amber-300' : 'border-gray-200'
                    }`}
                  >
                    {/* Floating watermark icon */}
                    <div className="absolute right-1 -bottom-4 text-7xl opacity-[0.08] select-none pointer-events-none">
                      {tip.emoji}
                    </div>

                    <div className="flex flex-col gap-1.5 z-10">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] font-black tracking-widest text-primary/60 bg-white/50 px-2 py-0.5 rounded border border-white/80 uppercase">
                          {tip.category}
                        </span>
                        {isTodayTip && (
                          <span className="bg-amber-400 text-primary font-black text-[7.5px] px-1.5 py-0.5 rounded-full uppercase leading-none shadow-3xs border border-amber-300 animate-pulse flex items-center gap-0.5">
                            ⚡ DAGENS TIP
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xl filter drop-shadow-sm leading-none">{tip.emoji}</span>
                        <h4 className="text-[12px] font-black text-primary leading-tight uppercase font-sans">
                          {tip.title}
                        </h4>
                      </div>

                      <p className="text-[10px] text-primary/85 leading-relaxed font-semibold mt-0.5">
                        {tip.text}
                      </p>
                    </div>

                    <div className="text-[8px] text-primary/40 font-bold self-start mt-2 border-t border-primary/5 pt-1.5 w-full flex justify-between items-center">
                      <span>Cirkel Viden</span>
                      <span>{isTodayTip ? '✓ Idag' : `Tip #${tip.id}`}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Sortering performance grid */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mt-auto shadow-sm">
            <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-3 text-center">Din Cirkel Sorteringsstatistik</span>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="flex flex-col">
                <span className="text-xl font-extrabold text-primary">{user.balance.toFixed(2)} kr</span>
                <span className="text-[10px] font-bold text-muted-text uppercase mt-0.5">Optjent</span>
              </div>
              <div className="border-l border-gray-100 flex flex-col">
                <span className="text-xl font-extrabold text-primary">{user.scansCount}</span>
                <span className="text-[10px] font-bold text-muted-text uppercase mt-0.5">Scanninger</span>
              </div>
              <div className="border-l border-gray-100 flex flex-col">
                <span className="text-xl font-extrabold text-primary">{user.co2SavedKg} kg</span>
                <span className="text-[10px] font-bold text-muted-text uppercase mt-0.5">CO₂ sparet</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
          <motion.div 
            className="text-6xl mb-6"
            animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          >
            🧠
          </motion.div>
          <h3 className="text-xl font-black text-primary mb-2">AI analyserer emballage...</h3>
          <p className="text-muted-text text-sm max-w-xs mb-8">Vi genererer et levende AI materialepas med klimadata samt Aarhus Kommunes sorteringsguide.</p>
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-accent animate-spin" />
        </div>
      )}

      {phase === 'result' && scanResult && (
        <div className="flex flex-col flex-1 gap-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button 
              id="back-to-ready-btn"
              onClick={() => {
                setPhase('ready');
                setScanResult(null);
              }}
              className="w-10 h-10 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-gray-50 cursor-pointer shadow-sm"
            >
              <ChevronLeft className="w-5 h-5 text-primary shrink-0" />
            </button>
            <div>
              <span className="text-xs font-bold text-muted-text uppercase tracking-wider block">ANALYSE UDFØRT</span>
              <h3 className="text-xl font-black text-primary leading-none">Fundet emballage!</h3>
            </div>
          </div>

          {/* Main Info Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="text-lg font-black text-primary leading-tight">{scanResult.productName}</h4>
                <p className="text-xs text-muted-text font-semibold mt-1">{scanResult.materialShort}</p>
              </div>
              <div className="bg-success-alt/10 border border-success-alt/20 py-1.5 px-3 rounded-xl">
                <span className="text-sm font-black text-success-alt">{scanResult.grade}</span>
              </div>
            </div>
          </div>

          {/* Material Passport (Materialepas) Block */}
          <div className="bg-primary rounded-3xl p-5 text-white shadow-md relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-full blur-xl pointer-events-none" />
            <span className="text-[10px] font-black tracking-widest text-white/40 block mb-4 uppercase">AI MATERIALEPAS</span>
            
            <div className="grid grid-cols-4 gap-2 mb-5">
              <div className="bg-white/5 rounded-xl p-2.5 text-center flex flex-col items-center">
                <span className="text-lg mb-0.5">🌍</span>
                <span className="text-xs font-black text-white">{scanResult.co2Saved}</span>
                <span className="text-[8px] font-bold text-white/30 uppercase mt-0.5">CO₂</span>
              </div>
              <div className="bg-white/5 rounded-xl p-2.5 text-center flex flex-col items-center">
                <span className="text-lg mb-0.5">💧</span>
                <span className="text-xs font-black text-white">{scanResult.waterSaved}</span>
                <span className="text-[8px] font-bold text-white/30 uppercase mt-0.5">Vand</span>
              </div>
              <div className="bg-white/5 rounded-xl p-2.5 text-center flex flex-col items-center">
                <span className="text-lg mb-0.5">⚡</span>
                <span className="text-xs font-black text-white">{scanResult.energySaved}</span>
                <span className="text-[8px] font-bold text-white/30 uppercase mt-0.5">Energi</span>
              </div>
              <div className="bg-white/5 rounded-xl p-2.5 text-center flex flex-col items-center">
                <span className="text-lg mb-0.5">💰</span>
                <span className="text-xs font-black text-accent">{scanResult.pantValue} kr</span>
                <span className="text-[8px] font-bold text-white/30 uppercase mt-0.5">Pant</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
              <div className="flex justify-between text-xs">
                <span className="text-white/40 font-semibold">Materiale:</span>
                <span className="font-bold text-white/90">{scanResult.materialType}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40 font-semibold">Genanvendeligt:</span>
                <span className="font-bold text-accent">{scanResult.recyclablePercent}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40 font-semibold">Producent:</span>
                <span className="font-bold text-white/90">{scanResult.manufacturer}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40 font-semibold">Emballage vægt:</span>
                <span className="font-bold text-white/90">{scanResult.packagingWeight}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40 font-semibold">Cirkulær-score:</span>
                <span className="font-bold text-accent">{scanResult.circularScore}/100</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40 font-semibold">EPR (Producentansvar):</span>
                <span className="font-bold text-green-400">{scanResult.eprStatus}</span>
              </div>
            </div>
          </div>

          {/* AI-baseret AR Sorterings-Simulator */}
          <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4 text-left font-sans">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[9px] font-black text-primary/60 tracking-wider uppercase block">AI AR-MATERIALESIMULATOR</span>
                <h4 className="text-base font-black text-primary flex items-center gap-1.5 mt-0.5">
                  <Sparkles className="w-4.5 h-4.5 text-accent animate-pulse text-[#C8F24A] fill-[#C8F24A]/20" />
                  Interaktiv Sorteringsanalyse (AR)
                </h4>
              </div>
              <button
                onClick={() => {
                  setArXrayActive(prev => !prev);
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                }}
                className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-xl border transition-all flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 ${
                  arXrayActive 
                    ? 'bg-accent/20 border-accent text-primary font-extrabold shadow-inner' 
                    : 'bg-gray-50 border-gray-250 text-muted-text hover:bg-gray-100'
                }`}
              >
                <span>⚡ Røntgen</span>
                <span className={`w-1.5 h-1.5 rounded-full ${arXrayActive ? 'bg-accent animate-ping' : 'bg-gray-400'}`} />
              </button>
            </div>

            <p className="text-xs font-semibold text-muted-text leading-relaxed">
              Vores AI har kortlagt emballagens forskellige komponenter. Tryk på de trykfølsomme AR-mærker på billedet for at se, om delen er genanvendelig eller skal sorteres til restaffald.
            </p>

            {/* Simulated Live AR Canvas */}
            <div className="relative w-full aspect-[4/3] bg-primary rounded-2xl overflow-hidden border border-primary/10 flex flex-col items-center justify-center">
              {/* Scanlines / Grid Overlay */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,3px_100%] pointer-events-none z-10" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(200,242,74,0.08)_0%,transparent_75%)] pointer-events-none z-10" />
              
              {/* Simulated Holographic alignment indicators */}
              <div className="absolute top-4 left-4 border-t-2 border-l-2 border-accent/45 w-6 h-6 pointer-events-none z-10" />
              <div className="absolute top-4 right-4 border-t-2 border-r-2 border-accent/45 w-6 h-6 pointer-events-none z-10" />
              <div className="absolute bottom-4 left-4 border-b-2 border-l-2 border-accent/45 w-6 h-6 pointer-events-none z-10" />
              <div className="absolute bottom-4 right-4 border-b-2 border-r-2 border-accent/45 w-6 h-6 pointer-events-none z-10" />

              {/* AR Laser Line Sweep animation */}
              <motion.div 
                className="absolute left-0 w-full h-[2px] bg-accent/60 shadow-[0_0_8px_#C8F24A] z-10 pointer-events-none"
                animate={{
                  top: ['0%', '100%', '0%']
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'linear'
                }}
              />

              {/* Background Product Image or Vector Silhouette */}
              <div className={`w-full h-full absolute inset-0 ${arXrayActive ? 'brightness-[0.4] grayscale contrast-[1.8] saturate-[0.8] [filter:hue-rotate(240deg)_saturate(200%)]' : ''} transition-all duration-500`}>
                {capturedImagePreview ? (
                  <img 
                    src={capturedImagePreview} 
                    referrerPolicy="no-referrer"
                    alt="Scanned item camera feed preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  /* Futuristic neon visual fallback outline for products based on category */
                  <div className="w-full h-full bg-[#0a0f1d] flex items-center justify-center text-white/5 relative">
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:24px_24px]" />
                    {/* Centered neon silhouette drawing */}
                    <div className="z-0 opacity-45 flex flex-col items-center">
                      {scanResult.productName.toLowerCase().includes('arla') || scanResult.productName.toLowerCase().includes('mælk') || scanResult.productName.toLowerCase().includes('karton') || scanResult.productName.toLowerCase().includes('skyr') || scanResult.productName.toLowerCase().includes('juice') ? (
                        /* Carton Silhouette SVG */
                        <svg className="w-36 h-48 text-[#C8F24A]/30" viewBox="0 0 100 150" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M25 40 L50 20 L75 40 L75 135 L25 135 Z" strokeLinecap="round" strokeLinejoin="round" />
                          <line x1="25" y1="40" x2="75" y2="40" />
                          <path d="M50 20 L50 40" strokeLinecap="round" />
                          <circle cx="62" cy="22" r="6" strokeDasharray="3,3" />
                        </svg>
                      ) : scanResult.productName.toLowerCase().includes('zero') || scanResult.productName.toLowerCase().includes('coca') || scanResult.productName.toLowerCase().includes('cola') || scanResult.productName.toLowerCase().includes('pet') || scanResult.productName.toLowerCase().includes('flaske') ? (
                        /* Bottle Silhouette SVG */
                        <svg className="w-28 h-48 text-[#C8F24A]/30" viewBox="0 0 80 150" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M30 20 H50 V35 C50 45, 65 55, 65 75 V135 C65 140, 60 145, 55 145 H25 C20 145, 15 140, 15 135 V75 C15 55, 30 45, 30 35 Z" strokeLinecap="round" strokeLinejoin="round" />
                          <rect x="25" y="14" width="30" height="6" rx="1" />
                          <path d="M15 90 H65" strokeDasharray="3,3" />
                          <path d="M15 110 H65" strokeDasharray="3,3" />
                        </svg>
                      ) : scanResult.productName.toLowerCase().includes('royal') || scanResult.productName.toLowerCase().includes('pilsner') || scanResult.productName.toLowerCase().includes('carlsberg') || scanResult.productName.toLowerCase().includes('retur') || scanResult.productName.toLowerCase().includes('glas') || scanResult.productName.toLowerCase().includes('dåse') || scanResult.materialType.toLowerCase().includes('metal') ? (
                        /* Can Silhouette SVG */
                        <svg className="w-28 h-44 text-[#C8F24A]/30" viewBox="0 0 80 130" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <rect x="20" y="15" width="40" height="100" rx="12" strokeLinecap="round" strokeLinejoin="round" />
                          <line x1="20" y1="27" x2="60" y2="27" />
                          <line x1="20" y1="103" x2="60" y2="103" />
                          <path d="M40 10 L45 15 H35 Z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        /* Default Pouch/Box Silhouette */
                        <svg className="w-32 h-44 text-[#C8F24A]/30" viewBox="0 0 90 130" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M15 15 L75 15 C80 15, 80 25, 75 35 L75 115 C75 122, 68 125, 60 125 L30 125 C22 125, 15 122, 15 115 L15 35 C10 25, 10 15, 15 15 Z" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M15 35 H75" strokeDasharray="4,2" />
                        </svg>
                      )}
                      <span className="text-[8px] font-mono font-black tracking-widest text-[#C8F24A]/40 mt-3 select-none uppercase">
                        {arXrayActive ? '🧬 KROMATISK RØNTGENAKTIV' : '🧬 HOLOSYSTEM DATAOPMÅLT'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* AR Laser Marker targets absolutely positioned */}
              {getARComponents(scanResult.productName, scanResult.materialType).map((comp) => {
                const isSelected = selectedCompId === comp.id;
                // determine color theme for marker
                let markerBg = 'bg-emerald-500';
                let markerBorder = 'border-emerald-300';
                let markerShadow = 'shadow-emerald-500/50';
                let labelStyle = 'text-green-400 bg-emerald-950/80';
                
                if (comp.type === 'landfill') {
                  markerBg = 'bg-rose-500';
                  markerBorder = 'border-rose-300';
                  markerShadow = 'shadow-rose-400/50';
                  labelStyle = 'text-red-400 bg-rose-950/80';
                } else if (comp.type === 'pant') {
                  markerBg = 'bg-cyan-500';
                  markerBorder = 'border-cyan-300';
                  markerShadow = 'shadow-cyan-400/50';
                  labelStyle = 'text-cyan-400 bg-cyan-950/80';
                }

                return (
                  <div
                    key={comp.id}
                    className="absolute z-20 transition-all duration-300"
                    style={{ left: `${comp.x}%`, top: `${comp.y}%` }}
                  >
                    {/* Crosshair pulse rings centered */}
                    <div className="relative -left-3.5 -top-3.5 flex items-center justify-center">
                      <motion.button
                        id={`ar-marker-${comp.id}`}
                        onClick={() => {
                          setSelectedCompId(comp.id);
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                        }}
                        className={`w-7 h-7 rounded-full border-2 ${markerBorder} ${markerBg} ${markerShadow} shadow-lg flex items-center justify-center focus:outline-hidden cursor-pointer relative z-30`}
                        animate={{ 
                          scale: isSelected ? [1, 1.25, 1] : [1, 1.1, 1],
                        }}
                        transition={{ 
                          repeat: Infinity, 
                          duration: isSelected ? 1.2 : 2, 
                          ease: "easeInOut" 
                        }}
                      >
                        {/* Target reticle dot */}
                        <span className={`w-2.5 h-2.5 rounded-full bg-white transition-all ${isSelected ? 'scale-125 animate-ping' : ''}`} />
                      </motion.button>

                      {/* Expanding radar rings */}
                      <span className={`absolute w-12 h-12 rounded-full border border-dotted ${isSelected ? 'border-accent' : markerBorder} opacity-40 animate-spin [animation-duration:8s] pointer-events-none z-10`} />
                      <span className={`absolute w-16 h-16 rounded-full border ${isSelected ? 'border-accent/40 bg-accent/5' : 'border-white/20'} opacity-30 animate-pulse pointer-events-none`} />

                      {/* Small text flag label next to target icon */}
                      <span className={`absolute left-9 whitespace-nowrap px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider shadow-md pointer-events-none transition-all duration-300 ${labelStyle} border border-white/10 ${
                        isSelected ? 'scale-105 translate-x-1 opacity-100' : 'opacity-70'
                      }`}>
                        {comp.name.substring(0, 16)}...
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom HUD Sheet - Details regarding the selected packaging part */}
            {(() => {
              const comps = getARComponents(scanResult.productName, scanResult.materialType);
              const selectedComp = comps.find(c => c.id === selectedCompId) || comps[0];
              if (!selectedComp) return null;

              let typeBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-250";
              let typeTitle = "♻️ GENANVENDELIG";
              if (selectedComp.type === 'landfill') {
                typeBadgeClass = "bg-rose-50 text-rose-700 border-rose-250";
                typeTitle = "🗑️ Restaffald";
              } else if (selectedComp.type === 'pant') {
                typeBadgeClass = "bg-[#C8F24A]/10 text-primary border-[#C8F24A]/40";
                typeTitle = "🌟 PANTSYSTEM";
              }

              return (
                <div className="bg-gray-50 border border-gray-150 rounded-2xl p-4.5 flex flex-col gap-2.5 shadow-inner text-left">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="text-[8px] font-black text-muted-text/75 tracking-wider uppercase block">VALGT AR EMBALLAGEDEL</span>
                      <h5 className="text-sm font-black text-primary mt-1">{selectedComp.name}</h5>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border shadow-xs select-none ${typeBadgeClass}`}>
                      {typeTitle}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 border-y border-gray-200/60 py-2.5 my-1 text-xs">
                    <div>
                      <span className="text-[9px] font-black text-muted-text/50 uppercase tracking-widest block">Materialetype</span>
                      <span className="font-bold text-primary mt-0.5 block">{selectedComp.material}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-black text-muted-text/50 uppercase tracking-widest block font-sans">Anbefalet handling</span>
                      <span className="font-bold text-primary mt-0.5 block">
                        {selectedComp.type === 'landfill' ? '🗑️ Sorter i Restaffald' : selectedComp.type === 'pant' ? '🍾 Pant i automat' : '♻️ Sorter i genbrug'}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs font-semibold text-muted-text/90 leading-relaxed">
                    {selectedComp.desc}
                  </p>

                  <div className="bg-white border border-gray-200/80 rounded-xl p-3 flex gap-2.5 items-start mt-1">
                    <div className="bg-[#C8F24A]/15 text-primary p-1.5 rounded-lg flex items-center justify-center shrink-0">
                      <Lightbulb className="w-4 h-4 text-primary fill-[#C8F24A]" />
                    </div>
                    <div>
                      <span className="text-[9px] font-black text-primary/75 tracking-wider uppercase block">MASKINELT SORTERINGSTIP</span>
                      <p className="text-[11px] font-bold text-muted-text mt-0.5 leading-snug">{selectedComp.tip}</p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* AI-driven educational overlay with 'Did you know?' tip about material composition and sorting best practices */}
          {scanResult.didYouKnow && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-amber-50/70 border border-amber-200 rounded-3xl p-5 shadow-inner text-left relative overflow-hidden"
            >
              <div className="absolute right-3 top-3 text-amber-200/50 pointer-events-none">
                <Sparkles className="w-12 h-12 animate-pulse" />
              </div>
              <div className="flex gap-3.5 items-start">
                <div className="bg-amber-100 text-amber-700 p-2 rounded-2xl flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                  <Lightbulb className="w-5 h-5 text-amber-600 fill-amber-300" />
                </div>
                <div className="flex-1">
                  <span className="text-[9px] font-black text-amber-800 bg-amber-200/50 px-2.5 py-0.5 rounded-lg tracking-widest uppercase">
                    💡 Vidste du det?
                  </span>
                  <h4 className="text-sm font-black text-[#633c02] mt-1.5 leading-tight">
                    AI Materialeindsigt
                  </h4>
                  <p className="text-xs font-semibold text-amber-900/90 mt-1.5 leading-relaxed">
                    {scanResult.didYouKnow}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Sortering guidance Aarhus */}
          <div className="bg-accent/15 border border-accent/30 rounded-2xl p-5 shadow-sm flex flex-col gap-1.5">
            <span className="text-[9px] font-black text-primary/60 tracking-wider uppercase">SORTERING — {user.municipality.toUpperCase()}</span>
            <div className="flex justify-between items-center">
              <h4 className="text-base font-black text-primary">{scanResult.sortingType}</h4>
              {suggestedBin && (
                <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg ${suggestedBin.bgClass} ${suggestedBin.textClass} border ${suggestedBin.borderClass} shadow-xs flex items-center gap-1`}>
                  <span>{suggestedBin.picto}</span> {suggestedBin.colorName}
                </span>
              )}
            </div>
            <p className="text-xs font-medium text-primary/80 leading-relaxed mt-1">{scanResult.sortingInstructions}</p>
          </div>

          {/* Suggested Recycling Bin Highlight Section */}
          {suggestedBin && (
            <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-black text-muted-text tracking-widest uppercase">ANBEFALET SORTERINGSBEHOLDER (MILJØSTYRELSEN)</span>
                <div className="flex items-center gap-2.5 mt-1">
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${suggestedBin.colorClass} shadow-md shadow-black/10`}>
                    <span className="text-white filter drop-shadow font-extrabold">{suggestedBin.picto}</span>
                  </span>
                  <div>
                    <h4 className="text-sm font-black text-primary">Kategori: {suggestedBin.colorName}</h4>
                    <p className="text-[10px] text-muted-text font-bold">Officiel national farvekode og sorteringssymbol</p>
                  </div>
                </div>
              </div>

              {/* Grid of the 7 official standard Danish waste bins with active highlight */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {STANDARD_DANISH_BINS.map((bin) => {
                  const isActive = bin.id === suggestedBin.id;
                  return (
                    <div 
                      key={bin.id}
                      className={`relative flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all ${
                        isActive 
                          ? `${bin.bgLight} ${bin.border} ${bin.activeGlow} scale-102 ring-2 ring-primary/5`
                          : 'bg-gray-50/40 border-gray-100 opacity-40 hover:opacity-75'
                      }`}
                      title={`${bin.label} (${bin.translation})`}
                    >
                      {/* Interactive indicator badge */}
                      {isActive && (
                        <div className="absolute -top-1.5 -right-1 bg-primary text-accent rounded-full p-0.5 shadow-md border border-white">
                          <Check className="w-2.5 h-2.5 stroke-[4.5]" />
                        </div>
                      )}
                      
                      {/* Visual representations of trash can */}
                      <div className="relative w-8 h-10 mt-1 mb-1.5 flex flex-col items-center justify-end">
                        {/* Can Lid */}
                        <div className={`w-7 h-1.5 rounded-t-sm transition-all shadow-xs ${isActive ? bin.color : 'bg-gray-400'}`} />
                        {/* Can Handle/Accent bar */}
                        <div className="w-5 h-0.5 bg-gray-300" />
                        {/* Can Body */}
                        <div className={`w-6 h-7 rounded-b-md relative flex items-center justify-center transition-all shadow-sm ${isActive ? bin.color : 'bg-gray-300'}`}>
                          <span className="text-xs text-white/90 filter drop-shadow-sm leading-none font-black">{bin.icon}</span>
                        </div>
                        {/* Can Wheels (tiny circle indicators) */}
                        <div className="flex gap-2.5 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                        </div>
                      </div>

                      <span className="text-[8px] font-black leading-tight text-primary truncate max-w-full block">
                        {bin.label.split(' / ')[0]}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Informative description text */}
              <div className={`p-3.5 rounded-2xl text-xs leading-relaxed border font-medium ${suggestedBin.bgClass} ${suggestedBin.textClass} ${suggestedBin.borderClass}`}>
                <div className="flex gap-2 items-start">
                  <span className="text-base leading-none">💡</span>
                  <p>{suggestedBin.description}</p>
                </div>
              </div>
            </div>
          )}

          {/* Nearest Smart Bin Navigation Card (Send directly to affaldsspand) */}
          {nearestSmartBin && (
            <div className="bg-white border-2 border-[#C8F24A] border-dashed rounded-3xl p-5 shadow-sm flex flex-col gap-3.5 relative overflow-hidden">
              <div className="absolute right-3 top-3 animate-pulse bg-accent/20 text-primary border border-accent text-[8px] font-black uppercase tracking-wider py-0.5 px-2 rounded-full">
                📡 IoT Smart-Bin Live
              </div>
              
              <div className="flex flex-col gap-1 text-left">
                <span className="text-[9px] font-black text-muted-text tracking-widest uppercase">Nær-deponering (Affaldsspand)</span>
                <h5 className="text-sm font-black text-primary flex items-center gap-1.5 mt-1 leading-snug">
                  <span>🗑️</span> {nearestSmartBin.name}
                </h5>
                <p className="text-[10px] text-muted-text font-semibold">{nearestSmartBin.address}</p>
              </div>

              <div className="bg-[#FAF9F6] rounded-2xl p-3 border border-gray-150 flex items-center justify-between">
                <div className="flex flex-col text-left">
                  <span className="text-[8px] text-muted-text font-black uppercase tracking-wide">Afstand</span>
                  <span className="text-xs font-black text-primary mt-0.5">{nearestSmartBin.distance} km</span>
                </div>
                <div className="h-6 w-px bg-gray-200" />
                <div className="flex flex-col text-left pl-2.5">
                  <span className="text-[8px] text-muted-text font-black uppercase tracking-wide">Estimering</span>
                  <span className="text-xs font-black text-primary mt-0.5">🚶 {Math.round(nearestSmartBin.distance * 12) || 1} min</span>
                </div>
                <div className="h-6 w-px bg-gray-200" />
                <div className="flex flex-col text-left">
                  <span className="text-[8px] text-muted-text font-black uppercase tracking-wide">Type</span>
                  <span className="text-[9px] font-black text-[#85A912] mt-0.5">IoT Smart-Bin ✓</span>
                </div>
              </div>

              {/* ROUTE SEND TRIGGER */}
              <a
                id="route-to-smart-bin-btn"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nearestSmartBin.name + ' ' + nearestSmartBin.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-[#C8F24A] hover:bg-[#b2da3c] text-primary py-3 px-4 rounded-xl text-xs font-black text-center shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
              >
                Rutevejledning direkte til affaldsspanden <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Aflevér & Verificer block */}
          <div className="mb-4">
            <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-2.5">AFLEVÉR & VERIFICER SALDO</span>
            <div className="flex flex-col gap-2.5">
              
              <button 
                id="verify-home-btn"
                onClick={() => triggerVerification(0.15, 2, 'Hjemme-foto')}
                className="bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex justify-between items-center text-left transition-all active:scale-99 shadow-sm cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl bg-gray-100 p-2 rounded-xl">📸</span>
                  <div>
                    <h5 className="text-xs font-black text-primary">Hjemme-foto</h5>
                    <p className="text-[10px] text-muted-text font-medium mt-0.5">Tag sorteringsbillede hjemme</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-primary">+0,15 kr · +2 CP</p>
                  <p className="text-[9px] text-muted-text font-medium mt-0.5">Tillid: 60%</p>
                </div>
              </button>

              <button 
                id="verify-iot-btn"
                onClick={() => triggerVerification(0.35, 4, 'IoT-sensor')}
                className="bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex justify-between items-center text-left transition-all active:scale-99 shadow-sm cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl bg-blue-50 p-2 rounded-xl">📡</span>
                  <div>
                    <h5 className="text-xs font-black text-primary">IoT-sensor</h5>
                    <p className="text-[10px] text-muted-text font-medium mt-0.5">Registreres i nærhedsbeholder</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-blue-600">+0,35 kr · +4 CP</p>
                  <p className="text-[9px] text-muted-text font-medium mt-0.5">Tillid: 80%</p>
                </div>
              </button>

              <button 
                id="verify-drop-point-btn"
                onClick={() => triggerVerification(0.75, 6, 'Drop Point')}
                className="bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex justify-between items-center text-left transition-all active:scale-99 shadow-sm cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl bg-emerald-50 p-2 rounded-xl">📦</span>
                  <div>
                    <h5 className="text-xs font-black text-primary">Drop Point</h5>
                    <p className="text-[10px] text-muted-text font-medium mt-0.5">Lokale genbrugsstationer</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-success-alt">+0,75 kr · +6 CP</p>
                  <p className="text-[9px] text-muted-text font-medium mt-0.5">Tillid: 95%</p>
                </div>
              </button>

              <button 
                id="verify-vending-btn"
                onClick={() => triggerVerification(1.50, 8, 'Pant-automat')}
                className="bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex justify-between items-center text-left transition-all active:scale-99 shadow-sm cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl bg-emerald-50 p-2 rounded-xl">🏧</span>
                  <div>
                    <h5 className="text-xs font-black text-primary">Pant-automat</h5>
                    <p className="text-[10px] text-muted-text font-medium mt-0.5">Dansk Retursystem stationer</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-success-alt">+1,50 kr · +8 CP</p>
                  <p className="text-[9px] text-muted-text font-medium mt-0.5">Tillid: 98%</p>
                </div>
              </button>

            </div>
          </div>

          <button 
            id="cancel-scan-result-btn"
            onClick={() => {
              setPhase('ready');
              setScanResult(null);
            }} 
            className="text-muted-text hover:text-primary transition-colors text-xs font-bold text-center pt-2 cursor-pointer"
          >
            ← Sorter en anden emballage
          </button>
        </div>
      )}

      {/* Scanner Help Modal Overlay */}
      {showScannerHelp && (
        <div id="scanner-help-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white border border-gray-150 rounded-3xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
            
            {/* Header */}
            <div className="flex justify-between items-start pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary/5 flex items-center justify-center text-sm">💡</span>
                <div>
                  <h4 className="text-xs font-black text-primary uppercase tracking-wider">Vælg den rette scanning</h4>
                  <p className="text-[9px] text-muted-text font-bold">Lær de to metoder at kende</p>
                </div>
              </div>
              <button
                id="close-scanner-help-btn"
                onClick={() => setShowScannerHelp(false)}
                className="p-1 hover:bg-gray-150 rounded-lg text-primary/40 hover:text-primary transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explanation section */}
            <div className="flex flex-col gap-3.5">
              
              {/* Option 1: AI Camera */}
              <div className="flex gap-3 p-3 rounded-2xl bg-[#FAF9F6] border border-gray-150">
                <span className="text-xl shrink-0 mt-0.5">🧠</span>
                <div>
                  <h5 className="text-[11px] font-black text-primary uppercase tracking-wide leading-none">🧠 AI Kamera-Genkendelse</h5>
                  <p className="text-[10px] text-muted-text font-semibold mt-1 leading-relaxed">
                    Bedst til <span className="text-primary font-bold">alle former for løs emballage</span> (f.eks. plastbakker, mælkekartoner, flasker uden stregkode).
                  </p>
                  <ul className="text-[9.5px]/relaxed text-primary/80 font-medium mt-1.5 list-disc pl-3.5 space-y-0.5">
                    <li>AI analyserer form, materiale og farve live</li>
                    <li>Særligt genialt ved tvivl om plastiktype</li>
                    <li>Tag blot et billede af hele tingen</li>
                  </ul>
                </div>
              </div>

              {/* Option 2: QR & Barcode */}
              <div className="flex gap-3 p-3 rounded-2xl bg-white border border-gray-150 shadow-2xs">
                <span className="text-xl shrink-0 mt-0.5">🔳</span>
                <div>
                  <h5 className="text-[11px] font-black text-primary uppercase tracking-wide leading-none">🔳 QR & EAN Stregkode</h5>
                  <p className="text-[10px] text-muted-text font-semibold mt-1 leading-relaxed">
                    Bedst til <span className="text-primary font-bold">mærkevarer samt gods med stregkoder</span>, eller officielle Cirkel QR-mærker.
                  </p>
                  <ul className="text-[9.5px]/relaxed text-primary/80 font-medium mt-1.5 list-disc pl-3.5 space-y-0.5">
                    <li>Giver 100% præcis genkendelse i databasen</li>
                    <li>Dekoder EAN-numre og særskilte QR-labels</li>
                    <li>Placer stregkoden helt indenfor fokusrammen</li>
                  </ul>
                </div>
              </div>

              {/* Tip */}
              <div className="p-3 bg-emerald-50/55 border border-emerald-100 rounded-2xl text-[9.5px] font-semibold text-emerald-950 leading-relaxed flex items-start gap-2">
                <span className="text-xs leading-none">💡</span>
                <p>
                  <span className="font-extrabold text-emerald-800">Hurtigt tip:</span> Hvis dit produkt har en tydelig stregkode, så brug altid <span className="text-primary font-bold">QR / EAN</span> for det hurtigste og mest nøjagtige match.
                </p>
              </div>

            </div>

            {/* Action Button */}
            <button
              id="confirm-scanner-help-btn"
              onClick={() => setShowScannerHelp(false)}
              className="w-full py-2.5 bg-primary text-accent hover:bg-primary/95 font-black text-xs uppercase rounded-xl transition-all shadow-sm cursor-pointer select-none tracking-wider text-center"
            >
              Kom i gang! 🚀
            </button>

          </div>
        </div>
      )}

      {/* Daily Check-in Celebration Modal Overlay */}
      {showCheckinBonusCeleb && (
        <div id="checkin-bonus-celeb-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white border border-gray-150 rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center gap-4 animate-in slide-in-from-bottom-4 duration-300">
            
            {/* Celebration Emojis */}
            <div className="relative">
              <span className="text-6xl animate-bounce duration-500 block">🎁</span>
              <span className="absolute -top-2 -right-2 text-2xl animate-ping">✨</span>
              <span className="absolute -bottom-1 -left-2 text-2xl">🎉</span>
            </div>

            <div className="mt-2">
              <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                Daglig Bonus Udbetalt!
              </span>
              <h4 className="text-lg font-black text-primary mt-2">Du har indløst +2,00 kr!</h4>
              <p className="text-[11px] text-muted-text font-semibold mt-1 leading-relaxed">
                Flot arbejde! Ved at åbne Cirkel og scanne en emballage beviser du, at de grønne sorteringsvaner sidder lige i skabet.
              </p>
            </div>

            {/* Reward Pill */}
            <div className="bg-[#FAF9F6] border border-gray-150 p-3 rounded-2xl w-full flex justify-around items-center">
              <div>
                <span className="text-[8px] font-bold text-muted-text uppercase block">Ny Saldo</span>
                <span className="text-sm font-black font-mono text-primary">{(user.balance).toFixed(2)} kr</span>
              </div>
              <div className="h-6 w-[1px] bg-gray-250" />
              <div>
                <span className="text-[8px] font-bold text-muted-text uppercase block">Point heraf</span>
                <span className="text-sm font-black text-[#10B981] font-mono">+15 CP</span>
              </div>
            </div>

            {/* Close Button */}
            <button
               id="close-checkin-celeb-btn"
               onClick={() => setShowCheckinBonusCeleb(false)}
               className="w-full py-2.5 bg-primary text-accent hover:bg-primary/95 font-black text-xs uppercase rounded-xl transition-all shadow-sm cursor-pointer select-none tracking-wider text-center"
            >
              Fortsæt det gode arbejde! 🚀
            </button>

          </div>
        </div>
      )}

      {/* Deposit Verification Celebration Modal Overlay */}
      {showVerificationCeleb && verificationDetails && (
        <div id="verification-celeb-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white border border-gray-150 rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center gap-4 animate-in slide-in-from-bottom-4 duration-300">
            
            {/* Celebration Emojis */}
            <div className="relative">
              <span className="text-6xl animate-bounce duration-500 block">♻️</span>
              <span className="absolute -top-1 -right-2 text-2xl animate-spin duration-3000">🌟</span>
              <span className="absolute -bottom-1 -left-2 text-2xl animate-ping text-emerald-400">✨</span>
            </div>

            <div className="mt-2">
              <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                Verificering Godkendt!
              </span>
              <h4 className="text-lg font-black text-primary mt-2">Deltagelse registreret! 🎉</h4>
              <p className="text-[11px] text-muted-text font-semibold mt-1 leading-relaxed">
                Tusind tak for din grønne indsats! Din aflevering via <strong className="text-primary font-black">{verificationDetails.label}</strong> er bekræftet i databasen og din profil er opdateret.
              </p>
            </div>

            {/* Reward Pill */}
            <div className="bg-[#FAF9F6] border border-gray-150 p-3.5 rounded-2xl w-full flex justify-around items-center">
              <div className="text-center">
                <span className="text-[8px] font-black text-muted-text uppercase block">Udbetalt Pant</span>
                <span className="text-sm font-black font-mono text-primary">+{verificationDetails.pant.toFixed(2)} kr</span>
              </div>
              <div className="h-6 w-[1px] bg-gray-250" />
              <div className="text-center">
                <span className="text-[8px] font-black text-muted-text uppercase block">Optjente Points</span>
                <span className="text-sm font-black text-[#85A912] font-mono">+{verificationDetails.points} CP</span>
              </div>
              <div className="h-6 w-[1px] bg-gray-250" />
              <div className="text-center">
                <span className="text-[8px] font-black text-muted-text uppercase block">CO₂ Sparret</span>
                <span className="text-xs font-black text-[#047857] font-mono">150g</span>
              </div>
            </div>

            {/* Close Button */}
            <button
              id="close-verification-celeb-btn"
              onClick={() => {
                setShowVerificationCeleb(false);
                setVerificationDetails(null);
              }}
              className="w-full py-2.5 bg-primary text-accent hover:bg-primary/95 font-black text-xs uppercase rounded-xl transition-all shadow-sm cursor-pointer select-none tracking-wider text-center"
            >
              Udført · Fortsæt! 🚀
            </button>

          </div>
        </div>
      )}

      {/* Floating Action Button for AI Chat Sorteringsassistent */}
      <motion.button
        id="ai-chatbot-fab"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => {
          setIsChatOpen(prev => !prev);
          triggerHaptic(HapticPattern.LIGHT_TAP);
        }}
        className="fixed bottom-24 right-5 z-40 bg-primary hover:bg-primary/95 text-accent p-3.5 rounded-full shadow-2xl flex items-center justify-center border-2 border-[#C8F24A]/30 cursor-pointer group"
      >
        <div className="relative flex items-center gap-2">
          {/* Pulsing ring */}
          <span className="absolute -inset-1 rounded-full bg-[#C8F24A]/20 animate-ping pointer-events-none" />
          <MessageSquare className="w-5.5 h-5.5" />
          <span className="max-w-0 overflow-hidden group-hover:max-w-24 transition-all duration-300 text-[10px] font-black uppercase tracking-wider text-accent shrink-0">
            Spørg AI
          </span>
        </div>
      </motion.button>

      {/* AI Sorteringsassistent Chat Interface Overlay */}
      {isChatOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-xs z-50 flex items-end justify-center md:items-center p-0 md:p-4 transition-all duration-300">
          {/* Tap-out area */}
          <div 
            className="absolute inset-0 cursor-default" 
            onClick={() => setIsChatOpen(false)} 
          />
          
          {/* Chat Card */}
          <motion.div
            initial={{ y: 150, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            className="relative bg-white w-full max-w-md h-[82vh] md:h-[620px] rounded-t-3xl md:rounded-3xl border border-gray-150 shadow-2xl flex flex-col overflow-hidden z-20"
          >
            {/* Header */}
            <div className="bg-primary text-accent p-4 flex items-center justify-between shadow-md select-none shrink-0 border-b border-[#C8F24A]/20">
              <div className="flex items-center gap-2.5">
                <div className="relative w-8 h-8 rounded-full bg-[#C8F24A]/20 border border-[#C8F24A]/30 flex items-center justify-center">
                  <Sparkles className="w-4.5 h-4.5 text-[#C8F24A] animate-pulse" />
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-primary rounded-full animate-pulse" />
                </div>
                <div>
                  <h3 className="text-xs font-black tracking-wider uppercase text-accent">Cirkel AI Assistent</h3>
                  <span className="text-[9px] font-bold text-[#C8F24A]/80 block mt-0.5">Din personlige sorteringsguide</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {chatMessages.length > 1 && (
                  <button
                    onClick={() => {
                      if (window.confirm("Vil du rydde samtalehistorikken?")) {
                        setChatMessages([
                          {
                            sender: 'agent',
                            text: 'Samtalen er ryddet! ♻️ Spørg mig endelig om mælkekartoner, pizzabakker eller plastiktyper.'
                          }
                        ]);
                        triggerHaptic(HapticPattern.HEAVY_TAP);
                      }
                    }}
                    title="Ryd samtale"
                    className="p-1.5 hover:bg-white/10 rounded-lg text-white/70 hover:text-[#C8F24A] transition-all cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setIsChatOpen(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-white/70 hover:text-[#C8F24A] transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 bg-[#FAF9F6] scrollbar-thin">
              {chatMessages.map((msg, index) => (
                <div 
                  key={index}
                  className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
                >
                  <span className="text-[8px] font-black uppercase text-muted-text/60 px-1 mb-1 tracking-widest">
                    {msg.sender === 'user' ? 'Dig' : 'Cirkel AI'}
                  </span>
                  <div 
                    className={`rounded-2xl px-4 py-2.5 shadow-xs text-xs font-semibold leading-relaxed ${
                      msg.sender === 'user' 
                        ? 'bg-primary text-accent rounded-tr-none' 
                        : 'bg-white text-muted-text border border-gray-150 rounded-tl-none font-medium'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              
              {isChatLoading && (
                <div className="self-start flex flex-col items-start max-w-[85%]">
                  <span className="text-[8px] font-black uppercase text-muted-text/60 px-1 mb-1 tracking-widest">
                    Cirkel AI
                  </span>
                  <div className="bg-white border border-gray-150 rounded-2xl rounded-tl-none px-4 py-3 shadow-xs">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-primary/30 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Suggestion Chips */}
            <div className="px-4 py-2 bg-white border-t border-gray-100 flex gap-1.5 overflow-x-auto select-none shrink-0 no-scrollbar">
              {[
                "🥛 Mælkekartoner?",
                "🍕 Pizzabakker?",
                "🧴 Hvad er PP5?",
                "🥫 Sorter metal"
              ].map((chip) => (
                <button
                  key={chip}
                  disabled={isChatLoading}
                  onClick={() => {
                    const cleanText = chip.endsWith('?') ? 'Hvordan sorterer jeg ' + chip.slice(2, -1).toLowerCase() + '?' : (chip.startsWith('🥛') ? 'Hvordan sorteres mælkekartoner?' : 'Hvordan sorterer jeg ' + chip.slice(2).toLowerCase() + ' i Danmark?');
                    handleSendChatMessage(cleanText);
                  }}
                  className="px-3 py-1.5 bg-gray-50 border border-gray-150 text-gray-700 rounded-full text-[10px] font-bold hover:bg-[#C8F24A]/20 hover:border-[#C8F24A] transition-all whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer shadow-xs active:scale-95"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Form Input */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleSendChatMessage();
              }}
              className="p-3 bg-white border-t border-gray-150 flex gap-2 items-center shrink-0"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Spørg om specifikke materialer her..."
                disabled={isChatLoading}
                className="flex-1 h-10 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-primary focus:bg-white text-muted-text disabled:opacity-75"
              />
              <button
                type="submit"
                disabled={isChatLoading || !chatInput.trim()}
                className="bg-primary text-accent hover:bg-primary/95 w-10 h-10 flex items-center justify-center rounded-xl hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-40 transition-all cursor-pointer shrink-0 shadow-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
