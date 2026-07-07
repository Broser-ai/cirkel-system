export interface Voucher {
  id: string;
  title: string;
  partner: string;
  code: string;
  emoji: string;
  cost: number;
  expiryDate: string;
  isUsed: boolean;
  category?: 'coupon' | 'code' | 'award';
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  isLoggedIn: boolean;
  municipality: string;
  user_type?: 'consumer' | 'b2b_business' | 'b2b_kommune' | 'admin';
  balance: number; // in DKK (kr)
  points: number;  // Cirkel Points (CP)
  scansCount: number;
  co2SavedKg: number;
  streakDays: number;
  level: number;
  memberStatus: string;
  xp?: number; // current XP for level up (e.g. 0 to 100)
  vouchers?: Voucher[]; // claimed active vouchers
  referralCode?: string; // unique user invite code
  hasAppliedReferral?: boolean; // whether they entered referral rewards code
  claimedBadgeIds?: string[]; // list of badge IDs where double bonus CP was claimed
  verificationTier?: 'standard' | 'cpr' | 'mitid'; // Trust/Verification tier
  isMitIDVerified?: boolean; // True if upgraded/logged-in with MitID
  dailyRecyclingGoal?: number; // Daily recycling goal
}

export interface ScanResult {
  productName: string;
  materialShort: string;
  grade: string;
  co2Saved: string;
  waterSaved: string;
  energySaved: string;
  pantValue: string;
  materialType: string;
  recyclablePercent: string;
  manufacturer: string;
  packagingWeight: string;
  circularScore: string;
  eprStatus: string;
  sortingType: string;
  sortingInstructions: string;
  didYouKnow?: string;
}

export interface Transaction {
  id: string;
  title: string;
  date: string;
  amount: string;
  isPoints?: boolean;
}

export interface RewardOffer {
  id: string;
  emoji: string;
  partner: string;
  description: string;
  cost: number;
  category?: 'coupon' | 'code' | 'award';
}
