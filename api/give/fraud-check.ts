// api/give/fraud-check.ts
//
// POST /api/give/fraud-check — Fraud pre-flight for Cirkel Give marketplace listings.
//
// Denne handler kombinerer tre signaler til én samlet risikovurdering:
//   1) _fraud.calculateRiskScore() — deterministisk regelmotor (duplicate image,
//      geo-speed, frekvens, high-value-unverified).
//   2) DK CVR-lookup — sanity check af sælgers virksomhedsnummer mod CVR-registret.
//      MOCK i denne version. Live-integration: https://cvrapi.dk/documentation
//      (kræver User-Agent header + CVR_API_TOKEN env-var).
//   3) Telefon-blacklist — opslag mod intern liste over kendte svindler-numre.
//      MOCK i denne version. Live-integration: Supabase-tabel
//      `sovereign_phone_blacklist` (kolonner: phone_e164, reason, added_at)
//      eller ekstern feed (fx PSD2-flagging fra bank-partner).
//
// F3.8 wired: resolveTrustedUid FØR alt arbejde — samme pattern som api/scan.ts.
// Enforce-mode: 401 UID_SPOOF_DETECTED ved manglende/mismatch token.
// Warn_only-mode: log advarsel og pass through med body-UID.
//
// Response-format:
//   { success: true,  data: FraudCheckResult }   — 200 OK
//   { success: false, error: string, detail? }   — 4xx/5xx fejl

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  calculateRiskScore,
  generateImageHash,
  type FraudFlag,
  type FraudRecommendation,
  type FraudResult,
  type GeoPoint,
  type HistoricalScan,
  type VerificationTier,
} from '../_fraud.js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';
import logger from '../../src/lib/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types — request/response kontrakt
// ─────────────────────────────────────────────────────────────────────────────

interface GiveListingPayload {
  readonly firebaseUid: string;
  readonly listing_id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly asking_price_dkk?: number;
  readonly image?: string;                 // base64 eller data-URI
  readonly geo?: GeoPoint;
  readonly seller_phone?: string;          // E.164 helst, fx +4512345678
  readonly seller_cvr?: string;            // 8-cifret DK CVR-nummer
  readonly verification_tier?: VerificationTier;
}

interface CvrLookupResult {
  readonly checked: boolean;
  readonly valid: boolean;
  readonly cvr?: string;
  readonly company_name?: string;
  readonly status?: string;                // fx "NORMAL", "OPHØRT"
  readonly reason?: string;                // hvorfor invalid (hvis relevant)
  readonly source: 'mock' | 'cvrapi';
}

interface PhoneBlacklistResult {
  readonly checked: boolean;
  readonly blacklisted: boolean;
  readonly phone_e164?: string;
  readonly reason?: string;
  readonly source: 'mock' | 'supabase' | 'external';
}

interface FraudCheckResult {
  readonly listing_id?: string;
  readonly trusted_uid: string;
  readonly uid_verified: boolean;
  readonly uid_spoofed: boolean;
  readonly score: number;
  readonly flags: FraudFlag[];
  readonly recommend: FraudRecommendation;
  readonly cvr: CvrLookupResult;
  readonly phone: PhoneBlacklistResult;
  readonly evaluated_at: string;
}

interface ApiResponseSuccess {
  readonly success: true;
  readonly data: FraudCheckResult;
}

interface ApiResponseError {
  readonly success: false;
  readonly error: string;
  readonly detail?: string;
}

type ApiResponse = ApiResponseSuccess | ApiResponseError;

