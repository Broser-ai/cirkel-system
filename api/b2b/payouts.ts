// C:\Users\Ambro2\cirkel-system\api\b2b\payouts.ts
//
// Cirkel — Modul 10.4 · B2B producer payouts (Stripe Connect · MobilePay-cash)
//
// POST /api/b2b/payouts
//
// Trigger en Stripe Connect-udbetaling til en producent. Endpointet er den
// programmerbare vej for producenter (og platform-admins) til at trække penge
// ud af deres remaining_funds-saldo. Alle udbetalinger går igennem Modul 1.3
// Pool Sovereignty Guard, som beslutter om:
//   - MobilePay-kontantudbetaling gennemføres (EXECUTE_MOBILEPAY_CASH)
//   - Beløbet omdirigeres til brand-vouchers (DIVERT_TO_BRAND_VOUCHERS)
//   - Udbetalingen blokeres (BLOCK_INSUFFICIENT)
//
// Body (POST JSON):
//   {
//     "producer_id":         "<UUID>",           // required
//     "payout_amount_dkk":   1250.00,             // required, > 0
//     "stripe_account_id":   "acct_XXXX",         // optional override,
//                                                 //  ellers hentes fra producent-row
//     "idempotency_key":     "<uuid-v4>"          // optional; klient-kontrolleret
//                                                 //  Stripe-idempotency
//   }
//
// Response (success 200):
//   {
//     success: true,
//     data: {
//       producer_id: string,
//       action: "EXECUTED" | "DIVERTED_TO_VOUCHERS",
//       amount_dkk: number,
//       previous_remaining_funds_dkk: number,
//       new_remaining_funds_dkk: number,
//       stripe_transfer_id?: string,            // sat når action = EXECUTED
//       stripe_account_id?: string,              // sat når action = EXECUTED
//       voucher_reference?: string,              // sat når action = DIVERTED_TO_VOUCHERS
//       pool_decision_reason: string,
//       evaluated_at: string
//     }
//   }
//
// Response (fejl):
//   { success: false, error: string, code?: string }
//
// SIKKERHED:
//   - F3.8 — Firebase-token verificeres via verifyFirebaseToken FØR alt andet.
//     Håndhæver ok-flaget uanset FIREBASE_ADMIN_ENFORCE-envvar; udbetalings-
//     endpoints må aldrig serveres til uidentificerede klienter.
//   - Producer-owner check: kalderens verificerede token.email SKAL matche
//     b2b_producers.contact_email (med email_verified === true), ELLER
//     custom claim admin === true (platform-admin).
//   - Supabase service-role klient (lazy init, samme pattern som scan.ts).
//   - Stripe-klient med appInfo — telemetry til vores telemetri-dashboard.
//   - Ingen hardkodede secrets — udelukkende process.env.
//   - Idempotens: klient kan sende idempotency_key. Vi bruger den både på
//     Stripe API-siden og som klient-hint i vores logs.
//
// DATA-KILDER:
//   b2b_producers (public.b2b_producers) — producer_id, contact_email,
//     remaining_funds, is_active, stripe_customer_id (og valgfrit
//     stripe_connect_account_id hvis kolonnen findes i produktions-skemaet).
//
// Bemærk: kolonnen stripe_connect_account_id findes IKKE i migration 013 (v1
// skema). Handleren læser den defensivt (kolonne-eksisterer-ikke → undefined)
// og accepterer et body-override `stripe_account_id`. En fremtidig migration
// forventes at tilføje kolonnen; koden er forwards-kompatibel uden ændringer.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { verifyFirebaseToken } from '../_verify-firebase-token.js';
import {
  evaluatePoolSovereignty,
  PoolGuardInputError,
  type PoolSovereigntyDecision,
} from '../_pool-guard.js';

// ---------- Vercel config -----------------------------------------------

export const config = {
  api: {
    bodyParser: true,
  },
} as const;

// ---------- Konstanter --------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_ACCOUNT_RE = /^acct_[A-Za-z0-9]+$/;
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-09-30.acacia';

// DKK øre-konvertering: Stripe arbejder i minor units.
const DKK_MINOR_UNITS_PER_DKK = 100;

// Max størrelse på en enkelt udbetaling. Beskytter mod scripting-fejl der
// dræner en producents pulje via ét kald. Kan overrides via env.
const DEFAULT_MAX_SINGLE_PAYOUT_DKK = 100_000;

