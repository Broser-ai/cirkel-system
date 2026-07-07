import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { ScanResult, UserProfile } from '../types';
import { Camera, Upload, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, RefreshCw, Sparkles, Smile, Compass, QrCode, Check, Link, HelpCircle, Info, X } from 'lucide-react';
import jsQR from 'jsqr';
import RecyclingCenterMap from './RecyclingCenterMap';
import { useLanguage } from '../lib/i18n';

interface ScanTabProps {
  user: UserProfile;
  onChangeUser: (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => void;
  bal: number;
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
      qrScannerIcon: '🥛'
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
      qrScannerIcon: '🥤'
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
      qrScannerIcon: '🍺'
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
      qrScannerIcon: '🥫'
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
      sortingInstructions: `Ryst chipsrester ud af posen, fold den sammen og læg i beholderen til Blød plast (eller restaffald afhængig af sorteringen in ${municipality}).`,
      decodedRaw: qrData,
      qrScannerIcon: '🍟'
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
    sortingInstructions: `Skyl, rens og placér genstanden i den relevante genbrugsbeholder derhjemme in ${municipality}.`,
    decodedRaw: qrData,
    qrScannerIcon: '🔳'
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
      description: 'Glas og emballageflasker uden pant skal tømmes helt og sorteren i den fælles glascontainer.',
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

function playScanSuccessFeedback() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate([40, 50, 40]);
    } catch {}
  }

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.2);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1567.98, now + 0.08);
    
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

