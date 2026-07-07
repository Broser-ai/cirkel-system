import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { 
  Navigation, 
  MapPin, 
  Compass, 
  Play, 
  Square,
  Volume2, 
  VolumeX, 
  Battery, 
  Wifi, 
  CheckCircle, 
  ArrowRight, 
  Layers, 
  Info,
  Route,
  Activity,
  AlertCircle
} from 'lucide-react';

interface SmartBin {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: 'Aarhus' | 'København';
  fillLevel: number; // 0 - 100
  batteryLevel: number; // 0 - 100
  lastEmpty: string;
  materials: string[];
  signalStrength: 'excellent' | 'good' | 'poor';
}

const SMART_BINS: SmartBin[] = [
  // Aarhus
  {
    id: 'aarhus-bin-dokk1',
    name: 'Cirkel IoT Smart-Spand Dokk1',
    address: 'Hack Kampmanns Plads 2, 8000 Aarhus C',
    lat: 56.1538,
    lng: 10.2135,
    city: 'Aarhus',
    fillLevel: 42,
    batteryLevel: 94,
    lastEmpty: 'Idag kl. 05:30',
    materials: ['Plast', 'Metal', 'Karton'],
    signalStrength: 'excellent'
  },
  {
    id: 'aarhus-bin-banegard',
    name: 'Cirkel IoT Smart-Spand Banegårdspladsen',
    address: 'Banegårdspladsen 1, 8000 Aarhus C',
    lat: 56.1504,
    lng: 10.2045,
    city: 'Aarhus',
    fillLevel: 84,
    batteryLevel: 88,
    lastEmpty: 'I går kl. 06:12',
    materials: ['Plast', 'Metal', 'Flasker'],
    signalStrength: 'excellent'
  },
  {
    id: 'aarhus-bin-aboulevarden',
    name: 'Cirkel IoT Smart-Spand Åboulevarden',
    address: 'Åboulevarden 26, 8000 Aarhus C',
    lat: 56.1565,
    lng: 10.2095,
    city: 'Aarhus',
    fillLevel: 15,
    batteryLevel: 99,
    lastEmpty: 'Idag kl. 05:40',
    materials: ['Plast', 'Metal', 'Flasker', 'Papir'],
    signalStrength: 'good'
  },
  {
    id: 'aarhus-bin-salling',
    name: 'Cirkel IoT Smart-Spand Salling',
    address: 'Østergade 25, 8000 Aarhus C',
    lat: 56.1558,
    lng: 10.2069,
    city: 'Aarhus',
    fillLevel: 61,
    batteryLevel: 75,
    lastEmpty: 'I går kl. 14:22',
    materials: ['Plast', 'Karton'],
    signalStrength: 'excellent'
  },
  // København
  {
    id: 'cph-bin-norrebro',
    name: 'Cirkel IoT Smart-Spand Nørrebro Runddel',
    address: 'Nørrebrogade 120, 2200 København N',
    lat: 55.6948,
    lng: 12.5485,
    city: 'København',
    fillLevel: 32,
    batteryLevel: 92,
    lastEmpty: 'Idag kl. 04:15',
    materials: ['Plast', 'Metal', 'Karton'],
    signalStrength: 'excellent'
  },
  {
    id: 'cph-bin-vesterport',
    name: 'Cirkel IoT Smart-Spand Vesterport',
    address: 'Vesterbrogade 10, 1620 København V',
    lat: 55.6749,
    lng: 12.5621,
    city: 'København',
    fillLevel: 79,
    batteryLevel: 81,
    lastEmpty: 'Idag kl. 07:11',
    materials: ['Plast', 'Metal', 'Flasker'],
    signalStrength: 'good'
  }
];

// Distance formula in Kilometers (Haversine rule)
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

// Generate stylized grid streets based on city
interface MapStreet {
  id: string;
  name: string;
  path: string; // SVG Line or Path data
}

const AARHUS_STREETS: MapStreet[] = [
  { id: 'str-1', name: 'Banegårdsgade', path: 'M 50,300 L 150,220' },
  { id: 'str-2', name: 'Søndergade (Strøget)', path: 'M 150,220 L 250,150' },
  { id: 'str-3', name: 'Skt. Clemens Torv', path: 'M 250,150 L 320,120' },
  { id: 'str-4', name: 'Åboulevarden', path: 'M 100,100 L 350,100' },
  { id: 'str-5', name: 'Hack Kampmanns Plads', path: 'M 350,100 L 380,180' }
];

