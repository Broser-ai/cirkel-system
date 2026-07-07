import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from './types';
import LoginScreen from './components/LoginScreen';
import ScanTab from './components/ScanTab';
import WalletTab from './components/WalletTab';
import ProfilTab from './components/ProfilTab';
import SystemsTab from './components/SystemsTab';
import AdminPanel from './components/AdminPanel';
import B2BPartnerDashboard from './components/B2BPartnerDashboard';
import BiometricPrompt from './components/BiometricPrompt';
import {
  Camera, Wallet, User, Globe, HelpCircle, ShieldCheck, Landmark, Building2, ShieldAlert,
  Bell, MapPin, Trash2, Smartphone, AlertTriangle, Clock
} from 'lucide-react';
import { useLanguage } from './lib/i18n';
import { triggerHaptic, HapticPattern } from './lib/haptics';

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<'scan' | 'wallet' | 'profil' | 'systems' | 'admin'>('scan');
  type ViewMode = 'citizen' | 'b2b_business' | 'b2b_kommune';
  const availableModes = useMemo<ViewMode[]>(() => {
    if (!user) return ['citizen'];
    switch (user.user_type) {
      case 'admin':        return ['citizen', 'b2b_business', 'b2b_kommune'];
      case 'b2b_business': return ['b2b_business'];
      case 'b2b_kommune':  return ['b2b_kommune'];
      case 'consumer':
      default:             return ['citizen'];
    }
  }, [user?.user_type]);
  const [viewMode, setViewMode] = useState<ViewMode>(availableModes[0]);
  useEffect(() => {
    if (!availableModes.includes(viewMode)) {
      setViewMode(availableModes[0]);
    }
  }, [availableModes, viewMode]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWalletUnlocked, setIsWalletUnlocked] = useState(false);

  useEffect(() => {
    if (tab !== 'wallet') {
      setIsWalletUnlocked(false);
    }
  }, [tab]);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('cirkel_dark_mode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('cirkel_dark_mode', String(isDarkMode));
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDarkMode]);

  interface ToastItem {
    id: string;
    message: string;
    co2Value?: string;
    type: 'success' | 'info' | 'error' | 'co2';
  }

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (message: string, type: 'success' | 'info' | 'error' | 'co2' = 'info', co2Value?: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast: ToastItem = { id, message, type, co2Value };
    setToasts(prev => [...prev, newToast]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  // Expose as global for child components to grab easily
  useEffect(() => {
    (window as any).showToast = showToast;
    return () => {
      delete (window as any).showToast;
    };
  }, []);

  useEffect(() => {
    // Try to restore the cached user session across reloads
    const cached = localStorage.getItem('cirkel_user');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.id) {
          // TRIN 2 migration: sikre kendte demo-bypass-brugere har user_type
          // (rekonstruerer efter localStorage-cache fra før TRIN 2 rollout)
          if (!parsed.user_type && parsed.id === 'auth-ma-keap-uid-bypass') {
            parsed.user_type = 'admin';
            localStorage.setItem('cirkel_user', JSON.stringify(parsed));
          }
          setUser(parsed);
        }
      } catch (err) {
        console.warn("Could not parse cached user profile:", err);
      }
    }
    setIsLoading(false);
  }, []);

  const handleLogin = (profile: UserProfile) => {
    setUser(profile);
    setTab('scan');
  };

  const handleLogout = async () => {
    try {
      const { logoutUser } = await import('./lib/firebase');
      await logoutUser();
    } catch (err) {
      console.warn("Error signing out from Firebase:", err);
    }
    localStorage.removeItem('cirkel_user');
    setUser(null);
  };

  const handleUpdateUser = (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => {
    if (!user) return;
    setUser(prev => {
      if (!prev) return prev;
      const result = typeof updates === 'function' ? updates(prev) : { ...prev, ...updates };
      localStorage.setItem('cirkel_user', JSON.stringify(result));
      
      // Replicate state in real-time to Firestore
      import('./lib/firebase').then(({ saveUserProfileToStore }) => {
        saveUserProfileToStore(result.id, result).catch(err => {
          console.warn("Could not replicate user update to Firestore:", err);
        });
      });

      return result;
    });
  };

  const [lastScanTime, setLastScanTime] = useState<number>(() => {
    const saved = localStorage.getItem('cirkel_last_scan_time');
    if (saved) return Number(saved);
    const now = Date.now();
    localStorage.setItem('cirkel_last_scan_time', String(now));
    return now;
  });

  const [reminderDismissed, setReminderDismissed] = useState<boolean>(() => {
    return localStorage.getItem('cirkel_reminder_dismissed') === 'true';
  });

  const prevScansCountRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (user) {
      if (prevScansCountRef.current !== undefined && user.scansCount > prevScansCountRef.current) {
        const now = Date.now();
        setLastScanTime(now);
        localStorage.setItem('cirkel_last_scan_time', String(now));
        localStorage.removeItem('cirkel_reminder_dismissed');
        setReminderDismissed(false);
      }
      prevScansCountRef.current = user.scansCount;
    }
  }, [user?.scansCount]);

  const showInactivityReminder = useMemo(() => {
    const notifsEnabled = localStorage.getItem('cirkel_notifs_enabled') !== 'false';
    if (!notifsEnabled) return false;
    if (reminderDismissed) return false;

    const differenceMs = Date.now() - lastScanTime;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return differenceMs > threeDaysMs;
  }, [lastScanTime, reminderDismissed]);

  const handleSimulateInactivity = () => {
    const fourDaysAgo = Date.now() - (4 * 24 * 60 * 60 * 1000);
    setLastScanTime(fourDaysAgo);
    localStorage.setItem('cirkel_last_scan_time', String(fourDaysAgo));
    localStorage.removeItem('cirkel_reminder_dismissed');
    setReminderDismissed(false);
    triggerHaptic(HapticPattern.LIGHT_TAP);
    showToast(
      language === 'da' 
        ? 'Inaktivitet simuleret! Sidste scan sat til 4 dage siden.' 
        : 'Inactivity simulated! Set last scan to 4 days ago.', 
      'info'
    );
  };

  const handleDismissReminder = () => {
    localStorage.setItem('cirkel_reminder_dismissed', 'true');
    setReminderDismissed(true);
    triggerHaptic(HapticPattern.LIGHT_TAP);
    showToast(
      language === 'da'
        ? 'Genbrugspåmindelse snoozet/skjult.'
        : 'Recycling reminder snoozed/hidden.',
      'info'
    );
  };

  const handleActionReminder = () => {
    triggerHaptic(HapticPattern.LIGHT_TAP);
    setTab('scan');
    localStorage.setItem('cirkel_reminder_dismissed', 'true');
    setReminderDismissed(true);
    showToast(
      language === 'da'
        ? 'Åbner genbrugsbeholder-kortet! Find din lokale beholder ♻️'
        : 'Opening smartbins locator! Check your local bin ♻️',
      'success'
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-primary text-accent p-6">
        <motion.h1 
          className="text-5xl font-black tracking-tighter"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          cirkel
        </motion.h1>
        <p className="text-accent/60 text-xs tracking-widest mt-2 uppercase">{t('slogan')}</p>
        <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin mt-8" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="bg-[#DFD9CE] min-h-screen w-full flex flex-col items-center justify-start p-4 md:p-6 font-sans antialiased text-primary selection:bg-accent selection:text-primary">
      
      {/* 🚀 STRATEGIC PLATFORM SWITCHER HEADER */}
      <div className="w-full max-w-6xl bg-white border border-primary/10 rounded-3xl p-3 flex flex-col md:flex-row justify-between items-center gap-4 shadow-md z-40 mb-6 select-none animate-in slide-in-from-top duration-300">
        <div className="flex items-center gap-3 text-left pl-1 w-full md:w-auto">
          <Globe className="w-5 h-5 text-[#85A912] animate-spin shrink-0" style={{ animationDuration: '10s' }} />
          <div>
            <span className="text-[9px] font-black text-[#85A912] uppercase tracking-wider bg-[#85A912]/10 border border-[#85A912]/20 px-2 py-0.5 rounded-md">
              Cirkel Miljø-Platform
            </span>
            <h4 className="text-xs font-black uppercase text-[#002b49] leading-tight mt-1">Multi-Interface Demo System</h4>
          </div>
        </div>
        
        {availableModes.length > 1 && (
        <div className="flex bg-gray-100 p-1 rounded-xl w-full md:w-auto">
          <button
            id="switch-view-citizen-btn"
            onClick={() => {
              triggerHaptic(HapticPattern.LIGHT_TAP);
              setViewMode('citizen');
              showToast('Skiftede til Borger Mobil-Applikation!', 'info');
              setTab('systems');
            }}
            className={`flex-1 md:flex-none text-[10px] font-black uppercase tracking-wider py-2 px-4 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'citizen'
                ? 'bg-primary text-[#C8F24A] shadow-md'
                : 'text-gray-500 hover:text-primary'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            📱 Borger Mobil App
          </button>
          <button
            id="switch-view-b2b-btn"
            onClick={() => {
              triggerHaptic(HapticPattern.LIGHT_TAP);
              setViewMode('b2b_business');
              showToast('Skiftede til B2B Erhverv-Portal!', 'info');
            }}
            className={`flex-1 md:flex-none text-[10px] font-black uppercase tracking-wider py-2 px-4 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'b2b_business'
                ? 'bg-[#85A912] text-white shadow-md'
                : 'text-gray-550 hover:text-primary'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            💼 B2B Erhverv (Widescreen)
          </button>
          <button
            id="switch-view-kommune-btn"
            onClick={() => {
              triggerHaptic(HapticPattern.LIGHT_TAP);
              setViewMode('b2b_kommune');
              showToast('Skiftede til Kommune-Portal!', 'info');
            }}
            className={`flex-1 md:flex-none text-[10px] font-black uppercase tracking-wider py-2 px-4 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'b2b_kommune'
                ? 'bg-primary text-white shadow-md'
                : 'text-gray-550 hover:text-primary'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            🏛️ Kommune Portal
          </button>
        </div>
        )}
      </div>

      {viewMode === 'b2b_business' ? (
        /* Widescreen — B2B Erhverv-Portal (producenter, brands) */
        <div className="w-full max-w-6xl bg-white border border-gray-200 md:rounded-[2rem] md:shadow-2xl overflow-hidden min-h-[750px] animate-in fade-in duration-300">
          <B2BPartnerDashboard user={user} onChangeUser={handleUpdateUser} portalType="business" />
        </div>
      ) : viewMode === 'b2b_kommune' ? (
        /* Widescreen — Kommune-Portal (kommunemedarbejdere) */
        <div className="w-full max-w-6xl bg-white border border-gray-200 md:rounded-[2rem] md:shadow-2xl overflow-hidden min-h-[750px] animate-in fade-in duration-300">
          <B2BPartnerDashboard user={user} onChangeUser={handleUpdateUser} portalType="kommune" />
        </div>
      ) : (
        /* simulated mobile preview card to make the applet feel incredibly organic and polished */
        <div className="bg-bg-base w-full max-w-md md:rounded-[2.5rem] md:shadow-2xl overflow-hidden min-h-screen md:min-h-[850px] flex flex-col justify-between border-0 md:border-8 border-primary relative animate-in fade-in duration-300">
          
          {/* Dynamic Notch / Status Area on mobile preview */}
          <div className="hidden md:flex justify-between items-center bg-primary text-white py-2 px-9 text-[10px] font-bold z-30 select-none">
            <span>9:41</span>
            <div className="w-24 h-4 bg-black rounded-b-xl absolute left-1/2 -translate-x-1/2 top-0" />
            <div className="flex items-center gap-1">
              <span>📶</span>
              <span>🔋 100%</span>
            </div>
          </div>

          {/* Global Compact App Header with Language Selection */}
          <div className="bg-white border-b border-gray-150 py-3.5 px-6 flex justify-between items-center z-25 select-none shrink-0 shadow-3xs">
            <div className="flex flex-col text-left">
              <span className="text-lg font-black text-primary tracking-tighter leading-none">cirkel</span>
              <span className="text-[8px] font-black text-primary/50 tracking-wider uppercase mt-1 leading-none">{t('slogan')}</span>
            </div>
            <div className="flex items-center gap-1 bg-primary/5 p-1 rounded-xl">
              <button
                id="set-lang-da-btn"
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setLanguage('da');
                }}
                className={`text-[9px] font-black tracking-widest uppercase py-1 px-2.5 rounded-lg transition-all cursor-pointer select-none ${
                  language === 'da'
                    ? 'bg-primary text-accent shadow-xs'
                    : 'text-primary/55 hover:text-primary'
                }`}
              >
                DA
              </button>
              <button
                id="set-lang-en-btn"
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setLanguage('en');
                }}
                className={`text-[9px] font-black tracking-widest uppercase py-1 px-2.5 rounded-lg transition-all cursor-pointer select-none ${
                  language === 'en'
                    ? 'bg-primary text-accent shadow-xs'
                    : 'text-primary/55 hover:text-primary'
                }`}
              >
                EN
              </button>
            </div>
          </div>

          {/* Content body with animations */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative pb-20 select-none">
            {/* Direct simulated Local Push Notification Banner */}
            <AnimatePresence>
              {showInactivityReminder && (
                <motion.div
                  id="inactivity-local-notification"
                  initial={{ opacity: 0, y: -80, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -40, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  className="mx-4 mt-3 bg-[#111827] text-white rounded-2xl shadow-xl p-4 flex flex-col gap-3 border border-gray-800 relative z-50 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 bg-[#C8F24A] rounded-md flex items-center justify-center text-xs text-primary font-black">
                        c
                      </div>
                      <span className="text-[10px] font-black uppercase text-[#C8F24A] tracking-wider">
                        cirkel ♻️
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] text-gray-400 font-bold">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span>{language === 'da' ? '3 dage siden' : '3 days ago'}</span>
                    </div>
                  </div>

                  <div className="flex gap-2.5">
                    <div className="w-9 h-9 bg-primary/20 rounded-xl flex items-center justify-center shrink-0 border border-gray-700">
                      <Trash2 className="w-5 h-5 text-[#C8F24A]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-black text-gray-100">
                        {language === 'da' ? 'Begynder beholderen at blive fuld?' : 'Is your recycling pile starting to grow?'}
                      </p>
                      <p className="text-[10px] text-gray-300 font-semibold leading-normal mt-0.5">
                        {language === 'da'
                          ? 'Det er over 3 dage siden, du sidst scannede et emne. Tjek din lokale beholder for at genstarte din grønne stime!'
                          : "It's been over 3 days since your last scan. Check your local bin map to keep your streak going!"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      id="action-bin-reminder-btn"
                      onClick={handleActionReminder}
                      className="bg-[#C8F24A] hover:bg-[#b0d836] text-primary py-2 px-3 rounded-xl text-center text-[10px] font-black uppercase tracking-wider cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                    >
                      <MapPin className="w-3 h-3" />
                      {language === 'da' ? 'Tjek Lokal Beholder' : 'Check Local Bin'}
                    </button>
                    <button
                      id="dismiss-bin-reminder-btn"
                      onClick={handleDismissReminder}
                      className="bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-3 rounded-xl text-center text-[10px] font-black uppercase tracking-wider cursor-pointer transition-colors"
                    >
                      {language === 'da' ? 'Måske senere' : 'Maybe later'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {tab === 'scan' && (
                  <ScanTab 
                    user={user} 
                    onChangeUser={handleUpdateUser} 
                    bal={user.balance} 
                    onShowToast={showToast}
                  />
                )}
                {tab === 'wallet' && (
                  !isWalletUnlocked ? (
                    <BiometricPrompt 
                      onUnlock={() => setIsWalletUnlocked(true)}
                      onCancel={() => {
                        setTab('scan');
                      }}
                    />
                  ) : (
                    <WalletTab 
                      user={user} 
                      onChangeUser={handleUpdateUser} 
                    />
                  )
                )}
                {tab === 'profil' && (
                  <ProfilTab 
                    user={user} 
                    onChangeUser={handleUpdateUser} 
                    onLogout={handleLogout} 
                    isDarkMode={isDarkMode}
                    setIsDarkMode={setIsDarkMode}
                    onSimulateInactivity={handleSimulateInactivity}
                  />
                )}
                {tab === 'systems' && (
                  <SystemsTab
                    user={user}
                    onChangeUser={handleUpdateUser}
                  />
                )}
                {tab === 'admin' && user.user_type === 'admin' && (
                  <AdminPanel user={user} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Bottom tab bar exactly like standard mobile bar */}
          <nav className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-250 py-3.5 px-6 flex justify-around items-center z-30 shadow-[0_-5px_15px_rgba(0,0,0,0.02)] rounded-t-3xl md:rounded-none">
            
            <motion.button
              id="tab-scan-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setTab('scan');
              }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.90 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
              className="flex flex-col items-center gap-1 cursor-pointer group shrink-0 focus:outline-none"
            >
              <motion.div 
                animate={{ 
                  scale: tab === 'scan' ? 1.05 : 1,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm relative ${
                  tab === 'scan' 
                    ? 'bg-primary text-accent' 
                    : 'bg-primary/5 text-primary/60 group-hover:bg-primary/10'
                }`}
              >
                <Camera className="w-5 h-5 shrink-0 z-10" />
              </motion.div>
              <motion.span 
                animate={{ y: tab === 'scan' ? 1 : 0 }}
                className={`text-[10px] font-black tracking-wider uppercase transition-colors ${
                  tab === 'scan' ? 'text-primary' : 'text-primary/45'
                }`}
              >
                {t('tab_scan')}
              </motion.span>
            </motion.button>
    
            <motion.button
              id="tab-wallet-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setTab('wallet');
              }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.90 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
              className="flex flex-col items-center gap-1 cursor-pointer group shrink-0 focus:outline-none"
            >
              <motion.div 
                animate={{ 
                  scale: tab === 'wallet' ? 1.05 : 1,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm relative ${
                  tab === 'wallet' 
                    ? 'bg-primary text-accent' 
                    : 'bg-primary/5 text-primary/60 group-hover:bg-primary/10'
                }`}
              >
                <Wallet className="w-5 h-5 shrink-0 z-10" />
              </motion.div>
              <motion.span 
                animate={{ y: tab === 'wallet' ? 1 : 0 }}
                className={`text-[10px] font-black tracking-wider uppercase transition-colors ${
                  tab === 'wallet' ? 'text-primary' : 'text-primary/45'
                }`}
              >
                {t('tab_wallet')}
              </motion.span>
            </motion.button>

            <motion.button
              id="tab-profil-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setTab('profil');
              }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.90 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
              className="flex flex-col items-center gap-1 cursor-pointer group shrink-0 focus:outline-none"
            >
              <motion.div 
                animate={{ 
                  scale: tab === 'profil' ? 1.05 : 1,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm relative ${
                  tab === 'profil' 
                    ? 'bg-primary text-accent' 
                    : 'bg-primary/5 text-primary/60 group-hover:bg-primary/10'
                }`}
              >
                <User className="w-5 h-5 shrink-0 z-10" />
              </motion.div>
              <motion.span 
                animate={{ y: tab === 'profil' ? 1 : 0 }}
                className={`text-[10px] font-black tracking-wider uppercase transition-colors ${
                  tab === 'profil' ? 'text-primary' : 'text-primary/45'
                }`}
              >
                {t('tab_profil')}
              </motion.span>
            </motion.button>

            <motion.button
              id="tab-systems-btn"
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setTab('systems');
              }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.90 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
              className="flex flex-col items-center gap-1 cursor-pointer group shrink-0 focus:outline-none"
            >
              <motion.div 
                animate={{ 
                  scale: tab === 'systems' ? 1.05 : 1,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm relative ${
                  tab === 'systems' 
                    ? 'bg-primary text-[#C8F24A]' 
                    : 'bg-primary/5 text-primary/60 hover:bg-primary/10'
                }`}
              >
                <ShieldCheck className="w-5 h-5 shrink-0 z-10" />
              </motion.div>
              <motion.span 
                animate={{ y: tab === 'systems' ? 1 : 0 }}
                className={`text-[10px] font-black tracking-wider uppercase transition-colors ${
                  tab === 'systems' ? 'text-primary' : 'text-primary/45'
                }`}
              >
                {t('tab_systems')}
              </motion.span>
            </motion.button>

            {user.user_type === 'admin' && (
              <motion.button
                id="tab-admin-btn"
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setTab('admin');
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.90 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                className="flex flex-col items-center gap-1 cursor-pointer group shrink-0 focus:outline-none"
              >
                <motion.div
                  animate={{ scale: tab === 'admin' ? 1.05 : 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm ${
                    tab === 'admin'
                      ? 'bg-primary text-accent'
                      : 'bg-primary/5 text-primary/60 group-hover:bg-primary/10'
                  }`}
                >
                  <ShieldAlert className="w-5 h-5 shrink-0 z-10" />
                </motion.div>
                <motion.span
                  animate={{ y: tab === 'admin' ? 1 : 0 }}
                  className={`text-[10px] font-black tracking-wider uppercase transition-colors ${
                    tab === 'admin' ? 'text-primary' : 'text-primary/45'
                  }`}
                >
                  Admin
                </motion.span>
              </motion.button>
            )}

          </nav>

        </div>
      )}

      {/* Global Toast Notification System overlay */}
      <div id="global-toasts-container" className="fixed top-24 right-6 z-[9999] flex flex-col gap-2.5 w-full max-w-sm pointer-events-none select-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -25, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92, y: -10 }}
              transition={{ type: "spring", stiffness: 420, damping: 25 }}
              className="pointer-events-auto w-full bg-white border border-gray-200/90 rounded-2xl shadow-lg p-3.5 flex items-start gap-3 border-l-4 overflow-hidden relative"
              style={{
                borderLeftColor: 
                  toast.type === 'co2' ? '#10B981' : 
                  toast.type === 'success' ? '#C8F24A' : 
                  toast.type === 'error' ? '#EF4444' : '#3B82F6'
              }}
            >
              <span className="text-lg shrink-0 mt-0.5">
                {toast.type === 'co2' ? '🌍' : 
                 toast.type === 'success' ? '⚡' : 
                 toast.type === 'error' ? '❌' : 'ℹ️'}
              </span>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[11px] font-black text-primary leading-tight uppercase tracking-wide">
                  {toast.type === 'co2' ? 'Klimafodaftryk reduceret!' : 
                   toast.type === 'success' ? 'Belønning modtaget!' : 
                   toast.type === 'error' ? 'Fejl opstået!' : 'Meddelelse'}
                </p>
                <p className="text-[10px] font-extrabold text-[#111111] leading-snug mt-0.5">{toast.message}</p>
                {toast.co2Value && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-black text-emerald-850 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md leading-none font-mono">
                      -{toast.co2Value} CO₂
                    </span>
                    <span className="text-[8.5px] font-black text-muted-text uppercase tracking-wider">Er sparet for atmosfæren! 🚀</span>
                  </div>
                )}
              </div>
              <button 
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="text-gray-400 hover:text-primary transition-colors cursor-pointer shrink-0 text-[10px] font-bold p-1 leading-none"
              >
                ✕
              </button>
              {/* Visual loading indicator inside toast */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-100">
                <motion.div 
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 4.5, ease: 'linear' }}
                  className="h-full"
                  style={{
                    backgroundColor: 
                      toast.type === 'co2' ? '#10B981' : 
                      toast.type === 'success' ? '#C8F24A' : 
                      toast.type === 'error' ? '#EF4444' : '#3B82F6'
                  }}
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

    </div>
  );
}
