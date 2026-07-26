// api/_fraud.ts
// Cirkel fraud-detection engine.
// Rene, deterministiske funktioner uden IO — testbare i isolation.
// Al persistens (historicalScans) leveres af caller (Firestore/Supabase-lag).

import { createHash } from 'crypto';

// ---------- Types ----------

export type VerificationTier = 'anonymous' | 'standard' | 'verified' | 'premium';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface FraudSignals {
  image_hash?: string;
  geo?: GeoPoint;
  user_id: string;
  /** Unix epoch ms for det aktuelle scan */
  scan_ts_ms: number;
  /** Bruges kun til high_value_unverified-reglen */
  verification_tier?: VerificationTier;
  /** Forventet payout i DKK for dette scan */
  payout_dkk?: number;
}

/**
 * Minimalt scan-record som engine'n forventer i historikken.
 * Repo kan indeholde flere felter — engine'n læser kun disse.
 */
export interface HistoricalScan {
  user_id: string;
  scan_ts_ms: number;
  image_hash?: string;
  geo?: GeoPoint;
}

export type FraudFlag =
  | 'duplicate_image'
  | 'implausible_geo_speed'
  | 'excessive_frequency'
  | 'high_value_unverified';

export type FraudRecommendation = 'accept' | 'review' | 'reject';

export interface FraudResult {
  score: number;
  flags: FraudFlag[];
  recommend: FraudRecommendation;
}

// ---------- Konstanter (eksporteret så tests kan asserte) ----------

export const FRAUD_WEIGHTS: Record<FraudFlag, number> = {
  duplicate_image: 50,
  implausible_geo_speed: 40,
  excessive_frequency: 30,
  high_value_unverified: 20,
};

export const FRAUD_THRESHOLDS = {
  /** Duplicate image_hash inden for dette vindue */
  duplicate_window_ms: 24 * 60 * 60 * 1000, // 24 timer
  /** Implausibel geo-hastighed: nær afstand + kort tid */
  geo_max_distance_m: 10,
  geo_min_delta_ms: 30 * 1000, // 30 sekunder
  /** Ekstrem frekvens: N scans pr. rullende time */
  frequency_window_ms: 60 * 60 * 1000, // 1 time
  frequency_max_scans: 10, // 10+ scans inden for vinduet
  /** High-value uverificeret bruger */
  high_value_payout_dkk: 50,
  /** Score-gates */
  reject_at: 70,
  review_at: 40,
} as const;

// ---------- Utils ----------

/**
 * SHA-256 hex-digest af et base64-encoded billede.
 * Accepterer både rå base64 og data-URI ("data:image/png;base64,....").
 */
export function generateImageHash(base64Image: string): string {
  if (typeof base64Image !== 'string' || base64Image.length === 0) {
    throw new Error('generateImageHash: base64Image must be a non-empty string');
  }
  const commaIdx = base64Image.indexOf(',');
  const payload =
    base64Image.startsWith('data:') && commaIdx !== -1
      ? base64Image.slice(commaIdx + 1)
      : base64Image;

  const buf = Buffer.from(payload, 'base64');
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Great-circle distance i meter mellem to WGS-84 punkter.
 * Haversine — præcis nok til meter-niveau i vores brugscase.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000; // jordens radius i meter
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

// ---------- Interne rule-helpers ----------

interface RuleContext {
  signals: FraudSignals;
  history: HistoricalScan[];
  userHistory: HistoricalScan[];
}

function buildContext(signals: FraudSignals, historicalScans: HistoricalScan[]): RuleContext {
  const history = Array.isArray(historicalScans) ? historicalScans : [];
  const userHistory = history.filter((h) => h && h.user_id === signals.user_id);
  return { signals, history, userHistory };
}

function ruleDuplicateImage(ctx: RuleContext): boolean {
  const { signals, history } = ctx;
  if (!signals.image_hash) return false;

  const cutoff = signals.scan_ts_ms - FRAUD_THRESHOLDS.duplicate_window_ms;
  return history.some(
    (h) =>
      h.image_hash === signals.image_hash &&
      h.scan_ts_ms >= cutoff &&
      h.scan_ts_ms <= signals.scan_ts_ms,
  );
}

function ruleImplausibleGeoSpeed(ctx: RuleContext): boolean {
  const { signals, userHistory } = ctx;
  if (!signals.geo) return false;

  // Find seneste tidligere scan for denne bruger med geo
  let last: HistoricalScan | undefined;
  for (const h of userHistory) {
    if (!h.geo) continue;
    if (h.scan_ts_ms >= signals.scan_ts_ms) continue;
    if (!last || h.scan_ts_ms > last.scan_ts_ms) last = h;
  }
  if (!last || !last.geo) return false;

  const distance = haversineMeters(signals.geo, last.geo);
  const dt = signals.scan_ts_ms - last.scan_ts_ms;

  return distance < FRAUD_THRESHOLDS.geo_max_distance_m && dt < FRAUD_THRESHOLDS.geo_min_delta_ms;
}

function ruleExcessiveFrequency(ctx: RuleContext): boolean {
  const { signals, userHistory } = ctx;
  const cutoff = signals.scan_ts_ms - FRAUD_THRESHOLDS.frequency_window_ms;

  const count = userHistory.reduce(
    (n, h) => (h.scan_ts_ms >= cutoff && h.scan_ts_ms <= signals.scan_ts_ms ? n + 1 : n),
    0,
  );
  // "10+ scans/time" — inklusiv det aktuelle scan
  return count + 1 >= FRAUD_THRESHOLDS.frequency_max_scans;
}

function ruleHighValueUnverified(ctx: RuleContext): boolean {
  const { signals } = ctx;
  const payout = signals.payout_dkk ?? 0;
  return signals.verification_tier === 'standard' && payout > FRAUD_THRESHOLDS.high_value_payout_dkk;
}

// ---------- Public API ----------

export function calculateRiskScore(
  signals: FraudSignals,
  historicalScans: HistoricalScan[] = [],
): FraudResult {
  if (!signals || typeof signals.user_id !== 'string' || signals.user_id.length === 0) {
    throw new Error('calculateRiskScore: signals.user_id is required');
  }
  if (!Number.isFinite(signals.scan_ts_ms)) {
    throw new Error('calculateRiskScore: signals.scan_ts_ms must be a finite number');
  }

  const ctx = buildContext(signals, historicalScans);
  const flags: FraudFlag[] = [];
  let score = 0;

  if (ruleDuplicateImage(ctx)) {
    flags.push('duplicate_image');
    score += FRAUD_WEIGHTS.duplicate_image;
  }
  if (ruleImplausibleGeoSpeed(ctx)) {
    flags.push('implausible_geo_speed');
    score += FRAUD_WEIGHTS.implausible_geo_speed;
  }
  if (ruleExcessiveFrequency(ctx)) {
    flags.push('excessive_frequency');
    score += FRAUD_WEIGHTS.excessive_frequency;
  }
  if (ruleHighValueUnverified(ctx)) {
    flags.push('high_value_unverified');
    score += FRAUD_WEIGHTS.high_value_unverified;
  }

  const recommend: FraudRecommendation =
    score >= FRAUD_THRESHOLDS.reject_at
      ? 'reject'
      : score >= FRAUD_THRESHOLDS.review_at
        ? 'review'
        : 'accept';

  return { score, flags, recommend };
}

// Default-eksport for compatibility med require()-baserede callers
export default {
  calculateRiskScore,
  generateImageHash,
  haversineMeters,
  FRAUD_WEIGHTS,
  FRAUD_THRESHOLDS,
};
