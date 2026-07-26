// cirkel-system/api/gdpr/export.ts
//
// GDPR Article 15/20 — Right of Access + Data Portability.
//
// GET /api/gdpr/export?firebaseUid=...
//
// Aggregerer alt personhenførbart data for den kaldende bruger på tværs af:
//   • profiles                   → identitet, verifikationstier, saldi
//   • scans                      → hele scan-historikken
//   • ledger                     → SHA-256 hash-chain (proof-of-earn)
//   • wallet_payouts             → MobilePay/Stripe/manual payouts
//   • biometric_verifications    → WebAuthn/MitID/device-fingerprint log
//
// F3.8 verify: resolveTrustedUid kaldes FØR nogen data-fetch.
// Enforce-mode: 401 UID_SPOOF_DETECTED ved manglende/mismatch.
// Warn_only-mode: logger advarsel, fortsætter med klient-oplyst UID.
//
// Response: application/json med Content-Disposition attachment for direkte download.
// Format: { success: boolean, data?: GdprExportPayload, error?: string, detail?: string }
//
// Ingen hemmeligheder hardcodes — alt læses fra process.env.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';
import { getDashboard } from '../../lib/cirkel.js';
import logger from '../../src/lib/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Typer
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  municipality: string | null;
  balance: number | null;
  points: number | null;
  scans_count: number | null;
  co2_saved_kg: number | null;
  streak_days: number | null;
  level: number | null;
  member_status: string | null;
  verification_tier: string | null;
  is_mitid_verified: boolean | null;
  referral_code: string | null;
  has_applied_referral: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ScanRow {
  id: string;
  user_id: string;
  barcode: string | null;
  material: string | null;
  weight_grams: number | null;
  sorting_compliance: number | null;
  points_earned: number | null;
  kroner_earned: number | null;
  is_processed: boolean | null;
  created_at: string | null;
}

interface LedgerRow {
  id: number;
  scan_id: string;
  user_id: string;
  points: number | null;
  balance: number | null;
  prev_hash: string | null;
  hash: string | null;
  is_valid: boolean | null;
  created_at: string | null;
}

interface WalletPayoutRow {
  payout_id: string;
  user_id: string;
  amount_dkk: number | null;
  psp_provider: string | null;
  psp_reference: string | null;
  danish_phone: string | null;
  status: string | null;
  failure_reason: string | null;
  initiated_at: string | null;
  completed_at: string | null;
}

interface BiometricVerificationRow {
  verification_id: string;
  user_id: string;
  device_fingerprint: string | null;
  webauthn_credential_id: string | null;
  verification_method: string | null;
  ip_address: string | null;
  user_agent: string | null;
  verification_result: string | null;
  verified_at: string | null;
}

interface GdprExportMeta {
  generated_at: string;
  trusted_uid: string;
  profile_id: string;
  uid_verified: boolean;
  uid_spoofed: boolean;
  verify_reason: string;
  legal_basis: string;
  data_controller: string;
  retention_note: string;
  hash_chain_note: string;
}

interface GdprExportCounts {
  scans: number;
  ledger_entries: number;
  wallet_payouts: number;
  biometric_verifications: number;
}

interface GdprExportPayload {
  meta: GdprExportMeta;
  counts: GdprExportCounts;
  profile: ProfileRow | null;
  scans: ScanRow[];
  ledger: LedgerRow[];
  wallet_payouts: WalletPayoutRow[];
  biometric_verifications: BiometricVerificationRow[];
}

interface GdprSuccessResponse {
  success: true;
  data: GdprExportPayload;
}

interface GdprErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type GdprResponse = GdprSuccessResponse | GdprErrorResponse;

// ─────────────────────────────────────────────────────────────────────────────
// Supabase — lazy init (samme mønster som api/scan.ts)
// ─────────────────────────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table-fetch hjælpere — hver returnerer tom liste ved fejl, så partielle
// eksporter er mulige selv hvis én tabel mangler i det aktuelle miljø.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchScans(sb: SupabaseClient, profileId: string): Promise<ScanRow[]> {
  const { data, error } = await sb
    .from('scans')
    .select('id, user_id, barcode, material, weight_grams, sorting_compliance, points_earned, kroner_earned, is_processed, created_at')
    .eq('user_id', profileId)
    .order('created_at', { ascending: false });
  if (error) {
    logger.warn('[gdpr/export] scans query fejlede', { message: error.message });
    return [];
  }
  return (data ?? []) as ScanRow[];
}

