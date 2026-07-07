import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, Transaction, RewardOffer, Voucher } from '../types';
import { CreditCard, ArrowUpRight, CheckCircle, Coins, Award, Sparkles, X, Check, Copy, Share2, Ticket, ChevronRight, HelpCircle, Gift } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

interface WalletTabProps {
  user: UserProfile;
  onChangeUser: (updates: Partial<UserProfile> | ((prev: UserProfile) => UserProfile)) => void;
}

const REWARD_OFFERS: RewardOffer[] = [
  // Coupons (Kuponer)
  { id: 'coop', emoji: '🛒', partner: 'Coop', description: '50 kr butiks-rabat', cost: 500, category: 'coupon' },
  { id: 'kaffe', emoji: '☕', partner: 'Original Coffee', description: 'Gratis øko kaffe', cost: 200, category: 'coupon' },
  { id: 'biograf', emoji: '🎬', partner: 'Nordisk Film', description: '1 fribillet', cost: 800, category: 'coupon' },
  { id: 'croissant', emoji: '🥐', partner: '7-Eleven', description: 'Friskbagt croissant', cost: 150, category: 'coupon' },
  { id: 'is', emoji: '🍦', partner: 'Paradis Is', description: '2 kugler øko-is', cost: 300, category: 'coupon' },

  // Codes (Rabatkoder)
  { id: 'rejsekort', emoji: '🚆', partner: 'DSB / Rejsekort', description: '25 kr rejse-saldo', cost: 250, category: 'code' },
  { id: 'spotify', emoji: '🎵', partner: 'Spotify Premium', description: '1 mdr fri musik', cost: 600, category: 'code' },
  { id: 'nextory', emoji: '📚', partner: 'Nextory E-bøger', description: '45 dages læsning', cost: 350, category: 'code' },
  { id: 'wolt', emoji: '🍔', partner: 'Wolt Food', description: '30 kr leverings-kode', cost: 400, category: 'code' },
  { id: 'tier', emoji: '🛴', partner: 'Tier Scooters', description: '2 køre-kreditter', cost: 180, category: 'code' },

  // Awards (Miljø-priser & Doneringer)
  { id: 'trae', emoji: '🌳', partner: 'Growing Trees', description: 'Plant et træ i DK', cost: 100, category: 'award' },
  { id: 'havplast', emoji: '🌊', partner: 'Ocean Cleanup', description: 'Fjern 1 kg hav-plast', cost: 150, category: 'award' },
  { id: 'regnskov', emoji: '🐒', partner: 'Verdens Skove', description: 'Beskyt 50m² regnskov', cost: 220, category: 'award' },
  { id: 'solcelle', emoji: '☀️', partner: 'Green Energy', description: 'Doner 10 m solenergi', cost: 80, category: 'award' },
  { id: 'champion_cert', emoji: '🏆', partner: 'Cirkel Clean', description: 'Grøn Ambassadør diplom', cost: 1200, category: 'award' },
];

const INITIAL_TXS: Transaction[] = [
  { id: 'tx-1', title: 'Plastik sorteret (Drop Point)', date: 'I dag', amount: '+0,75 kr' },
  { id: 'tx-2', title: 'Dåse scannet (Pant-automat)', date: 'I dag', amount: '+0,15 kr' },
  { id: 'tx-3', title: 'Bonus: 10 scanninger streak!', date: 'I går', amount: '+2,00 kr' },
  { id: 'tx-4', title: 'Glasflaske (Hjemme-foto)', date: 'I mandags', amount: '+0,15 kr' },
];

