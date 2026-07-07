import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Fingerprint, Lock, Unlock, ShieldCheck, Camera, Sparkles, RefreshCw, AlertCircle, RefreshCw as RotateCw } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { triggerHaptic, HapticPattern } from '../lib/haptics';

interface BiometricPromptProps {
  onUnlock: () => void;
  onCancel: () => void;
}

export default function BiometricPrompt({ onUnlock, onCancel }: BiometricPromptProps) {
  const { language, t } = useLanguage();
  const [authMode, setAuthMode] = useState<'faceid' | 'fingerprint'>('faceid');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'failed'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [fingerprintProgress, setFingerprintProgress] = useState(0);
  
  // Timer references for custom animations
  const scanInterval = useRef<NodeJS.Timeout | null>(null);
  const scanTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Reset state on auth mode switch
    cleanup();
    setStatus('idle');
    setFingerprintProgress(0);
    if (authMode === 'faceid') {
      setStatusMessage(language === 'da' ? 'Klar til ansigtsscanning' : 'Ready for face scan');
    } else {
      setStatusMessage(language === 'da' ? 'Tryk og hold på sensoren' : 'Touch and hold the sensor');
    }
    return () => cleanup();
  }, [authMode, language]);

  const cleanup = () => {
    if (scanInterval.current) clearInterval(scanInterval.current);
    if (scanTimeout.current) clearTimeout(scanTimeout.current);
  };

  // Face ID Trigger (automated scan feeling for Face ID)
  const handleStartFaceIdScan = () => {
    if (status === 'scanning' || status === 'success') return;
    
    triggerHaptic(HapticPattern.LIGHT_TAP);
    setStatus('scanning');
    setStatusMessage(language === 'da' ? 'Aktiverer infrarødt kamera...' : 'Activating depth camera...');

    let step = 0;
    const messagesDa = [
      'Søger efter ansigt...',
      'Korrigerer modlysstyrke...',
      'Matcher ansigtspunkter (30.000 punkter)...',
      'Bekræfter modtagers nøglefelt...',
      'Godkendt!'
    ];
    const messagesEn = [
      'Searching for face...',
      'Adjusting depth contrast...',
      'Matching facial mesh (30,000 points)...',
      'Confirming biometric key map...',
      'Verified!'
    ];

    scanInterval.current = setInterval(() => {
      step++;
      if (step < messagesDa.length) {
        setStatusMessage(language === 'da' ? messagesDa[step] : messagesEn[step]);
        triggerHaptic(HapticPattern.LIGHT_TAP);
      }
    }, 450);

    scanTimeout.current = setTimeout(() => {
      cleanup();
      setStatus('success');
      setStatusMessage(language === 'da' ? 'Identitet verificeret! Låser op...' : 'Identity verified! Unlocking...');
      triggerHaptic(HapticPattern.SCAN_SUCCESS);
      
      // Delay unlock callback briefly for high fidelity UX
      setTimeout(() => {
        onUnlock();
      }, 700);
    }, 2200);
  };

  // Fingerprint Interaction Event Handlers (Touch & Hold or Click-to-Scan)
  const handleFingerprintDown = () => {
    if (status === 'success' || status === 'scanning') return;

    triggerHaptic(HapticPattern.HEAVY_TAP);
    setStatus('scanning');
    setFingerprintProgress(0);
    setStatusMessage(language === 'da' ? 'Skan påbegyndt...' : 'Scan started...');

    let progress = 0;
    scanInterval.current = setInterval(() => {
      progress += 5;
      if (progress > 100) progress = 100;
      setFingerprintProgress(progress);

      // Play soft tick and update status based on scan threshold
      if (progress % 20 === 0 && progress < 100) {
        triggerHaptic(HapticPattern.LIGHT_TAP);
        
        if (progress === 20) {
          setStatusMessage(language === 'da' ? 'Læser fingeraftryksriller...' : 'Reading friction ridges...');
        } else if (progress === 40) {
          setStatusMessage(language === 'da' ? 'Kortlægger minutiapunkter...' : 'Mapping minutiae points...');
        } else if (progress === 60) {
          setStatusMessage(language === 'da' ? 'Genererer kryptografisk hash...' : 'Generating secure hash...');
        } else if (progress === 85) {
          setStatusMessage(language === 'da' ? 'Krypterer session...' : 'Encrypting session...');
        }
      }

      if (progress === 100) {
        cleanup();
        setStatus('success');
        setStatusMessage(language === 'da' ? 'Skan godkendt! Åbner boks...' : 'Fingerprint matching! Unlocking...');
        triggerHaptic(HapticPattern.SCAN_SUCCESS);
        
        setTimeout(() => {
          onUnlock();
        }, 700);
      }
    }, 80);
  };

  const handleFingerprintRelease = () => {
    if (status === 'success') return;
    
    if (fingerprintProgress < 100) {
      cleanup();
      setStatus('idle');
      setFingerprintProgress(0);
      setStatusMessage(language === 'da' ? 'Scanning afbrudt. Hold sensoren nede!' : 'Scan interrupted. Keep holding the sensor!');
      triggerHaptic(HapticPattern.ERROR_PATTERN);
    }
  };

  const forceDemoUnlock = () => {
    triggerHaptic(HapticPattern.SCAN_SUCCESS);
    setStatus('success');
    setStatusMessage('Bypass - Sikkerhedsgodkendt!');
    setTimeout(() => {
      onUnlock();
    }, 400);
  };

  return (
    <div id="biometric-login-box" className="min-h-[580px] bg-slate-900 text-white rounded-3xl p-6 flex flex-col justify-between items-center relative overflow-hidden shadow-2xl border border-slate-800">
      
      {/* Background ambient glow circles */}
      <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-slate-800/40 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute bottom-[-50px] right-[-50px] w-48 h-48 bg-indigo-950/40 rounded-full blur-2xl pointer-events-none" />

      {/* Security Status Header */}
      <div className="w-full flex justify-between items-center z-10">
        <button 
          onClick={() => {
            triggerHaptic(HapticPattern.LIGHT_TAP);
            onCancel();
          }}
          className="text-[10px] uppercase font-black tracking-widest text-[#C8F24A] hover:opacity-85 transition-opacity px-2.5 py-1 bg-slate-850 rounded-xl"
        >
          {language === 'da' ? '← Tilbage' : '← Cancel'}
        </button>
        <span className="text-[8px] font-black tracking-widest text-[#C8F24A] bg-[#C8F24A]/10 border border-[#C8F24A]/25 px-2.5 py-1 rounded-full uppercase flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" /> CRYPTO ENCLAVE
        </span>
      </div>

      {/* Main vault icon and description */}
      <div className="flex flex-col items-center gap-2 mt-4 z-10 px-4 text-center">
        <div className="p-3 bg-indigo-950/50 border border-indigo-500/10 rounded-2xl mb-1 shadow-inner relative">
          <AnimatePresence mode="wait">
            {status === 'success' ? (
              <motion.div
                key="unlock"
                initial={{ rotate: -45, scale: 0.8 }}
                animate={{ rotate: 0, scale: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="text-[#C8F24A]"
              >
                <Unlock className="w-8 h-8" />
              </motion.div>
            ) : (
              <motion.div
                key="lock"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="text-indigo-400"
              >
                <Lock className="w-8 h-8" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <h4 className="text-sm font-black uppercase tracking-tight text-white flex items-center justify-center gap-1.5 leading-none">
          {language === 'da' ? 'Sikker Cirkel-Boks' : 'Secure Cirkel Wallet'}
        </h4>
        <p className="text-[10px] text-gray-400 leading-relaxed max-w-[240px] font-medium">
          {language === 'da' 
            ? 'Miljøregnskab, pantesaldo og bankudbetalinger er beskyttet med krypteret biometri.'
            : 'Environmental accounts, deposit balance, and bank payouts are protected by encrypted biometrics.'}
        </p>
      </div>

      {/* Biometric Scan Arena */}
      <div className="my-6 flex flex-col justify-center items-center w-full min-h-[190px] z-10 relative">
        <AnimatePresence mode="wait">
          {authMode === 'faceid' ? (
            <motion.div
              key="faceid-arena"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-4"
            >
              {/* iOS style face detection mesh visual */}
              <div 
                onClick={handleStartFaceIdScan}
                className={`relative w-36 h-36 border-2 rounded-3xl flex items-center justify-center cursor-pointer group transition-all overflow-hidden ${
                  status === 'scanning' ? 'border-[#C8F24A] bg-[#C8F24A]/5' : 
                  status === 'success' ? 'border-emerald-400 bg-emerald-400/5' : 
                  'border-indigo-500/25 bg-slate-850/50 hover:border-indigo-500/50'
                }`}
              >
                {/* Visual grid brackets */}
                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-indigo-400" />
                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-indigo-400" />
                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-indigo-400" />
                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-indigo-400" />
                
                {status === 'scanning' && (
                  <>
                    {/* Glowing animated scan bar line */}
                    <motion.div 
                      className="absolute left-0 right-0 h-0.5 bg-[#C8F24A] shadow-[0_0_12px_#C8F24A] z-10"
                      animate={{ top: ['15%', '85%', '15%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <motion.div 
                      className="absolute inset-0 bg-[#C8F24A]/5 flex items-center justify-center"
                      animate={{ opacity: [0.1, 0.4, 0.1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    />
                  </>
                )}

                {status === 'success' ? (
                  <motion.div 
                    initial={{ scale: 0, rotate: 180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="text-emerald-400"
                  >
                    <ShieldCheck className="w-12 h-12" />
                  </motion.div>
                ) : (
                  <Camera className={`w-12 h-12 transition-all ${status === 'scanning' ? 'text-[#C8F24A] scale-105' : 'text-indigo-400 group-hover:scale-105'}`} />
                )}
              </div>

              {status === 'idle' && (
                <button
                  onClick={handleStartFaceIdScan}
                  className="bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-[#C8F24A] font-black text-[9.5px] uppercase tracking-widest px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-1.5 focus:outline-none"
                >
                  <Sparkles className="w-3.5 h-3.5" /> {language === 'da' ? 'Start Ansigtsskan' : 'Start Face ID Scan'}
                </button>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="fingerprint-arena"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-4 w-full"
            >
              {/* Circular tactile sensor with exact active-state listener triggers */}
              <div className="relative flex items-center justify-center">
                {/* Radial progress track */}
                <svg className="w-36 h-36 transform -rotate-90">
                  <circle
                    cx="72"
                    cy="72"
                    r="60"
                    stroke="#1e293b"
                    strokeWidth="4"
                    fill="transparent"
                  />
                  <motion.circle
                    cx="72"
                    cy="72"
                    r="60"
                    stroke={status === 'success' ? '#34d399' : '#C8F24A'}
                    strokeWidth="5"
                    fill="transparent"
                    strokeDasharray={377}
                    strokeDashoffset={377 - (377 * fingerprintProgress) / 100}
                    transition={{ ease: 'easeOut' }}
                  />
                </svg>

                {/* Center Fingerprint Pad button */}
                <button
                  onMouseDown={handleFingerprintDown}
                  onMouseUp={handleFingerprintRelease}
                  onMouseLeave={handleFingerprintRelease}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    handleFingerprintDown();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    handleFingerprintRelease();
                  }}
                  className={`absolute w-24 h-24 rounded-full flex items-center justify-center transition-all outline-none focus:outline-none select-none touch-none ${
                    status === 'scanning' ? 'bg-[#C8F24A]/15 scale-95 shadow-inner border border-[#C8F24A]/25 text-[#C8F24A]' : 
                    status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 
                    'bg-slate-800 text-indigo-400 border border-slate-705 shadow-md active:scale-95'
                  }`}
                >
                  <Fingerprint className={`w-12 h-12 transition-transform duration-300 ${status === 'scanning' ? 'scale-110 animate-pulse' : ''}`} />
                </button>
              </div>

              <span className="text-[8.5px] font-semibold text-indigo-300 uppercase tracking-widest animate-pulse">
                {status === 'scanning' 
                  ? `${fingerprintProgress}%` 
                  : (language === 'da' ? 'Hold sensoren nede' : 'Press & Hold Sensor')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Real-time scanning feedback logs or initial guide */}
        <div className="absolute bottom-[-15px] inset-x-0 text-center px-4">
          <span className={`text-[10px] font-mono leading-none tracking-tight block transition-all ${
            status === 'success' ? 'text-emerald-400 font-bold' : 
            status === 'failed' ? 'text-rose-400 font-bold' : 
            status === 'scanning' ? 'text-[#C8F24A] font-bold' : 'text-slate-400 font-medium'
          }`}>
            {statusMessage}
          </span>
        </div>
      </div>

      {/* Footer controls: selection switch & instant master bypass option */}
      <div className="w-full flex flex-col gap-4 items-center mt-4 z-10">
        
        {/* Toggle option buttons */}
        <div className="bg-slate-850 p-1 rounded-xl border border-slate-800 flex gap-1 text-[9px] font-black uppercase tracking-wider">
          <button
            onClick={() => {
              triggerHaptic(HapticPattern.LIGHT_TAP);
              setAuthMode('faceid');
            }}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              authMode === 'faceid' 
                ? 'bg-[#C8F24A] text-slate-950 font-black shadow-sm' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'da' ? 'Face ID 📷' : 'Face ID 📷'}
          </button>
          <button
            onClick={() => {
              triggerHaptic(HapticPattern.LIGHT_TAP);
              setAuthMode('fingerprint');
            }}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              authMode === 'fingerprint' 
                ? 'bg-[#C8F24A] text-slate-950 font-black shadow-sm' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'da' ? 'Fingeraftryk 👆' : 'Fingerprint 👆'}
          </button>
        </div>

        {/* Bypass / Passcode trigger */}
        <div className="flex gap-4 items-center justify-center border-t border-slate-850 pt-3.5 w-full">
          <button
            onClick={forceDemoUnlock}
            className="text-[9px] font-black uppercase tracking-widest text-[#C8F24A] hover:underline focus:outline-none opacity-60 hover:opacity-100 transition-opacity"
          >
            {language === 'da' ? '[ Bypass Biometri ]' : '[ Bypass Biometrics ]'}
          </button>
        </div>
      </div>
    </div>
  );
}
