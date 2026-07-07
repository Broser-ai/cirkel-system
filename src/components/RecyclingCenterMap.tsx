import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MapPin, Compass, Navigation, Clock, Check, Info, ExternalLink, ArrowRight, Trash2,
  Camera, MessageSquare, AlertTriangle, Send, ThumbsUp, Plus, X, Eye, ThumbsDown
} from 'lucide-react';

interface FeedbackEntry {
  id: string;
  userName: string;
  userAvatar: string;
  timestamp: string;
  type: 'optimal' | 'full' | 'broken';
  comment: string;
  photoUrl?: string;
  likes: number;
}

interface RecyclingPoint {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string;
  hours: string;
  materials: string[];
  vendingSupported: boolean; // support system for refund/pant
  isSmartBin?: boolean; // physical IoT trash bin or street bin
  status: 'optimal' | 'full' | 'broken';
  photos: string[];
  feedback: FeedbackEntry[];
  distance?: number;
}

// Custom Danish Recycling points clustered by major hubs (fallback coords)
const INITIAL_RECYCLING_POINTS: RecyclingPoint[] = [
  // Aarhus
  {
    id: 'aarhus-borgporten',
    name: 'Cirkel Drop-Point Borgporten',
    address: 'Borgporten 3, 8000 Aarhus C',
    lat: 56.1572,
    lng: 10.2078,
    city: 'Aarhus',
    hours: 'Åbent alle dage 07:00 - 22:00',
    materials: ['Plast', 'Metal', 'Karton', 'Flasker'],
    vendingSupported: true,
    status: 'optimal',
    photos: [
      'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?auto=format&fit=crop&w=600&q=80'
    ],
    feedback: [
      {
        id: 'fb-1',
        userName: 'Sofia Nielsen',
        userAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&q=80',
        timestamp: 'I dag, 10:15',
        type: 'optimal',
        comment: 'Super rent og ryddeligt her! Panten blev udbetalt med det samme på min Cirkel Wallet.',
        likes: 12
      },
      {
        id: 'fb-2',
        userName: 'Mads Poulsen',
        userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80',
        timestamp: 'I går, 16:40',
        type: 'optimal',
        comment: 'Altid godt tømt. Mit absolutte yndlingssted at aflevere mælkekartoner.',
        likes: 5
      }
    ]
  },
  {
    id: 'aarhus-smartbin-banegard',
    name: 'Cirkel IoT Smart-Spand Banegårdspladsen',
    address: 'Banegårdspladsen 1, 8000 Aarhus C',
    lat: 56.1504,
    lng: 10.2045,
    city: 'Aarhus',
    hours: 'Åbent 24/7',
    materials: ['Plast', 'Metal', 'Flasker'],
    vendingSupported: true,
    isSmartBin: true,
    status: 'optimal',
    photos: [
      'https://images.unsplash.com/photo-1503596476-1c12a8ba09a9?auto=format&fit=crop&w=600&q=80'
    ],
    feedback: [
      {
        id: 'fb-3',
        userName: 'Lucas Jensen',
        userAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&q=80',
        timestamp: 'I går, 11:10',
        type: 'optimal',
        comment: 'Meget praktisk placeret lige ved indgangen til Banegården. Scanneren fangede min QR-kode lynhurtigt.',
        likes: 8
      }
    ]
  },
  {
    id: 'aarhus-smartbin-dokk1',
    name: 'Cirkel IoT Smart-Spand Dokk1',
    address: 'Hack Kampmanns Plads 2, 8000 Aarhus C',
    lat: 56.1538,
    lng: 10.2135,
    city: 'Aarhus',
    hours: 'Åbent alle hverdage 08:00 - 22:00',
    materials: ['Plast', 'Metal', 'Karton'],
    vendingSupported: false,
    isSmartBin: true,
    status: 'optimal',
    photos: [
      'https://images.unsplash.com/photo-1616886220360-a24a5e003ac5?auto=format&fit=crop&w=600&q=80'
    ],
    feedback: [
      {
        id: 'fb-4',
        userName: 'Emma Thomsen',
        userAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=100&q=80',
        timestamp: 'I forrige uge',
        type: 'optimal',
        comment: 'Perfekt funktionel! Dejlig udsigt ved vandet, mens man afleverer sine plastflasker.',
        likes: 4
      }
    ]
  },
  {
    id: 'aarhus-smartbin-aboulevarden',
    name: 'Cirkel IoT Smart-Spand Åboulevarden',
    address: 'Åboulevarden 26, 8000 Aarhus C',
    lat: 56.1565,
    lng: 10.2095,
    city: 'Aarhus',
    hours: 'Åbent 24/7',
    materials: ['Plast', 'Metal', 'Flasker', 'Papir'],
    vendingSupported: true,
    isSmartBin: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'aarhus-smartbin-salling',
    name: 'Cirkel IoT Smart-Spand Salling',
    address: 'Østergade 25, 8000 Aarhus C',
    lat: 56.1558,
    lng: 10.2069,
    city: 'Aarhus',
    hours: 'Mandag - Lørdag 09:00 - 20:00',
    materials: ['Plast', 'Metal', 'Karton'],
    vendingSupported: false,
    isSmartBin: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'aarhus-lisbjerg',
    name: 'Lisbjerg Genbrugsstation',
    address: 'Øllegårdsvej 5, 8200 Aarhus N',
    lat: 56.2234,
    lng: 10.1654,
    city: 'Aarhus',
    hours: 'Hverdage 07:00 - 18:00, Weekend 09:00 - 17:00',
    materials: ['Plast', 'Metal', 'Glas', 'Pap', 'Elektronik', 'Farligt affald'],
    vendingSupported: false,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'aarhus-egaa',
    name: 'Egå Genbrugsstation',
    address: 'Grenaavej 455, 8250 Egå',
    lat: 56.2105,
    lng: 10.2687,
    city: 'Aarhus',
    hours: 'Hverdage 07:00 - 18:00, Weekend 09:00 - 17:00',
    materials: ['Plast', 'Metal', 'Glas', 'Pap & Papir', 'Haveaffald'],
    vendingSupported: false,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'aarhus-hojbjerg',
    name: 'Højbjerg Genbrugsstation',
    address: 'Banevej 3, 8270 Højbjerg',
    lat: 56.1152,
    lng: 10.2045,
    city: 'Aarhus',
    hours: 'Hverdage 07:00 - 18:00, Weekend 09:00 - 17:00',
    materials: ['Plast', 'Metal', 'Glas', 'Pap', 'Gips', 'Miljøfarligt'],
    vendingSupported: false,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'aarhus-viby',
    name: 'Viby Genbrugsstation',
    address: 'Vestergårdsvej 15, 8260 Viby J',
    lat: 56.1265,
    lng: 10.1582,
    city: 'Aarhus',
    hours: 'Hverdage 07:00 - 18:00, Weekend 09:00 - 17:00',
    materials: ['Plast', 'Metal', 'Karton', 'Glas', 'Stort jern'],
    vendingSupported: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  // København
  {
    id: 'cph-norrebro',
    name: 'Nørrebro Genbrugsstation',
    address: 'Hørsholmsgade 20, 2200 København N',
    lat: 55.6983,
    lng: 12.5412,
    city: 'København',
    hours: 'Mandag - Fredag 10:00 - 18:00, Weekend 10:00 - 17:00',
    materials: ['Plast', 'Metal', 'Karton', 'Glas', 'Småt elektronik'],
    vendingSupported: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'cph-arc',
    name: 'KRAFTVAERK Amager (ARC)',
    address: 'Kraftværksvej 25, 2300 København S',
    lat: 55.6852,
    lng: 12.6241,
    city: 'København',
    hours: 'Alle dage 08:00 - 20:00',
    materials: ['Plast', 'Metal', 'Glas', 'Pap', 'Miljøfarligt'],
    vendingSupported: false,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'cph-vesterbro',
    name: 'Vesterbro Genbrugscenter',
    address: 'Lyrskovgade 4, 1758 København V',
    lat: 55.6664,
    lng: 12.5310,
    city: 'København',
    hours: 'Hverdage 10:00 - 18:00, Lørdag 10:00 - 16:00',
    materials: ['Plast', 'Metal', 'Karton', 'Batterier'],
    vendingSupported: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  // København Smart-Bins
  {
    id: 'cph-smartbin-norrebro',
    name: 'Cirkel IoT Smart-Spand Nørrebro Runddel',
    address: 'Nørrebrogade 120, 2200 København N',
    lat: 55.6948,
    lng: 12.5485,
    city: 'København',
    hours: 'Åbent 24/7',
    materials: ['Plast', 'Metal', 'Karton'],
    vendingSupported: false,
    isSmartBin: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  {
    id: 'cph-smartbin-vesterport',
    name: 'Cirkel IoT Smart-Spand Vesterport',
    address: 'Vesterbrogade 10, 1620 København V',
    lat: 55.6749,
    lng: 12.5621,
    city: 'København',
    hours: 'Åbent 24/7',
    materials: ['Plast', 'Metal', 'Flasker'],
    vendingSupported: true,
    isSmartBin: true,
    status: 'optimal',
    photos: [],
    feedback: []
  },
  // Aalborg
  {
    id: 'aalborg-overvejen',
    name: 'Overvejen Genbrugsstation',
    address: 'Overvejen 7, 9220 Aalborg Øst',
    lat: 57.0298,
    lng: 9.9925,
    city: 'Aalborg',
    hours: 'Mandag - Søndag 09:00 - 17:00',
    materials: ['Plast', 'Metal', 'Glas', 'Møbler', 'Pap'],
    vendingSupported: false,
    status: 'optimal',
    photos: [],
    feedback: []
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

// Standard Aarhus city center coordinate fallback
const DEFAULT_LAT = 56.1522;
const DEFAULT_LNG = 10.2037;

export default function RecyclingCenterMap() {
  const [points, setPoints] = useState<RecyclingPoint[]>(INITIAL_RECYCLING_POINTS);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'success' | 'denied'>('idle');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [activeTab, setActiveTab ] = useState<'list' | 'map'>('list');
  const [filterType, setFilterType] = useState<'all' | 'station' | 'smartbin'>('all');

  // Detail view nested sub tab: Details info vs Community contribution
  const [detailSubTab, setDetailSubTab] = useState<'info' | 'community'>('info');
  const [showReportForm, setShowReportForm] = useState(false);
  const [activeZoomPhoto, setActiveZoomPhoto] = useState<string | null>(null);

  // Community report form variables
  const [reporterName, setReporterName] = useState('');
  const [reportStatusType, setReportStatusType] = useState<'optimal' | 'full' | 'broken'>('full');
  const [reportComment, setReportComment] = useState('');
  const [reportPresetPhoto, setReportPresetPhoto] = useState<string>('');
  const [customPhotoUrl, setCustomPhotoUrl] = useState('');

  // Preset photographic options simulating real broken/full bins for browser compatibility
  const PRESET_PHOTOS = [
    {
      id: 'p1',
      label: '⚠️ Overfyldt affald',
      url: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=600&q=80'
    },
    {
      id: 'p2',
      label: '🔧 Beskadiget / Defekt lås',
      url: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=600&q=80'
    },
    {
      id: 'p3',
      label: '📦 Genbrugs-papbunker',
      url: 'https://images.unsplash.com/photo-1605600656374-27726d6f4275?auto=format&fit=crop&w=600&q=80'
    }
  ];

  // Derive sorted points from current points state
  const sortedPoints = [...points].sort((a, b) => {
    const distA = a.distance !== undefined ? a.distance : 9999;
    const distB = b.distance !== undefined ? b.distance : 9999;
    return distA - distB;
  });

  // Load default layout on mount
  useEffect(() => {
    calculateDistances(DEFAULT_LAT, DEFAULT_LNG);
  }, []);

  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      alert("Udbyderen understøtter ikke lokalisering på din platform.");
      return;
    }

    setGeoState('locating');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        calculateDistances(latitude, longitude);
        setGeoState('success');
      },
      (error) => {
        console.warn("Geolocation permission error:", error);
        setGeoState('denied');
        calculateDistances(DEFAULT_LAT, DEFAULT_LNG);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 1000 * 60 * 5 }
    );
  };

  const calculateDistances = (lat: number, lng: number) => {
    setPoints(prev => {
      const list = prev.map((point) => {
        const distance = getDistanceKm(lat, lng, point.lat, point.lng);
        return {
          ...point,
          distance
        };
      });
      list.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      return list;
    });

    // Auto select nearest
    const tempPoints = INITIAL_RECYCLING_POINTS.map(p => ({
      ...p,
      distance: getDistanceKm(lat, lng, p.lat, p.lng)
    })).sort((a, b) => a.distance - b.distance);
    
    if (tempPoints.length > 0) {
      setSelectedStationId(tempPoints[0].id);
    }
  };

  const displayedPoints = sortedPoints.filter(point => {
    if (filterType === 'all') return true;
    if (filterType === 'smartbin') return point.isSmartBin === true;
    if (filterType === 'station') return !point.isSmartBin;
    return true;
  });

  useEffect(() => {
    const list = displayedPoints;
    if (list.length > 0 && !list.some(p => p.id === selectedStationId)) {
      setSelectedStationId(list[0].id);
    }
  }, [filterType]);

  const selectedPoint = points.find(p => p.id === selectedStationId);

  // Approximate travel estimates
  const getTravelTimes = (distanceKm: number) => {
    const walkMin = Math.round((distanceKm / 5) * 60);
    const bikeMin = Math.round((distanceKm / 15) * 60);
    return {
      walk: walkMin < 1 ? 'Under 1 min' : `${walkMin} min`,
      bike: bikeMin < 1 ? 'Under 1 min' : `${bikeMin} min`
    };
  };

  // Submit report to state
  const handleAddNewReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStationId) return;

    const selectedImg = reportPresetPhoto || customPhotoUrl;
    const finalComment = reportComment.trim() || (
      reportStatusType === 'full' 
        ? 'Rapporteret som fuld beholder.' 
        : reportStatusType === 'broken'
          ? 'Rapporteret som defekt system.'
          : 'Alt bekræftet i orden.'
    );

    const newFeedback: FeedbackEntry = {
      id: `fb-${Date.now()}`,
      userName: reporterName.trim() || 'Anonym borger',
      userAvatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${reporterName.trim() || 'anon-' + Math.random()}`,
      timestamp: 'Lige nu',
      type: reportStatusType,
      comment: finalComment,
      photoUrl: selectedImg || undefined,
      likes: 0
    };

    setPoints(prev => prev.map(p => {
      if (p.id === selectedStationId) {
        const updatedPhotos = [...p.photos];
        if (selectedImg && !updatedPhotos.includes(selectedImg)) {
          updatedPhotos.unshift(selectedImg);
        }
        return {
          ...p,
          status: reportStatusType,
          photos: updatedPhotos,
          feedback: [newFeedback, ...p.feedback]
        };
      }
      return p;
    }));

    // Reset fields
    setReporterName('');
    setReportComment('');
    setReportPresetPhoto('');
    setCustomPhotoUrl('');
    setShowReportForm(false);

    // Call global toast notifier if initialized
    const toastFn = (window as any).showToast;
    if (toastFn) {
      const msg = reportStatusType === 'full' 
        ? 'Rapport indsendt! Beholder markeret som FULD 🔴'
        : reportStatusType === 'broken'
          ? 'Rapport indsendt! Beholder markeret som DEFEKT ⚠️'
          : 'Tak for din status-opdatering 🟢';
      toastFn(msg, 'success');
    }
  };

  // Upvote feedback entry
  const handleLikeFeedback = (pointId: string, feedbackId: string) => {
    setPoints(prev => prev.map(p => {
      if (p.id === pointId) {
        return {
          ...p,
          feedback: p.feedback.map(f => f.id === feedbackId ? { ...f, likes: f.likes + 1 } : f)
        };
      }
      return p;
    }));
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
      {/* Header section with Location permission trigger */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-[#C8F24A]/20 text-primary rounded-lg text-sm shrink-0">📍</span>
            <h4 id="recycling-map-heading" className="text-sm font-black text-primary tracking-tight uppercase">Genbrugsstationer & Affaldsspande</h4>
          </div>

          <button
            id="geolocation-trigger-btn"
            onClick={handleLocateUser}
            disabled={geoState === 'locating'}
            className={`flex items-center gap-1.5 text-[10px] font-black border uppercase tracking-wider py-1.5 px-3 rounded-xl transition-all cursor-pointer ${
              geoState === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : geoState === 'locating'
                  ? 'bg-gray-100 border-gray-200 text-gray-450 animate-pulse'
                  : 'bg-primary text-accent border-primary hover:opacity-95 shadow-sm'
            }`}
          >
            <Compass className={`w-3.5 h-3.5 shrink-0 ${geoState === 'locating' ? 'animate-spin' : ''}`} />
            {geoState === 'success' 
              ? 'Placering fundet' 
              : geoState === 'locating' 
                ? 'Søger...' 
                : 'Brug min position'}
          </button>
        </div>

        <p className="text-[11px] font-semibold text-muted-text leading-relaxed">
          {geoState === 'success' 
            ? 'Fundet baseret på din GPS-lokation. Sorteringsenheder i nærheden sorteret efter afstand.'
            : 'Få vist lokale danske genbrugspladser og intelligente IoT affaldsspande nær dig.'}
        </p>
      </div>

      {/* Internal Mini-tab selection: List versus Visual interactive map */}
      <div className="bg-primary/5 p-1 rounded-xl flex gap-1 border border-primary/5">
        <button
          id="rec-tab-list"
          onClick={() => setActiveTab('list')}
          className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'list'
              ? 'bg-primary text-accent shadow-sm'
              : 'text-primary/60 hover:text-primary hover:bg-primary/5'
          }`}
        >
          📋 Liste ({displayedPoints.slice(0, 3).length} nærmeste)
        </button>
        <button
          id="rec-tab-map"
          onClick={() => setActiveTab('map')}
          className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'map'
              ? 'bg-primary text-accent shadow-sm'
              : 'text-primary/60 hover:text-primary hover:bg-primary/5'
          }`}
        >
          🗺️ Interaktivt Kort
        </button>
      </div>

      {/* Category selector to direct user specifically to an affaldsspand vs stations */}
      <div className="bg-gray-50/50 p-2 rounded-2xl flex items-center justify-between border border-gray-100 gap-1.5">
        <span className="text-[9px] font-black text-muted-text uppercase tracking-widest pl-1">Filtrering:</span>
        <div className="flex gap-1 shrink-0">
          <button
            id="filter-all-btn"
            onClick={() => setFilterType('all')}
            className={`py-1 px-2 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer border ${
              filterType === 'all'
                ? 'bg-primary text-accent border-primary'
                : 'bg-white border-gray-200 text-primary hover:bg-gray-50'
            }`}
          >
            Alle
          </button>
          <button
            id="filter-station-btn"
            onClick={() => setFilterType('station')}
            className={`py-1 px-2 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer border flex items-center gap-1 ${
              filterType === 'station'
                ? 'bg-primary text-accent border-primary'
                : 'bg-white border-gray-200 text-primary hover:bg-gray-50'
            }`}
          >
            📦 Stationer
          </button>
          <button
            id="filter-smartbin-btn"
            onClick={() => setFilterType('smartbin')}
            className={`py-1 px-2.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer border flex items-center gap-1 ${
              filterType === 'smartbin'
                ? 'bg-accent text-primary border-accent'
                : 'bg-white border-gray-150 text-primary hover:bg-gray-50'
            }`}
          >
            🗑️ Affaldsspande
          </button>
        </div>
      </div>

      {activeTab === 'list' && (
        <div className="flex flex-col gap-2.5">
          {/* Nearest 3 Stations list */}
          {displayedPoints.slice(0, 3).map((point, index) => {
            const isSelected = selectedStationId === point.id;
            const times = getTravelTimes(point.distance ?? 1.5);
            return (
              <div
                id={`nearest-point-card-${point.id}`}
                key={point.id}
                onClick={() => {
                  setSelectedStationId(point.id);
                  setDetailSubTab('info');
                }}
                className={`border rounded-2xl p-3.5 text-left transition-all cursor-pointer relative overflow-hidden flex flex-col gap-2 ${
                  isSelected
                    ? 'bg-primary/5 border-primary/20 shadow-sm'
                    : 'bg-white border-gray-150 hover:border-gray-200'
                }`}
              >
                {index === 0 && (
                  <span className="absolute right-3.5 top-3.5 text-[8px] font-black uppercase tracking-wider bg-accent text-primary px-1.5 py-0.5 rounded-full select-none">
                    Nærmeste
                  </span>
                )}

                <div className="flex justify-between items-start pr-12">
                  <div className="flex gap-2.5 items-start">
                    <span className="text-xl shrink-0 mt-0.5 font-sans">
                      {point.isSmartBin ? '🗑️' : (point.vendingSupported ? '🏧' : '📦')}
                    </span>
                    <div>
                      <h5 className="text-xs font-extrabold text-primary leading-snug flex items-center gap-1.5 flex-wrap">
                        {point.name}
                        {point.isSmartBin && (
                          <span className="text-[7.5px] font-black tracking-wide text-accent bg-primary px-1.5 py-0.2 rounded-md uppercase">
                            Smart-Spand
                          </span>
                        )}
                        {point.status === 'full' && (
                          <span className="text-[7.5px] font-bold text-white bg-red-500 border border-red-300 px-1 py-0.2 rounded uppercase">
                            Fuld 🔴
                          </span>
                        )}
                        {point.status === 'broken' && (
                          <span className="text-[7.5px] font-bold text-black bg-amber-400 border border-amber-300 px-1 py-0.2 rounded uppercase">
                            Defekt ⚠️
                          </span>
                        )}
                      </h5>
                      <p className="text-[10px] text-muted-text mt-0.5 truncate max-w-xs">{point.address}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 text-[10px] font-bold text-muted-text bg-[#FAF9F6] px-2.5 py-1.5 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-1">
                    <Navigation className="w-3.5 h-3.5 text-primary" />
                    <span>{point.distance !== undefined ? `${point.distance} km` : '1.5 km'} væk</span>
                  </div>
                  <div className="border-l border-gray-200 h-3" />
                  <span>🚴 {times.bike}</span>
                  <div className="border-l border-gray-200 h-3" />
                  <span>🚶 {times.walk}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'map' && (
        <div className="flex flex-col gap-3">
          {/* Beautiful 2D Coordinate radar-looking SVG map */}
          <div className="relative h-44 bg-primary rounded-2xl border border-primary/20 overflow-hidden shadow-inner flex flex-col justify-between p-3 select-none">
            {/* Visual grid lines to give it a radar GPS feel */}
            <div className="absolute inset-0 bg-[radial-gradient(#C8F24A_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />
            <div className="absolute top-1/2 left-0 right-0 h-0.5 border-t border-dashed border-white/5 pointer-events-none" />
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 border-l border-dashed border-white/5 pointer-events-none" />

            {/* Simulated Radar-like sweeps */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border border-accent/15 rounded-full pointer-events-none" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 border border-accent/10 rounded-full pointer-events-none animate-pulse" />

            {/* Centralized User Location Circle Pin */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
              <span className="w-4 h-4 bg-accent rounded-full flex items-center justify-center shadow-[0_0_12px_rgba(200,242,74,0.7)] border-2 border-primary relative">
                <span className="absolute w-6 h-6 bg-accent/25 rounded-full animate-ping pointer-events-none" />
              </span>
              <span className="text-[7.5px] font-black text-accent bg-primary/90 px-1 py-0.5 rounded-md mt-1 shadow border border-white/10 uppercase tracking-widest leading-none">
                DIG
              </span>
            </div>

            {/* Plot nearest recycling hubs as click targets */}
            {displayedPoints.slice(0, 4).map((pt, idx) => {
              // Convert coordinate differences into aesthetic layout position offsets
              let topOffset = '30%';
              let leftOffset = '22%';
              
              if (idx === 0) { topOffset = '24%'; leftOffset = '70%'; }
              else if (idx === 1) { topOffset = '75%'; leftOffset = '32%'; }
              else if (idx === 2) { topOffset = '18%'; leftOffset = '18%'; }
              else if (idx === 3) { topOffset = '68%'; leftOffset = '78%'; }

              const isSelected = selectedStationId === pt.id;

              return (
                <button
                  id={`map-pin-${pt.id}`}
                  key={pt.id}
                  onClick={() => {
                    setSelectedStationId(pt.id);
                    setDetailSubTab('info');
                  }}
                  style={{ top: topOffset, left: leftOffset }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-all p-1 hover:scale-110 z-20 cursor-pointer flex flex-col items-center"
                >
                  <div className="relative">
                    <motion.div 
                      animate={isSelected ? { y: [0, -4, 0] } : {}}
                      transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                      className={`w-7.5 h-7.5 rounded-xl flex items-center justify-center text-xs shadow-md border ${
                        isSelected 
                          ? 'bg-accent border-accent text-primary scale-110' 
                          : pt.status === 'full'
                            ? 'bg-red-500 border-red-300 text-white'
                            : pt.status === 'broken'
                              ? 'bg-amber-400 border-amber-300 text-black'
                              : 'bg-primary border-white/20 text-white/90 hover:bg-primary-dark'
                      }`}
                    >
                      {pt.isSmartBin ? '🗑' : (pt.vendingSupported ? '🏧' : '📦')}
                    </motion.div>

                    {/* Exclamation alerting badge for bad status reports */}
                    {pt.status === 'full' && (
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 z-30">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-600 border border-white text-[7px] text-white font-black items-center justify-center shadow-xs">!</span>
                      </span>
                    )}

                    {pt.status === 'broken' && (
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 z-30">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500 border border-white text-[7px] text-black font-black items-center justify-center shadow-xs">!</span>
                      </span>
                    )}
                  </div>

                  <span className={`text-[8px] font-black py-0.2 px-1 rounded shadow-sm mt-1 whitespace-nowrap overflow-hidden max-w-16 truncate ${
                    isSelected 
                      ? 'bg-accent text-primary border border-accent uppercase' 
                      : 'bg-primary-dark text-white/60 border border-white/5 font-semibold'
                  }`}>
                    {pt.name.split(' ')[0]}
                  </span>
                </button>
              );
            })}

            {/* Mini Compass overlay */}
            <div className="text-[8px] font-bold text-white/40 uppercase tracking-widest mt-auto z-10 flex items-center gap-1">
              <Compass className="w-3 h-3 text-accent" /> Aarhus C Kort-radar
            </div>
            
            <div className="text-[8px] font-black text-accent uppercase tracking-widest text-right ml-auto bg-primary/80 py-0.5 px-2 rounded-full border border-white/5">
              {geoState === 'success' ? 'GPS AKTIV' : 'MOCK GPS AKTIV'}
            </div>
          </div>

          {/* Quick instructions indicator for map clicks */}
          <p className="text-[10px] text-muted-text text-center italic mt-0.5">
            Klik på ikonerne 🏧/📦/🗑️ på kortet for at skifte rutevejledning.
          </p>
        </div>
      )}

      {/* Detail Action drawer of Selected Center */}
      <AnimatePresence mode="wait">
        {selectedPoint && (
          <motion.div
            key={selectedPoint.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-[#FAF9F6] border border-gray-150 p-4 rounded-2xl flex flex-col gap-3"
          >
            <div className="flex justify-between items-start gap-4">
              <div>
                <span className="text-[8px] font-black text-muted-text uppercase tracking-widest block">Valgt Drop-Point</span>
                <h5 className="text-sm font-black text-primary tracking-tight mt-0.5">{selectedPoint.name}</h5>
                <p className="text-xs text-muted-text mt-0.5">{selectedPoint.address}</p>
              </div>

              {selectedPoint.vendingSupported && (
                <span className="text-[9px] font-black bg-emerald-100 text-emerald-800 border border-emerald-250 px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0">
                  Pant Retur ✓
                </span>
              )}
            </div>

            {/* NESTED SUB-TAB FOR INFO VS CITIZEN FEEDBACK */}
            <div className="flex gap-1.5 bg-gray-200/50 p-1 rounded-xl">
              <button
                id="station-detail-info-btn"
                onClick={() => {
                  setDetailSubTab('info');
                  setShowReportForm(false);
                }}
                className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  detailSubTab === 'info'
                    ? 'bg-primary text-accent shadow-2xs'
                    : 'text-primary/60 hover:text-primary hover:bg-gray-200/30'
                }`}
              >
                ℹ️ Åbningstider & Rute
              </button>
              <button
                id="station-detail-community-btn"
                onClick={() => setDetailSubTab('community')}
                className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 ${
                  detailSubTab === 'community'
                    ? 'bg-primary text-accent shadow-2xs'
                    : 'text-primary/60 hover:text-primary hover:bg-gray-200/30'
                }`}
              >
                👥 Borger-feedback ({selectedPoint.feedback.length + selectedPoint.photos.length})
              </button>
            </div>

            {detailSubTab === 'info' && (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs border-t border-gray-150 pt-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-black text-muted-text uppercase tracking-widest">📋 Godkendte materialer</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {selectedPoint.materials.map((mat) => (
                        <span 
                          key={mat}
                          className="text-[9px] font-black bg-white border border-gray-200 text-primary px-1.5 py-0.5 rounded"
                        >
                          {mat}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-0.5 pl-2 border-l border-gray-200">
                    <span className="text-[9px] font-black text-muted-text uppercase tracking-widest">🕒 Åbningstider</span>
                    <p className="text-[10px] font-semibold text-primary mt-1.5 leading-snug">
                      {selectedPoint.hours}
                    </p>
                  </div>
                </div>

                {/* Route & share external triggers */}
                <div className="flex gap-2 border-t border-gray-150 pt-3.5 mt-0.5">
                  <a
                    id="external-route-maps-btn"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedPoint.name + ' ' + selectedPoint.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-primary text-accent text-center py-2 px-4 rounded-xl text-xs font-black hover:opacity-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    Åbn Rutevejledning <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  
                  <button
                    id="copy-address-button"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedPoint.address);
                      alert(`Adresse kopieret!`);
                    }}
                    className="bg-white border border-gray-200 text-primary py-2 px-4 rounded-xl text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer shadow-sm shrink-0"
                  >
                    Kopier adresse
                  </button>
                </div>
              </>
            )}

            {detailSubTab === 'community' && (
              <div className="flex flex-col gap-3 border-t border-gray-150 pt-3 text-left">
                
                {/* 1. Status Indicator strip */}
                <div className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-bold ${
                  selectedPoint.status === 'optimal' 
                    ? 'bg-emerald-50/70 border-emerald-100 text-emerald-800'
                    : selectedPoint.status === 'full'
                      ? 'bg-red-50/70 border-red-100 text-red-800'
                      : 'bg-amber-50/70 border-amber-100 text-amber-800'
                }`}>
                  <span className="uppercase flex items-center gap-1.5">
                    {selectedPoint.status === 'optimal' && <span>🟢 Alt Ok · Fuldt funktionel</span>}
                    {selectedPoint.status === 'full' && <span>🔴 REGISTRERET SOM FULD</span>}
                    {selectedPoint.status === 'broken' && <span>⚠️ REGISTRERET SOM DEFEKT / I STYKKER</span>}
                  </span>
                  
                  {selectedPoint.status !== 'optimal' && (
                    <button
                      onClick={() => {
                        setPoints(prev => prev.map(p => p.id === selectedPoint.id ? { ...p, status: 'optimal' } : p));
                        const toastFn = (window as any).showToast;
                        if (toastFn) toastFn('Markeret som optimal/løst!', 'success');
                      }}
                      className="px-2 py-0.5 bg-white text-[9px] font-black rounded uppercase border hover:bg-gray-50 text-emerald-800 cursor-pointer shadow-3xs"
                    >
                      ✓ Marker som Tømt / Fikset
                    </button>
                  )}
                </div>

                {/* 2. User-Contributed Photos gallery */}
                <div>
                  <span className="text-[9px] font-black text-muted-text uppercase tracking-widest block mb-1.5">
                    📸 Borgerfotos ({selectedPoint.photos.length})
                  </span>
                  {selectedPoint.photos.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1.5 no-scrollbar">
                      {selectedPoint.photos.map((url, i) => (
                        <div 
                          key={i} 
                          onClick={() => setActiveZoomPhoto(url)}
                          className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0 cursor-zoom-in hover:opacity-90 group transition-all"
                        >
                          <img 
                            src={url} 
                            alt={`Borger foto ${i + 1}`} 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-all" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-400 italic bg-gray-50 p-2.5 rounded-xl border border-dashed text-center">
                      Ingen fotos tilføjet endnu. Vær den første til at dele et foto af beholderen.
                    </p>
                  )}
                </div>

                {/* 3. Feedback Feed */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[9px] font-black text-muted-text uppercase tracking-widest">
                      💬 Borger log- og kommentarer ({selectedPoint.feedback.length})
                    </span>
                    {!showReportForm && (
                      <button
                        onClick={() => setShowReportForm(true)}
                        className="text-[9.5px] font-black bg-primary text-accent px-2 py-1 rounded-lg uppercase cursor-pointer flex items-center gap-0.5 hover:opacity-95"
                      >
                        <Plus className="w-3 h-3" /> Rapporter status / foto
                      </button>
                    )}
                  </div>

                  {/* Comment Form Section */}
                  {showReportForm && (
                    <motion.form 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onSubmit={handleAddNewReport}
                      className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-2.5 mb-3 text-xs"
                    >
                      <div className="flex justify-between items-center border-b border-gray-100 pb-1.5 mb-0.5">
                        <span className="font-bold text-primary uppercase text-[9px] tracking-wider">Opret ny borger-rapport</span>
                        <button 
                          type="button" 
                          onClick={() => setShowReportForm(false)}
                          className="text-gray-400 hover:text-primary cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] font-black text-muted-text uppercase">Dit Navn</label>
                          <input 
                            type="text" 
                            placeholder="Valgfrit (f.eks Morten A.)" 
                            className="border border-gray-250 p-1.5 rounded-lg outline-none font-semibold text-xs"
                            value={reporterName}
                            onChange={(e) => setReporterName(e.target.value)}
                          />
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] font-black text-muted-text uppercase">Beholder Status</label>
                          <select
                            className="border border-gray-250 p-1.5 rounded-lg outline-none font-bold text-xs cursor-pointer bg-white"
                            value={reportStatusType}
                            onChange={(e) => setReportStatusType(e.target.value as any)}
                          >
                            <option value="optimal">🟢 Alt i orden (Optimal / Tom)</option>
                            <option value="full">🔴 Beholderen er fuld / fyldt til randen</option>
                            <option value="broken">⚠️ Beholderen er i stykker / defekt</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <label className="text-[8px] font-black text-muted-text uppercase">Din Kommentar / Observation</label>
                        <textarea 
                          placeholder="F.eks. Lågen sidder løs på spanden, eller Der er fyldt helt op..." 
                          className="border border-gray-250 p-1.5 rounded-lg h-12 outline-none resize-none font-semibold text-xs"
                          value={reportComment}
                          onChange={(e) => setReportComment(e.target.value)}
                        />
                      </div>

                      {/* Photo addition options */}
                      <div className="flex flex-col gap-1 bg-gray-50 p-2 rounded-lg border">
                        <label className="text-[8px] font-black text-muted-text uppercase flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5 text-primary" /> Tilføj et borger-billede (Vælg hurtigt eller skriv URL)
                        </label>
                        
                        {/* Quick Presets */}
                        <div className="flex flex-wrap gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => setReportPresetPhoto('')}
                            className={`p-1 px-1.5 text-[8.5px] font-bold rounded border cursor-pointer select-none ${
                              reportPresetPhoto === '' ? 'bg-primary text-white border-primary' : 'bg-white border-gray-200'
                            }`}
                          >
                            Intet billede
                          </button>
                          {PRESET_PHOTOS.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setReportPresetPhoto(p.url);
                                setCustomPhotoUrl('');
                              }}
                              className={`p-1 px-1.5 text-[8.5px] font-bold rounded border cursor-pointer select-none ${
                                reportPresetPhoto === p.url ? 'bg-[#85A912] text-white border-[#85A912]' : 'bg-white border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>

                        {/* Custom Photo URL input fallback */}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="text-[8.5px] font-semibold text-slate-400 shrink-0">Eller indsæt URL:</span>
                          <input 
                            type="text" 
                            placeholder="https://images.unsplash.com/..." 
                            className="bg-white border border-gray-250 p-1 rounded font-mono text-[9px] flex-1 outline-none"
                            value={customPhotoUrl}
                            onChange={(e) => {
                              setCustomPhotoUrl(e.target.value);
                              setReportPresetPhoto('');
                            }}
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-[#85A912] hover:bg-[#708f0f] text-white font-black text-[10px] uppercase py-2 rounded-lg transition-all text-center cursor-pointer tracking-wider"
                      >
                        Indsend Borger-rapport 🚀
                      </button>
                    </motion.form>
                  )}

                  {/* Comment List */}
                  {selectedPoint.feedback.length > 0 ? (
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                      {selectedPoint.feedback.map((entry) => (
                        <div key={entry.id} className="border border-gray-150 rounded-xl p-2.5 bg-white text-xs flex flex-col gap-1.5 relative">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex items-center gap-2">
                              <img 
                                src={entry.userAvatar} 
                                alt={entry.userName} 
                                className="w-6 h-6 rounded-full border border-gray-200 bg-gray-100 shrink-0"
                                referrerPolicy="no-referrer"
                              />
                              <div>
                                <span className="font-extrabold text-primary block leading-none">{entry.userName}</span>
                                <span className="text-[8px] font-bold text-gray-400 block mt-0.5">{entry.timestamp}</span>
                              </div>
                            </div>

                            {/* Comment type tag */}
                            <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase leading-none ${
                              entry.type === 'optimal'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
                                : entry.type === 'full'
                                  ? 'bg-red-50 text-red-800 border border-red-100 font-black'
                                  : 'bg-amber-100 text-amber-900 border border-amber-200 font-semibold'
                            }`}>
                              {entry.type === 'optimal' ? 'Alt Ok' : entry.type === 'full' ? 'Fuld' : 'Defekt'}
                            </span>
                          </div>

                          <p className="text-[11px] font-medium text-slate-700 leading-normal pl-0.5 pr-2">
                            {entry.comment}
                          </p>

                          {/* Render thumbnail inside comments if they provided a photograph */}
                          {entry.photoUrl && (
                            <div 
                              onClick={() => setActiveZoomPhoto(entry.photoUrl!)}
                              className="mt-1 h-20 w-32 rounded-lg overflow-hidden border border-gray-150 cursor-zoom-in hover:opacity-90 transition-all shrink-0 relative group"
                            >
                              <img 
                                src={entry.photoUrl} 
                                alt="Observation vedhæftning" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute top-1 right-1 bg-black/60 text-white rounded p-0.5 px-1 text-[7px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">
                                Forstør 🔍
                              </div>
                            </div>
                          )}

                          {/* Upvotes bar */}
                          <div className="border-t border-gray-100 pt-1.5 mt-0.5 flex justify-end gap-2 text-[9px] font-black text-gray-400 uppercase tracking-wider">
                            <button
                              onClick={() => handleLikeFeedback(selectedPoint.id, entry.id)}
                              className="flex items-center gap-1 text-slate-500 hover:text-[#85A912] transition-colors cursor-pointer"
                              title="Upvote comment"
                            >
                              <ThumbsUp className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>Støt rapport ({entry.likes})</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-gray-50 text-gray-400 italic text-[10.5px] p-3 text-center rounded-xl border">
                      Ingen kommentarer registreret endnu. Klik på "+ Rapporter status / foto" for at efterlade feedback.
                    </div>
                  )}

                </div>

              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* FULLSCREEN PHOTO ZOOM LIGHTBOX MODAL */}
      <AnimatePresence>
        {activeZoomPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActiveZoomPhoto(null)}
            className="fixed inset-0 bg-black/85 z-9999 flex items-center justify-center p-4 cursor-zoom-out"
          >
            <div className="relative max-w-2xl w-full max-h-[85vh] flex flex-col items-center justify-center gap-3">
              <button
                onClick={() => setActiveZoomPhoto(null)}
                className="absolute top-0 right-0 -mr-10 text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full cursor-pointer z-50 text-lg font-bold"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={activeZoomPhoto}
                alt="Zoomed citizen observation"
                className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl border border-white/10"
                referrerPolicy="no-referrer"
              />
              <p className="text-[10px] text-white/50 font-mono font-bold tracking-widest uppercase">
                Klik hvor som helst for at lukke zoomen 🔍
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
