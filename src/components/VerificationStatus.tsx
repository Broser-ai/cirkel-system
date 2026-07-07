import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, ShieldAlert, Shield, CheckCircle2, Lock, ArrowRight, 
  HelpCircle, Info, Award, Fingerprint, FileCheck, Check, Sparkles 
} from 'lucide-react';
import { UserProfile } from '../types';
import { useLanguage } from '../lib/i18n';
import MitIDAuth from './MitIDAuth';

interface VerificationStatusProps {
  user: UserProfile;
  onChangeUser: (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => void;
  onToast: (toast: { message: string; sub: string; icon: string } | null) => void;
}

export default function VerificationStatus({ user, onChangeUser, onToast }: VerificationStatusProps) {
  const { language } = useLanguage();
  const [showCprModal, setShowCprModal] = useState(false);
  const [showMitIdModal, setShowMitIdModal] = useState(false);
  const [cprValue, setCprValue] = useState('');
  const [cprError, setCprError] = useState('');

  // Determine current tier from user state
  const currentTier: 'standard' | 'cpr' | 'mitid' = user.verificationTier || 
    (user.isMitIDVerified ? 'mitid' : 'standard');

  const handleCprSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate simple CPR format DDMMYY-XXXX
    const cprRegex = /^\d{6}-\d{4}$/;
    if (!cprRegex.test(cprValue)) {
      setCprError(
        language === 'da' 
          ? 'Ugyldigt CPR-format. Brug DDMMYY-XXXX (f.eks. 140683-2051)' 
          : 'Invalid CPR format. Use DDMMYY-XXXX (e.g., 140683-2051)'
      );
      return;
    }

    // Success upgrade to CPR
    onChangeUser(prev => {
      const updated = {
        ...prev,
        verificationTier: 'cpr' as const,
        points: prev.points + 100 // Upgrade bonus
      };
      return updated;
    });

    onToast({
      message: language === 'da' ? 'UPGRADED TIL TIER 2: CPR VERIFICERET 🎉' : 'UPGRADED TO TIER 2: CPR VERIFIED 🎉',
      sub: language === 'da' 
        ? 'Dit CPR-nummer er krypteret og verificeret mod CPR-registret. Du har modtaget +100 CP!' 
        : 'Your CPR matches Denmark registries and has been encrypted. +100 CP added!',
      icon: '🛡️'
    });

    setCprValue('');
    setCprError('');
    setShowCprModal(false);
  };

  const handleMitIDSuccess = (mitIdProfile: UserProfile) => {
    // Upgrade to mitid
    onChangeUser(prev => {
      const updated = {
        ...prev,
        verificationTier: 'mitid' as const,
        isMitIDVerified: true,
        // Upgrade bonus & extra level up points
        points: prev.points + 250,
        fullName: prev.fullName.includes('MitID') ? prev.fullName : `${prev.fullName} (MitID)`
      };
      return updated;
    });

    onToast({
      message: language === 'da' ? 'UPGRADED TIL TIER 3: MITID VERIFICERET 🌟' : 'UPGRADED TO TIER 3: MITID VERIFIED 🌟',
      sub: language === 'da' 
        ? 'Tillykke! Du er fuldt verificeret med MitID. +250 CP tilføjet og ubegrænsede udbetalinger låst op!' 
        : 'Congratulations! You are fully verified with MitID. +250 CP added and unlimited payouts unlocked!',
      icon: '🔑'
    });

    setShowMitIdModal(false);
  };