async function fetchLedger(sb: SupabaseClient, profileId: string): Promise<LedgerRow[]> {
  const { data, error } = await sb
    .from('ledger')
    .select('id, scan_id, user_id, points, balance, prev_hash, hash, is_valid, created_at')
    .eq('user_id', profileId)
    .order('id', { ascending: true });
  if (error) {
    logger.warn('[gdpr/export] ledger query fejlede', { message: error.message });
    return [];
  }
  return (data ?? []) as LedgerRow[];
}

async function fetchWalletPayouts(sb: SupabaseClient, profileId: string): Promise<WalletPayoutRow[]> {
  const { data, error } = await sb
    .from('wallet_payouts')
    .select('payout_id, user_id, amount_dkk, psp_provider, psp_reference, danish_phone, status, failure_reason, initiated_at, completed_at')
    .eq('user_id', profileId)
    .order('initiated_at', { ascending: false });
  if (error) {
    logger.warn('[gdpr/export] wallet_payouts query fejlede', { message: error.message });
    return [];
  }
  return (data ?? []) as WalletPayoutRow[];
}

async function fetchBiometricVerifications(sb: SupabaseClient, profileId: string): Promise<BiometricVerificationRow[]> {
  const { data, error } = await sb
    .from('biometric_verifications')
    .select('verification_id, user_id, device_fingerprint, webauthn_credential_id, verification_method, ip_address, user_agent, verification_result, verified_at')
    .eq('user_id', profileId)
    .order('verified_at', { ascending: false });
  if (error) {
    logger.warn('[gdpr/export] biometric_verifications query fejlede', { message: error.message });
    return [];
  }
  return (data ?? []) as BiometricVerificationRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Method-guard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    const body: GdprErrorResponse = { success: false, error: 'method_not_allowed' };
    res.status(405).json(body);
    return;
  }

  // Klient-oplyst UID (query-string) — bruges kun som hint til resolveTrustedUid;
  // sandheden er token.uid efter F3.8-verify.
  const rawUid = req.query?.firebaseUid;
  const clientProvidedUid = Array.isArray(rawUid)
    ? String(rawUid[0] ?? '').trim()
    : String(rawUid ?? '').trim();

  if (!clientProvidedUid) {
    const body: GdprErrorResponse = { success: false, error: 'firebaseUid_required' };
    res.status(400).json(body);
    return;
  }

  // F3.8 — verificér Bearer-token FØR nogen data-fetch.
  let trustedUid: string;
  let uidVerified = false;
  let uidSpoofed = false;
  let verifyReason = 'no_verify_attempted';
  try {
    const verified = await resolveTrustedUid(req, clientProvidedUid);
    if (!verified || !verified.trusted_uid) {
      logger.warn('[F3.8] gdpr/export: resolveTrustedUid returnerede intet UID — fortsætter i warn_only med klient-UID');
      trustedUid = clientProvidedUid;
    } else {
      trustedUid = verified.trusted_uid;
      uidVerified = Boolean(verified.verified);
      uidSpoofed = Boolean(verified.spoofed);
      verifyReason = verified.reason ?? '';
      if (uidSpoofed) {
        logger.warn('[F3.8] gdpr/export warn_only: UID-spoof detekteret. Bruger token-UID', { reason: verifyReason });
      } else if (!uidVerified) {
        logger.warn('[F3.8] gdpr/export warn_only: token IKKE verificeret. Fortsætter med klient-UID', { reason: verifyReason });
      }
    }
  } catch (err: unknown) {
    const errObj = err as { status?: number; reason?: string; message?: string };
    const status = errObj?.status ?? 401;
    logger.error('[F3.8] gdpr/export enforce: blokerede request', err as Error, { reason: errObj?.reason });
    const body: GdprErrorResponse = {
      success: false,
      error: 'UID_SPOOF_DETECTED',
      detail: errObj?.reason ?? errObj?.message ?? 'Firebase-token verifikation fejlede.',
    };
    res.status(status).json(body);
    return;
  }

  // Supabase service-role-klient (server-side, aldrig klient).
  const sb = getSupabase();
  if (!sb) {
    logger.warn('[gdpr/export] Supabase service-role ikke konfigureret — kan ikke levere export');
    const body: GdprErrorResponse = {
      success: false,
      error: 'supabase_unavailable',
      detail: 'Service-role-nøgle mangler i miljøet — kontakt DPO/administrator.',
    };
    res.status(503).json(body);
    return;
  }

  // Slå profil op via get_dashboard-RPC — RPC'en løser Firebase-UID → profile.id
  // (samme Firebase-bro som scan.ts og dashboard.ts). Vi bruger profile.id som
  // filter mod scans/ledger/wallet_payouts/biometric_verifications.
  let profile: ProfileRow | null = null;
  let profileId: string | null = null;
  try {
    const dashboard = await getDashboard(sb, trustedUid);
    const rawProfile = dashboard?.profile ?? null;
    if (rawProfile && typeof rawProfile === 'object') {
      profile = rawProfile as unknown as ProfileRow;
      profileId = typeof profile.id === 'string' && profile.id.length > 0 ? profile.id : null;
    }
  } catch (err: unknown) {
    const errObj = err as { message?: string };
    logger.error('[gdpr/export] get_dashboard fejlede', err as Error);
    const body: GdprErrorResponse = {
      success: false,
      error: 'profile_lookup_failed',
      detail: errObj?.message ?? 'Kunne ikke slå profil op via Firebase-broen.',
    };
    res.status(500).json(body);
    return;
  }

  if (!profileId) {
    const body: GdprErrorResponse = {
      success: false,
      error: 'profile_not_found',
      detail: `Ingen profil er registreret for firebaseUid=${trustedUid}. Der er intet at eksportere.`,
    };
    res.status(404).json(body);
    return;
  }

  // Parallel fetch af alle underliggende tabeller for profile.id
  const [scans, ledgerEntries, walletPayouts, biometricVerifications] = await Promise.all([
    fetchScans(sb, profileId),
    fetchLedger(sb, profileId),
    fetchWalletPayouts(sb, profileId),
    fetchBiometricVerifications(sb, profileId),
  ]);

  const meta: GdprExportMeta = {
    generated_at: new Date().toISOString(),
    trusted_uid: trustedUid,
    profile_id: profileId,
    uid_verified: uidVerified,
    uid_spoofed: uidSpoofed,
    verify_reason: verifyReason,
    legal_basis: 'GDPR Art. 15 (Right of Access) + Art. 20 (Data Portability)',
    data_controller: process.env.GDPR_DATA_CONTROLLER ?? 'Cirkel ApS',
    retention_note: 'Data leveres i maskin-læsbart JSON-format. Kontakt DPO for sletning (Art. 17).',
    hash_chain_note: 'Ledger-entries er append-only SHA-256 hash-chain (prev_hash → hash). Integritet kan verificeres via /api/verify-ledger.',
  };

  const counts: GdprExportCounts = {
    scans: scans.length,
    ledger_entries: ledgerEntries.length,
    wallet_payouts: walletPayouts.length,
    biometric_verifications: biometricVerifications.length,
  };

  const payload: GdprExportPayload = {
    meta,
    counts,
    profile,
    scans,
    ledger: ledgerEntries,
    wallet_payouts: walletPayouts,
    biometric_verifications: biometricVerifications,
  };

  // Attachment-header så browseren tilbyder direkte download af filen.
  const filename = `cirkel-gdpr-export-${profileId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  logger.info('[gdpr/export] leveret', {
    uid: trustedUid,
    profile_id: profileId,
    counts,
    uid_verified: uidVerified,
  });

  const body: GdprSuccessResponse = { success: true, data: payload };
  res.status(200).json(body);
}

// Suppress unused-type warning for public API-typer der eksponeres for konsumenter.
export type {
  GdprExportPayload,
  GdprExportMeta,
  GdprExportCounts,
  GdprResponse,
  GdprSuccessResponse,
  GdprErrorResponse,
};
