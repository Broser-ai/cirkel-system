import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import LoginScreen from '../components/LoginScreen';
import ScanTab from '../components/ScanTab';
import WalletTab from '../components/WalletTab';
import ProfilTab from '../components/ProfilTab';
import { Camera, Wallet, User, Globe, HelpCircle, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<'scan' | 'wallet' | 'profil'>('scan');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Read cached login sessions
    const cached = localStorage.getItem('cirkel_user');
    if (cached) {
      try {
        const profile = JSON.parse(cached) as UserProfile;
        if (profile && profile.isLoggedIn) {
          setUser(profile);
        }
      } catch (err) {
        console.error("Error reading login cache:", err);
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
      const { logoutUser } = await import('../lib/firebase');
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
      import('../lib/firebase').then(({ saveUserProfileToStore }) => {
        saveUserProfileToStore(result.id, result).catch(err => {
          console.warn("Could not replicate user update to Firestore:", err);
        });
      });

      return result;
    });
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
    <div className="bg-[#DFD9CE] min-h-screen w-full flex items-center justify-center p-0 md:p-6 font-sans antialiased text-primary selection:bg-accent selection:text-primary">
      
      {/* simulated mobile preview card to make the applet feel incredibly organic and polished */}
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
              onClick={() => setLanguage('da')}
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
              onClick={() => setLanguage('en')}
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
                />
              )}
              {tab === 'wallet' && (
                <WalletTab 
                  user={user} 
                  onChangeUser={handleUpdateUser} 
                />
              )}
              {tab === 'profil' && (
                <ProfilTab 
                  user={user} 
                  onChangeUser={handleUpdateUser} 
                  onLogout={handleLogout} 
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom tab bar exactly like standard mobile bar */}
        <nav className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-250 py-3.5 px-6 flex justify-around items-center z-30 shadow-[0_-5px_15px_rgba(0,0,0,0.02)] rounded-t-3xl md:rounded-none">
          
          <motion.button
            id="tab-scan-btn"
            onClick={() => setTab('scan')}
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
            onClick={() => setTab('wallet')}
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
            onClick={() => setTab('profil')}
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

        </nav>

      </div>
    </div>
  );
}