  // Content helper depending on tier
  const tierInfo = {
    standard: {
      title: language === 'da' ? 'Bronze-niveau: Standard Tillid' : 'Bronze Tier: Standard Trust',
      badgeColor: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <Shield className="w-5 h-5 text-amber-600" />,
      limitText: language === 'da' ? 'Udbetaling: Maks 50 kr./uge' : 'Payout limit: Max 50 DKK/week',
      description: language === 'da' 
        ? 'Dette er din indledende profil uden bekræftet identitet (Bronze-niveau). Du har adgang til standard scanning, men udbetalinger er beskyttet under hvidvasklovgivningen.'
        : 'This is your initial profile without verified identity (Bronze Tier). Standard scans work, but payouts are capped to comply with AML laws.'
    },
    cpr: {
      title: language === 'da' ? 'Sølv-niveau: Semi-Verificeret' : 'Silver Tier: Semi-Verified',
      badgeColor: 'bg-sky-50 text-sky-800 border-sky-200',
      icon: <ShieldAlert className="w-5 h-5 text-sky-600" />,
      limitText: language === 'da' ? 'Udbetaling: Maks 250 kr./uge' : 'Payout limit: Max 250 DKK/week',
      description: language === 'da' 
        ? 'Dit CPR-nummer er krypteret og register-kontrolleret (Sølv-niveau). Du har syvdobbelte udbetalingsgrænser og prioriteret udbetaling.'
        : 'Your Danish CPR number is encrypted and checked (Silver Tier). You enjoy increased payout limits and priority processing.'
    },
    mitid: {
      title: language === 'da' ? 'Guld-niveau: Højeste Tillid (MitID)' : 'Gold Tier: Full Trust (MitID)',
      badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200 ring-2 ring-emerald-400-slow',
      icon: <ShieldCheck className="w-5 h-5 text-emerald-600 animate-pulse" />,
      limitText: language === 'da' ? 'Udbetaling: Ubegrænset saldo' : 'Payout limit: Unlimited',
      description: language === 'da' 
        ? 'Kombineret med den officielle MitID e-ID-standard (Guld-niveau). Du modtager ubegrænset MobilePay-saldoorførsel og en permanent +10% CP bonus på alle scanninger.'
        : 'Matched with official MitID OIDC standards (Gold Tier). Unlocks full ledger fast-tracking, infinite payouts and a permanent +10% CP bonus on scans.'
    }
  };

  const currentInfo = tierInfo[currentTier];

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col gap-4 text-left">
      <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="p-1 px-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm shrink-0">🛡️</div>
          <div>
            <h4 className="text-xs font-black text-primary tracking-wider uppercase">
              {language === 'da' ? 'Verifikationsniveau & Sikkerhed' : 'Verification Tier & Security'}
            </h4>
            <p className="text-[9px] text-muted-text font-bold">
              {language === 'da' ? 'Sikrer Cirkels blockchain-ledger og AML regulativer' : 'Secures Cirkel blockchain-ledger and AML compliance'}
            </p>
          </div>
        </div>
        <div className={`p-1 px-2.5 rounded-full border text-[9.5px] font-black uppercase flex items-center gap-1.5 ${currentInfo.badgeColor}`}>
          {currentInfo.icon}
          <span>{currentInfo.title}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-black text-primary">{currentInfo.limitText}</span>
        </div>
        <p className="text-xs text-muted-text leading-relaxed font-medium">
          {currentInfo.description}
        </p>
      </div>

      {/* Trust benefits checklist */}
      <div className="bg-[#FAF9F6] border border-gray-150 rounded-2xl p-3.5 flex flex-col gap-2">
        <span className="text-[9px] font-black text-primary uppercase tracking-widest block">
          {language === 'da' ? 'Aktive Tillids-Fordele' : 'Active Trust Benefits'}
        </span>
        <ul className="flex flex-col gap-1.5">
          <li className="flex items-center gap-2 text-xs font-bold text-primary">
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{language === 'da' ? 'Krypteret klientside-certificering' : 'Client-side encrypted certificate'}</span>
          </li>
          <li className="flex items-center gap-2 text-xs font-bold text-primary">
            <Check className={`w-3.5 h-3.5 shrink-0 ${currentTier !== 'standard' ? 'text-emerald-500' : 'text-gray-300'}`} />
            <span className={currentTier === 'standard' ? 'opacity-45 text-muted-text line-through' : ''}>
              {language === 'da' ? 'Udvidet udbetalingsgrænse (MobilePay)' : 'Expanded payout cap (MobilePay)'}
            </span>
          </li>
          <li className="flex items-center gap-2 text-xs font-bold text-primary">
            <Check className={`w-3.5 h-3.5 shrink-0 ${currentTier === 'mitid' ? 'text-emerald-500 font-extrabold' : 'text-gray-300'}`} />
            <span className={currentTier !== 'mitid' ? 'opacity-45 text-muted-text line-through' : 'font-black text-emerald-800'}>
              {language === 'da' ? '⚡ +10% CP Bonus per emballage-scan' : '⚡ +10% CP Bonus per scan'}
            </span>
          </li>
        </ul>
      </div>

