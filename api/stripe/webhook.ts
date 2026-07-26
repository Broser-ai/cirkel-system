// C:\Users\Ambro2\cirkel-system\api\stripe\webhook.ts
//
// Cirkel — Modul 10.2 · Stripe billing webhook (B2B producer remaining_funds)
//
// Vercel serverless handler (Node runtime). Modtager Stripe-events, verificerer
// signaturen med `stripe.webhooks.constructEvent` og opdaterer
// `b2b_producers.remaining_funds` med 80% af `invoice.amount_paid` når en
// invoice.payment_succeeded-event ankommer.
//
// Endpoint:   POST /api/stripe/webhook
// Body:       RAW JSON (Stripe sender rå bytes — vi SKAL læse ubearbejdede
//             bytes for at HMAC-signaturen matcher). Vercels body-parser
//             deaktiveres via `export const config` nedenfor.
//
// Env vars:
//   STRIPE_SECRET_KEY                   — sk_live_... / sk_test_...
//   STRIPE_WEBHOOK_SIGNATURE_SECRET     — whsec_... fra Stripe Dashboard
//   SUPABASE_URL                        — https://<projekt>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY           — server-side kun (aldrig VITE_)
//   STRIPE_ALLOCATION_PCT               — valgfri override, default = 0.80
//
// Håndterede events:
//   - invoice.payment_succeeded → +80% af amount_paid til remaining_funds
//
// Alle øvrige events kvitteres med 200 { success:true, handled:false } så
// Stripe ikke retry'er unødigt.
//
// F3.8-note: verifyFirebaseToken er IKKE anvendt her. Webhooken kommer fra
// Stripe (ikke en Cirkel-bruger), og HMAC-signaturen er den kanoniske
// autentificering. Hvis fremtidige varianter tilføjer bruger-initierede
// stier ind gennem samme handler, importér da `./` -> '../_verify-firebase-token'.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Vercel-config: slå body-parser fra så vi kan læse rå bytes til Stripe-sig.
// ---------------------------------------------------------------------------

export const config = {
  api: {
    bodyParser: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HandledEventType = 'invoice.payment_succeeded';

interface WebhookOkData {
  event_id: string;
  event_type: string;
  handled: boolean;
  producer_id?: string;
  stripe_customer_id?: string;
  amount_paid_dkk?: number;
  allocation_pct?: number;
  allocated_dkk?: number;
  previous_remaining_funds_dkk?: number;
  new_remaining_funds_dkk?: number;
  note?: string;
}

interface WebhookOkBody {
  success: true;
  data: WebhookOkData;
}

interface WebhookErrBody {
  success: false;
  error: string;
  code?: string;
}

interface B2BProducerRow {
  producer_id: string;
  stripe_customer_id: string | null;
  remaining_funds: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HANDLED_EVENT_TYPES: readonly HandledEventType[] = [
  'invoice.payment_succeeded',
] as const;

const DEFAULT_ALLOCATION_PCT = 0.8;
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-09-30.acacia';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readAllocationPct(): number {
  const raw = process.env.STRIPE_ALLOCATION_PCT;
  if (!raw || raw.trim() === '') return DEFAULT_ALLOCATION_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return DEFAULT_ALLOCATION_PCT;
  return n;
}

// ---------------------------------------------------------------------------
// Lazy singletons (samme mønster som resten af api/*.ts — undgår crash i mock/lokal
// hvor env ikke er sat, og undgår at oprette flere klienter pr. cold start)
// ---------------------------------------------------------------------------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  _sb = createClient(url, key, {
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
    appInfo: { name: 'cirkel-system.webhook', version: '1.0.0' },
  });
  return _stripe;
}

// ---------------------------------------------------------------------------
// Raw-body helper — nødvendig fordi Vercels default body-parser normalt spiser
// bytes'ene inden `stripe.webhooks.constructEvent` kan beregne HMAC over dem.
// ---------------------------------------------------------------------------

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson<T>(res: VercelResponse, status: number, body: T): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}

function ok(res: VercelResponse, data: WebhookOkData): void {
  sendJson<WebhookOkBody>(res, 200, { success: true, data });
}

function fail(res: VercelResponse, status: number, error: string, code?: string): void {
  sendJson<WebhookErrBody>(res, status, { success: false, error, code });
}

// ---------------------------------------------------------------------------
// Business logic: invoice.payment_succeeded → +80% allocation til remaining_funds
//
// Stripe leverer beløb i minor units (øre for DKK). Vi runder til to decimaler
// på DKK-siden for at matche skemaets NUMERIC(12,2). Nul-belløb og ukendte
// kunder returneres som 200 { handled:false } med forklarende note — det er
// per Stripe-anbefaling at kvittere med 2xx også når vi bevidst dropper eventet.
// ---------------------------------------------------------------------------