// ---------- Body-parsing typer ------------------------------------------

interface RawBody {
  readonly producer_id?: unknown;
  readonly payout_amount_dkk?: unknown;
  readonly stripe_account_id?: unknown;
  readonly idempotency_key?: unknown;
}

interface ParsedBody {
  readonly producer_id: string;
  readonly payout_amount_dkk: number;
  readonly stripe_account_id: string | null;
  readonly idempotency_key: string | null;
}

// ---------- DB-row typer ------------------------------------------------

interface ProducerRow {
  readonly producer_id: string;
  readonly contact_email: string;
  readonly is_active: boolean;
  readonly remaining_funds: number;
  readonly stripe_customer_id: string | null;
  readonly stripe_connect_account_id: string | null;
}

// ---------- Auth typer --------------------------------------------------

interface DecodedTokenLite {
  readonly uid?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly admin?: boolean;
  readonly role?: string;
}

// ---------- Response typer ----------------------------------------------

type PayoutAction = 'EXECUTED' | 'DIVERTED_TO_VOUCHERS';

interface PayoutSuccessData {
  readonly producer_id: string;
  readonly action: PayoutAction;
  readonly amount_dkk: number;
  readonly previous_remaining_funds_dkk: number;
  readonly new_remaining_funds_dkk: number;
  readonly stripe_transfer_id?: string;
  readonly stripe_account_id?: string;
  readonly voucher_reference?: string;
  readonly pool_decision_reason: string;
  readonly evaluated_at: string;
}

interface SuccessResponse {
  readonly success: true;
  readonly data: PayoutSuccessData;
}

interface ErrorResponse {
  readonly success: false;
  readonly error: string;
  readonly code?: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

// ---------- Env helpers -------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readMaxSinglePayoutDkk(): number {
  const raw = process.env.B2B_MAX_SINGLE_PAYOUT_DKK;
  if (!raw || raw.trim() === '') return DEFAULT_MAX_SINGLE_PAYOUT_DKK;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_SINGLE_PAYOUT_DKK;
  return n;
}

// ---------- Lazy singletons --------------------------------------------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _sb;
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    appInfo: { name: 'cirkel-system.b2b.payouts', version: '1.0.0' },
  });
  return _stripe;
}

// ---------- Response helpers -------------------------------------------

function sendJson(res: VercelResponse, status: number, body: ApiResponse): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}

function ok(res: VercelResponse, data: PayoutSuccessData): void {
  sendJson(res, 200, { success: true, data });
}

function fail(
  res: VercelResponse,
  status: number,
  error: string,
  code?: string,
): void {
  sendJson(res, status, { success: false, error, code });
}

// ---------- Body-validering --------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseAndValidateBody(
  body: unknown,
): { ok: true; value: ParsedBody } | { ok: false; reason: string; code: string } {
  if (!isRecord(body)) {
    return {
      ok: false,
      reason: 'Request body skal være et JSON-objekt.',
      code: 'invalid_body',
    };
  }
  const raw: RawBody = body;

  const producer_id = toStringOrNull(raw.producer_id);
  if (!producer_id) {
    return {
      ok: false,
      reason: "Field 'producer_id' er påkrævet.",
      code: 'missing_producer_id',
    };
  }
  if (!UUID_RE.test(producer_id)) {
    return {
      ok: false,
      reason: "Field 'producer_id' skal være et gyldigt UUID.",
      code: 'invalid_producer_id',
    };
  }

  const payoutAmount = toFiniteNumber(raw.payout_amount_dkk);
  if (payoutAmount === null) {
    return {
      ok: false,
      reason: "Field 'payout_amount_dkk' er påkrævet og skal være et tal.",
      code: 'missing_amount',
    };
  }
  if (payoutAmount <= 0) {
    return {
      ok: false,
      reason: "Field 'payout_amount_dkk' skal være strengt større end 0.",
      code: 'invalid_amount',
    };
  }
  const maxSingle = readMaxSinglePayoutDkk();
  if (payoutAmount > maxSingle) {
    return {
      ok: false,
      reason: `payout_amount_dkk (${payoutAmount}) overstiger maks pr. udbetaling (${maxSingle} DKK).`,
      code: 'amount_exceeds_max',
    };
  }
  // Klam-safe: round to 2 decimals (NUMERIC(12,2))
  const payout_amount_dkk = round2(payoutAmount);

  const stripeAccountRaw = toStringOrNull(raw.stripe_account_id);
  if (stripeAccountRaw !== null && !STRIPE_ACCOUNT_RE.test(stripeAccountRaw)) {
    return {
      ok: false,
      reason: "Field 'stripe_account_id' skal matche formatet 'acct_...'.",
      code: 'invalid_stripe_account',
    };
  }

  const idempotency_key = toStringOrNull(raw.idempotency_key);
  if (idempotency_key !== null && idempotency_key.length > 255) {
    return {
      ok: false,
      reason: "Field 'idempotency_key' må højst være 255 tegn.",
      code: 'invalid_idempotency_key',
    };
  }

  return {
    ok: true,
    value: {
      producer_id,
      payout_amount_dkk,
      stripe_account_id: stripeAccountRaw,
      idempotency_key,
    },
  };
}

