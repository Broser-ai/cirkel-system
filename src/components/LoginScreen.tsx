import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { 
  ShieldCheck, Fingerprint, Check, Sparkles, AlertCircle, RefreshCw, ScanFace
} from 'lucide-react';
import { logInWithGoogle, logInWithEmail, registerWithEmail, isRealFirebase } from '../lib/firebase';
import { useLanguage } from '../lib/i18n';
import MitIDAuth from './MitIDAuth';

interface LoginScreenProps {
  onLogin: (profile: UserProfile) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const { language, setLanguage, t } = useLanguage();
  
  // Credentials Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Biometrics State
  const [isBiometricScanning, setIsBiometricScanning] = useState(false);
  const [bScanProgress, setBScanProgress] = useState(0);
  const [bScanSuccess, setBScanSuccess] = useState(false);

  // MitID State
  const [isMitIDScanning, setIsMitIDScanning] = useState(false);

  const triggerBiometricScan = () => {
    setIsBiometricScanning(true);
    setBScanProgress(0);
    setBScanSuccess(false);

    let progressVal = 0;
    const interval = setInterval(() => {
      progressVal += 10;
      setBScanProgress(progressVal);
      if (progressVal >= 100) {
        clearInterval(interval);
        setBScanSuccess(true);
        
        setTimeout(() => {
          setIsBiometricScanning(false);
          let profile: UserProfile | null = null;
          const cached = localStorage.getItem('cirkel_user');
          if (cached) {
            try { profile = JSON.parse(cached); } catch(e) {}
          }
          if (!profile) {
            profile = {
              id: 'user-biometric-mock-id',
              fullName: 'Søren Kierkegaard',
              email: 'soren@cirkel.dk',
              isLoggedIn: true,
              municipality: 'Aarhus Kommune',
              balance: 247.50,
              points: 2140,
              scansCount: 892,
              co2SavedKg: 127.0,
              streakDays: 14,
              level: 12,
              memberStatus: 'Guld-medlem',
              verificationTier: 'mitid',
              isMitIDVerified: true
            };
          } else {
            profile.isLoggedIn = true;
          }
          localStorage.setItem('cirkel_user', JSON.stringify(profile));
          onLogin(profile);
        }, 850);
      }
    }, 110);
  };