async function handleInvoicePaymentSucceeded(
  sb: SupabaseClient,
  invoice: Stripe.Invoice,
  eventId: string,
): Promise<WebhookOkData> {
  const stripeCustomerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id ?? null;

  if (!stripeCustomerId) {
    return {
      event_id: eventId,
      event_type: 'invoice.payment_succeeded',
      handled: false,
      note: 'Invoice missing customer id — nothing to allocate.',
    };
  }

  const amountPaidMinor =
    typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;

  if (amountPaidMinor <= 0) {
    return {
      event_id: eventId,
      event_type: 'invoice.payment_succeeded',
      handled: false,
      stripe_customer_id: stripeCustomerId,
      amount_paid_dkk: 0,
      note: 'amount_paid <= 0 — ingen allocation.',
    };
  }

  const amountPaidDkk = Math.round(amountPaidMinor) / 100;
  const allocationPct = readAllocationPct();
  const allocatedDkk = Math.round(amountPaidDkk * allocationPct * 100) / 100;

  const { data: producer, error: prodErr } = await sb
    .from('b2b_producers')
    .select('producer_id, stripe_customer_id, remaining_funds, is_active')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle<B2BProducerRow>();

  if (prodErr) {
    throw new Error(`db_error_lookup: ${prodErr.message}`);
  }

  if (!producer) {
    return {
      event_id: eventId,
      event_type: 'invoice.payment_succeeded',
      handled: false,
      stripe_customer_id: stripeCustomerId,
      amount_paid_dkk: amountPaidDkk,
      allocation_pct: allocationPct,
      allocated_dkk: allocatedDkk,
      note: `No b2b_producers row for stripe_customer_id=${stripeCustomerId}.`,
    };
  }

  const previousRemaining = Number(producer.remaining_funds) || 0;
  const newRemaining =
    Math.round((previousRemaining + allocatedDkk) * 100) / 100;

  const { error: updErr } = await sb
    .from('b2b_producers')
    .update({
      remaining_funds: newRemaining,
      updated_at: new Date().toISOString(),
    })
    .eq('producer_id', producer.producer_id);

  if (updErr) {
    throw new Error(`db_error_update: ${updErr.message}`);
  }

  console.log(
    `[stripe-webhook] invoice.payment_succeeded event=${eventId} ` +
      `producer=${producer.producer_id} paid=${amountPaidDkk} DKK ` +
      `allocated=${allocatedDkk} DKK (${(allocationPct * 100).toFixed(0)}%) ` +
      `remaining_funds ${previousRemaining} -> ${newRemaining}`,
  );

  return {
    event_id: eventId,
    event_type: 'invoice.payment_succeeded',
    handled: true,
    producer_id: producer.producer_id,
    stripe_customer_id: stripeCustomerId,
    amount_paid_dkk: amountPaidDkk,
    allocation_pct: allocationPct,
    allocated_dkk: allocatedDkk,
    previous_remaining_funds_dkk: previousRemaining,
    new_remaining_funds_dkk: newRemaining,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  // 2) Signaturheader
  const sigHeader = req.headers['stripe-signature'];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!signature || typeof signature !== 'string') {
    return fail(res, 400, 'Missing Stripe-Signature header', 'missing_signature');
  }

  // 3) Rå body (bodyParser er slået fra ovenfor)
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return fail(res, 400, `Failed to read request body: ${message}`, 'body_read_error');
  }
  if (rawBody.length === 0) {
    return fail(res, 400, 'Empty request body', 'empty_body');
  }

  // 4) Env + Stripe-klient
  let webhookSecret: string;
  let stripe: Stripe;
  try {
    webhookSecret = requireEnv('STRIPE_WEBHOOK_SIGNATURE_SECRET');
    stripe = getStripe();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server misconfiguration';
    return fail(res, 500, message, 'env_missing');
  }

  // 5) HMAC-verify — kanonisk autentificering for denne endpoint
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    return fail(
      res,
      400,
      `Webhook signature verification failed: ${message}`,
      'invalid_signature',
    );
  }

  // 6) Filtrér — kvittér 200 for ikke-håndterede typer så Stripe ikke retry'er
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return ok(res, {
      event_id: event.id,
      event_type: event.type,
      handled: false,
      note: 'Event type not handled by this endpoint.',
    });
  }

  // 7) Supabase-klient (lazy — env-fejl bliver 500)
  let sb: SupabaseClient;
  try {
    sb = getSupabase();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supabase misconfiguration';
    return fail(res, 500, message, 'env_missing');
  }

  // 8) Dispatch
  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      const data = await handleInvoicePaymentSucceeded(sb, invoice, event.id);
      return ok(res, data);
    }

    // Uopnåelig pga. HANDLED_EVENT_TYPES-guard ovenfor — men kompilator-safe fallback.
    return ok(res, {
      event_id: event.id,
      event_type: event.type,
      handled: false,
      note: 'No dispatch branch matched.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handler failed';
    console.error(
      `[stripe-webhook] handler_error event=${event.id} type=${event.type} err=${message}`,
    );
    // 500 → Stripe retry'er automatisk med exponential backoff (op til ~3 dage).
    return fail(res, 500, message, 'handler_error');
  }
}