// ---------- Auth-check --------------------------------------------------

/**
 * Producer-owner check:
 *   1. Platform-admin via custom claim (admin === true eller role === 'admin').
 *   2. Producentens contact_email matcher token.email (email_verified === true).
 */
function isAuthorizedForProducer(
  decoded: DecodedTokenLite | null | undefined,
  producer: ProducerRow,
): boolean {
  if (!decoded) return false;

  if (decoded.admin === true) return true;
  if (typeof decoded.role === 'string' && decoded.role.toLowerCase() === 'admin') {
    return true;
  }

  const tokenEmail =
    typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const producerEmail = producer.contact_email.trim().toLowerCase();
  if (!tokenEmail || !producerEmail) return false;
  if (tokenEmail !== producerEmail) return false;

  // Firebase-anbefaling: kræv email_verified for at undgå at en angriber
  // opretter en account med samme email uden at eje inboxen.
  if (decoded.email_verified !== true) return false;

  return true;
}

// ---------- Producer-lookup --------------------------------------------

/**
 * Slår producenten op fra b2b_producers. Læser stripe_connect_account_id
 * defensivt — hvis kolonnen ikke findes i skemaet (migration ikke rullet ud
 * endnu) falder vi tilbage til et andet SELECT uden kolonnen.
 */
async function fetchProducer(
  sb: SupabaseClient,
  producer_id: string,
): Promise<ProducerRow | null> {
  // Første forsøg: inkludér stripe_connect_account_id.
  const withConnect = await sb
    .from('b2b_producers')
    .select(
      'producer_id,contact_email,is_active,remaining_funds,stripe_customer_id,stripe_connect_account_id',
    )
    .eq('producer_id', producer_id)
    .maybeSingle();

  if (!withConnect.error) {
    if (!withConnect.data) return null;
    const row = withConnect.data as {
      producer_id: string;
      contact_email: string;
      is_active: boolean;
      remaining_funds: number | string;
      stripe_customer_id: string | null;
      stripe_connect_account_id: string | null;
    };
    return {
      producer_id: row.producer_id,
      contact_email: row.contact_email,
      is_active: row.is_active,
      remaining_funds: Number(row.remaining_funds) || 0,
      stripe_customer_id: row.stripe_customer_id ?? null,
      stripe_connect_account_id: row.stripe_connect_account_id ?? null,
    };
  }

  // Fallback: hvis kolonnen ikke findes (Postgres 42703), prøv uden.
  const message = (withConnect.error.message || '').toLowerCase();
  const isColumnMissing =
    message.includes('stripe_connect_account_id') ||
    message.includes('column') ||
    message.includes('does not exist');

  if (!isColumnMissing) {
    const err = new Error(`b2b_producers-lookup fejlede: ${withConnect.error.message}`);
    (err as Error & { supabase?: unknown }).supabase = withConnect.error;
    throw err;
  }

  const legacy = await sb
    .from('b2b_producers')
    .select(
      'producer_id,contact_email,is_active,remaining_funds,stripe_customer_id',
    )
    .eq('producer_id', producer_id)
    .maybeSingle();

  if (legacy.error) {
    const err = new Error(`b2b_producers-lookup fejlede: ${legacy.error.message}`);
    (err as Error & { supabase?: unknown }).supabase = legacy.error;
    throw err;
  }
  if (!legacy.data) return null;

  const legacyRow = legacy.data as {
    producer_id: string;
    contact_email: string;
    is_active: boolean;
    remaining_funds: number | string;
    stripe_customer_id: string | null;
  };
  return {
    producer_id: legacyRow.producer_id,
    contact_email: legacyRow.contact_email,
    is_active: legacyRow.is_active,
    remaining_funds: Number(legacyRow.remaining_funds) || 0,
    stripe_customer_id: legacyRow.stripe_customer_id ?? null,
    stripe_connect_account_id: null,
  };
}

