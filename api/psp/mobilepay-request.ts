// C:\Users\Ambro2\cirkel-system\api\psp\mobilepay-request.ts
//
// Cirkel — Modul: MobilePay Business payout initiation
//
// Vercel serverless handler (Node runtime).
//
// POST body: { user_id: string; amount_dkk: number; danish_phone: string }
// Response 200 (queued/executing):
//     { payout_id: string; status: 'pending'; poll_url: string }
// Response 200 (diverted til brand vouchers, ingen MobilePay-call):
//     { payout_id: string; status: 'diverted_to_vouchers'; poll_url: string; reason: string }
// Response 4xx/5xx: { error: string; code: string; ... }
//
// F3.8 authorization: kun brugeren selv (claims.sub === user_id) må initiere
// payout til egen konto. Admin/service-role må også — men producent-support
// står for det manuelt via andet flow.
//
// Flow:
//   1. Method guard + parse body
//   2. Env-check
//   3. Verify Supabase JWT → claims.sub
//   4. F3.8: claims.sub === user_id (eller admin)
//   5. Validér danish_phone på "+45 XXXXXXXX" form
//   6. Slå wallet-balance op → skal være >= amount_dkk
//   7. Slå pool remaining op → evaluatePoolSovereignty(...)
//   8a. BLOCK_INSUFFICIENT      → 400
//   8b. DIVERT_TO_BRAND_VOUCHERS → insert wallet_payouts (status='diverted_to_vouchers'), returnér reference
//   8c. EXECUTE_MOBILEPAY_CASH  → insert wallet_payouts (status='pending'),
//                                 POST til MobilePay Business API,
//                                 opdater ekstern reference, returnér reference
//   9. Response med poll_url til /api/psp/mobilepay-status?payout_id=…
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   MOBILEPAY_API_URL          — fx https://api.mobilepay.dk (uden trailing slash)
//   MOBILEPAY_BEARER_TOKEN     — OAuth2 access token til MobilePay Business
//   MOBILEPAY_MERCHANT_ID      — merchant identifier hos MobilePay
//   PUBLIC_APP_URL             — bruges til at bygge poll_url (fx https://cirkel.dk)
//
// Antaget skema (Supabase):
//   wallet_balances(user_id uuid PK, balance_dkk numeric)
//   wallet_pool_state(pool_id text PK, remaining_dkk numeric)
//   wallet_payouts(
//     id uuid PK default gen_random_uuid(),
//     user_id uuid,
//     amount_dkk numeric,
//     danish_phone text,
//     status text,                       -- 'pending' | 'diverted_to_vouchers' | 'blocked' | 'settled' | 'failed'
//     provider text,                     -- 'mobilepay' | 'brand_vouchers'
//     provider_payment_id text,          -- reference retur fra MobilePay
//     provider_response jsonb,
//     pool_decision jsonb,               -- hele PoolSovereigntyDecision
//     requested_at timestamptz default now(),
//     updated_at timestamptz default now()
//   )
//
// Bruger fetch (Node 18+ på Vercel har global fetch).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  evaluatePoolSovereignty,
  type PoolSovereigntyDecision,
} from '../_pool-guard.js';

// ---------- Types ----------

interface RequestBody {
  user_id: string;
  amount_dkk: number;
  danish_phone: string;
}

interface OkResponse {
  payout_id: string;
  status: 'pending' | 'diverted_to_vouchers';
  poll_url: string;
  reason?: string;
}

interface ErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

interface UserClaims {
  sub: string;
  role?: string;
  app_metadata?: { role?: string };
}

interface WalletBalanceRow {
  user_id: string;
  balance_dkk: number | string;
}

interface WalletPoolStateRow {
  pool_id: string;
  remaining_dkk: number | string;
}

interface WalletPayoutRow {
  id: string;
  user_id: string;
  amount_dkk: number | string;
  status: string;
  requested_at: string;
}

interface MobilePayPaymentRequestBody {
  merchantId: string;
  amount: number;          // øre (heltal)
  currency: 'DKK';
  phoneNumber: string;     // "+45XXXXXXXX"
  description: string;
  reference: string;       // vores wallet_payouts.id
  callbackUrl?: string;
}

interface MobilePayPaymentRequestResponse {
  paymentId?: string;
  status?: string;
  redirectUrl?: string;
  [key: string]: unknown;
}

// ---------- Constants ----------

const GLOBAL_POOL_ID = 'global' as const;
const MOBILEPAY_PROVIDER = 'mobilepay' as const;
const VOUCHERS_PROVIDER = 'brand_vouchers' as const;

const MIN_PAYOUT_DKK = 1;
const MAX_PAYOUT_DKK = 5000;

// +45 efterfulgt af 8 cifre. Tillader valgfrit ét mellemrum/bindestreg mellem
// landekode og nummer, og fjerner separator-tegn før validering.
const DANISH_PHONE_RE = /^\+45\s?\d{8}$/;