export default function WalletTab({ user, onChangeUser }: WalletTabProps) {
  const { t, language } = useLanguage();
  
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'coupon' | 'code' | 'award'>('all');

  const [txs, setTxs] = useState<Transaction[]>(() => {
    const cachedTxs = localStorage.getItem('cirkel_txs');
    return cachedTxs ? JSON.parse(cachedTxs) : INITIAL_TXS;
  });

  const [modalOffer, setModalOffer] = useState<RewardOffer | null>(null);
  const [mobilePayModal, setMobilePayModal] = useState(false);
  const [showTiersModal, setShowTiersModal] = useState(false);
  const [selectedVoucherForBarcode, setSelectedVoucherForBarcode] = useState<Voucher | null>(null);
  const [amountToPayout, setAmountToPayout] = useState(user.balance.toString());
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // States for Referral program code
  const [enteredRefCode, setEnteredRefCode] = useState('');
  const [appliedCodeError, setAppliedCodeError] = useState<string | null>(null);

  // Sync transactions state to localStorage
  useEffect(() => {
    localStorage.setItem('cirkel_txs', JSON.stringify(txs));
  }, [txs]);

  // Generate deterministic referral code if none is stored
  const referralCode = user.referralCode || `CIRKEL-${user.fullName.split(' ')[0].substring(0, 4).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Multiplier benefit calculation
  const getMultiplier = (status: string) => {
    if (status.includes('Sølv')) return 1.1;
    if (status.includes('Guld')) return 1.25;
    if (status.includes('Carbon') || status.includes('Diamond')) return 1.5;
    return 1.0;
  };

  const currentMultiplier = getMultiplier(user.memberStatus);

  const handlePayOutMobilePay = () => {
    const payoutVal = parseFloat(amountToPayout);
    if (isNaN(payoutVal) || payoutVal <= 0 || payoutVal > user.balance) {
      alert(t('fejl_payout'));
      return;
    }

    onChangeUser(prev => {
      const updated = {
        ...prev,
        balance: Number((prev.balance - payoutVal).toFixed(2)),
      };
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });

    const newTx: Transaction = {
      id: Math.random().toString(),
      title: language === 'da' ? 'Udbetalt til MobilePay' : 'Paid out to MobilePay',
      date: language === 'da' ? 'I dag' : 'Today',
      amount: `-${payoutVal.toFixed(2)} kr`
    };
    setTxs(prev => [newTx, ...prev]);
    setMobilePayModal(false);
    showSuccessToast(t('udbetal_success'));
  };

  const handleClaimOffer = (offer: RewardOffer) => {
    if (user.points < offer.cost) {
      alert(language === 'da' 
        ? "Du har desværre ikke point nok til dette tilbud. Scan mere emballage for at optjene Cirkel Points!" 
        : "You don't have enough points for this offer. Scan more packagings to earn Cirkel Points!");
      setModalOffer(null);
      return;
    }

    // Generate active offline voucher object
    const randomVoucherCode = `${offer.id.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3); // 3 months validity

    const newVoucher: Voucher = {
      id: Math.random().toString(),
      title: offer.description,
      partner: offer.partner,
      code: randomVoucherCode,
      emoji: offer.emoji,
      cost: offer.cost,
      expiryDate: expiry.toLocaleDateString(language === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
      isUsed: false,
    };

    onChangeUser(prev => {
      const existingVouchers = prev.vouchers || [];
      const updated = {
        ...prev,
        points: prev.points - offer.cost,
        vouchers: [newVoucher, ...existingVouchers],
      };
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });

    const newTx: Transaction = {
      id: Math.random().toString(),
      title: `${language === 'da' ? 'Kupon indløst' : 'Coupon claimed'}: ${offer.partner}`,
      date: language === 'da' ? 'I dag' : 'Today',
      amount: `-${offer.cost} CP`,
      isPoints: true
    };
    setTxs(prev => [newTx, ...prev]);
    setModalOffer(null);
    showSuccessToast(
      language === 'da' 
        ? `Rabatkupon oprettet! Se din aktive kode i din voucher pung nedenfor.` 
        : `Coupon generated successfully! View your active code in your vouchers wallet below.`
    );
  };

  const handleApplyReferralCode = () => {
    setAppliedCodeError(null);
    const cleanCode = enteredRefCode.trim().toUpperCase();
    
    if (!cleanCode.startsWith('CIRKEL-') || cleanCode.length < 9) {
      setAppliedCodeError(t('referral_not_found'));
      return;
    }

    if (user.hasAppliedReferral) {
      alert(language === 'da' ? "Du har allerede indløst en velkomstinvitationskode!" : "You have already applied a welcome invitation code!");
      return;
    }

    onChangeUser(prev => {
      const updated = {
        ...prev,
        points: prev.points + 200,
        hasAppliedReferral: true,
      };
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });

    const newTx: Transaction = {
      id: Math.random().toString(),
      title: language === 'da' ? 'Inviterings-gavekort indløst (+200 CP)' : 'Referral welcome bonus claimed (+200 CP)',
      date: language === 'da' ? 'I dag' : 'Today',
      amount: '+200 CP',
      isPoints: true
    };
    setTxs(prev => [newTx, ...prev]);
    setEnteredRefCode('');
    showSuccessToast(t('referral_bonus_applied'));
  };

  const handleMarkVoucherUsed = (voucherId: string) => {
    onChangeUser(prev => {
      const updatedVouchers = (prev.vouchers || []).map(v => 
        v.id === voucherId ? { ...v, isUsed: true } : v
      );
      const updated = {
        ...prev,
        vouchers: updatedVouchers
      };
      localStorage.setItem('cirkel_user', JSON.stringify(updated));
      return updated;
    });
    setSelectedVoucherForBarcode(null);
    showSuccessToast(language === 'da' ? 'Kupon markeret som brugt!' : 'Coupon marked as used successfully!');
  };

  const handleCopyReferralCode = () => {
    navigator.clipboard.writeText(referralCode);
    showSuccessToast(t('copied'));
  };

  const handleCopyVoucherCode = (code: string) => {
    navigator.clipboard.writeText(code);
    showSuccessToast(t('copied'));
  };

  const showSuccessToast = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4500);
  };

  // Safe voucher filter
  const activeVouchers = (user.vouchers || []).filter(v => !v.isUsed);

  // Filter reward offers according to chosen sub category
  const filteredRewardOffers = REWARD_OFFERS.filter(
    offer => selectedCategory === 'all' || offer.category === selectedCategory
  );

  // Simulated Weekly Streaks Completeness Calendar
  const todayIndex = new Date().getDay(); // 0 is Sunday, 1 is Monday, etc.
  const WEEK_DAYS = [
    { name: language === 'da' ? 'Ma' : 'Mo', full: 'Mandag', num: 1 },
    { name: language === 'da' ? 'Ti' : 'Tu', full: 'Tirsdag', num: 2 },
    { name: language === 'da' ? 'On' : 'We', full: 'Onsdag', num: 3 },
    { name: language === 'da' ? 'To' : 'Th', full: 'Torsdag', num: 4 },
    { name: language === 'da' ? 'Fr' : 'Fr', full: 'Fredag', num: 5 },
    { name: language === 'da' ? 'Lø' : 'Sa', full: 'Lørdag', num: 6 },
    { name: language === 'da' ? 'Sø' : 'Su', full: 'Søndag', num: 0 },
  ];

  return (
    <div className="w-full max-w-lg mx-auto px-4 pt-4 pb-12 flex flex-col gap-6 select-none animate-in fade-in duration-200">
      
      {/* Toast Notification */}
      <AnimatePresence>
        {actionSuccess && (
          <motion.div 
            className="fixed top-6 left-1/2 -translate-x-1/2 bg-primary border-2 border-accent text-white px-5 py-4 rounded-2xl flex items-center gap-3 shadow-2xl z-55 w-[90%] max-w-md"
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
          >
            <div className="bg-accent/10 p-1 rounded-lg shrink-0">
              <CheckCircle className="w-5 h-5 text-accent shrink-0" />
            </div>
            <p className="text-xs font-black leading-tight text-left">{actionSuccess}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Membership Status Indicator Pills */}
      <div className="flex justify-between items-center bg-white border border-gray-150 p-4 rounded-2xl shadow-3xs text-left">
        <div className="flex gap-2.5 items-center">
          <span className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-lg filter drop-shadow-3xs">👑</span>
          <div>
            <span className="text-[9px] font-black tracking-widest text-[#9CA3AF] uppercase block leading-none">{t('member_status')}</span>
            <span className="text-sm font-black text-primary block mt-0.5">{user.memberStatus}</span>
          </div>
        </div>
        <button
          id="see-tiers-btn"
          onClick={() => setShowTiersModal(true)}
          className="bg-primary/5 hover:bg-primary/10 text-primary py-2 px-3.5 rounded-xl text-[10px] uppercase font-black tracking-wider transition-colors active:scale-97 cursor-pointer"
        >
          {t('medlemstatus_tiers')}
        </button>
      </div>

      {/* Main Balance card matching circular dynamic look */}
      <div className="bg-primary text-white rounded-3xl p-6 shadow-lg relative overflow-hidden flex flex-col text-left">
        {/* Vector Background Arch */}
        <div className="absolute right-0 top-0 w-36 h-36 bg-accent/5 rounded-full blur-2xl pointer-events-none" />
        
        <span className="text-xs font-black text-white/40 tracking-wider uppercase">{language === 'da' ? 'DIN SALDO' : 'YOUR BALANCE'}</span>
        <h3 className="text-4.5xl font-black text-accent mt-2 tracking-tighter leading-none">
          {user.balance.toFixed(2)} kr
        </h3>

        <div className="flex flex-col gap-1 mt-4 border-t border-white/10 pt-3.5">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
            <Coins className="w-4 h-4 shrink-0" />
            <span>{user.points} Cirkel Points (CP)</span>
          </div>
          {currentMultiplier > 1.0 && (
            <p className="text-[10px] text-accent/85 font-semibold">
              ✨ {user.memberStatus} Boost: {currentMultiplier}x {language === 'da' ? 'point-multiplikator aktiv!' : 'points multiplier active!'}
            </p>
          )}
        </div>

        <button 
          id="payout-mobilepay-btn"
          onClick={() => setMobilePayModal(true)}
          className="mt-6 w-full bg-accent hover:opacity-95 text-primary text-sm font-black py-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-98 shadow-sm"
        >
          {language === 'da' ? 'Udbetal til MobilePay' : 'Cash out to MobilePay'} <ArrowUpRight className="w-4 h-4 shrink-0" />
        </button>
      </div>

      {/* Weekly Streaks visual gamified tracker */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm text-left">
        <div className="flex justify-between items-center mb-1.5">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center text-sm">🔥</span>
            <h4 className="text-xs font-black text-primary uppercase tracking-wider">{language === 'da' ? 'Dine Ugentlige Stimer' : 'Your Weekly Streaks'}</h4>
          </div>
          <span className="text-[11px] font-black text-primary">{user.streakDays} {t('streak_days')}</span>
        </div>
        <p className="text-[10px] text-muted-text font-semibold mb-4 leading-normal">
          {language === 'da' 
            ? 'Scan mindst 1 genstand hver dag for at holde gang i din stime og modtage eksklusive CP bonusser.' 
            : 'Scan at least 1 packaging every day to keep your streak alive and unlock exclusive point caches.'}
        </p>

        {/* Calendar days mapping */}
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {WEEK_DAYS.map((day) => {
            const isToday = day.num === todayIndex;
            const isCompleted = day.num !== 0 && (day.num < todayIndex || (isToday && user.scansCount > 0));
            return (
              <div key={day.name} className="flex flex-col items-center gap-1.5">
                <span className="text-[9px] font-bold text-muted-text uppercase">{day.name}</span>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border text-[11px] font-black transition-all ${
                  isCompleted 
                    ? 'bg-emerald-100 border-emerald-300 text-emerald-800 shadow-3xs'
                    : isToday 
                      ? 'bg-amber-50 border-amber-300 text-amber-700 animate-pulse ring-2 ring-amber-300/35'
                      : 'bg-gray-50 border-gray-150 text-gray-400'
                }`}>
                  {isCompleted ? '✓' : day.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spend points section */}
      <div className="text-left bg-white border border-gray-150 p-5 rounded-3xl shadow-3xs flex flex-col gap-4">
        <div>
          <h4 className="text-xs font-black text-primary uppercase tracking-wider">{t('loyalty_shop_title')}</h4>
          <p className="text-[11px] text-muted-text font-semibold mt-1 leading-normal">
            {t('loyalty_shop_desc')}
          </p>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none snap-x">
          {(['all', 'coupon', 'code', 'award'] as const).map((cat) => {
            const isActive = selectedCategory === cat;
            let label = '';
            if (cat === 'all') label = language === 'da' ? 'Alle 🌟' : 'All 🌟';
            else if (cat === 'coupon') label = t('tab_coupons');
            else if (cat === 'code') label = t('tab_codes');
            else if (cat === 'award') label = t('tab_awards');

            return (
              <button
                id={`tab-rewards-${cat}`}
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer snap-start shrink-0 select-none ${
                  isActive
                    ? 'bg-primary text-white shadow-3xs scale-102 font-black'
                    : 'bg-gray-50 hover:bg-gray-100 border border-gray-150 text-muted-text'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Dynamic Items Carousel/Grid list */}
        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 snap-x scrollbar-none">
          {filteredRewardOffers.length > 0 ? (
            filteredRewardOffers.map((offer) => (
              <button
                id={`offer-${offer.id}-btn`}
                key={offer.id}
                onClick={() => setModalOffer(offer)}
                className="bg-gray-50 border border-gray-150 hover:border-primary rounded-2xl p-4 min-w-[140px] max-w-[140px] flex flex-col items-center text-center shadow-3xs snap-start shrink-0 select-none cursor-pointer duration-150 active:scale-97 transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-white border border-gray-150 flex items-center justify-center text-3xl mb-2.5 shadow-3xs filter drop-shadow-3xs relative">
                  {offer.emoji}
                  {/* Category small badge indicator */}
                  <span className="absolute -top-1.5 -right-1.5 text-[7px] bg-primary/10 text-primary border border-primary/20 rounded-full px-1.5 py-0.5 scale-90 leading-none font-black uppercase">
                    {offer.category === 'coupon' ? 'coup' : offer.category === 'code' ? 'code' : 'awrd'}
                  </span>
                </div>
                <h4 className="text-xs font-black text-primary truncate w-full">{offer.partner}</h4>
                <p className="text-[10px] text-muted-text font-bold mt-1 h-7 line-clamp-2 leading-tight w-full">{offer.description}</p>
                <div className="bg-primary/5 hover:bg-primary/10 border border-primary/10 rounded-xl py-1.5 px-3 mt-3 w-full transition-colors">
                  <span className="text-[10px] font-black text-primary tracking-wide">{offer.cost} CP</span>
                </div>
              </button>
            ))
          ) : (
            <div className="w-full text-center py-6">
              <p className="text-xs font-bold text-muted-text">
                {language === 'da' ? 'Ingen belønninger fundet i denne kategori.' : 'No rewards found under this category.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Active Vouchers Wallet List of owned offline coupon codes */}
      <div className="text-left">
        <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-3">{t('active_vouchers')} ({activeVouchers.length})</span>
        
        {activeVouchers.length > 0 ? (
          <div className="flex flex-col gap-2.5 bg-white border border-gray-200 p-4 rounded-3xl shadow-3xs">
            {activeVouchers.map((voucher) => (
              <div 
                key={voucher.id}
                onClick={() => setSelectedVoucherForBarcode(voucher)}
                className="flex justify-between items-center p-3.5 bg-gray-50 border border-gray-150 hover:border-amber-300 hover:bg-amber-50/20 rounded-2xl cursor-pointer transition-all active:scale-99"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded-xl bg-white border border-gray-250 flex items-center justify-center text-xl shadow-3xs select-none">
                    {voucher.emoji}
                  </div>
                  <div>
                    <h5 className="text-[11px] font-bold text-muted-text uppercase leading-none">{voucher.partner}</h5>
                    <p className="text-xs font-extrabold text-primary leading-tight mt-1">{voucher.title}</p>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">
                      {t('kupon_udløb')}: {voucher.expiryDate}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[9px] font-black uppercase text-primary/45 tracking-widest mr-1">Vis</span>
                  <ChevronRight className="w-4 h-4 text-primary/40 shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center p-7 border-2 border-dashed border-gray-200 rounded-3xl bg-white/40">
            <span className="text-2xl select-none">🎟️</span>
            <p className="text-xs font-extrabold text-muted-text mt-2">{t('ingen_kuponer')}</p>
            <p className="text-[10px] text-muted-text font-bold mt-1">
              {language === 'da' ? 'Indløs dine optjente Cirkel Points for at modtage personlige fordele!' : 'Spend your points to generate store discounts!'}
            </p>
          </div>
        )}
      </div>

      {/* Viral Referral Rewards Program Section */}
      <div className="bg-gradient-to-br from-[#182C21] to-[#2E4337] text-white rounded-3xl p-6 shadow-md relative overflow-hidden flex flex-col text-left">
        <div className="absolute right-0 bottom-0 w-32 h-32 bg-accent/5 rounded-full blur-xl pointer-events-none" />
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-xl shrink-0 select-none">🎁</div>
          <div className="text-left flex-1">
            <h4 className="text-xs font-black text-accent uppercase tracking-wider leading-none mt-1">{t('inviter_venner')}</h4>
            <p className="text-[11px] text-white/70 font-semibold mt-2 leading-normal">
              {t('inviter_beskrivelse')}
            </p>
          </div>
        </div>

        {/* Copy Referral Code */}
        <div className="flex items-center gap-1.5 mt-5 bg-black/15 border border-white/10 p-3 rounded-2xl justify-between">
          <div className="text-left pl-1.5">
            <span className="text-[9px] font-black text-white/50 uppercase block tracking-wider">{t('din_invitationskode')}</span>
            <span className="text-xs font-black text-accent tracking-widest uppercase block font-mono mt-1 select-all">{referralCode}</span>
          </div>
          <button
            id="copy-referral-code-btn"
            onClick={handleCopyReferralCode}
            className="bg-accent hover:bg-accent/90 text-primary text-[10px] uppercase font-black py-2 px-3.5 rounded-xl cursor-pointer select-none transition-all active:scale-97 flex items-center gap-1 shrink-0"
          >
            <Copy className="w-3 h-3" /> {language === 'da' ? 'Kopier' : 'Copy'}
          </button>
        </div>

        {/* Enter Invitation Code form block */}
        {!user.hasAppliedReferral ? (
          <div className="mt-4 border-t border-white/10 pt-4 flex flex-col gap-2 text-left">
            <span className="text-[9px] font-black text-white/50 uppercase tracking-widest">Blev du inviteret af en ven?</span>
            <div className="flex gap-2">
              <input
                id="referral-input"
                type="text"
                placeholder="F.eks. CIRKEL-NAME-81"
                value={enteredRefCode}
                onChange={(e) => {
                  setEnteredRefCode(e.target.value);
                  setAppliedCodeError(null);
                }}
                className="flex-1 bg-white/5 rounded-xl border border-white/10 px-3.5 py-2.5 text-xs font-bold placeholder-white/30 text-accent font-mono uppercase tracking-widest outline-none focus:border-accent"
              />
              <button
                id="apply-referral-btn"
                onClick={handleApplyReferralCode}
                className="bg-accent text-primary text-[10px] font-black uppercase py-2 px-4 rounded-xl hover:opacity-95 cursor-pointer flex items-center justify-center transition-colors shadow-2xs shrink-0"
              >
                {t('indløs')}
              </button>
            </div>
            {appliedCodeError && (
              <span className="text-[9px] font-bold text-rose-400 mt-1">{appliedCodeError}</span>
            )}
          </div>
        ) : (
          <div className="mt-4 border-t border-white/10 pt-4 flex items-center gap-1.5 text-left text-accent select-none">
            <span className="text-base">✨</span>
            <span className="text-[10px] font-black uppercase tracking-wider text-accent">{t('referral_bonus_applied')}</span>
          </div>
        )}
      </div>

      {/* Recent transactions list */}
      <div className="text-left">
        <span className="text-xs font-bold text-muted-text uppercase tracking-wider block mb-3">
          {language === 'da' ? `Seneste aktiviteter (${user.scansCount} i alt)` : `Recent Activity (${user.scansCount} total)`}
        </span>
        <div className="flex flex-col border border-gray-200 rounded-3xl overflow-hidden bg-white shadow-3xs divide-y divide-gray-100">
          {txs.map((tx) => (
            <div key={tx.id} className="flex justify-between items-center p-4">
              <div className="text-left">
                <h5 className="text-xs font-extrabold text-primary tracking-tight leading-tight">{tx.title}</h5>
                <p className="text-[9px] text-muted-text font-bold mt-1 leading-none">{tx.date}</p>
              </div>
              <div className="shrink-0 select-none text-right">
                <span className={`text-xs font-black font-mono ${
                  tx.amount.startsWith('-') 
                    ? 'text-red-500' 
                    : tx.isPoints || tx.amount.endsWith('CP')
                      ? 'text-amber-500'
                      : 'text-success-alt'
                }`}>
                  {tx.amount}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Claim Offer Confirmation Modal */}
      <AnimatePresence>
        {modalOffer && (
          <div className="fixed inset-0 bg-primary/45 backdrop-blur-xs z-55 flex items-end justify-center p-4 animate-in fade-in duration-200">
            <motion.div 
              className="bg-white rounded-t-[2.5rem] rounded-b-2xl border border-gray-150 max-w-sm w-full p-6 shadow-2xl relative select-none flex flex-col gap-5 text-left"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
            >
              <button 
                id="close-offer-modal-btn"
                onClick={() => setModalOffer(null)}
                className="absolute right-4 top-4 w-8 h-8 border border-gray-150 rounded-full flex items-center justify-center hover:bg-gray-50 active:scale-90 cursor-pointer text-primary transition-all shadow-3xs"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex flex-col items-center text-center mt-3 gap-3">
                <span className="text-5.5.xl mb-1 filter drop-shadow-xs select-none leading-none">{modalOffer.emoji}</span>
                <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">{modalOffer.partner}</span>
                <h4 className="text-xl font-black text-primary mt-1 leading-tight">{modalOffer.description}</h4>
                <p className="text-xs text-muted-text font-semibold px-4 mt-1 leading-relaxed">
                  {language === 'da'
                    ? modalOffer.category === 'award'
                      ? `Vil du donere dine points til denne miljømæssige indsats? Det vil koste dig ${modalOffer.cost} Cirkel Points.`
                      : modalOffer.category === 'code'
                        ? `Vil du indløse denne online partner-rabatkode? Det vil koste dig ${modalOffer.cost} Cirkel Points.`
                        : `Vil du indløse denne rabatkupon til butikken? Det vil koste dig ${modalOffer.cost} Cirkel Points.`
                    : modalOffer.category === 'award'
                      ? `Would you like to donate your points to this eco cause? It will cost you ${modalOffer.cost} Cirkel Points (CP).`
                      : modalOffer.category === 'code'
                        ? `Would you like to purchase this partner promo-code? It will cost you ${modalOffer.cost} Cirkel Points (CP).`
                        : `Do you want to claim this store discount coupon? It will cost you ${modalOffer.cost} Cirkel Points (CP).`
                  }
                </p>

                <div className="flex gap-2 items-center bg-amber-50 border border-amber-200 p-3 rounded-2xl mt-2 w-full text-left">
                  <Award className="w-5 h-5 text-amber-500 shrink-0" />
                  <span className="text-[10px] font-black text-amber-900 uppercase tracking-wide leading-snug">
                    {language === 'da'
                      ? `Din saldo: ${user.points} CP · Rest efter: ${user.points - modalOffer.cost} CP`
                      : `Your Balance: ${user.points} CP · Remaining: ${user.points - modalOffer.cost} CP`
                    }
                  </span>
                </div>

                <div className="flex gap-3 mt-4 w-full">
                  <button 
                    id="cancel-claim-btn"
                    onClick={() => setModalOffer(null)}
                    className="flex-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-primary font-extrabold text-xs uppercase py-3.5 rounded-xl cursor-pointer transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button 
                    id="confirm-claim-btn"
                    onClick={() => handleClaimOffer(modalOffer)}
                    className="flex-1 bg-accent hover:bg-accent/95 text-primary font-extrabold text-xs uppercase py-3.5 rounded-xl cursor-pointer transition-colors"
                  >
                    {language === 'da' ? 'Bekræft' : 'Confirm'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Digital Coupon Barcode Viewer Overlay Modal */}
      <AnimatePresence>
        {selectedVoucherForBarcode && (
          <div className="fixed inset-0 bg-primary/45 backdrop-blur-xs z-55 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <motion.div 
              className="bg-white border border-gray-150 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative select-none flex flex-col gap-5 text-center"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <button 
                id="close-voucher-modal-btn"
                onClick={() => setSelectedVoucherForBarcode(null)}
                className="absolute right-4 top-4 w-8 h-8 border border-gray-150 rounded-full flex items-center justify-center hover:bg-gray-50 active:scale-90 cursor-pointer text-primary transition-all shadow-3xs"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex flex-col items-center gap-2 mt-4 text-center">
                <span className="text-4.5xl leading-none select-none filter drop-shadow-xs">{selectedVoucherForBarcode.emoji}</span>
                <span className="text-[9px] font-black text-[#9CA3AF] uppercase tracking-widest">{selectedVoucherForBarcode.partner}</span>
                <h4 className="text-lg font-black text-primary leading-tight">{selectedVoucherForBarcode.title}</h4>
                <p className="text-[10px] font-bold text-muted-text -mt-1">{t('kupon_udløb')}: {selectedVoucherForBarcode.expiryDate}</p>
              </div>

              {/* Simulated Visual Barcode Panel with alternate CSS lines */}
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex flex-col items-center gap-3.5">
                <span className="text-[9px] font-black text-muted-text uppercase tracking-wider">{t('stregkode_titel')}</span>
                
                {/* Barcode representation */}
                <div className="flex items-center justify-center h-16 w-full px-2 max-w-[240px] bg-white border border-gray-150 rounded-lg overflow-hidden py-2 select-none">
                  {Array.from({ length: 42 }).map((_, index) => {
                    const widths = [1, 2, 3, 4, 1, 2, 1, 3, 2, 4];
                    const wIndex = index % widths.length;
                    const w = widths[wIndex];

                    const isGapValue = [2, 5, 8, 12, 17, 21, 24, 29, 34, 38].includes(index);
                    return (
                      <div 
                        key={index}
                        className={`h-full ${isGapValue ? 'bg-transparent' : 'bg-primary'}`}
                        style={{ width: `${isGapValue ? w * 2.5 : w}px` }}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 bg-white border border-gray-150 rounded-xl px-4 py-2 hover:bg-gray-50 transition-colors select-all cursor-pointer">
                  <span className="text-xs font-black font-mono tracking-wider text-primary">{selectedVoucherForBarcode.code}</span>
                  <button 
                    onClick={() => handleCopyVoucherCode(selectedVoucherForBarcode.code)}
                    className="p-1 text-primary/45 hover:text-primary transition-colors shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex gap-2.5 pt-2 border-t border-gray-100">
                <button 
                  id="mark-voucher-used-btn"
                  onClick={() => handleMarkVoucherUsed(selectedVoucherForBarcode.id)}
                  className="flex-1 py-3.5 bg-primary hover:bg-primary/95 text-white font-extrabold text-xs uppercase rounded-xl transition-all shadow-md cursor-pointer tracking-wider"
                >
                  {t('mark_used_btn')}
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MobilePay Payout Modal */}
      <AnimatePresence>
        {mobilePayModal && (
          <div className="fixed inset-0 bg-primary/45 backdrop-blur-xs z-55 flex items-end justify-center p-4">
            <motion.div 
              className="bg-white rounded-t-[2.5rem] rounded-b-2xl border border-gray-150 max-w-sm w-full p-6 shadow-2xl relative select-none flex flex-col text-left gap-4"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
            >
              <button 
                id="close-mobilepay-modal-btn"
                onClick={() => setMobilePayModal(false)}
                className="absolute right-4 top-4 w-8 h-8 border border-gray-150 rounded-full flex items-center justify-center hover:bg-gray-50 active:scale-90 cursor-pointer text-primary transition-all shadow-3xs"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex flex-col mt-3">
                <div className="flex items-center gap-3.5 mb-4">
                  <span className="text-3.5xl filter drop-shadow-3xs">🏧</span>
                  <div>
                    <span className="text-[9px] font-black text-muted-text uppercase tracking-widest block leading-none">UDBETALING</span>
                    <h4 className="text-base font-black text-primary leading-none mt-1">MobilePay Overførsel</h4>
                  </div>
                </div>

                <p className="text-xs text-muted-text font-semibold leading-relaxed mb-4">
                  {language === 'da'
                    ? 'Udbetal din emballage-pant direkte to dit personlige MobilePay mobilnummer øjeblikkeligt.'
                    : 'Withdraw your accumulated deposit-balance to your local MobilePay account instantly.'
                  }
                </p>

                <div className="flex flex-col gap-1.5 mb-3.5 text-left">
                  <label className="text-[10px] font-black text-[#9CA3AF] uppercase tracking-wide">Beløb (DKK)</label>
                  <div className="relative">
                    <input
                      id="payout-amount-input"
                      type="number"
                      max={user.balance}
                      step="0.05"
                      value={amountToPayout}
                      onChange={(e) => setAmountToPayout(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 outline-none focus:border-primary text-primary font-extrabold text-sm"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-xs text-[#9CA3AF]">kr</span>
                  </div>
                  <span className="text-[9px] font-bold text-[#9CA3AF]">Maksimum muligt: {user.balance.toFixed(2)} kr</span>
                </div>

                <div className="flex flex-col gap-1.5 mb-6 text-left">
                  <label className="text-[10px] font-black text-[#9CA3AF] uppercase tracking-wide">MobilePay Mobilnummer</label>
                  <input
                    id="payout-phone-input"
                    type="tel"
                    placeholder="+45 xx xx xx xx"
                    defaultValue="+45 88 88 88 88"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 outline-none focus:border-primary text-primary font-extrabold text-sm"
                  />
                </div>

                <div className="flex gap-3 w-full">
                  <button 
                    id="cancel-payout-btn"
                    onClick={() => setMobilePayModal(false)}
                    className="flex-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-primary font-extrabold text-xs uppercase py-3.5 rounded-xl cursor-pointer transition-all"
                  >
                    {t('cancel')}
                  </button>
                  <button 
                    id="confirm-payout-btn"
                    onClick={handlePayOutMobilePay}
                    className="flex-1 bg-accent hover:opacity-95 text-primary font-extrabold text-xs uppercase py-3.5 rounded-xl cursor-pointer transition-all shadow-md"
                  >
                    {language === 'da' ? 'Udbetal nu' : 'Payout Now'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Levels & Membership Status Tiers Detailed Benefits Modal */}
      <AnimatePresence>
        {showTiersModal && (
          <div className="fixed inset-0 bg-primary/45 backdrop-blur-xs z-55 flex items-center justify-center p-4">
            <motion.div 
              className="bg-white border border-gray-150 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative select-none flex flex-col gap-4 text-left"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <button 
                id="close-tiers-modal-btn"
                onClick={() => setShowTiersModal(false)}
                className="absolute right-4 top-4 w-8 h-8 border border-gray-150 rounded-full flex items-center justify-center hover:bg-gray-50 active:scale-90 cursor-pointer text-primary transition-all shadow-3xs"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex gap-2.5 items-center mt-3">
                <span className="text-3xl filter drop-shadow-3xs">🏆</span>
                <div>
                  <h4 className="text-sm font-black text-primary uppercase tracking-wider">{language === 'da' ? 'Cirkel Medlemsfordele' : 'Cirkel Levels & Tiers'}</h4>
                  <p className="text-[10px] text-muted-text font-semibold">{language === 'da' ? 'Hæv dit niveau og få stærkere point-boost!' : 'Level up to unlock stronger point boosts!'}</p>
                </div>
              </div>

              {/* Tiers list table mapping */}
              <div className="flex flex-col gap-2.5 mt-2">
                {/* Bronze */}
                <div className="p-3 bg-gray-50/60 border border-gray-200 rounded-xl flex justify-between items-center">
                  <div className="text-left">
                    <span className="text-xs font-black text-secondary block leading-none">🥉 Bronze-medlem</span>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">Level 1 - 3</span>
                  </div>
                  <span className="text-xs font-black text-primary/50">1.0x (Standard)</span>
                </div>

                {/* Sølv */}
                <div className={`p-3 border rounded-xl flex justify-between items-center ${
                  user.memberStatus.includes('Sølv') ? 'bg-amber-50/20 border-amber-300 ring-1 ring-amber-300/30' : 'bg-gray-50/60 border-gray-200'
                }`}>
                  <div className="text-left">
                    <span className="text-xs font-black text-secondary block leading-none">🥈 Sølv-medlem</span>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">Level 4 - 9</span>
                  </div>
                  <span className="text-xs font-black text-[#5F523E]">+10% Multiplier</span>
                </div>

                {/* Guld */}
                <div className={`p-3 border rounded-xl flex justify-between items-center ${
                  user.memberStatus.includes('Guld') ? 'bg-amber-50/25 border-amber-300 ring-2 ring-amber-300/35 shadow-3xs' : 'bg-gray-50/60 border-gray-200'
                }`}>
                  <div className="text-left">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-black text-primary block leading-none">🥇 Guld-medlem</span>
                      {user.memberStatus.includes('Guld') && <span className="text-[8px] font-black uppercase text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-full leading-none shrink-0 header">Aktiv</span>}
                    </div>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">Level 10 - 24</span>
                  </div>
                  <span className="text-xs font-black text-amber-600">+25% Multiplier</span>
                </div>

                {/* Diamond / Carbon Champion */}
                <div className={`p-3 border rounded-xl flex justify-between items-center ${
                  user.memberStatus.includes('Carbon') || user.memberStatus.includes('Diamond') ? 'bg-emerald-50/40 border-emerald-300 ring-2 ring-emerald-300/30' : 'bg-gray-50/60 border-gray-200'
                }`}>
                  <div className="text-left">
                    <span className="text-xs font-black text-emerald-900 block leading-none">💎 Carbon Champion</span>
                    <span className="text-[9px] font-bold text-muted-text block mt-1">Level 25+</span>
                  </div>
                  <span className="text-xs font-black text-emerald-600">+50% Multiplier</span>
                </div>
              </div>

              <button
                id="close-tiers-bottom-btn"
                onClick={() => setShowTiersModal(false)}
                className="w-full mt-2 py-3 bg-primary text-white hover:bg-primary/95 text-xs font-extrabold uppercase rounded-xl transition-all shadow-sm tracking-wider text-center cursor-pointer"
              >
                Fortsæt
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