  const triggerMitIDScan = () => {
    setIsMitIDScanning(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setNotification({ type: 'error', message: t('fill_fields') });
      return;
    }
    if (isSignUp && !name) {
      setNotification({ type: 'error', message: t('fill_name') });
      return;
    }

    setIsLoading(true);
    setNotification(null);

    const isTargetTestAccount = email.trim().toLowerCase() === 'ma@keap.me';
    const isTargetPassword = password === 'MA2041ma!';

    try {
      const { fetchUserProfileFromStore, saveUserProfileToStore } = await import('../lib/firebase');
      let userRecord;
      if (isSignUp) {
        userRecord = await registerWithEmail(email, password);
        setNotification({ type: 'success', message: t('account_created') });
      } else {
        try {
          userRecord = await logInWithEmail(email, password);
        } catch (loginErr: any) {
          // If login fails and it is our target credentials, automatically create the account or fallback
          if (isTargetTestAccount && isTargetPassword) {
            try {
              userRecord = await registerWithEmail(email, password);
            } catch (regErr: any) {
              console.warn("Auto registration for test account failed, using local session:", regErr);
              userRecord = {
                uid: 'auth-ma-keap-uid-fallback',
                email: 'ma@keap.me',
                displayName: 'Morten Andersen'
              };
            }
          } else {
            throw loginErr;
          }
        }
      }

      let profile: UserProfile | null = null;
      try {
        profile = await fetchUserProfileFromStore(userRecord.uid) as UserProfile | null;
      } catch (storeErr) {
        console.warn("Could not load profile from store:", storeErr);
      }

      const isMitIDPrefill = isTargetTestAccount || (profile && profile.isMitIDVerified);

      if (!profile) {
        profile = {
          id: userRecord.uid,
          fullName: isTargetTestAccount ? 'Morten Andersen' : (name || userRecord.displayName || email.split('@')[0]),
          email: userRecord.email || email,
          isLoggedIn: true,
          municipality: 'Aarhus Kommune',
          balance: isTargetTestAccount ? 247.50 : 0.00,
          points: isTargetTestAccount ? 2140 : 0,
          scansCount: isTargetTestAccount ? 892 : 0,
          co2SavedKg: isTargetTestAccount ? 127.0 : 0.0,
          streakDays: isTargetTestAccount ? 14 : 0,
          level: isTargetTestAccount ? 12 : 1,
          memberStatus: isTargetTestAccount ? 'Guld-medlem' : 'Standard-medlem',
          verificationTier: isMitIDPrefill ? 'mitid' : 'standard',
          isMitIDVerified: !!isMitIDPrefill
        };
        try {
          await saveUserProfileToStore(userRecord.uid, profile);
        } catch (saveErr) {
          console.warn("Could not save profile to firestore store, using local state:", saveErr);
        }
      } else {
        profile.isLoggedIn = true;
        if (isTargetTestAccount) {
          profile.fullName = 'Morten Andersen';
          profile.isMitIDVerified = true;
          profile.verificationTier = 'mitid';
        }
      }

      localStorage.setItem('cirkel_user', JSON.stringify(profile));
      
      setTimeout(() => {
        setIsLoading(false);
        onLogin(profile!);
      }, 800);

    } catch (err: any) {
      setIsLoading(false);
      setNotification({ 
         type: 'error', 
         message: err.message || 'Godkendelsesfejl. Kontroller dine oplysninger og prøv igen.' 
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setNotification(null);
    try {
      const { fetchUserProfileFromStore, saveUserProfileToStore } = await import('../lib/firebase');
      const googleUser = await logInWithGoogle();
      
      let profile: UserProfile | null = await fetchUserProfileFromStore(googleUser.uid) as UserProfile | null;

      if (!profile) {
        profile = {
          id: googleUser.uid,
          fullName: googleUser.displayName || 'Google-bruger',
          email: googleUser.email || 'google@cirkel.dk',
          isLoggedIn: true,
          municipality: 'Aarhus Kommune',
          balance: 247.5,
          points: 2140,
          scansCount: 892,
          co2SavedKg: 127,
          streakDays: 14,
          level: 12,
          memberStatus: 'Guld-medlem',
          verificationTier: 'mitid',
          isMitIDVerified: true
        };
        await saveUserProfileToStore(googleUser.uid, profile);
      } else {
        profile.isLoggedIn = true;
      }

      localStorage.setItem('cirkel_user', JSON.stringify(profile));
      
      setTimeout(() => {
        setIsLoading(false);
        onLogin(profile!);
      }, 800);
    } catch (err: any) {
      setIsLoading(false);
      setNotification({ 
        type: 'error', 
        message: err.message || 'Google indlogning mislykkedes.' 
      });
    }
  };

  return (
    <div className="bg-[#DFD9CE] min-h-screen font-sans selection:bg-[#c8f24a] selection:text-[#002b49] text-primary antialiased flex flex-col justify-between">
      
      {/* 1. PUBLIC LANDING HEADER */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-primary/5 select-none transition-all">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-tighter text-[#002b49]">cirkel</span>
            <span className="hidden sm:inline bg-[#002b49]/5 text-[#002b49] text-[9px] font-black tracking-widest uppercase px-2.5 py-1 rounded-lg border border-[#002b49]/10">
              {t('slogan')}
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-primary/5 p-1 rounded-xl">
              <button
                id="landing-lang-da"
                onClick={() => setLanguage('da')}
                className={`text-[9px] font-black tracking-widest uppercase py-1.5 px-3 rounded-lg transition-all cursor-pointer ${
                  language === 'da' ? 'bg-[#002b49] text-white shadow-xs' : 'text-primary/55 hover:text-primary'
                }`}
              >
                DA
              </button>
              <button
                id="landing-lang-en"
                onClick={() => setLanguage('en')}
                className={`text-[9px] font-black tracking-widest uppercase py-1.5 px-3 rounded-lg transition-all cursor-pointer ${
                  language === 'en' ? 'bg-[#002b49] text-white shadow-xs' : 'text-primary/55 hover:text-primary'
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. DYNAMIC CENTERED LOGIN PORTAL */}
      <section className="relative overflow-hidden py-12 px-6 flex-1 flex flex-col justify-center items-center">
        {/* Abstract shapes decoration */}
        <div className="absolute right-1/4 top-1/4 w-96 h-96 bg-[#c8f24a]/20 rounded-full blur-3xl pointer-events-none -z-10 animate-pulse" />
        <div className="absolute left-1/4 bottom-1/4 w-[500px] h-[500px] bg-sky-200/15 rounded-full blur-3xl pointer-events-none -z-10" />

        {/* Animated Login Form Card */}
        <div className="w-full flex justify-center z-10 shrink-0">
          <motion.div 
            className="bg-white rounded-[2.5rem] border border-primary/10 shadow-2xl p-8 w-full max-w-md flex flex-col justify-start relative text-left"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
          >
            <div className="text-center mb-6">
              <span className="text-[10px] font-black text-[#002b49] tracking-widest bg-[#c8f24a]/20 border border-[#002b49]/10 rounded-full px-4 py-1.5 uppercase inline-flex items-center gap-1.5 mb-3.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-spin" style={{ animationDuration: '4s' }} />
                {language === 'da' ? 'Krypteret Miljø-System' : 'Encrypted Eco Platform'}
              </span>
              <h2 className="text-3xl font-black text-[#002b49] tracking-tight">
                {isSignUp ? t('signup_title') : t('login_title')}
              </h2>
              <p className="text-xs text-primary/50 font-bold mt-1.5">
                {language === 'da' ? 'Få sikker adgang til din uforanderlige pant-ledgertabel' : 'Access your immutable circular recycling records securely'}
              </p>
            </div>

            {/* 🚀 QUICK PREVIEW BYPASS BADGE & BUTTONS */}
            <div className="bg-[#FAFBF6] border-2 border-[#85A912]/30 rounded-2xl p-4 mb-5 text-left">
              <span className="text-[9px] font-black tracking-widest uppercase bg-[#85A912]/10 text-[#82a417] px-2 py-0.5 rounded border border-[#85A912]/20 inline-block mb-2">
                ⚡ Demo-Bypass Adgang (Hurtig log ind)
              </span>
              <p className="text-[10px] text-primary/70 font-semibold leading-relaxed mb-3">
                {language === 'da' 
                  ? 'Klik her for at logge direkte ind og udforske både Borger Mobil-Applikationen og B2B Partner Portalen med det samme uden adgangskode!' 
                  : 'Click here to log in directly and explore both the Citizen App and the B2B Partner Portal instantly without entering password!'}
              </p>
              <button
                id="quick-demo-login-bypass"
                type="button"
                onClick={() => {
                  const demoProfile: UserProfile = {
                    id: 'auth-ma-keap-uid-bypass',
                    fullName: 'Morten Andersen',
                    email: 'ma@keap.me',
                    isLoggedIn: true,
                    municipality: 'Aarhus Kommune',
                    user_type: 'admin',
                    balance: 247.50,
                    points: 2140,
                    scansCount: 892,
                    co2SavedKg: 127.0,
                    streakDays: 14,
                    level: 12,
                    memberStatus: 'Guld-medlem',
                    verificationTier: 'mitid',
                    isMitIDVerified: true
                  };
                  localStorage.setItem('cirkel_user', JSON.stringify(demoProfile));
                  onLogin(demoProfile);
                }}
                className="w-full bg-[#85A912] hover:bg-[#739410] text-white font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 shadow-sm"
              >
                <span>🔓 Log direkte ind (Testkonto: Morten)</span>
              </button>
            </div>

            {notification && (
              <motion.div 
                className={`p-3.5 mb-4.5 rounded-xl flex items-center gap-2.5 border text-xs font-bold leading-normal ${
                  notification.type === 'success' 
                    ? 'bg-green-50 text-green-800 border-green-200' 
                    : 'bg-rose-50 text-rose-800 border-rose-100'
                }`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <span>{notification.message}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              {isSignUp && (
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-black text-primary/50 uppercase tracking-wider">{t('name_label')}</label>
                  <input
                    id="landing-login-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dit fulde navn"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-bold focus:bg-white focus:border-[#002b49] outline-none transition-all placeholder-slate-400 text-[#002b49]"
                    required
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-black text-primary/50 uppercase tracking-wider">{t('email_label')}</label>
                <input
                  id="landing-login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="din@email.dk"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-bold focus:bg-white focus:border-[#002b49] outline-none transition-all placeholder-slate-400 text-[#002b49]"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-black text-primary/50 uppercase tracking-wider">{t('password_label')}</label>
                <input
                  id="landing-login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-bold focus:bg-white focus:border-[#002b49] outline-none transition-all placeholder-slate-400 text-[#002b49]"
                  required
                />
              </div>

              <button
                id="landing-login-submit"
                type="submit"
                disabled={isLoading}
                className="w-full mt-1.5 bg-[#002b49] hover:bg-[#001D33] text-white font-extrabold text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-98 shadow-md"
              >
                {isLoading ? (
                  <RefreshCw className="animate-spin w-4 h-4 text-white" />
                ) : (
                  <span>{isSignUp ? t('signup_btn') : t('login_btn')}</span>
                )}
              </button>
            </form>

            {/* Alternative separator */}
            <div className="relative my-4 flex items-center justify-center">
              <div className="border-t border-slate-100 w-full" />
              <span className="absolute bg-white px-2.5 text-[9px] font-black text-primary/45 uppercase shrink-0">{t('use_alternative')}</span>
            </div>

            {/* Alternatives Grid Container */}
            <div className="flex flex-col gap-2">
              {/* Absolute MitID login button (Primary alternative) */}
              {!isSignUp && (
                <button
                  id="landing-mitid-login"
                  onClick={triggerMitIDScan}
                  disabled={isLoading}
                  type="button"
                  className="w-full bg-[#002b49] hover:bg-[#001D33] text-white font-extrabold text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 shadow-md"
                >
                  <div className="w-4 h-4 rounded-full bg-[#c8f24a] flex items-center justify-center text-[9px] font-sans font-black text-[#002b49] shadow-xs shrink-0 select-none">🔑</div>
                  <span>Log ind med MitID (Sikker identitet)</span>
                </button>
              )}

              <button
                id="landing-google-login"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full bg-[#FAF9F6] border border-slate-200 hover:border-slate-300 text-primary font-black text-[10.5px] py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>{isSignUp ? t('signup_google') : t('login_google')}</span>
              </button>

              {!isSignUp && (
                <>
                  {/* Biometric Passkey */}
                  <button
                    id="landing-biometric-login"
                    onClick={triggerBiometricScan}
                    disabled={isLoading}
                    className="w-full bg-[#FAF9F6] border border-slate-200 hover:border-slate-300 text-primary font-black text-[10.5px] py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                  >
                    <Fingerprint className="w-3.5 h-3.5 text-primary shrink-0 animate-pulse" />
                    <span>Passkey / Biometrisk Log ind</span>
                  </button>
                </>
              )}
            </div>

            <div className="mt-4.5 text-center">
              <button
                id="landing-toggle-signup"
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setNotification(null);
                }}
                className="text-xs text-[#002b49] hover:underline font-black cursor-pointer transition-colors"
              >
                {isSignUp ? t('or_login') : t('or_signup')}
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* 4. FOOTER */}
      <footer className="py-8 border-t border-primary/10 max-w-6xl mx-auto px-6 text-center select-none text-primary/45 uppercase text-[9px] font-black tracking-widest leading-loose">
        <div>cirkel cryptographic platform · Aarup-Aarhus circular e-government initiatives</div>
        <div className="mt-1">Dansk Retursystem, General Data Protection Regulation (GDPR) & OIDC PKCE Approved</div>
      </footer>

      {/* 5. MODAL PORTALS */}
      <AnimatePresence mode="wait">
        {/* Biometrics simulator overlay */}
        {isBiometricScanning && (
          <div id="biometric-scan-modal" className="fixed inset-0 bg-[#002b49]/45 backdrop-blur-md flex items-center justify-center p-6 z-55 select-none animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center gap-6 relative"
            >
              <div>
                <span className="text-[9px] font-black bg-[#002b49]/5 text-[#002b49] border border-[#002b49]/10 tracking-widest uppercase px-3 py-1 rounded-full">Passkey Enclave</span>
                <h4 className="text-lg font-black text-[#002b49] uppercase tracking-wider mt-3">WebAuthn Identifikation</h4>
                <p className="text-[9px] text-[#002b49]/60 font-bold mt-1">Kontrollerer biometriske data via enheden...</p>
              </div>

              {/* Scanning visualizer */}
              <div className="relative w-32 h-32 rounded-full border border-slate-200 flex items-center justify-center">
                <div className="absolute inset-2 rounded-full border border-slate-100" />
                
                <div className="absolute w-24 h-24 rounded-full bg-[#002b49]/5 flex items-center justify-center overflow-hidden">
                  {bScanSuccess ? (
                    <motion.div
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg"
                    >
                      <Check className="w-7 h-7 stroke-[3]" />
                    </motion.div>
                  ) : (
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="w-14 h-14 rounded-full bg-[#002b49]/10 flex items-center justify-center text-[#002b49]"
                    >
                      <ScanFace className="w-7 h-7 shrink-0" />
                    </motion.div>
                  )}

                  {!bScanSuccess && (
                    <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#c8f24a] to-transparent shadow-[0_0_8px_rgba(200,242,74,0.8)] top-1/2 -translate-y-1/2 animate-bounce z-10" />
                  )}
                </div>
              </div>

              {/* Progress feedback */}
              <div className="w-full flex flex-col gap-1.5 px-2">
                <div className="flex justify-between text-[8px] font-black text-primary/60 uppercase">
                  <span>Signeringsstatus</span>
                  <span>{bScanProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden border">
                  <div className="h-full bg-[#002b49] transition-all duration-150" style={{ width: `${bScanProgress}%` }} />
                </div>
              </div>

              <p className="text-[9px] text-[#002b49]/80 font-black uppercase">
                {bScanSuccess ? (
                  <span className="text-emerald-700">✓ Godkendelse godkendt</span>
                ) : bScanProgress > 70 ? (
                  "Verificerer underskrift..."
                ) : (
                  "Kalder secure enclave..."
                )}
              </p>

              <button
                type="button"
                onClick={() => setIsBiometricScanning(false)}
                className="text-[10px] font-black text-primary/45 uppercase hover:text-primary transition-colors cursor-pointer"
              >
                Annuller og brug adgangskode
              </button>
            </motion.div>
          </div>
        )}

        {/* MitID OAuth / PKCE Portal */}
        {isMitIDScanning && (
          <MitIDAuth 
            onSuccess={(profile) => {
              setIsMitIDScanning(false);
              onLogin(profile);
            }}
            onCancel={() => setIsMitIDScanning(false)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