// ---------- Helpers ----------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function json<T>(res: VercelResponse, status: number, body: T): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}

function getBearerToken(req: VercelRequest): string | null {
  const header =
    req.headers['authorization'] ??
    (req.headers['Authorization' as unknown as string] as string | undefined);
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isAdmin(claims: UserClaims): boolean {
  const role = claims.app_metadata?.role ?? claims.role;
  return role === 'admin' || role === 'service_role';
}

function normalizeDanishPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!DANISH_PHONE_RE.test(trimmed)) return null;
  return trimmed.replace(/\s+/g, '');
}

function toOre(dkk: number): number {
  return Math.round(dkk * 100);
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // 1. Method guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json<ErrorResponse>(res, 405, {
      error: 'Method not allowed',
      code: 'method_not_allowed',
    });
  }

  // 2. Parse + validate body
  const body = (req.body ?? {}) as Partial<RequestBody>;
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const amountDkk = typeof body.amount_dkk === 'number' ? body.amount_dkk : Number(body.amount_dkk);
  const rawPhone = typeof body.danish_phone === 'string' ? body.danish_phone : '';

  if (!userId) {
    return json<ErrorResponse>(res, 400, {
      error: 'user_id is required',
      code: 'invalid_user_id',
    });
  }
  if (!Number.isFinite(amountDkk) || amountDkk < MIN_PAYOUT_DKK || amountDkk > MAX_PAYOUT_DKK) {
    return json<ErrorResponse>(res, 400, {
      error: `amount_dkk must be a finite number in [${MIN_PAYOUT_DKK}, ${MAX_PAYOUT_DKK}]`,
      code: 'invalid_amount',
    });
  }
  const phone = normalizeDanishPhone(rawPhone);
  if (!phone) {
    return json<ErrorResponse>(res, 400, {
      error: 'danish_phone must match "+45XXXXXXXX" (8 digits after +45)',
      code: 'invalid_phone',
    });
  }

  // 3. Env
  let supabaseUrl: string;
  let supabaseServiceKey: string;
  let mobilepayApiUrl: string;
  let mobilepayBearer: string;
  let mobilepayMerchantId: string;
  let publicAppUrl: string;
  try {
    supabaseUrl = requireEnv('SUPABASE_URL');
    supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    mobilepayApiUrl = requireEnv('MOBILEPAY_API_URL').replace(/\/+$/, '');
    mobilepayBearer = requireEnv('MOBILEPAY_BEARER_TOKEN');
    mobilepayMerchantId = requireEnv('MOBILEPAY_MERCHANT_ID');
    publicAppUrl = requireEnv('PUBLIC_APP_URL').replace(/\/+$/, '');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server misconfiguration';
    return json<ErrorResponse>(res, 500, {
      error: message,
      code: 'env_missing',
    });
  }

  // 4. Auth
  const token = getBearerToken(req);
  if (!token) {
    return json<ErrorResponse>(res, 401, {
      error: 'Missing bearer token',
      code: 'unauthenticated',
    });
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json<ErrorResponse>(res, 401, {
      error: 'Invalid or expired token',
      code: 'invalid_token',
    });
  }
  const claims: UserClaims = {
    sub: userData.user.id,
    app_metadata: userData.user.app_metadata as { role?: string } | undefined,
  };

  // F3.8: kun bruger selv (eller admin) må initiere payout til egen konto
  if (claims.sub !== userId && !isAdmin(claims)) {
    return json<ErrorResponse>(res, 403, {
      error: 'Not authorized to request payout for this user',
      code: 'forbidden',
    });
  }

  // 5. Balance-check
  const { data: balanceRow, error: balErr } = await supabase
    .from('wallet_balances')
    .select('user_id, balance_dkk')
    .eq('user_id', userId)
    .maybeSingle<WalletBalanceRow>();

  if (balErr) {
    console.error('[mobilepay-request] balance query failed:', balErr.message);
    return json<ErrorResponse>(res, 500, {
      error: 'Failed to load wallet balance',
      code: 'balance_check_failed',
    });
  }
  const currentBalance = toNumber(balanceRow?.balance_dkk);
  if (currentBalance < amountDkk) {
    return json<ErrorResponse>(res, 400, {
      error: 'Insufficient balance',
      code: 'insufficient_balance',
      details: {
        balance_dkk: currentBalance,
        requested_dkk: amountDkk,
      },
    });
  }

  // 6. Pool sovereignty guard
  const { data: poolRow, error: poolErr } = await supabase
    .from('wallet_pool_state')
    .select('pool_id, remaining_dkk')
    .eq('pool_id', GLOBAL_POOL_ID)
    .maybeSingle<WalletPoolStateRow>();

  if (poolErr) {
    console.error('[mobilepay-request] pool query failed:', poolErr.message);
    return json<ErrorResponse>(res, 500, {
      error: 'Failed to load pool state',
      code: 'pool_state_failed',
    });
  }
  const remainingPool = toNumber(poolRow?.remaining_dkk);

  let decision: PoolSovereigntyDecision;
  try {
    decision = evaluatePoolSovereignty(GLOBAL_POOL_ID, remainingPool, amountDkk);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pool guard evaluation failed';
    console.error('[mobilepay-request] pool-guard threw:', message);
    return json<ErrorResponse>(res, 500, {
      error: message,
      code: 'pool_guard_error',
    });
  }

  // 7a. BLOCK_INSUFFICIENT
  if (decision.action === 'BLOCK_INSUFFICIENT') {
    return json<ErrorResponse>(res, 400, {
      error: decision.reason,
      code: 'pool_insufficient',
      details: {
        remaining_dkk: remainingPool,
        requested_dkk: amountDkk,
      },
    });
  }

  // 7b. Insert wallet_payouts (provider + status afhænger af beslutning)
  const provider =
    decision.action === 'EXECUTE_MOBILEPAY_CASH' ? MOBILEPAY_PROVIDER : VOUCHERS_PROVIDER;
  const initialStatus =
    decision.action === 'EXECUTE_MOBILEPAY_CASH' ? 'pending' : 'diverted_to_vouchers';

  const { data: payoutRow, error: insertErr } = await supabase
    .from('wallet_payouts')
    .insert({
      user_id: userId,
      amount_dkk: amountDkk,
      danish_phone: phone,
      status: initialStatus,
      provider,
      pool_decision: decision,
    })
    .select('id, user_id, amount_dkk, status, requested_at')
    .single<WalletPayoutRow>();

  if (insertErr || !payoutRow) {
    console.error('[mobilepay-request] insert failed:', insertErr?.message);
    return json<ErrorResponse>(res, 500, {
      error: 'Failed to persist payout request',
      code: 'insert_failed',
    });
  }

  const pollUrl = `${publicAppUrl}/api/psp/mobilepay-status?payout_id=${encodeURIComponent(payoutRow.id)}`;

  // 7c. Diverted til brand vouchers — vi kalder IKKE MobilePay
  if (decision.action === 'DIVERT_TO_BRAND_VOUCHERS') {
    return json<OkResponse>(res, 200, {
      payout_id: payoutRow.id,
      status: 'diverted_to_vouchers',
      poll_url: pollUrl,
      reason: decision.reason,
    });
  }

  // 8. EXECUTE_MOBILEPAY_CASH — kald MobilePay Business API
  const mpBody: MobilePayPaymentRequestBody = {
    merchantId: mobilepayMerchantId,
    amount: toOre(amountDkk),
    currency: 'DKK',
    phoneNumber: phone,
    description: `Cirkel payout ${payoutRow.id}`,
    reference: payoutRow.id,
    callbackUrl: `${publicAppUrl}/api/psp/mobilepay-webhook`,
  };

  let mpResponse: MobilePayPaymentRequestResponse | null = null;
  let mpHttpStatus = 0;
  let mpRawText = '';
  try {
    const mpRes = await fetch(`${mobilepayApiUrl}/v1/payment-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobilepayBearer}`,
        'Idempotency-Key': payoutRow.id,
        Accept: 'application/json',
      },
      body: JSON.stringify(mpBody),
    });
    mpHttpStatus = mpRes.status;
    mpRawText = await mpRes.text();
    try {
      mpResponse = mpRawText ? (JSON.parse(mpRawText) as MobilePayPaymentRequestResponse) : {};
    } catch {
      mpResponse = { raw: mpRawText };
    }

    if (!mpRes.ok) {
      // Marker som failed, gem svar til fejlanalyse
      await supabase
        .from('wallet_payouts')
        .update({
          status: 'failed',
          provider_response: { http_status: mpHttpStatus, body: mpResponse },
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutRow.id);

      return json<ErrorResponse>(res, 502, {
        error: 'MobilePay Business API rejected the payment request',
        code: 'mobilepay_error',
        details: {
          http_status: mpHttpStatus,
          body: mpResponse,
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MobilePay call failed';
    console.error('[mobilepay-request] fetch threw:', message);
    await supabase
      .from('wallet_payouts')
      .update({
        status: 'failed',
        provider_response: { error: message },
        updated_at: new Date().toISOString(),
      })
      .eq('id', payoutRow.id);
    return json<ErrorResponse>(res, 502, {
      error: message,
      code: 'mobilepay_unreachable',
    });
  }

  // 9. Persistér ekstern reference (best-effort — vi returnerer stadig payout_id
  // hvis update fejler; klienten poller på egen id)
  const providerPaymentId =
    typeof mpResponse?.paymentId === 'string' ? mpResponse.paymentId : null;

  await supabase
    .from('wallet_payouts')
    .update({
      provider_payment_id: providerPaymentId,
      provider_response: { http_status: mpHttpStatus, body: mpResponse },
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutRow.id);

  return json<OkResponse>(res, 200, {
    payout_id: payoutRow.id,
    status: 'pending',
    poll_url: pollUrl,
  });
}