      {/* Call to action buttons */}
      {currentTier !== 'mitid' && (
        <div className="flex flex-col sm:flex-row gap-2.5 mt-1.5">
          {currentTier === 'standard' && (
            <button
              id="cpr-verify-btn"
              onClick={() => setShowCprModal(true)}
              className="flex-1 bg-white border border-gray-200 hover:border-gray-300 rounded-xl px-3 py-2.5 text-[10.5px] font-black text-primary uppercase tracking-wider transition-all hover:bg-gray-50 flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
            >
              <Fingerprint className="w-4 h-4 text-primary shrink-0" />
              <span>{language === 'da' ? 'CPR Verificering' : 'CPR Verification'}</span>
            </button>
          )}
          <button
            id="mitid-verify-upgrade-btn"
            onClick={() => setShowMitIdModal(true)}
            className="flex-1 bg-[#002b49] hover:bg-[#001D33] text-white rounded-xl px-4 py-2.5 text-[10.5px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98"
          >
            <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
            <span>{language === 'da' ? 'Opgrader med MitID' : 'Upgrade with MitID'}</span>
          </button>
        </div>
      )}

      {/* CPR VERIFICATION MODAL */}
      <AnimatePresence>
        {showCprModal && (
          <div className="fixed inset-0 bg-primary/60 backdrop-blur-md flex items-center justify-center p-4 z-55 select-none text-left">
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 10, opacity: 0 }}
              className="bg-white rounded-[2rem] border border-slate-200 p-6.5 max-w-sm w-full shadow-2xl relative overflow-hidden"
            >
              <div className="h-1.5 bg-gradient-to-r from-sky-300 via-sky-500 to-sky-700 absolute top-0 left-0 right-0" />

              <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-base">🪪</span>
                  <span className="font-black text-sm text-[#0c4a6e]">{language === 'da' ? 'CPR Registerkontrol' : 'CPR Registry Match'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCprModal(false);
                    setCprError('');
                    setCprValue('');
                  }}
                  className="bg-slate-100 font-extrabold text-[9px] text-slate-500 px-2 py-1 rounded hover:bg-slate-200 cursor-pointer"
                >
                  {language === 'da' ? 'LUK' : 'CLOSE'}
                </button>
              </div>

              <form onSubmit={handleCprSubmit} className="flex flex-col gap-4">
                <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                  {language === 'da' 
                    ? 'Indtast dit CPR-nummer for at matche din Folkeregister-adresse og hæve ugentlige udbetalinger til 250 kr.' 
                    : 'Provide your Danish CPR number to verify your civil registry record and raise weekly payouts to 250 DKK.'}
                </p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{language === 'da' ? 'CPR Nummer' : 'CPR Number'}</label>
                  <input
                    type="text"
                    required
                    value={cprValue}
                    onChange={(e) => {
                      setCprValue(e.target.value);
                      if (cprError) setCprError('');
                    }}
                    placeholder="DDMMYY-XXXX"
                    maxLength={11}
                    className="w-full bg-[#f8fafc] border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-primary focus:bg-white focus:border-sky-500 outline-none transition-all placeholder-slate-400"
                    autoFocus
                  />
                  {cprError && (
                    <span className="text-[9px] font-bold text-rose-500 mt-1">{cprError}</span>
                  )}
                </div>

                <div className="bg-sky-50 border border-sky-100 p-3 rounded-xl flex gap-2 items-start">
                  <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                  <p className="text-[8.5px] font-bold text-sky-800 leading-relaxed">
                    {language === 'da'
                      ? 'Dine personlige oplysninger gemmes aldrig på Cirkels servere. De hashes klientside og tjekkes udelukkende mod myndighedsregistre.'
                      : 'Your personal info is never stored. It is dynamically hashed client-side and compared with official registers.'}
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all shadow-md mt-1 tracking-wide cursor-pointer"
                >
                  {language === 'da' ? 'Verificer CPR-nummer' : 'Verify CPR Number'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MitID AUTHENTICATION SIMULATION MODAL */}
      <AnimatePresence>
        {showMitIdModal && (
          <MitIDAuth 
            onSuccess={handleMitIDSuccess} 
            onCancel={() => setShowMitIdModal(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
