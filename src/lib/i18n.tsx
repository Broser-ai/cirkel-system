import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'da' | 'en';

export type TranslationKeys = 
  | 'slogan'
  | 'tab_scan'
  | 'tab_wallet'
  | 'tab_profil'
  | 'tab_systems'
  | 'hello'
  | 'scan_pkg'
  | 'aarhus'
  | 'optjent'
  | 'scans'
  | 'co2'
  | 'daily_bonus'
  | 'daily_bonus_sub'
  | 'scanned_today'
  | 'scan_one_today'
  | 'claimed'
  | 'claim_ready'
  | 'locked'
  | 'bonus_paid_title'
  | 'bonus_paid_desc'
  | 'new_balance'
  | 'points_hereof'
  | 'continue_work'
  | 'simulate_fast'
  | 'no_packaging'
  | 'claim'
  | 'ai_camera'
  | 'qr_scanner'
  | 'which_scan_method'
  | 'camera_scanning'
  | 'qr_code_scanner'
  | 'ai_camera_hint'
  | 'qr_scanner_hint'
  | 'start_camera'
  | 'start_qr_camera'
  | 'choose_image'
  | 'upload_qr_image'
  | 'fast_ai_test'
  | 'fast_qr_test'
  | 'custom_product_placeholder'
  | 'custom_qr_placeholder'
  | 'ai_scan_btn'
  | 'decode_qr_btn'
  | 'circular_tips'
  | 'nearest_recycling'
  | 'stats_title'
  | 'login_title'
  | 'signup_title'
  | 'login_btn'
  | 'signup_btn'
  | 'login_google'
  | 'signup_google'
  | 'use_alternative'
  | 'email_label'
  | 'password_label'
  | 'name_label'
  | 'or_signup'
  | 'or_login'
  | 'fill_fields'
  | 'fill_name'
  | 'account_created'
  | 'demo_mode'
  | 'firebase_live'
  | 'logout'
  | 'settings'
  | 'profile_info'
  | 'member_status'
  | 'guld_medlem'
  | 'level'
  | 'streak_days'
  | 'co2_saved'
  | 'transactions'
  | 'rewards'
  | 'claim_reward_points'
  | 'active_vouchers'
  | 'scans_count_short'
  | 'language_label'
  | 'my_municipality'
  | 'log_out'
  | 'change_language_title'
  | 'change_language_subtitle'
  | 'cancel'
  | 'select_lang_desc'
  | 'referral_bonus_applied'
  | 'referral_not_found'
  | 'copied'
  | 'inviter_venner'
  | 'inviter_beskrivelse'
  | 'din_invitationskode'
  | 'indløs'
  | 'aktive_kuponer'
  | 'ingen_kuponer'
  | 'medlemstatus_tiers'
  | 'vis_stregkode'
  | 'mark_used_btn'
  | 'stregkode_titel'
  | 'kupon_udløb'
  | 'udbetal_success'
  | 'fejl_payout'
  | 'tab_coupons'
  | 'tab_codes'
  | 'tab_awards'
  | 'loyalty_shop_title'
  | 'loyalty_shop_desc';

