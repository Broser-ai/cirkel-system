import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Compass, Navigation, Clock, Check, Info, ExternalLink, ArrowRight, Trash2 } from 'lucide-react';

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
}

// Custom Danish Recycling points clustered by major hubs (fallback coords)
const RECYCLING_POINTS: RecyclingPoint[] = [
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
    vendingSupported: true
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
    vendingSupported: false
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
    vendingSupported: false
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
    vendingSupported: false
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
    vendingSupported: true
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
    vendingSupported: true
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
    vendingSupported: false
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
    vendingSupported: true
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
    vendingSupported: false
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
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'success' | 'denied'>('idle');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [sortedPoints, setSortedPoints] = useState<(RecyclingPoint & { distance: number })[]>([]);
  const [activeTab, setActiveTab] = useState<'list' | 'map'>('list');

  // Load default layout on mount (or coordinates if stored previously/immediate fallback)
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
        setUserCoords({ lat: latitude, lng: longitude });
        calculateDistances(latitude, longitude);
        setGeoState('success');
      },
      (error) => {
        console.warn("Geolocation permission error:", error);
        setGeoState('denied');
        // fallback to default coordinates but keep sorted
        calculateDistances(DEFAULT_LAT, DEFAULT_LNG);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 1000 * 60 * 5 }
    );
  };

  const calculateDistances = (lat: number, lng: number) => {
    const list = RECYCLING_POINTS.map((point) => {
      const distance = getDistanceKm(lat, lng, point.lat, point.lng);
      return {
        ...point,
        distance
      };
    });

    // Sort by nearest
    list.sort((a, b) => a.distance - b.distance);
    setSortedPoints(list);
    
    // Automatically select the nearest point as default
    if (list.length > 0) {
      setSelectedStationId(list[0].id);
    }
  };

  const selectedPoint = sortedPoints.find(p => p.id === selectedStationId);

  // Approximate walking/biking times
  // Average walking speed = 5 km/h, average biking speed = 15 km/h
  const getTravelTimes = (distanceKm: number) => {
    const walkMin = Math.round((distanceKm / 5) * 60);
    const bikeMin = Math.round((distanceKm / 15) * 60);
    return {
      walk: walkMin < 1 ? 'Under 1 min' : `${walkMin} min`,
      bike: bikeMin < 1 ? 'Under 1 min' : `${bikeMin} min`
    };
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4">
      {/* Header section with Location permission trigger */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="p-1 px-1.5 bg-[#C8F24A]/20 text-primary rounded-lg text-sm shrink-0">📍</span>
            <h4 id="recycling-map-heading" className="text-sm font-black text-primary tracking-tight uppercase">Genbrugsstationer i nærheden</h4>
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
            ? 'Fundet baseret på din GPS-lokation. Herunder er sorteringsstationer sorteret efter afstand.'
            : 'Få vist lokale danske genbrugspladser og cirkulære Drop-Points nær dig baseret på afstand eller kommune.'}
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
          📋 Liste ({sortedPoints.slice(0, 3).length} nærmeste)
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

      {activeTab === 'list' && (
        <div className="flex flex-col gap-2.5">
          {/* Nearest 3 Stations list */}
          {sortedPoints.slice(0, 3).map((point, index) => {
            const isSelected = selectedStationId === point.id;
            const times = getTravelTimes(point.distance);
            return (
              <div
                id={`nearest-point-card-${point.id}`}
                key={point.id}
                onClick={() => setSelectedStationId(point.id)}
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
                    <span className="text-xl shrink-0 mt-0.5">
                      {point.vendingSupported ? '🏧' : '📦'}
                    </span>
                    <div>
                      <h5 className="text-xs font-extrabold text-primary leading-snug">{point.name}</h5>
                      <p className="text-[10px] text-muted-text mt-0.5 truncate max-w-xs">{point.address}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 text-[10px] font-bold text-muted-text bg-[#FAF9F6] px-2.5 py-1.5 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-1">
                    <Navigation className="w-3.5 h-3.5 text-primary" />
                    <span>{point.distance} km væk</span>
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

            {/* Centralized User Location Pin */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
              <span className="w-4 h-4 bg-accent rounded-full flex items-center justify-center shadow-[0_0_12px_rgba(200,242,74,0.7)] border-2 border-primary relative">
                <span className="absolute w-6 h-6 bg-accent/25 rounded-full animate-ping pointer-events-none" />
              </span>
              <span className="text-[7.5px] font-black text-accent bg-primary/90 px-1 py-0.5 rounded-md mt-1 shadow border border-white/10 uppercase tracking-widest leading-none">
                DIG
              </span>
            </div>

            {/* Plot nearest recycling hubs as click targets */}
            {sortedPoints.slice(0, 4).map((pt, idx) => {
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
                  onClick={() => setSelectedStationId(pt.id)}
                  style={{ top: topOffset, left: leftOffset }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-all p-1 hover:scale-110 z-20 cursor-pointer flex flex-col items-center"
                >
                  <motion.div 
                    animate={isSelected ? { y: [0, -4, 0] } : {}}
                    transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                    className={`w-7.5 h-7.5 rounded-xl flex items-center justify-center text-xs shadow-md border ${
                      isSelected 
                        ? 'bg-accent border-accent text-primary scale-110' 
                        : 'bg-primary border-white/20 text-white/90 hover:bg-primary-dark'
                    }`}
                  >
                    {pt.vendingSupported ? '🏧' : '📦'}
                  </motion.div>
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
            Klik på ikonerne 🏧/📦 på kortet for at skifte rutevejledning.
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
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[8px] font-black text-muted-text uppercase tracking-widest block">Valgt Drop-Point</span>
                <h5 className="text-sm font-black text-primary tracking-tight mt-0.5">{selectedPoint.name}</h5>
                <p className="text-xs text-muted-text mt-0.5">{selectedPoint.address}</p>
              </div>

              {selectedPoint.vendingSupported && (
                <span className="text-[9px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
                  Maks Pant Udbetaling ✓
                </span>
              )}
            </div>

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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