// ─────────────────────────────────────────────────────────────────────────────
// Supabase — lazy service-role client (samme pattern som api/scan.ts).
// Returnerer null hvis env ikke er sat, så handler kan degrade gracefully.
// ─────────────────────────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ─────────────────────────────────────────────────────────────────────────────
// CVR-tjek — MOCK
//
// Live-integration (dokumenteret her, TODO F-give.2):
//   const url = `https://cvrapi.dk/api?search=${cvr}&country=dk`;
//   const res = await fetch(url, {
//     headers: {
//       'User-Agent': 'Cirkel-Give-FraudCheck/1.0 (ma@keap.me)',
//       'Authorization': `Bearer ${process.env.CVR_API_TOKEN}`, // hvis pro-plan
//     },
//   });
//   const data = await res.json();
//   → valid = data.vat && data.name && data.status !== 'OPHØRT'
//
// Mock-regler:
//   • undefined/tomt CVR → checked=false (Give tillader private sælgere)
//   • CVR skal være præcis 8 cifre — ellers invalid
//   • Test-CVR 12345678 markeres som invalid ("test-CVR blokkeret")
//   • Alle andre 8-cifrede CVR-numre passerer som valide
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCvr(cvr: string | undefined): string | undefined {
  if (typeof cvr !== 'string') return undefined;
  const trimmed = cvr.replace(/\s+/g, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

async function checkCvr(cvrInput: string | undefined): Promise<CvrLookupResult> {
  const cvr = normalizeCvr(cvrInput);
  if (!cvr) {
    return { checked: false, valid: true, source: 'mock' };
  }

  if (!/^\d{8}$/.test(cvr)) {
    return {
      checked: true,
      valid: false,
      cvr,
      reason: 'CVR skal være præcis 8 cifre.',
      source: 'mock',
    };
  }

  if (cvr === '12345678') {
    return {
      checked: true,
      valid: false,
      cvr,
      reason: 'Test-CVR blokkeret i mock-motor.',
      source: 'mock',
    };
  }

  return {
    checked: true,
    valid: true,
    cvr,
    company_name: `Mock Company ${cvr}`,
    status: 'NORMAL',
    source: 'mock',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Telefon-blacklist — MOCK
//
// Live-integration (dokumenteret her, TODO F-give.3):
//   const sb = getSupabase();
//   if (!sb) return { checked: false, blacklisted: false, source: 'mock' };
//   const { data, error } = await sb
//     .from('sovereign_phone_blacklist')
//     .select('phone_e164, reason')
//     .eq('phone_e164', phone)
//     .maybeSingle();
//   if (error) throw error;
//   return { checked: true, blacklisted: !!data, ... };
//
// Mock-regler:
//   • undefined/tomt nummer → checked=false
//   • Normaliserer til E.164 (fjerner mellemrum, plus-prefix)
//   • Numre der starter med "+4570" eller "+4590" markeres som blacklisted
//     (mock — repræsenterer "kendte svindel-prefixes")
// ─────────────────────────────────────────────────────────────────────────────

function normalizePhone(phone: string | undefined): string | undefined {
  if (typeof phone !== 'string') return undefined;
  const cleaned = phone.replace(/[\s\-().]/g, '');
  if (cleaned.length === 0) return undefined;
  // Antag DK hvis 8 cifre uden landekode
  if (/^\d{8}$/.test(cleaned)) return `+45${cleaned}`;
  if (cleaned.startsWith('+')) return cleaned;
  return `+${cleaned}`;
}

async function checkPhoneBlacklist(phoneInput: string | undefined): Promise<PhoneBlacklistResult> {
  const phone = normalizePhone(phoneInput);
  if (!phone) {
    return { checked: false, blacklisted: false, source: 'mock' };
  }

  const mockBlacklistedPrefixes = ['+4570', '+4590'];
  const hit = mockBlacklistedPrefixes.find((p) => phone.startsWith(p));
  if (hit) {
    return {
      checked: true,
      blacklisted: true,
      phone_e164: phone,
      reason: `Mock-blacklist ramte prefix ${hit}.`,
      source: 'mock',
    };
  }

  return {
    checked: true,
    blacklisted: false,
    phone_e164: phone,
    source: 'mock',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Historik-lookup — henter brugerens seneste scans fra Supabase.
// Bruges af calculateRiskScore til duplicate/geo/frequency-reglerne.
// Returnerer tom array hvis Supabase ikke er konfigureret eller query fejler.
// ─────────────────────────────────────────────────────────────────────────────

async function loadHistory(uid: string): Promise<HistoricalScan[]> {
  const sb = getSupabase();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from('sovereign_scans')
      .select('user_id, scan_ts_ms, image_hash, geo_lat, geo_lng')
      .eq('user_id', uid)
      .order('scan_ts_ms', { ascending: false })
      .limit(100);

    if (error) {
      logger.warn('[give/fraud-check] history query failed', { message: error.message });
      return [];
    }

    if (!Array.isArray(data)) return [];

    return data.map((row: Record<string, unknown>): HistoricalScan => {
      const lat = typeof row.geo_lat === 'number' ? row.geo_lat : undefined;
      const lng = typeof row.geo_lng === 'number' ? row.geo_lng : undefined;
      const scan: HistoricalScan = {
        user_id: String(row.user_id),
        scan_ts_ms: Number(row.scan_ts_ms),
        image_hash: typeof row.image_hash === 'string' ? row.image_hash : undefined,
        geo: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
      };
      return scan;
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[give/fraud-check] history lookup threw', { message });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    const body: ApiResponse = { success: false, error: 'Method not allowed' };
    return res.status(405).json(body);
  }

  // Body-parsing — Vercel parser JSON automatisk hvis Content-Type er sat korrekt
  const payload = (req.body ?? {}) as Partial<GiveListingPayload>;
  const firebaseUid = typeof payload.firebaseUid === 'string' ? payload.firebaseUid.trim() : '';

  if (!firebaseUid) {
    const body: ApiResponse = { success: false, error: 'firebaseUid er påkrævet.' };
    return res.status(400).json(body);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // F3.8 — resolveTrustedUid FØR alt arbejde. Samme pattern som api/scan.ts.
  // Enforce-mode: kaster ved manglende/mismatch token → 401.
  // Warn_only-mode: pass through + log.
  // ─────────────────────────────────────────────────────────────────────────
  let trustedUid: string = firebaseUid;
  let uidVerified = false;
  let uidSpoofed = false;
  try {
    const verify = await resolveTrustedUid(req, firebaseUid);
    trustedUid = verify.trusted_uid || firebaseUid;
    uidVerified = verify.verified;
    uidSpoofed = verify.spoofed;
    if (uidSpoofed) {
      logger.warn('[F3.8] give/fraud-check warn_only: spoof detected', {
        firebaseUidBody: firebaseUid,
        trustedUid,
        reason: verify.reason,
      });
    } else if (!uidVerified) {
      logger.warn('[F3.8] give/fraud-check warn_only: no crypto-verify', {
        reason: verify.reason,
      });
    }
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status ?? 401;
    const reason =
      (err as { reason?: string })?.reason ??
      (err instanceof Error ? err.message : 'UID_SPOOF_DETECTED');
    logger.error(
      '[F3.8] give/fraud-check enforce BLOCKED',
      err instanceof Error ? err : new Error(String(err)),
      { status, reason },
    );
    const body: ApiResponse = {
      success: false,
      error: 'UID_SPOOF_DETECTED',
      detail: reason,
    };
    return res.status(status).json(body);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Precompute image-hash én gang — bruges af fraud-motoren til duplicate-check.
  // ─────────────────────────────────────────────────────────────────────────
  let imageHash: string | undefined;
  if (typeof payload.image === 'string' && payload.image.length > 0) {
    try {
      imageHash = generateImageHash(payload.image);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[give/fraud-check] generateImageHash failed', { message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Verification tier — default til "standard" hvis token er verificeret,
  // ellers "anonymous". Klient kan overstyre til "verified"/"premium" hvis
  // ekstra KYC-data er indhentet (fx MitID).
  // ─────────────────────────────────────────────────────────────────────────
  function resolveTier(): VerificationTier {
    if (payload.verification_tier) return payload.verification_tier;
    if (!trustedUid) return 'anonymous';
    if (uidVerified) return 'verified';
    return 'standard';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Kør alle tre tjeks parallelt for lav latency.
  // ─────────────────────────────────────────────────────────────────────────
  const askingPriceDkk =
    typeof payload.asking_price_dkk === 'number' && Number.isFinite(payload.asking_price_dkk)
      ? payload.asking_price_dkk
      : 0;

  try {
    const [history, cvrResult, phoneResult] = await Promise.all([
      loadHistory(trustedUid),
      checkCvr(payload.seller_cvr),
      checkPhoneBlacklist(payload.seller_phone),
    ]);

    // Fraud-score fra _fraud.calculateRiskScore
    const fraudResult: FraudResult = calculateRiskScore(
      {
        user_id: trustedUid,
        scan_ts_ms: Date.now(),
        image_hash: imageHash,
        geo: payload.geo,
        payout_dkk: askingPriceDkk,
        verification_tier: resolveTier(),
      },
      history,
    );

    // Aggregér CVR/telefon-signaler ind i det samlede resultat.
    // Business-regel: hvis CVR er invalid ELLER telefon er blacklisted,
    // opgradér anbefaling til 'reject' uanset base-score.
    let recommend: FraudRecommendation = fraudResult.recommend;
    if (cvrResult.checked && !cvrResult.valid) recommend = 'reject';
    if (phoneResult.blacklisted) recommend = 'reject';

    const result: FraudCheckResult = {
      listing_id: payload.listing_id,
      trusted_uid: trustedUid,
      uid_verified: uidVerified,
      uid_spoofed: uidSpoofed,
      score: fraudResult.score,
      flags: fraudResult.flags,
      recommend,
      cvr: cvrResult,
      phone: phoneResult,
      evaluated_at: new Date().toISOString(),
    };

    logger.info('[give/fraud-check] evaluated', {
      uid: trustedUid,
      score: result.score,
      flags: result.flags,
      recommend: result.recommend,
      cvr_valid: cvrResult.valid,
      phone_blacklisted: phoneResult.blacklisted,
    });

    const body: ApiResponse = { success: true, data: result };
    return res.status(200).json(body);
  } catch (err: unknown) {
    logger.error(
      '[give/fraud-check] evaluation failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    const body: ApiResponse = {
      success: false,
      error: 'Fraud-check kunne ikke gennemføres.',
      detail: err instanceof Error ? err.message : String(err),
    };
    return res.status(500).json(body);
  }
}