interface WasteBinLocatorProps {
  user?: UserProfile;
  onChangeUser?: (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => void;
}

export default function WasteBinLocator({ user, onChangeUser }: WasteBinLocatorProps) {
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number }>({ lat: 56.1522, lng: 10.2037 }); // Default: Aarhus City Hall
  const [gpsState, setGpsState] = useState<'idle' | 'tracking' | 'success' | 'err'>('idle');
  const [currentCity, setCurrentCity] = useState<'Aarhus' | 'København'>('Aarhus');
  const [selectedBinId, setSelectedBinId] = useState<string>('aarhus-bin-dokk1');
  const [isNavigating, setIsNavigating] = useState(false);
  const [navProgress, setNavProgress] = useState(0); // 0 to 100 % representing progress to bin
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);

  // Simulated Voice Instructions state
  const [voiceTranscript, setVoiceTranscript] = useState<string>('Parat til at starte navigation til din valgte intelligente affaldsspand.');

  // Find nearest bins based on distance from user coordinates
  const calculatedBins = useMemo(() => {
    return SMART_BINS.map(bin => {
      const distance = getDistanceKm(userCoords.lat, userCoords.lng, bin.lat, bin.lng);
      return { ...bin, distance };
    })
    .filter(bin => bin.city === currentCity)
    .sort((a, b) => a.distance - b.distance);
  }, [userCoords, currentCity]);

  // Keep a selected bin if current city changes
  useEffect(() => {
    if (calculatedBins.length > 0) {
      // Auto select the closest bin in the chosen city
      setSelectedBinId(calculatedBins[0].id);
    }
  }, [currentCity]);

  const activeBin = useMemo(() => {
    return SMART_BINS.find(b => b.id === selectedBinId) || SMART_BINS[0];
  }, [selectedBinId]);

  // Drop-off simulation states
  const [simItem, setSimItem] = useState<'flaske_a' | 'flaske_b' | 'daase' | 'karton'>('flaske_a');
  const [simStatus, setSimStatus] = useState<'idle' | 'scanning' | 'weighing' | 'verifying' | 'connected' | 'completed'>('idle');
  const [simStatusMsg, setSimStatusMsg] = useState('');
  const [simLogs, setSimLogs] = useState<string[]>([]);

  // Simulation handler
  const handleSimulateDrop = () => {
    if (simStatus !== 'idle') return;
    
    setSimLogs([]);
    setSimStatus('scanning');
    setSimStatusMsg('1. Scanner emballage stregkode og tjekker pant-database...');
    setSimLogs(prev => [...prev, '[IoT Scanner] Scanner stregkode via infrarød laser...']);

    setTimeout(() => {
      setSimStatus('weighing');
      setSimStatusMsg('2. Kontrollerer vægten via indbyggede vejeceller...');
      setSimLogs(prev => [
        ...prev,
        '[IoT Scanner] Stregkode godkendt (Dansk Retursystem registreret)',
        '[Load-Cells] Vægtsensor kalibreres til 0.0g...',
        '[Load-Cells] Registrerer indkast vægt på 24.5 gram'
      ]);

      setTimeout(() => {
        setSimStatus('verifying');
        setSimStatusMsg('3. Krypterer transaktionsdata med AES-256 nøgle...');
        setSimLogs(prev => [
          ...prev,
          '[CPU Edge-Node] Krypterer register-data via indbygget hardware Secure Element',
          '[GSM Modem] Sender krypteret signal over 5G IoT Mesh...'
        ]);

        setTimeout(() => {
          setSimStatus('connected');
          setSimStatusMsg('4. Bogfører optjente Cirkel Points og Kroner til din konto...');
          setSimLogs(prev => [
            ...prev,
            '[Server Node] Synkroniserer transaktion i realtid',
            `[LEDGER DB] Ledger Integrity Verified. Forbinder til bruger-id: ${user?.fullName || 'Standardbruger'}`
          ]);

          // Now we calculate real rewards
          let rewardKr = 3.00;
          let rewardPoints = 15;
          let savedCo2 = 0.45;

          if (simItem === 'flaske_b') {
            rewardKr = 3.00;
            rewardPoints = 20;
            savedCo2 = 0.60;
          } else if (simItem === 'daase') {
            rewardKr = 1.50;
            rewardPoints = 10;
            savedCo2 = 0.25;
          } else if (simItem === 'karton') {
            rewardKr = 0.00;
            rewardPoints = 5;
            savedCo2 = 0.12;
          }

          if (onChangeUser) {
            onChangeUser(prev => {
              const nextBalance = Number((prev.balance + rewardKr).toFixed(2));
              const nextPoints = prev.points + rewardPoints;
              const nextScans = prev.scansCount + 1;
              const nextCo2 = Number((prev.co2SavedKg + savedCo2).toFixed(2));
              
              const updated = {
                ...prev,
                balance: nextBalance,
                points: nextPoints,
                scansCount: nextScans,
                co2SavedKg: nextCo2
              };
              
              localStorage.setItem('cirkel_user', JSON.stringify(updated));
              return updated;
            });
          }

          setTimeout(() => {
            setSimStatus('completed');
            setSimStatusMsg(`✓ Indkast fuldført! Du har modtaget +${rewardKr.toFixed(2)} kr og +${rewardPoints} CP.`);
            setSimLogs(prev => [
              ...prev,
              `[Success] Overført +${rewardKr.toFixed(2)} kr og +${rewardPoints} CP til Cirkel Wallet!`,
              `[Mål] Sparet ${savedCo2} kg CO2 udledninger.`
            ]);
            
            setNotification(`Live System Test: Godkendt! Modtaget +${rewardKr.toFixed(2)} kr & +${rewardPoints} CP`);
            setTimeout(() => setNotification(null), 4000);
          }, 1200);

        }, 1200);

      }, 1200);

    }, 1250);
  };

  const resetSimulator = () => {
    setSimStatus('idle');
    setSimStatusMsg('');
    setSimLogs([]);
  };

  // Handle live HTML5 Geolocation lookup
  const handleAcquireLocation = () => {
    if (!navigator.geolocation) {
      setNotification('Din browser understøtter ikke live GPS-lokalisering.');
      return;
    }

    setGpsState('tracking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lng: longitude });
        setGpsState('success');
        
        // Auto-detect city by latitude
        if (latitude > 56.0) {
          setCurrentCity('Aarhus');
        } else {
          setCurrentCity('København');
        }
        
        setNotification('Din GPS-sporing er synkroniseret med Cirkel-netværket!');
        setTimeout(() => setNotification(null), 3500);
      },
      (error) => {
        console.warn("GPS acquire error:", error);
        setGpsState('err');
        setNotification('GPS-tilladelse blev afvist. Vi bruger en simuleret bykerne som fallback.');
        setTimeout(() => setNotification(null), 4000);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  // Navigational Simulator interval
  useEffect(() => {
    let intervalId: any = null;
    if (isNavigating) {
      intervalId = setInterval(() => {
        setNavProgress(prev => {
          const nextVal = prev + 8;
          if (nextVal >= 100) {
            setIsNavigating(false);
            setVoiceTranscript('Rute fuldført! Du er ankommet til Smart-Spanden. Åbn Cirkel RFID-klappen for at indlevere emballage.');
            setNotification('✓ Du er ankommet til din destination!');
            // Play a gentle beep if audio is on
            if (!isAudioMuted && window.speechSynthesis) {
              const utterance = new SpeechSynthesisUtterance('Du er ankommet til Smart-Spanden.');
              utterance.lang = 'da-DK';
              window.speechSynthesis.speak(utterance);
            }
            return 100;
          }
          
          // Generate instructions dynamically based on progress
          if (nextVal < 25) {
            setVoiceTranscript('Gå ligeud ad gaden i retning mod ' + activeBin.materials.join(', ') + ' ikonet.');
          } else if (nextVal >= 25 && nextVal < 50) {
            setVoiceTranscript('Drej til højre i det næste kryds. Fortsæt ad stien i 80 meter.');
          } else if (nextVal >= 50 && nextVal < 75) {
            setVoiceTranscript('Du passerer nu et tættere boligområde. Hold til venstre forbi butiksarkaden.');
          } else {
            setVoiceTranscript('Smart-spanden er umiddelbart foran dig på højre side af vejen.');
          }

          // Text to speech simulation if not muted
          if (!isAudioMuted && window.speechSynthesis && nextVal % 24 === 0) {
            const currentInstruction = 
              nextVal < 50 ? 'Fortsæt ligeud mod destinationen.' : 'Smart-spanden er tæt på dig. Forbered indlevering.';
            const utterance = new SpeechSynthesisUtterance(currentInstruction);
            utterance.lang = 'da-DK';
            window.speechSynthesis.speak(utterance);
          }

          return nextVal;
        });
      }, 1000);
    } else {
      if (intervalId) clearInterval(intervalId);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isNavigating, activeBin, isAudioMuted]);

  const handleStartNavigation = () => {
    setNavProgress(0);
    setIsNavigating(true);
    setVoiceTranscript('Starter intelligent ruteberegning mod ' + activeBin.name + '. Hold venligst appen åben ad vejen.');
    if (!isAudioMuted && window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance('Starter ruteaktivitet mod smart-spand.');
      utterance.lang = 'da-DK';
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleStopNavigation = () => {
    setIsNavigating(false);
    setNavProgress(0);
    setVoiceTranscript('Navigation afbrudt. Du kan frit vælge en ny destination på Cirkel-kortet.');
  };

  // Convert progress into coordinates for visual movement
  const avatarPos = useMemo(() => {
    // Generate route interpolations on hypothetical coordinates mapping inside coordinates grid (2D preview coordinates)
    const startX = 60;
    const startY = 280;
    const endX = activeBin.id.includes('dokk1') ? 360 : 
                 activeBin.id.includes('banegard') ? 140 : 
                 activeBin.id.includes('aboulevarden') ? 320 : 
                 activeBin.id.includes('norrebro') ? 220 : 180;
    const endY = activeBin.id.includes('dokk1') ? 140 : 
                 activeBin.id.includes('banegard') ? 230 : 
                 activeBin.id.includes('aboulevarden') ? 100 : 
                 activeBin.id.includes('norrebro') ? 110 : 160;

    const currentX = startX + (endX - startX) * (navProgress / 100);
    const currentY = startY + (endY - startY) * (navProgress / 100);

    return { x: currentX, y: currentY };
  }, [navProgress, activeBin]);

  const activeBinCoordsInMap = useMemo(() => {
    const endX = activeBin.id.includes('dokk1') ? 360 : 
                 activeBin.id.includes('banegard') ? 140 : 
                 activeBin.id.includes('aboulevarden') ? 320 : 
                 activeBin.id.includes('norrebro') ? 220 : 180;
    const endY = activeBin.id.includes('dokk1') ? 140 : 
                 activeBin.id.includes('banegard') ? 230 : 
                 activeBin.id.includes('aboulevarden') ? 100 : 
                 activeBin.id.includes('norrebro') ? 110 : 160;
    return { x: endX, y: endY };
  }, [activeBin]);

  return (
    <div id="waste-bin-locator-section" className="bg-white border border-gray-200 rounded-3xl p-6.5 shadow-sm flex flex-col gap-5 text-left relative overflow-hidden">
      
      {/* 1. Header Information Panel */}
      <div className="flex flex-col gap-1.5 border-b border-gray-150 pb-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-2">
            <span className="p-1 px-2 bg-[#C8F24A]/25 text-primary rounded-xl text-lg shrink-0">🗑️</span>
            <div>
              <h4 className="text-base font-black text-primary tracking-tight">CIOT NETWORK LOCATOR</h4>
              <p className="text-[10px] uppercase font-black tracking-wider text-muted-text">Aktiv IoT Affaldsspand Rutesøgning</p>
            </div>
          </div>

          {/* City Toggle */}
          <div className="flex gap-1 bg-primary/5 p-1 rounded-xl shrink-0 border border-primary/5">
            <button
              onClick={() => setCurrentCity('Aarhus')}
              className={`py-1 px-3 text-[9px] font-black uppercase rounded-lg transition-all ${
                currentCity === 'Aarhus' 
                  ? 'bg-primary text-accent shadow-sm' 
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Aarhus
            </button>
            <button
              onClick={() => setCurrentCity('København')}
              className={`py-1 px-3 text-[9px] font-black uppercase rounded-lg transition-all ${
                currentCity === 'København' 
                  ? 'bg-primary text-accent shadow-sm' 
                  : 'text-primary/60 hover:text-primary'
              }`}
            >
              Kbh
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2.5 mt-2">
          <p className="text-[11px] font-medium text-primary/75 leading-relaxed">
            Find nærmeste intelligente Cirkel affaldsspand udstyret med realtids vejeceller, trådløs tømmesensor og QR-godkendelse.
          </p>

          <button
            onClick={handleAcquireLocation}
            disabled={gpsState === 'tracking'}
            className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-wider py-1.5 px-3 rounded-xl shrink-0 transition-all cursor-pointer ${
              gpsState === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : gpsState === 'tracking'
                ? 'bg-gray-100 border border-gray-200 text-gray-500 animate-pulse'
                : 'bg-primary border border-primary text-accent hover:opacity-95 shadow-sm'
            }`}
          >
            <Compass className={`w-3.5 h-3.5 ${gpsState === 'tracking' ? 'animate-spin' : ''}`} />
            {gpsState === 'success' ? 'GPS OK' : gpsState === 'tracking' ? 'Søger...' : 'Hent GPS'}
          </button>
        </div>
      </div>

      {notification && (
        <div className="bg-[#FAF9F6] border-l-3 border-[#C8F24A] text-primary p-3 rounded-xl text-xs font-bold leading-relaxed flex items-center gap-2">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* 2. Primary layout splitter - Map Canvas & List of Nearest Spande */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5.5">
        
        {/* Left Side: Intelligent Map Navigation Canvas (7 cols) */}
        <div className="md:col-span-7 flex flex-col gap-3">
          
          {/* MAP CANVAS CONTAINER */}
          <div className="relative h-64 bg-[#EBE8E0]/60 rounded-3xl overflow-hidden border border-gray-200/80 flex flex-col justify-between p-3 select-none">
            
            {/* GRID BACKGROUND WATERMARK */}
            <div className="absolute inset-0 opacity-5 bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:14px_14px]" />
            
            <div className="flex justify-between items-center z-10 pointer-events-none">
              <span className="text-[9px] font-black tracking-wide text-primary/45 uppercase bg-white/70 px-2.5 py-1 rounded-lg border border-gray-200 backdrop-blur-xs">
                {currentCity} Centrum Kort
              </span>
              <span className="text-[9px] font-black tracking-wide bg-[#C8F24A] text-primary px-2.5 py-1 rounded-lg border border-primary/5 uppercase">
                Mock Rutevejledning
              </span>
            </div>

            {/* VECTOR MAP SVG INTERACTION */}
            <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
              {/* Draw road networks */}
              {currentCity === 'Aarhus' && AARHUS_STREETS.map((str) => (
                <g key={str.id}>
                  <path 
                    d={str.path} 
                    fill="none" 
                    stroke="white" 
                    strokeWidth="8" 
                    strokeLinecap="round" 
                    className="opacity-70"
                  />
                  <path 
                    d={str.path} 
                    fill="none" 
                    stroke="#DCD7CD" 
                    strokeWidth="6" 
                    strokeLinecap="round" 
                  />
                </g>
              ))}

              {/* Draw generic street paths if Copenhagen for visual feedback */}
              {currentCity === 'København' && (
                <>
                  <line x1="40" y1="280" x2="220" y2="110" stroke="white" strokeWidth="8" strokeLinecap="round" className="opacity-70" />
                  <line x1="40" y1="280" x2="220" y2="110" stroke="#DCD7CD" strokeWidth="6" strokeLinecap="round" />
                  
                  <line x1="220" y1="110" x2="350" y2="210" stroke="white" strokeWidth="8" strokeLinecap="round" className="opacity-70" />
                  <line x1="220" y1="110" x2="350" y2="210" stroke="#DCD7CD" strokeWidth="6" strokeLinecap="round" />
                </>
              )}

              {/* ROUTE LINE PATH PREVIEW */}
              <line 
                x1="60" 
                y1="280" 
                x2={activeBinCoordsInMap.x} 
                y2={activeBinCoordsInMap.y} 
                stroke="#C8F24A" 
                strokeWidth="4" 
                strokeDasharray="6,4"
                className="opacity-95"
              />

              {/* Simulated active green laser line animating direction */}
              {isNavigating && (
                <line 
                  x1="60" 
                  y1="280" 
                  x2={avatarPos.x} 
                  y2={avatarPos.y} 
                  stroke="#10B981" 
                  strokeWidth="3.5" 
                  strokeLinecap="round"
                />
              )}
            </svg>

            {/* DYNAMIC AVATARS & PLACEMARKERS RENDERED ABSOLUTE */}
            {/* User Start Location */}
            <div 
              className="absolute bg-primary text-white p-1 rounded-full border-2 border-white shadow-md z-15 flex items-center justify-center pointer-events-none"
              style={{ left: '60px', top: '280px', transform: 'translate(-50%, -50%)' }}
            >
              <Compass className={`w-3.5 h-3.5 ${isNavigating ? 'animate-pulse text-[#C8F24A]' : ''}`} />
            </div>

            {/* Current Animating User Avatar (only when navigating) */}
            {isNavigating && (
              <motion.div 
                className="absolute bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white shadow-lg z-20 flex items-center justify-center pointer-events-none"
                style={{ left: `${avatarPos.x}px`, top: `${avatarPos.y}px`, transform: 'translate(-50%, -50%)' }}
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <Navigation className="w-3.5 h-3.5 rotate-45 text-white" />
              </motion.div>
            )}

            {/* Target Smart Waste Bin Destination */}
            <motion.div 
              className="absolute bg-[#C8F24A] text-primary p-2 rounded-2xl border-2 border-primary shadow-lg z-15 flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-all"
              style={{ left: `${activeBinCoordsInMap.x}px`, top: `${activeBinCoordsInMap.y}px`, transform: 'translate(-50%, -50%)' }}
              animate={isNavigating ? { y: [0, -5, 0] } : {}}
              transition={{ repeat: Infinity, duration: 1.2 }}
            >
              <MapPin className="w-4 h-4 text-primary font-bold shrink-0" />
            </motion.div>

            {/* BOTTOM NAV BAR ON GAMEPLAY SCREEN */}
            <div className="z-10 bg-white/90 backdrop-blur-sm p-2 rounded-2xl border border-gray-200 mt-auto flex items-center justify-between">
              <div className="flex flex-col text-left">
                <span className="text-[7px] font-black uppercase text-gray-450 tracking-wider">Afgang</span>
                <span className="text-[10px] font-extrabold text-primary truncate max-w-[120px]">Din GPS Lokation</span>
              </div>
              
              <div className="flex items-center text-primary/45 px-1 font-sans">➔</div>

              <div className="flex flex-col text-left">
                <span className="text-[7px] font-black uppercase text-[#85A912] tracking-wider">Destination</span>
                <span className="text-[10px] font-extrabold text-[#85A912] truncate max-w-[120px]">{activeBin.name}</span>
              </div>
            </div>

          </div>

          {/* TURN BY TURN VOICE AUDIO TRANSCRIPT COMPONENT */}
          <div className="bg-[#FAF9F6] border border-gray-150 p-4 rounded-3xl flex flex-col gap-2 relative">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black uppercase tracking-wider text-muted-text flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-primary" /> Rutevejledning & stemmevejvisning
              </span>

              {/* Audio toggle */}
              <button
                onClick={() => setIsAudioMuted(!isAudioMuted)}
                className={`p-1.5 rounded-lg border flex items-center gap-1 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  !isAudioMuted 
                    ? 'bg-[#C8F24A]/20 border-[#C8F24A] text-primary' 
                    : 'bg-white border-gray-200 text-gray-550'
                }`}
                title={isAudioMuted ? 'Slå rute-oplæsning til' : 'Efterlad rute på lydløs'}
              >
                {isAudioMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3 text-[#5A7308] animate-bounce" />}
                <span>{isAudioMuted ? 'Lydløs' : 'Lyd til'}</span>
              </button>
            </div>

            <p className="text-[11.5px] font-semibold text-primary leading-relaxed bg-white border border-gray-100 p-2.5 rounded-xl italic">
              " {voiceTranscript} "
            </p>

            {/* NAVIGATION CONTROL BUTTONS */}
            <div className="flex gap-2 mt-1">
              {!isNavigating ? (
                <button
                  onClick={handleStartNavigation}
                  className="flex-1 bg-primary text-accent hover:opacity-95 font-black text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider shadow-sm"
                >
                  <Play className="w-3.5 h-3.5 text-[#C8F24A] fill-[#C8F24A]" /> Start Simulator
                </button>
              ) : (
                <div className="flex-1 flex gap-2">
                  <div className="flex-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl px-3 py-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="text-[7px] font-black uppercase tracking-wider">Aktiv Fremdrift</span>
                      <span className="text-[10px] font-black font-mono leading-none mt-0.5">{navProgress}% fuldført ({Number(((1 - navProgress/100) * activeBin.distance).toFixed(2))} km tilbage)</span>
                    </div>
                  </div>

                  <button
                    onClick={handleStopNavigation}
                    className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-black text-xs px-4 rounded-xl flex items-center justify-center gap-1 cursor-pointer transition-all uppercase"
                  >
                    <Square className="w-3.5 h-3.5 fill-red-600 stroke-red-600" /> Stop
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Right Side: Smart Bin Diagnostics & Target List (5 cols) */}
        <div className="md:col-span-5 flex flex-col gap-4">
          
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-text">Affaldsspande i nærheden</span>
          
          {/* SCROLLABLE LIST OF LOCAL SMART BINS */}
          <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
            {calculatedBins.map((bin) => {
              const isSelected = selectedBinId === bin.id;
              const isHighFill = bin.fillLevel > 75;
              
              return (
                <div
                  key={bin.id}
                  onClick={() => {
                    if (!isNavigating) {
                      setSelectedBinId(bin.id);
                      setNavProgress(0);
                      setVoiceTranscript(`Klar til ny navigation til: ${bin.name}.`);
                    } else {
                      setNotification('Sæt simulator på stop, før du vælger en anden affaldsspand.');
                      setTimeout(() => setNotification(null), 3000);
                    }
                  }}
                  className={`border text-left p-3.5 rounded-2xl transition-all flex flex-col gap-1.5 cursor-pointer ${
                    isSelected 
                      ? 'bg-[#C8F24A]/10 border-[#C8F24A] ring-1 ring-[#C8F24A] shadow-xs' 
                      : 'bg-white border-gray-150 hover:border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex gap-2">
                      <span className="text-lg">🗑️</span>
                      <div>
                        <h5 className="text-[11.5px] font-black text-primary leading-tight">{bin.name}</h5>
                        <p className="text-[9.5px] text-muted-text mt-0.5 truncate max-w-[150px]">{bin.address}</p>
                      </div>
                    </div>
                    
                    {/* Distance Badge */}
                    <span className="text-[11px] font-extrabold text-primary font-mono bg-primary/5 px-2 py-0.5 rounded-md self-start shrink-0">
                      {bin.distance} km
                    </span>
                  </div>

                  {/* FILL LEVEL STATE */}
                  <div className="flex items-center justify-between gap-3 mt-1 text-[9.5px] font-bold">
                    <span className="text-muted-text uppercase tracking-wider">Kapacitet:</span>
                    <div className="flex items-center gap-1.5 flex-1 max-w-[80px]">
                      <div className="h-1.5 bg-gray-200 rounded-full flex-1 overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${isHighFill ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                          style={{ width: `${bin.fillLevel}%` }}
                        />
                      </div>
                      <span className={`font-mono ${isHighFill ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {bin.fillLevel}%
                      </span>
                    </div>
                  </div>

                  {/* Badges details on selection */}
                  {isSelected && (
                    <motion.div 
                      className="border-t border-gray-150/60 pt-2.5 mt-2 flex flex-col gap-2"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                    >
                      {/* Accepted Materials */}
                      <div className="flex flex-wrap gap-1">
                        {bin.materials.map((mat, i) => (
                          <span key={i} className="text-[8px] font-black uppercase text-primary/70 bg-[#FAF9F6] border border-gray-200/80 px-2 py-0.5 rounded-md">
                            {mat}
                          </span>
                        ))}
                      </div>

                      {/* IoT Diagnostics metadata banner */}
                      <div className="bg-primary/[0.03] p-2 rounded-xl grid grid-cols-2 gap-2 border border-primary/[0.04]">
                        <div className="flex items-center gap-1">
                          <Battery className="w-3.5 h-3.5 text-[#5A7308]" />
                          <div className="flex flex-col">
                            <span className="text-[7px] text-muted-text uppercase font-black leading-none">Strøm</span>
                            <span className="text-[9px] font-black text-primary font-mono mt-0.5">{bin.batteryLevel}%</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Wifi className="w-3.5 h-3.5 text-[#5A7308]" />
                          <div className="flex flex-col">
                            <span className="text-[7px] text-muted-text uppercase font-black leading-none">IoT Signal</span>
                            <span className="text-[8px] font-black text-primary capitalize mt-0.5">{bin.signalStrength}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-[9px] font-bold text-muted-text border-t border-gray-100/50 pt-1.5 mt-0.5">
                        <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span>Sidst tømt: {bin.lastEmpty}</span>
                      </div>
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>

          {/* DYNAMIC TELEMETRY OVERVIEW ON TARGET SMART BIN */}
          <div className="bg-[#C8F24A]/10 border border-[#C8F24A]/30 rounded-3xl p-4.5 flex flex-col gap-2.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-primary/75 flex items-center gap-1.5">
              <Route className="w-3.5 h-3.5 text-primary" /> ESTIMEREDE BELØNNINGER I PANT
            </span>

            <div className="grid grid-cols-2 gap-3 mt-1">
              <div className="bg-white/80 p-2.5 rounded-xl border border-primary/5 flex flex-col">
                <span className="text-[8px] font-black text-muted-text uppercase tracking-wider">Modtagede point</span>
                <span className="text-base font-black text-primary mt-1 font-mono">+12 CP</span>
              </div>
              <div className="bg-white/80 p-2.5 rounded-xl border border-primary/5 flex flex-col">
                <span className="text-[8px] font-black text-muted-text uppercase tracking-wider">Estimeret Pant</span>
                <span className="text-base font-black text-primary mt-1 font-mono">1.25 kr</span>
              </div>
            </div>

            <div className="flex items-start gap-1 p-1">
              <AlertCircle className="w-3.5 h-3.5 text-primary/60 shrink-0 mt-0.5" />
              <p className="text-[9px] text-primary/70 font-semibold leading-relaxed text-left">
                Bemærk: Cirkels intelligente spande registrerer pantværdien krypteret med sikker IoT-signatur ved indlevering.
              </p>
            </div>
          </div>

        </div>

      </div>

      {/* 3. Proof of Work / Verification Board */}
      <div id="cirkel-pow-verificator" className="mt-4 border-t border-gray-150 pt-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="p-1 px-1.5 bg-[#C8F24A]/25 text-primary rounded-lg text-sm bg-accent/20">🧪</span>
          <h4 className="text-xs font-black text-primary uppercase tracking-widest">
            BEVIS AT DET VIRKER: INTELLIGENT SYSTEM-VERIFIKATION
          </h4>
        </div>

        <p className="text-[11px] font-semibold text-muted-text mt-[-5px]">
          Simuler et fysisk indkast af emballage i den valgte IoT smart-spand og se hvordan live-sensorer, vægtceller og kryptering bogfører pant direkte på din Cirkel-konto.
        </p>

        <div className="bg-[#FAF9F6] border border-gray-150 rounded-2xl p-4.5 grid grid-cols-1 md:grid-cols-12 gap-5">
          
          {/* Left panel: Item selector & drop trigger */}
          <div className="md:col-span-5 flex flex-col gap-3">
            <span className="text-[9px] font-black text-muted-text uppercase tracking-wider block">1. Vælg emballage til test-indkast:</span>
            
            <div className="grid grid-cols-2 gap-2 text-left">
              <button
                type="button"
                disabled={simStatus !== 'idle'}
                onClick={() => setSimItem('flaske_a')}
                className={`p-2 rounded-xl text-left border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  simItem === 'flaske_a'
                    ? 'bg-primary text-accent border-primary shadow-xs font-black'
                    : 'bg-white border-gray-200 text-primary hover:bg-gray-50'
                }`}
              >
                <span className="text-base shrink-0">🍼</span>
                <div className="flex flex-col">
                  <span>Plastflaske (A)</span>
                  <span className="text-[8px] opacity-75 font-mono">3.00 kr / +15 CP</span>
                </div>
              </button>

              <button
                type="button"
                disabled={simStatus !== 'idle'}
                onClick={() => setSimItem('flaske_b')}
                className={`p-2 rounded-xl text-left border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  simItem === 'flaske_b'
                    ? 'bg-primary text-accent border-primary shadow-xs font-black'
                    : 'bg-white border-gray-200 text-primary hover:bg-gray-50'
                }`}
              >
                <span className="text-base shrink-0">🥤</span>
                <div className="flex flex-col">
                  <span>Plastflaske (B)</span>
                  <span className="text-[8px] opacity-75 font-mono">3.00 kr / +20 CP</span>
                </div>
              </button>

              <button
                type="button"
                disabled={simStatus !== 'idle'}
                onClick={() => setSimItem('daase')}
                className={`p-2 rounded-xl text-left border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  simItem === 'daase'
                    ? 'bg-primary text-accent border-primary shadow-xs font-black'
                    : 'bg-white border-gray-200 text-primary hover:bg-gray-50'
                }`}
              >
                <span className="text-base shrink-0">🥫</span>
                <div className="flex flex-col">
                  <span>Alu-dåse</span>
                  <span className="text-[8px] opacity-75 font-mono">1.50 kr / +10 CP</span>
                </div>
              </button>

              <button
                type="button"
                disabled={simStatus !== 'idle'}
                onClick={() => setSimItem('karton')}
                className={`p-2 rounded-xl text-left border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  simItem === 'karton'
                    ? 'bg-primary text-accent border-primary shadow-xs font-black'
                    : 'bg-white border-gray-200 text-primary hover:bg-gray-50'
                }`}
              >
                <span className="text-base shrink-0">📦</span>
                <div className="flex flex-col">
                  <span>Drikkekarton</span>
                  <span className="text-[8px] opacity-75 font-mono">0.00 kr / +5 CP</span>
                </div>
              </button>
            </div>

            {simStatus === 'idle' ? (
              <button
                type="button"
                onClick={handleSimulateDrop}
                className="w-full bg-[#C8F24A] hover:bg-[#b2da3c] font-black text-xs py-3 px-4 rounded-xl text-primary text-center shadow-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer mt-1"
              >
                <span>🚀 Udfør Test-Indkast</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={resetSimulator}
                disabled={simStatus !== 'completed'}
                className="w-full bg-primary text-accent hover:opacity-95 font-black text-xs py-3 px-4 rounded-xl text-center shadow-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer mt-1 disabled:opacity-50"
              >
                <span>🔄 Reset Test-Bræt</span>
              </button>
            )}
          </div>

          {/* Right panel: Terminal-like live output logs from IoT bin */}
          <div className="md:col-span-7 flex flex-col gap-2 text-left">
            <span className="text-[9px] font-black text-muted-text uppercase tracking-wider block">2. Live IoT Telemetri output og blockchain log:</span>
            
            <div className="bg-[#1C1A17] text-[#C8F24A]/90 p-3 rounded-xl border border-gray-800 font-mono text-[10px] min-h-[140px] flex flex-col justify-between overflow-y-auto">
              <div>
                <div className="flex justify-between text-gray-500 text-[8px] border-b border-gray-850 pb-1.5 mb-2.5">
                  <span>DEVICE ID: {activeBin.id.toUpperCase()}</span>
                  <span>IP: 192.168.12.{activeBin.id.includes('dokk1') ? '43' : '82'}</span>
                </div>

                <div className="flex flex-col gap-1.5 text-left text-xs">
                  {simLogs.length === 0 && (
                    <span className="text-gray-550 italic">Venter på indkast... Tryk på 'Udfør Test-Indkast' til venstre for at starte.</span>
                  )}
                  {simLogs.map((log, index) => (
                    <div key={index} className="flex gap-2 items-start leading-relaxed text-[#C8F24A]">
                      <span className="text-gray-550">❯</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>

              {simStatusMsg && (
                <div className="border-t border-gray-850 pt-2 mt-3 flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${simStatus === 'completed' ? 'bg-emerald-500' : 'bg-[#C8F24A] animate-pulse'}`} />
                  <span className="text-white text-[9px] font-bold uppercase">{simStatusMsg}</span>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