export default function ScanTab({ user, onChangeUser, bal }: ScanTabProps) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<'ready' | 'loading' | 'result'>('ready');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [scanMode, setScanMode] = useState<'ai' | 'qr'>('ai');
  const [showScannerHelp, setShowScannerHelp] = useState(false);

  const [todayStr] = useState(() => new Date().toISOString().split('T')[0]);
  const [scannedToday, setScannedToday] = useState(() => {
    return localStorage.getItem('cirkel_last_scan_date') === new Date().toISOString().split('T')[0];
  });
  const [rewardClaimed, setRewardClaimed] = useState(() => {
    return localStorage.getItem('cirkel_last_claim_date') === new Date().toISOString().split('T')[0];
  });
  const [showCheckinBonusCeleb, setShowCheckinBonusCeleb] = useState(false);

  const suggestedBin = scanResult 
    ? getSuggestedBin(scanResult.sortingType, scanResult.materialType, scanResult.productName)
    : null;
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const dailyTipIndex = useMemo(() => {
    const today = new Date();
    return today.getDate() % RECYCLING_TIPS.length;
  }, []);

  const [activeTipIndex, setActiveTipIndex] = useState(dailyTipIndex);
  const tipsCarouselRef = useRef<HTMLDivElement | null>(null);

  const scrollTips = (direction: 'left' | 'right') => {
    if (tipsCarouselRef.current) {
      const scrollAmount = 270;
      tipsCarouselRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

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
              } catch (e) {}
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
    playScanSuccessFeedback();
    stopCamera();
    setPhase('loading');
    
    setTimeout(() => {
      const parsed = parseQRContent(qrText, user.municipality);
      setScanResult({
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
        sortingInstructions: parsed.sortingInstructions
      });
      setPhase('result');
    }, 1000);
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
    setPhase('loading');
    stopCamera();

    fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64String,
        productName: productNameStr || null,
        municipality: user.municipality
      })
    })
    .then(res => res.json())
    .then(response => {
      if (response.success && response.data) {
        setScanResult(response.data);
        setPhase('result');
        playScanSuccessFeedback();
      } else {
        throw new Error(response.error || "Uventet fejl");
      }
    })
    .catch(err => {
      console.error(err);
      setScanResult({
        productName: productNameStr || "Blandet plast-genstand",
        materialShort: "HDPE plast · EAN: 5700234567891",
        grade: "A",
        co2Saved: "35g",
        waterSaved: "0.9L",
        energySaved: "0.6kWh",
        pantValue: "0.20",
        materialType: "Polyethylen (HDPE)",
        recyclablePercent: "95%",
        manufacturer: "Generisk producent",
        packagingWeight: "15g",
        circularScore: "85",
        eprStatus: "Registreret ✓",
        sortingType: "♻️ Plastik (hård)",
        sortingInstructions: `Sorteringsanbefaling: Skyl, tøm helt for rester og læg i plastik-beholderen derhjemme i ${user.municipality}.`
      });
      setPhase('result');
      playScanSuccessFeedback();
    });
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
          alert("Ingen QR-kode detekteret på billedet. Prøver normal AI-analyse i stedet...");
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
              alert("Ingen QR-kode fundet i den uploadede fil. Prøver normal AI-analyse...");
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

    playScanSuccessFeedback();

    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('cirkel_last_scan_date', today);
    setScannedToday(true);

    onChangeUser(prev => {
      const updated = {
        ...prev,
        balance: Number((prev.balance + balanceIncrease).toFixed(2)),
        points: prev.points + pointsIncrease,
        scansCount: prev.scansCount + 1,
        co2SavedKg: Number((prev.co2SavedKg + 0.15).toFixed(1)),
      };
      
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });

    alert(`🎉 Tak for dit bidrag!\n\nVerifikation via ${label} godkendt.\nSaldo: +${balanceIncrease} DKK\nPoints: +${pointsIncrease} Cirkel Points (CP)`);
    setPhase('ready');
    setScanResult(null);
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col min-h-[80vh] px-4 pt-4 pb-12">
      {phase === 'ready' && (
        <div className="flex flex-col flex-1">
          <div className="flex justify-between items-center mb-4">
            <div className="text-left">
              <span className="text-xs font-bold text-muted-text uppercase tracking-wider">{t('hello')}, {user.fullName}! 👋</span>
              <h2 className="text-2xl font-black text-primary leading-tight">{t('scan_pkg')}</h2>
            </div>
            <div className="bg-primary/5 rounded-full py-1 px-4 border border-primary/10">
              <span className="text-xs font-bold text-primary">📍 {t('aarhus')}</span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl p-4 shadow-sm flex flex-col gap-3 mb-4 transition-all">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-base animate-bounce duration-1000">🎁</span>
                <div className="text-left">
                  <h4 className="text-xs font-black text-primary uppercase tracking-wider">{t('daily_bonus')}</h4>
                  <p className="text-[10px] text-muted-text font-bold">{t('daily_bonus_sub')}</p>
                </div>
              </div>
              <div className="text-right">
                <span className={`text-[9.5px] font-black uppercase px-2.5 py-1 rounded-lg border tracking-wider leading-none block ${
                  rewardClaimed
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                    : scannedToday
                      ? 'bg-amber-50 text-amber-800 border-amber-200 animate-pulse'
                      : 'bg-gray-50 text-primary/60 border-gray-200'
                }`}>
                  {rewardClaimed ? `✓ ${t('claimed')}` : scannedToday ? `⚡ ${t('claim_ready')}` : `🔐 ${t('locked')}`}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between bg-[#FAF9F6] border border-gray-150 p-3 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black border ${
                  scannedToday 
                    ? 'bg-emerald-100 border-emerald-200 text-emerald-800' 
                    : 'bg-white border-dashed border-gray-300 text-gray-400'
                }`}>
                  {scannedToday ? '✓' : '0/1'}
                </div>
                <div className="text-left">
                  <p className="text-[11px] font-black text-primary uppercase leading-tight">
                    {scannedToday ? t('scanned_today') : t('scan_one_today')}
                  </p>
                  <p className="text-[10px] text-muted-text font-semibold leading-normal mt-1 max-w-[190px]">
                    {rewardClaimed 
                      ? 'Din dagsbonus på +2,00 kr er sat ind på din Wallet.' 
                      : scannedToday 
                        ? 'Tryk til højre for at indløse din bonus!' 
                        : 'Fuldfør ét scan ved hjælp af kameraet eller QR nedenfor.'}
                  </p>
                </div>
              </div>

              <div className="shrink-0 ml-2">
                {!scannedToday ? (
                  <div className="text-right flex flex-col items-center">
                    <span className="text-xs font-black text-primary font-mono bg-white border border-gray-200 px-2 py-1 rounded-lg">
                      +2,00 kr
                    </span>
                    <span className="text-[7.5px] font-bold text-muted-text uppercase tracking-widest mt-1">Udløser</span>
                  </div>
                ) : rewardClaimed ? (
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <Check className="w-4 h-4 stroke-[3]" />
                  </div>
                ) : (
                  <motion.button
                    id="claim-daily-checkin-bonus-btn"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      const rewardAmount = 2.00;
                      const rewardPoints = 15;
                      
                      onChangeUser(prev => {
                        const updated = {
                          ...prev,
                          balance: Number((prev.balance + rewardAmount).toFixed(2)),
                          points: prev.points + rewardPoints
                        };
                        localStorage.setItem('cirkel_user', JSON.stringify(updated));
                        return updated;
                      });

                      localStorage.setItem('cirkel_last_claim_date', todayStr);
                      setRewardClaimed(true);
                      setShowCheckinBonusCeleb(true);
                      playScanSuccessFeedback();
                    }}
                    className="py-2 px-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-[10px] uppercase rounded-xl transition-all shadow-md cursor-pointer select-none tracking-wider whitespace-nowrap active:scale-97"
                  >
                    {t('claim')}
                  </motion.button>
                )}
              </div>
            </div>

            {!scannedToday && (
              <div className="flex justify-between items-center text-[9px] font-bold text-muted-text px-1">
                <span>{t('no_packaging')}</span>
                <button
                  id="simulate-fast-checkin-scan-btn"
                  onClick={() => {
                    playScanSuccessFeedback();
                    
                    const today = new Date().toISOString().split('T')[0];
                    localStorage.setItem('cirkel_last_scan_date', today);
                    setScannedToday(true);

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
                  className="text-primary hover:underline cursor-pointer flex items-center gap-1 font-extrabold uppercase tracking-wider"
                >
                  {t('simulate_fast')}
                </button>
              </div>
            )}
          </div>

          <div className="bg-primary/5 p-1 rounded-2xl flex gap-1 border border-primary/5 mb-2.5 shrink-0">
            <button
              id="mode-ai-btn"
              onClick={() => {
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

          <div className="relative aspect-[4/3] bg-primary rounded-3xl overflow-hidden shadow-lg border border-primary/20 flex flex-col items-center justify-center text-center p-6 mb-6">
            {isCameraActive ? (
              <div className="absolute inset-0 w-full h-full flex flex-col justify-between">
                <video 
                  ref={videoRef}
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                
                <div className="absolute top-6 left-6 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-lg pointer-events-none z-10 opacity-85" />
                <div className="absolute top-6 right-6 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-lg pointer-events-none z-10 opacity-85" />
                <div className="absolute bottom-20 left-6 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-lg pointer-events-none z-10 opacity-85" />
                <div className="absolute bottom-20 right-6 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-lg pointer-events-none z-10 opacity-85" />

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

                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-primary/95 backdrop-blur-md border border-accent/20 px-4.5 py-1.5 rounded-full text-[10px] font-black text-accent tracking-wider uppercase z-20 flex items-center gap-1.5 shadow-lg whitespace-nowrap">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full animate-ping" />
                  {scanMode === 'ai' ? <LiveScanLabel /> : <span>Søger efter QR-koder...</span>}
                </div>

                <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_15px_#C8F24A] top-1/2 -translate-y-1/2 animate-bounce z-15" />

                <div className="absolute bottom-4 left-0 right-0 flex justify-between items-center px-6 z-20">
                  <button 
                    id="stop-camera-btn"
                    onClick={stopCamera}
                    className="bg-primary/90 hover:bg-primary text-white border border-white/10 rounded-xl py-2.5 px-4 text-xs font-bold backdrop-blur-md cursor-pointer transition-transform active:scale-95 shadow-md"
                  >
                    Afbryd
                  </button>
                  <button 
                    id="capture-photo-btn"
                    onClick={capturePhoto}
                    className="w-15 h-15 rounded-full border-4 border-white bg-accent/95 hover:bg-accent hover:scale-105 active:scale-90 shadow-lg shadow-black/40 cursor-pointer transition-all flex items-center justify-center animate-pulse"
                    title={scanMode === 'ai' ? "Tag materialefoto" : "Afkod QR Code"}
                  >
                    {scanMode === 'ai' ? (
                      <div className="w-6 h-6 rounded-full border border-primary/20 bg-primary/10" />
                    ) : (
                      <QrCode className="w-6 h-6 text-primary" />
                    )}
                  </button>
                  <div className="w-12" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center border border-accent/20 animate-pulse">
                  <span className="text-4xl filter drop-shadow-3xs">📸</span>
                </div>
                <div className="text-center">
                  <h3 className="text-white text-base font-black uppercase tracking-wider">{scanMode === 'ai' ? t('camera_scan_ready') : t('ready_scan_qr')}</h3>
                  <p className="text-white/60 text-[11px] font-bold mt-1.5 max-w-[240px] leading-relaxed">
                    {scanMode === 'ai' 
                      ? 'Analyser og sorter alt emballage korrekt med vores avancerede AI Sorterings-rådgivning.'
                      : 'Scan officielle QR-affaldskoder eller mærkater for en fejlfri synkronisering med databasen.'}
                  </p>
                </div>
                
                <div className="flex flex-col gap-2.5 w-full mt-2.5 max-w-[210px]">
                  <button 
                    id="start-camera-btn"
                    onClick={startCamera}
                    className="w-full py-3.5 bg-accent text-primary hover:opacity-95 font-black text-xs uppercase rounded-xl transition-all shadow-sm cursor-pointer select-none tracking-wider text-center"
                  >
                    {t('start_camera')}
                  </button>
                  <button 
                    id="trigger-file-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3.5 bg-transparent border border-white/20 text-white hover:bg-white/5 font-extrabold text-xs uppercase rounded-xl transition-all cursor-pointer select-none tracking-wider text-center flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4 text-white" />
                    {scanMode === 'ai' ? t('upload_photo') : t('upload_qr_photo')}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden" 
                  />
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="bg-white border border-gray-150 rounded-3xl p-5 shadow-3xs text-left mb-6">
            <span className="text-[10px] font-black text-primary/45 uppercase tracking-wider block mb-1">Eksperimentel indtastning</span>
            <h4 className="text-xs font-black text-primary uppercase tracking-normal">Søg i Materialeregisteret</h4>
            <p className="text-[10px] text-muted-text font-bold leading-normal mt-1 leading-normal">
              Har du ikke kameraet ved hånden? Søg blot efter mærker (fx Arla Letmælk, Carlsberg, Coca-Cola) for at få sorteringsinstruktioner.
            </p>
            <div className="flex gap-2 mt-4">
              <input
                id="manual-search-input"
                type="text"
                placeholder="F.eks. Arla Skyr 450g..."
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualName.trim()) {
                    executeImageScan(null, manualName);
                  }
                }}
                className="flex-1 bg-[#FAF9F6] border border-gray-150 rounded-xl px-4 py-3 text-xs font-semibold placeholder-gray-400 text-primary outline-none focus:border-primary shrink-0 min-w-0"
              />
              <button
                id="manual-search-btn"
                disabled={!manualName.trim()}
                onClick={() => executeImageScan(null, manualName)}
                className="bg-primary text-accent hover:bg-primary/95 font-extrabold text-xs uppercase px-4 rounded-xl disabled:bg-gray-200 disabled:text-gray-400 disabled:border-transparent transition-colors cursor-pointer select-none shrink-0"
              >
                Søg
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mt-3.5 pt-3.5 border-t border-gray-100">
              <span className="text-[9px] font-black text-[#9CA3AF] uppercase tracking-wider flex items-center mr-1">Lyn-test emner:</span>
              {(scanMode === 'ai' ? PRESET_PRODUCTS : PRESET_QR_CODES).map((preset) => (
                <button
                  id={`preset-${preset.id}-btn`}
                  key={preset.id}
                  onClick={() => {
                    if (scanMode === 'ai') {
                      executeImageScan(null, preset.name);
                    } else {
                      handleQRScanSuccess((preset as any).code || preset.name);
                    }
                  }}
                  className="bg-[#FAF9F6] border border-gray-150 hover:bg-[#F3F2EE] hover:border-primary/20 text-primary px-2.5 py-1.5 rounded-xl text-[10px] font-black transition-all cursor-pointer select-none flex items-center gap-1 hover:scale-101 shrink-0 active:scale-98 shadow-4xs"
                >
                  <span>{preset.icon}</span>
                  <span>{preset.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative text-left">
            <div className="flex justify-between items-center mb-3">
              <div className="flex gap-2 items-center">
                <Compass className="w-5 h-5 text-[#2E4337]" />
                <h3 className="text-xs font-black text-primary uppercase tracking-wider">{t('recycling_tips_title')}</h3>
              </div>
              <div className="flex gap-1">
                <button 
                  id="prev-tip-btn"
                  onClick={() => scrollTips('left')}
                  className="w-7 h-7 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center cursor-pointer active:scale-90 transition-transform shadow-3xs text-primary"
                >
                  <ChevronLeft className="w-4 h-4 shrink-0" />
                </button>
                <button 
                  id="next-tip-btn"
                  onClick={() => scrollTips('right')}
                  className="w-7 h-7 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center cursor-pointer active:scale-90 transition-transform shadow-3xs text-primary"
                >
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>

            <div 
              ref={tipsCarouselRef}
              className="flex gap-4 overflow-x-auto pb-4 pt-1 snap-x scroll-smooth scrollbar-none"
            >
              {RECYCLING_TIPS.map((tip) => (
                <div 
                  key={tip.id}
                  className={`bg-gradient-to-br ${tip.colorClass} border rounded-3xl p-4 min-w-[260px] max-w-[260px] flex flex-col justify-between shadow-3xs snap-start hover:shadow-2xs transition-shadow shrink-0 select-none`}
                >
                  <div>
                    <div className="flex justify-between items-center mb-2.5">
                      <span className="text-base">{tip.emoji}</span>
                      <span className="text-[8px] font-black tracking-widest uppercase opacity-65">{tip.category}</span>
                    </div>
                    <dt className="text-xs font-black tracking-tight">{tip.title}</dt>
                    <dd className="text-[10px] font-semibold mt-1 leading-normal opacity-85">{tip.text}</dd>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-3xl filter drop-shadow-md animate-bounce">
            🔮
          </div>
          <h3 className="text-lg font-black text-primary mt-6">{t('analyzing')}</h3>
          <p className="text-xs text-muted-text font-bold mt-2.5 max-w-[280px] leading-relaxed text-center">
            Vores AI Materialepas undersøger materialekvaliteten og henter sorteringsregler fra Affaldsdatabasen...
          </p>
          <div className="w-32 h-1 bg-gray-200 rounded-full overflow-hidden mt-8 relative">
            <div className="absolute top-0 bottom-0 left-0 bg-accent animate-[loading_1.5s_infinite] w-12 rounded-full" />
          </div>
        </div>
      )}

      {phase === 'result' && scanResult && (
        <div className="text-left flex flex-col gap-6">
          <div className="bg-white border-2 border-primary rounded-3xl p-6 shadow-sm flex flex-col gap-5 relative overflow-hidden">
            <div className="absolute -right-3 -top-3 w-16 h-16 bg-primary/5 rounded-full blur-xl pointer-events-none" />
            
            <div className="flex justify-between items-start gap-4">
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-[#10B981] bg-[#10B981]/15 px-2 py-0.5 rounded-full uppercase tracking-wider leading-none">AI Materialepas</span>
                  {scanResult.pantValue !== '0.00' && (
                    <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full uppercase tracking-wider leading-none">PANT klasses: {scanResult.pantValue} kr</span>
                  )}
                </div>
                <h3 className="text-xl font-black text-primary mt-2 leading-tight">{scanResult.productName}</h3>
                <p className="text-[10px] text-[#9CA3AF] font-bold mt-1 uppercase font-mono tracking-wider">{scanResult.materialShort}</p>
              </div>

              <div className="flex flex-col items-center shrink-0">
                <span className="text-[8px] font-black text-[#9CA3AF] uppercase tracking-wider">Cirkulær</span>
                <div className="w-12 h-12 rounded-full border-4 border-success-alt flex items-center justify-center text-base font-black text-success-alt mt-1 bg-success-alt/5 shadow-3xs select-none">
                  {scanResult.grade}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center border-t border-b border-gray-100 py-4.5">
              <div className="flex flex-col gap-1 text-left border-r border-gray-100 pr-1.5">
                <span className="text-[8.5px] font-black text-[#9CA3AF] uppercase tracking-wider block">CO₂ sparet</span>
                <span className="text-sm font-black text-success-alt font-mono block tracking-tight mt-0.5">-{scanResult.co2Saved}</span>
                <span className="text-[7.5px] text-muted-text font-bold block mt-0.5 leading-none">Reduktion</span>
              </div>
              <div className="flex flex-col gap-1 text-left border-r border-gray-100 px-1.5">
                <span className="text-[8.5px] font-black text-[#9CA3AF] uppercase tracking-wider block">Vand sparet</span>
                <span className="text-sm font-black text-primary font-mono block tracking-tight mt-0.5">{scanResult.waterSaved}</span>
                <span className="text-[7.5px] text-muted-text font-bold block mt-0.5 leading-none">Ressource</span>
              </div>
              <div className="flex flex-col gap-1 text-left pl-1.5">
                <span className="text-[8.5px] font-black text-[#9CA3AF] uppercase tracking-wider block">Energi sparet</span>
                <span className="text-sm font-black text-primary font-mono block tracking-tight mt-0.5">{scanResult.energySaved}</span>
                <span className="text-[7.5px] text-muted-text font-bold block mt-0.5 leading-none">Elektricitet</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 text-left bg-[#FAF9F6] border border-gray-150 p-4 rounded-2xl">
              <div>
                <dt className="text-[9px] font-black text-[#9CA3AF] uppercase tracking-wider">Registreret materiale</dt>
                <dd className="text-xs font-extrabold text-primary mt-1">{scanResult.materialType} ({scanResult.recyclablePercent} genanvendelig)</dd>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-gray-200/50">
                <div>
                  <dt className="text-[9px] font-black text-[#9CA3AF] uppercase tracking-wider">EPR Status</dt>
                  <dd className="text-[11px] font-extrabold text-primary mt-1">{scanResult.eprStatus}</dd>
                </div>
                <div>
                  <dt className="text-[9px] font-black text-[#9CA3AF] uppercase tracking-wider">Emballagevægt</dt>
                  <dd className="text-[11px] font-bold text-primary mt-1">{scanResult.packagingWeight}</dd>
                </div>
              </div>
            </div>

            {suggestedBin && (
              <div className={`border rounded-2.5rem p-5 flex flex-col gap-3 text-left ${suggestedBin.bgClass} ${suggestedBin.borderClass}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-3xs ${suggestedBin.colorClass} text-white`}>
                    {suggestedBin.picto}
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-[#9CA3AF] uppercase tracking-wider block leading-none">Anbefalet Sortering</span>
                    <h4 className={`text-sm font-black mt-1 leading-none ${suggestedBin.textClass}`}>
                      Sorteres som: {scanResult.sortingType}
                    </h4>
                  </div>
                </div>
                <p className={`text-[11px] font-semibold leading-relaxed ${suggestedBin.textClass}`}>
                  {scanResult.sortingInstructions}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm text-left flex flex-col gap-4">
            <div>
              <h4 className="text-xs font-black text-primary uppercase tracking-wider">Verificer Affaldssorteringen</h4>
              <p className="text-[11px] text-muted-text font-semibold mt-1 leading-normal">
                Indløs dine kontante cirkulære point samt DKK pantsaldo ved at bekræfte din aflevering via en af de godkendte genanvendelsesmetoder:
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              
              <button 
                id="verify-home-btn"
                onClick={() => triggerVerification(0.15, 2, 'Hjemme-sortering')}
                className="bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex justify-between items-center text-left transition-all active:scale-99 shadow-sm cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl bg-emerald-50 p-2 rounded-xl">🏡</span>
                  <div>
                    <h5 className="text-xs font-black text-primary">Hjemme-sortering</h5>
                    <p className="text-[10px] text-muted-text font-medium mt-0.5">Egne godkendte containere</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-success-alt">+0,15 kr · +2 CP</p>
                  <p className="text-[9px] text-muted-text font-medium mt-0.5">Tillid: 85%</p>
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

              <button 
                id="verify-collector-btn"
                onClick={() => triggerVerification(0.60, 5, 'Collector')}
                className="bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex justify-between items-center text-left transition-all active:scale-99 shadow-sm cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl bg-purple-50 p-2 rounded-xl">🚴</span>
                  <div>
                    <h5 className="text-xs font-black text-primary">Collector</h5>
                    <p className="text-[10px] text-muted-text font-medium mt-0.5">Afhentning af lokal cykel-indsamler</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-purple-600">+0,60 kr · +5 CP</p>
                  <p className="text-[9px] text-muted-text font-medium mt-0.5">Tillid: 95%</p>
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

      {showScannerHelp && (
        <div id="scanner-help-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white border border-gray-150 rounded-3xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
            
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

            <div className="flex flex-col gap-3.5">
              
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

              <div className="p-3 bg-emerald-50/55 border border-emerald-100 rounded-2xl text-[9.5px] font-semibold text-emerald-950 leading-relaxed flex items-start gap-2">
                <span className="text-xs leading-none">💡</span>
                <p>
                  <span className="font-extrabold text-emerald-800">Hurtigt tip:</span> Hvis dit produkt har en tydelig stregkode, så brug altid <span className="text-primary font-bold">QR / EAN</span> for det hurtigste og mest nøjagtige match.
                </p>
              </div>

            </div>

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

      {showCheckinBonusCeleb && (
        <div id="checkin-bonus-celeb-modal" className="fixed inset-0 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white border border-gray-150 rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center gap-4 animate-in slide-in-from-bottom-4 duration-300">
            
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

            <div className="bg-[#FAF9F6] border border-gray-150 p-3 rounded-2xl w-full flex justify-around items-center">
              <div>
                <span className="text-[8px] font-bold text-muted-text uppercase block">Ny Saldo</span>
                <span className="text-sm font-black font-mono text-primary">{(user.balance).toFixed(2)} kr</span>
              </div>
              <div className="h-6 w-[1px] bg-gray-250" />
              <div>
                <span className="text-[8px] font-bold text-[#9CA3AF] uppercase block">Point heraf</span>
                <span className="text-sm font-black text-[#10B981] font-mono">+15 CP</span>
              </div>
            </div>

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
    </div>
  );
}