/**
 * Trækker payout-beløbet fra remaining_funds. Opdaterer atomisk med en
 * WHERE-klausul der beskytter mod race-conditions: kun opdatér hvis
 * remaining_funds stadig matcher previous. Kaster ved conflict så caller
 * kan returnere 409 til klienten.
 */
async function debitProducerFunds(
  sb: SupabaseClient,
  producer_id: string,
  previousRemaining: number,
  amountDkk: number,
): Promise<number> {
  const newRemaining = round2(previousRemaining - amountDkk);
  if (newRemaining < 0) {
    const err = new Error(
      `debit ville sætte remaining_funds negativ (${newRemaining}); guard-check burde have fanget dette.`,
    );
    (err as Error & { code?: string }).code = 'debit_underflow';
    throw err;
  }

  // Optimistic concurrency: opdater kun hvis remaining_funds ikke er ændret
  // siden vores fetch. Vi tolererer floating-point ved at bruge equality på
  // NUMERIC(12,2) — Postgres sammenligner den fikserede repræsentation.
  const { data, error } = await sb
    .from('b2b_producers')
    .update({
      remaining_funds: newRemaining,
      updated_at: new Date().toISOString(),
    })
    .eq('producer_id', producer_id)
    .eq('remaining_funds', previousRemaining)
    .select('producer_id')
    .maybeSingle();

  if (error) {
    const err = new Error(`b2b_producers debit fejlede: ${error.message}`);
    (err as Error & { supabase?: unknown; code?: string }).supabase = error;
    (err as Error & { code?: string }).code = 'db_error_update';
    throw err;
  }
  if (!data) {
    const err = new Error(
      'Optimistic-concurrency conflict: remaining_funds er ændret siden lookup.',
    );
    (err as Error & { code?: string }).code = 'concurrent_modification';
    throw err;
  }

  return newRemaining;
}

/**
 * Refunderer et debiteret beløb hvis efterfølgende Stripe-transfer fejler.
 * Best-effort — logges hvis det fejler, så kompensationen kan hånd-køres.
 */
