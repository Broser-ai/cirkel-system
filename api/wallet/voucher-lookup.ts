// cirkel-system/api/wallet/voucher-lookup.ts
//
// JUDGE-02 Wallet — Voucher-lookup (læs-endpoint).
//
// Formål:
//   Publikt læs-endpoint der slår en voucher-kode op i den live
//   `rewards`-tabel og returnerer minimum af data en klient behøver
//   for at vise en voucher: identifier, beløb i DKK, udløbstidspunkt
//   og hvorvidt den p.t. er indløselig.
//
// Kontrakt:
//   GET /api/wallet/voucher-lookup?code=<string>
//
// 200 OK:
//   {
//     voucher_id: string,        // rewards.id (uuid)
//     amount_dkk: number,        // beløb i hele/decimal DKK
//     expires_at: string | null, // ISO-8601 timestamp (UTC) eller null (uendelig)
//     redeemable: boolean        // true hvis ikke udløbet, ikke indløst, og har stock
//   }
//
// 400 bad_request      — manglende/ugyldig `code`
// 404 voucher_not_found — ingen match
// 405 method_not_allowed
// 500 db_error / internal_error
// 503 service_unavailable — Supabase ikke konfigureret
//
// F3.8 (resolveTrustedUid) er BEVIDST udeladt: dette er et rent læs-
// endpoint uden bruger-mutation. Rate-limiting ligger ved Edge/CDN-laget.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase-klient (service-role; endpoint kan ellers ikke læse rewards
// på tværs af RLS-policies for brand-vouchere).
// ---------------------------------------------------------------------------
let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

// ---------------------------------------------------------------------------
// Hjælpere
// ---------------------------------------------------------------------------

/** Whitelist for `code`: alfanumerisk + `-` og `_`, 3–64 tegn. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

function parseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!CODE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Normalisér beløb til DKK (number). Tabellen kan realistisk indeholde
 * enten `amount_dkk` (kroner, numeric) eller `amount_ore` (heltal).
 * Vi accepterer begge og bruger den første der er sat.
 */
function resolveAmountDkk(row: Record<string, unknown>): number | null {
  const dkk = row['amount_dkk'];
  if (typeof dkk === 'number' && Number.isFinite(dkk)) return dkk;
  if (typeof dkk === 'string' && dkk.length > 0) {
    const parsed = Number(dkk);
    if (Number.isFinite(parsed)) return parsed;
  }
  const ore = row['amount_ore'];
  if (typeof ore === 'number' && Number.isFinite(ore)) return ore / 100;
  if (typeof ore === 'string' && ore.length > 0) {
    const parsed = Number(ore);
    if (Number.isFinite(parsed)) return parsed / 100;
  }
  return null;
}

/**
 * En voucher er indløselig hvis:
 *   - den ikke er udløbet (`expires_at` null eller > now)
 *   - den ikke allerede er indløst (`redeemed_at` null / `status` != 'redeemed')
 *   - der er beholdning tilbage (`stock` null eller > 0)
 *   - status er ikke 'blocked' / 'expired' / 'cancelled'
 */
function computeRedeemable(row: Record<string, unknown>, expiresAt: string | null): boolean {
  const now = Date.now();

  if (expiresAt) {
    const expiryMs = Date.parse(expiresAt);
    if (Number.isFinite(expiryMs) && expiryMs <= now) return false;
  }

  const redeemedAt = row['redeemed_at'];
  if (redeemedAt !== null && redeemedAt !== undefined && redeemedAt !== '') return false;

  const status = row['status'];
  if (typeof status === 'string') {
    const s = status.toLowerCase();
    if (s === 'redeemed' || s === 'blocked' || s === 'expired' || s === 'cancelled') {
      return false;
    }
  }

  const stock = row['stock'];
  if (typeof stock === 'number' && stock <= 0) return false;
  if (typeof stock === 'string') {
    const parsed = Number(stock);
    if (Number.isFinite(parsed) && parsed <= 0) return false;
  }

  return true;
}

function resolveExpiresAt(row: Record<string, unknown>): string | null {
  const value = row['expires_at'];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const rawCode = Array.isArray(req.query.code) ? req.query.code[0] : req.query.code;
  const code = parseCode(rawCode);
  if (!code) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Query-parameteren `code` skal være 3–64 tegn (A-Z, 0-9, `-`, `_`).',
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: 'service_unavailable' });
  }

  try {
    const { data, error } = await supabase
      .from('rewards')
      .select('id, code, amount_dkk, amount_ore, expires_at, redeemed_at, status, stock')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      // maybeSingle() må ikke fejle ved 0 rækker; en fejl her er en reel db-fejl.
      console.error('[voucher-lookup] Supabase error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    if (!data) {
      return res.status(404).json({ error: 'voucher_not_found' });
    }

    const row = data as Record<string, unknown>;
    const voucherId = row['id'];
    const amountDkk = resolveAmountDkk(row);
    const expiresAt = resolveExpiresAt(row);
    const redeemable = computeRedeemable(row, expiresAt);

    if (typeof voucherId !== 'string' || amountDkk === null) {
      // Beskyttelse mod semi-korrupt row (fx numeric amount_dkk der ikke kan læses).
      console.error('[voucher-lookup] row missing required fields:', {
        has_id: typeof voucherId === 'string',
        has_amount: amountDkk !== null,
      });
      return res.status(500).json({ error: 'internal_error' });
    }

    // Cache i 60s ved kanten — voucher-metadata ændrer sig sjældent per lookup,
    // og lookup-endpoint bruges typisk af scan-flow i klient. `private` fordi
    // shared caches (Vercel Edge) ikke må dele indløselighedstilstand mellem
    // brugere hvis vi senere tilføjer session-context.
    res.setHeader('Cache-Control', 'private, max-age=60');

    return res.status(200).json({
      voucher_id: voucherId,
      amount_dkk: amountDkk,
      expires_at: expiresAt,
      redeemable,
    });
  } catch (err: any) {
    console.error('[voucher-lookup] unexpected:', err?.message ?? err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