const translations: Record<Language, Record<TranslationKeys, string>> = {
  da: {
    slogan: 'Alt har en værdi',
    tab_scan: 'Scan',
    tab_wallet: 'Wallet',
    tab_profil: 'Profil',
    tab_systems: 'Infra',
    hello: 'Hej',
    scan_pkg: 'Scan din emballage',
    aarhus: 'Aarhus Kommune',
    optjent: 'Optjent',
    scans: 'Scanninger',
    co2: 'CO₂ sparet',
    daily_bonus: 'Daglig Bonus-Cirkel',
    daily_bonus_sub: 'Få +2,00 kr ekstra for dagens første scan',
    scanned_today: 'Dagens scan gennemført!',
    scan_one_today: 'Scan 1 genstand i dag',
    claimed: 'Indløst',
    claim_ready: 'Klar til indløsning',
    locked: 'Låst',
    bonus_paid_title: 'Daglig Bonus Udbetalt!',
    bonus_paid_desc: 'Flot arbejde! Ved at åbne Cirkel og scanne en emballage beviser du, at de grønne sorteringsvaner sidder lige i skabet.',
    new_balance: 'Ny Saldo',
    points_hereof: 'Point heraf',
    continue_work: 'Fortsæt det gode arbejde! 🚀',
    simulate_fast: 'Simuler hurtig-scan af emballage →',
    no_packaging: '⚡ Ingen emballage ved hånden?',
    claim: 'Indløs 🎉',
    ai_camera: 'AI Kamera',
    qr_scanner: 'QR / EAN Scanner',
    which_scan_method: 'Hvilken scan-metode skal jeg vælge?',
    camera_scanning: 'Kamera scanning',
    qr_code_scanner: 'QR-kode scanner',
    ai_camera_hint: 'Peg kameraet mod emballagen eller indtast navnet for at generere et AI materialepas.',
    qr_scanner_hint: 'Ret kameraet mod producentens QR-kode eller EAN-stregkode for at hente sorteringsinstrukser.',
    start_camera: 'Start Kamera 📸',
    start_qr_camera: 'Start QR Scanner 🔳',
    choose_image: 'Vælg Billede',
    upload_qr_image: 'Upload QR Billede',
    fast_ai_test: 'Hurtig AI-test (uden kamera)',
    fast_qr_test: 'Klik for at simulere QR-scanning (Interactive presets)',
    custom_product_placeholder: 'Skriv produktnavn (f.eks. Mælkekarton...)',
    custom_qr_placeholder: 'Indtast QR-link eller EAN-stregkode (f.eks. 5701122334411)',
    ai_scan_btn: 'AI Scan',
    decode_qr_btn: 'Afkod QR 🔳',
    circular_tips: 'Cirkulære Dagstips',
    nearest_recycling: 'Nærmeste Genbrugsstationer',
    stats_title: 'Din Cirkel Sorteringsstatistik',
    login_title: 'Log ind',
    signup_title: 'Opret konto',
    login_btn: 'Log ind med email',
    signup_btn: 'Opret konto med email',
    login_google: 'Log ind med Google',
    signup_google: 'Tilmeld dig hurtigt med Google',
    use_alternative: 'Brug alternative metoder',
    email_label: 'Email',
    password_label: 'Adgangskode',
    name_label: 'Dit Navn',
    or_signup: 'Ny bruger på Cirkel? Opret konto',
    or_login: 'Har du allerede en konto? Log ind',
    fill_fields: 'Udfyld venligst email og adgangskode.',
    fill_name: 'Udfyld venligst dit navn.',
    account_created: 'Konto oprettet succesfuldt!',
    demo_mode: 'Demo Mode',
    firebase_live: 'Firebase Live',
    logout: 'Log ud',
    settings: 'Indstillinger',
    profile_info: 'Profil Info',
    member_status: 'Medlemsstatus',
    guld_medlem: 'Guld-medlem',
    level: 'Niveau',
    streak_days: 'dage',
    co2_saved: 'sparet',
    transactions: 'Transaktioner',
    rewards: 'Belønninger',
    claim_reward_points: 'CP',
    active_vouchers: 'Dine Aktive Kuponer',
    scans_count_short: 'scans',
    language_label: 'Sprogvalg',
    my_municipality: 'Min kommune',
    log_out: 'Log ud af Cirkel',
    change_language_title: 'Skift Sprog / Language',
    change_language_subtitle: 'Vælg dit foretrukne sprog for appen / Select your preferred language',
    cancel: 'Annuller',
    select_lang_desc: 'Vælg sproget nedenfor for at opdatere alle visninger i applikationen.',
    referral_bonus_applied: 'Rabatkode indløst! Du har modtaget 200 Cirkel Points!',
    referral_not_found: 'Ugyldig eller ufuldstændig kode. Koden skal starte med CIRKEL-',
    copied: 'Kopieret til udklipsholder!',
    inviter_venner: 'Inviter Venner',
    inviter_beskrivelse: 'Del din kode. Når en ven tilmelder sig og scanner, modtager I begge 200 CP!',
    din_invitationskode: 'Din invitationskode',
    indløs: 'Indløs',
    aktive_kuponer: 'Dine Aktive Kuponer',
    ingen_kuponer: 'Du har ingen aktive kuponer endnu.',
    medlemstatus_tiers: 'Medlemsstatus & Fordele',
    vis_stregkode: 'Vis Stregkode',
    mark_used_btn: 'Marker som brugt',
    stregkode_titel: 'Scan Stregkoden i Butikken',
    kupon_udløb: 'Udløber',
    udbetal_success: 'Overførsel godkendt! Penge er på vej til din MobilePay.',
    fejl_payout: 'Indtast venligst et gyldigt beløb inden for din saldo.',
    tab_coupons: 'Kuponer 🎟️',
    tab_codes: 'Partner Koder 🔑',
    tab_awards: 'Miljø & Priser 🌳',
    loyalty_shop_title: 'Cirkel Loyalty Shop',
    loyalty_shop_desc: 'Brug dine optjente Cirkel Points (CP) til at indløse kuponer i butikken, partnerkoder online eller donere til miljømæssige formål.'
  },
  en: {
    slogan: 'Everything has value',
    tab_scan: 'Scan',
    tab_wallet: 'Wallet',
    tab_profil: 'Profile',
    tab_systems: 'Infra',
    hello: 'Hello',
    scan_pkg: 'Scan your packaging',
    aarhus: 'Aarhus Municipality',
    optjent: 'Earned',
    scans: 'Scans',
    co2: 'CO₂ Saved',
    daily_bonus: 'Daily Bonus-Circle',
    daily_bonus_sub: 'Get +2.00 kr extra for today\'s first scan',
    scanned_today: 'Today\'s scan completed!',
    scan_one_today: 'Scan 1 item today',
    claimed: 'Claimed',
    claim_ready: 'Ready to claim',
    locked: 'Locked',
    bonus_paid_title: 'Daily Bonus Paid!',
    bonus_paid_desc: 'Great work! By opening Cirkel and scanning packaging today, you sustain your healthy green sorting habits.',
    new_balance: 'New Balance',
    points_hereof: 'Points thereof',
    continue_work: 'Keep up the good work! 🚀',
    simulate_fast: 'Simulate fast packaging scan →',
    no_packaging: '⚡ No packaging on hand?',
    claim: 'Claim 🎉',
    ai_camera: 'AI Camera',
    qr_scanner: 'QR / EAN Scanner',
    which_scan_method: 'Which scan method should I choose?',
    camera_scanning: 'Camera scanning',
    qr_code_scanner: 'QR-code scanner',
    ai_camera_hint: 'Point the camera at packaging or type its name to generate an AI Material Passport.',
    qr_scanner_hint: 'Point the camera at a QR or EAN barcode to fetch local sorting instructions.',
    start_camera: 'Start Camera 📸',
    start_qr_camera: 'Start QR Scanner 🔳',
    choose_image: 'Choose Image',
    upload_qr_image: 'Upload QR Image',
    fast_ai_test: 'Fast AI Test (without camera)',
    fast_qr_test: 'Click to simulate QR scanning (Interactive presets)',
    custom_product_placeholder: 'Type product name (e.g. Milk carton...)',
    custom_qr_placeholder: 'Enter QR URL or EAN barcode (e.g. 5701122334411)',
    ai_scan_btn: 'AI Scan',
    decode_qr_btn: 'Decode QR 🔳',
    circular_tips: 'Circular Economy Daily Tips',
    nearest_recycling: 'Nearest Recycling Centers',
    stats_title: 'Your Cirkel Sorting Statistics',
    login_title: 'Log In',
    signup_title: 'Create Account',
    login_btn: 'Log in with email',
    signup_btn: 'Create account with email',
    login_google: 'Log in with Google',
    signup_google: 'Sign up quickly with Google',
    use_alternative: 'Or check-in using',
    email_label: 'Email Address',
    password_label: 'Password',
    name_label: 'Your Name',
    or_signup: 'New to Cirkel? Create an account',
    or_login: 'Already have an account? Log in',
    fill_fields: 'Please fill in both email and password.',
    fill_name: 'Please enter your name.',
    account_created: 'Account created successfully!',
    demo_mode: 'Demo Mode',
    firebase_live: 'Firebase Live',
    logout: 'Log Out',
    settings: 'Settings',
    profile_info: 'Profile Information',
    member_status: 'Member Status',
    guld_medlem: 'Gold Member',
    level: 'Level',
    streak_days: 'days',
    co2_saved: 'saved',
    transactions: 'Transactions',
    rewards: 'Rewards Store',
    claim_reward_points: 'CP',
    active_vouchers: 'Your Active Coupons',
    scans_count_short: 'scans',
    language_label: 'Language Selection',
    my_municipality: 'My Municipality',
    log_out: 'Log Out of Cirkel',
    change_language_title: 'Change Language / Sprog',
    change_language_subtitle: 'Select your preferred language for the app / Vælg dit foretrukne sprog',
    cancel: 'Cancel',
    select_lang_desc: 'Select the language below to update all views in the application.',
    referral_bonus_applied: 'Referral code applied! You gained 200 Cirkel Points (CP)!',
    referral_not_found: 'Invalid code format. Codes must start with CIRKEL-',
    copied: 'Copied to clipboard!',
    inviter_venner: 'Invite Friends',
    inviter_beskrivelse: 'Share your code. When a friend signs up and scans, both of you earn 200 CP!',
    din_invitationskode: 'Your Invitation Code',
    indløs: 'Redeem',
    aktive_kuponer: 'Your Active Coupons',
    ingen_kuponer: 'You have no active coupons yet.',
    medlemstatus_tiers: 'Membership Status & Tiers',
    vis_stregkode: 'Show Barcode',
    mark_used_btn: 'Mark as used',
    stregkode_titel: 'Scan Barcode in Store',
    kupon_udløb: 'Expires',
    udbetal_success: 'Payout approved! Money is on the way to your MobilePay.',
    fejl_payout: 'Please enter a valid amount within your current balance.',
    tab_coupons: 'Coupons 🎟️',
    tab_codes: 'Partner Codes 🔑',
    tab_awards: 'Impact & Awards 🌳',
    loyalty_shop_title: 'Cirkel Loyalty Shop',
    loyalty_shop_desc: 'Spend your Cirkel Points (CP) to claim offline store coupons, online partner promo keys, or make real eco-impact donations.'
  }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKeys) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('cirkel_language');
    return (saved === 'da' || saved === 'en') ? saved : 'da';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('cirkel_language', lang);
  };

  const t = (key: TranslationKeys): string => {
    return translations[language][key] || translations['da'][key] || String(key);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