async function reverseDebit(
  sb: SupabaseClient,
  producer_id: string,
  amountDkk: number,
  reason: string,
): Promise<void> {
  try {
    // Hent nuværende saldo (kan være ændret af parallelle kald) og læg tilbage.
    const { data, error } = await sb
      .from('b2b_producers')
      .select('remaining_funds')
      .eq('producer_id', producer_id)
      .maybeSingle();
    if (error || !data) {
      console.error(
        `[b2b/payouts] reverseDebit: kunne ikke læse producent ${producer_id}: ${error?.message ?? 'row missing'}`,
      );
      return;
    }
    const current = Number((data as { remaining_funds: number | string }).remaining_funds) || 0;
    const restored = round2(current + amountDkk);
    const { error: updErr } = await sb
      .from('b2b_producers')
      .update({
        remaining_funds: restored,
        updated_at: new Date().toISOString(),
      })
      .eq('producer_id', producer_id);
    if (updErr) {
      console.error(
        `[b2b/payouts] reverseDebit UPDATE fejlede producer=${producer_id} amount=${amountDkk} reason="${reason}": ${updErr.message}`,
      );
      return;
    }
    console.warn(
      `[b2b/payouts] reverseDebit OK producer=${producer_id} +${amountDkk} DKK → ${restored} (reason="${reason}")`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[b2b/payouts] reverseDebit kastede producer=${producer_id}: ${message}`,
    );
  }
}

// ---------- Voucher-reference generator --------------------------------

function generateVoucherReference(producerId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const shortProducer = producerId.replace(/-/g, '').slice(0, 8);
  return `VCHR-${shortProducer}-${ts}-${rand}`.toUpperCase();
}

// ---------- Stripe transfer --------------------------------------------

interface TransferResult {
  readonly transfer_id: string;
  readonly stripe_account_id: string;
}

async function executeStripeTransfer(
  stripe: Stripe,
  destinationAccount: string,
  amountDkk: number,
  producerId: string,
  idempotencyKey: string | null,
): Promise<TransferResult> {
  const amountMinor = Math.round(amountDkk * DKK_MINOR_UNITS_PER_DKK);

  const params: Stripe.TransferCreateParams = {
    amount: amountMinor,
    currency: 'dkk',
    destination: destinationAccount,
    description: `Cirkel payout · producer=${producerId} · ${amountDkk.toFixed(2)} DKK`,
    metadata: {
      cirkel_module: '10.4',
      cirkel_producer_id: producerId,
      cirkel_amount_dkk: amountDkk.toFixed(2),
    },
  };

  const options: Stripe.RequestOptions | undefined = idempotencyKey
    ? { idempotencyKey: `cirkel-payout-${idempotencyKey}` }
    : undefined;

  const transfer = options
    ? await stripe.transfers.create(params, options)
    : await stripe.transfers.create(params);

  return {
    transfer_id: transfer.id,
    stripe_account_id: destinationAccount,
  };
}

// ---------- Handler ----------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  // 2) Body-validering
  const parsed = parseAndValidateBody(req.body);
  if (!parsed.ok) {
    return fail(res, 400, parsed.reason, parsed.code);
  }
  const { producer_id, payout_amount_dkk, stripe_account_id, idempotency_key } =
    parsed.value;

  // 3) F3.8 — Firebase-token verify (hårdt krav for udbetalings-endpoints).
  let decoded: DecodedTokenLite | null = null;
  try {
    const verified = await verifyFirebaseToken(req, {});
    if (!verified.ok) {
      return fail(res, verified.status, verified.reason, 'auth_failed');
    }
    if (!verified.verified) {
      // Payout-endpoints må aldrig serveres til uidentificerede klienter,
      // selv i warn_only-mode.
      return fail(
        res,
        401,
        'Firebase-token er ikke cryptografisk verificeret. Bearer-token påkrævet.',
        'token_not_verified',
      );
    }
    decoded = (verified.decoded_token ?? null) as DecodedTokenLite | null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[b2b/payouts] verifyFirebaseToken kastede:', message);
    return fail(res, 500, 'Auth-verifikation fejlede.', 'auth_error');
  }

  // 4) Supabase-klient
  const sb = getSupabase();
  if (!sb) {
    return fail(
      res,
      503,
      'Supabase service-role-nøgle ikke konfigureret.',
      'supabase_unavailable',
    );
  }

  // 5) Slå producent op
  let producer: ProducerRow | null;
  try {
    producer = await fetchProducer(sb, producer_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[b2b/payouts] fetchProducer fejlede:', message);
    return fail(res, 502, `Kunne ikke hente producent: ${message}`, 'producer_lookup_failed');
  }
  if (!producer) {
    return fail(res, 404, 'Producer_id findes ikke.', 'producer_not_found');
  }
  if (!producer.is_active) {
    return fail(
      res,
      409,
      'Producent er inaktiv — udbetalinger er pauset.',
      'producer_inactive',
    );
  }

  // 6) Producer-owner check
  if (!isAuthorizedForProducer(decoded, producer)) {
    return fail(
      res,
      403,
      'FORBIDDEN — kalderen ejer ikke denne producent.',
      'not_producer_owner',
    );
  }

  // 7) Pool sovereignty guard (Modul 1.3)
  let decision: PoolSovereigntyDecision;
  try {
    decision = evaluatePoolSovereignty(
      producer.producer_id,
      producer.remaining_funds,
      payout_amount_dkk,
    );
  } catch (err) {
    if (err instanceof PoolGuardInputError) {
      return fail(res, 400, err.message, `pool_guard_${err.field}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[b2b/payouts] evaluatePoolSovereignty kastede:', message);
    return fail(res, 500, `Pool-guard fejlede: ${message}`, 'pool_guard_error');
  }

  if (decision.action === 'BLOCK_INSUFFICIENT') {
    return fail(res, 402, decision.reason, 'pool_insufficient');
  }

  // 8) DIVERT_TO_BRAND_VOUCHERS: registrér debit + voucher-reference,
  //    men gennemfør INGEN Stripe-transfer. Klient forventes at gøre
  //    voucher-udstedelse i særskilt flow (Modul 10.5).
  if (decision.action === 'DIVERT_TO_BRAND_VOUCHERS') {
    let newRemaining: number;
    try {
      newRemaining = await debitProducerFunds(
        sb,
        producer.producer_id,
        producer.remaining_funds,
        payout_amount_dkk,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        (err as Error & { code?: string }).code ?? 'debit_failed';
      const status = code === 'concurrent_modification' ? 409 : 500;
      console.error('[b2b/payouts] debit (divert) fejlede:', message);
      return fail(res, status, message, code);
    }

    const voucherRef = generateVoucherReference(producer.producer_id);
    console.log(
      `[b2b/payouts] DIVERTED_TO_VOUCHERS producer=${producer.producer_id} ` +
        `amount=${payout_amount_dkk} DKK voucher=${voucherRef} ` +
        `remaining_funds ${producer.remaining_funds} -> ${newRemaining} ` +
        `(reason="${decision.reason}")`,
    );

    return ok(res, {
      producer_id: producer.producer_id,
      action: 'DIVERTED_TO_VOUCHERS',
      amount_dkk: payout_amount_dkk,
      previous_remaining_funds_dkk: producer.remaining_funds,
      new_remaining_funds_dkk: newRemaining,
      voucher_reference: voucherRef,
      pool_decision_reason: decision.reason,
      evaluated_at: decision.evaluatedAt,
    });
  }

  // 9) EXECUTE_MOBILEPAY_CASH: gennemfør Stripe-transfer.
  //    Kræver enten body-override eller kolonne på producent-rækken.
  const destinationAccount = stripe_account_id ?? producer.stripe_connect_account_id;
  if (!destinationAccount) {
    return fail(
      res,
      422,
      'Producent har intet Stripe Connect account_id, og ingen override er sendt.',
      'no_stripe_account',
    );
  }
  if (!STRIPE_ACCOUNT_RE.test(destinationAccount)) {
    return fail(
      res,
      422,
      `Stripe account_id har ugyldigt format: ${destinationAccount}`,
      'invalid_stripe_account_stored',
    );
  }

  // Stripe-klient (env-fejl bliver 500)
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe misconfiguration';
    return fail(res, 500, message, 'env_missing');
  }

  // Debit først, transfer bagefter. Ved transfer-fejl kompenserer vi.
  let newRemaining: number;
  try {
    newRemaining = await debitProducerFunds(
      sb,
      producer.producer_id,
      producer.remaining_funds,
      payout_amount_dkk,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as Error & { code?: string }).code ?? 'debit_failed';
    const status = code === 'concurrent_modification' ? 409 : 500;
    console.error('[b2b/payouts] debit (execute) fejlede:', message);
    return fail(res, status, message, code);
  }

  let transferResult: TransferResult;
  try {
    transferResult = await executeStripeTransfer(
      stripe,
      destinationAccount,
      payout_amount_dkk,
      producer.producer_id,
      idempotency_key,
    );
  } catch (err) {
    // Stripe fejlede efter debit — refunder den bogførte saldo (best-effort).
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[b2b/payouts] Stripe transfer fejlede efter debit producer=${producer.producer_id}: ${message}`,
    );
    await reverseDebit(
      sb,
      producer.producer_id,
      payout_amount_dkk,
      `stripe_transfer_failed: ${message}`,
    );
    const stripeCode =
      err instanceof Stripe.errors.StripeError ? err.code ?? 'stripe_error' : 'stripe_error';
    return fail(res, 502, `Stripe transfer fejlede: ${message}`, stripeCode);
  }

  console.log(
    `[b2b/payouts] EXECUTED producer=${producer.producer_id} ` +
      `amount=${payout_amount_dkk} DKK transfer=${transferResult.transfer_id} ` +
      `dest=${transferResult.stripe_account_id} ` +
      `remaining_funds ${producer.remaining_funds} -> ${newRemaining} ` +
      `(reason="${decision.reason}")`,
  );

  return ok(res, {
    producer_id: producer.producer_id,
    action: 'EXECUTED',
    amount_dkk: payout_amount_dkk,
    previous_remaining_funds_dkk: producer.remaining_funds,
    new_remaining_funds_dkk: newRemaining,
    stripe_transfer_id: transferResult.transfer_id,
    stripe_account_id: transferResult.stripe_account_id,
    pool_decision_reason: decision.reason,
    evaluated_at: decision.evaluatedAt,
  });
}

// ---------- Public type exports ----------------------------------------

export type {
  ApiResponse,
  SuccessResponse,
  ErrorResponse,
  PayoutSuccessData,
  PayoutAction,
};
