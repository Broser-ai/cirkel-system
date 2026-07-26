// C:\Users\Ambro2\cirkel-system\api\psp\stripe-checkout.ts
//
// Cirkel — F3.8: Stripe Checkout Session opret (B2B producer subscriptions)
//
// Vercel serverless handler (Node runtime).
// POST body: { producer_id: string, subscription_tier: 'standard' | 'premium' | 'enterprise' }
// Response: { session_id: string, url: string }
//
// Env vars required:
//   STRIPE_SECRET_KEY               — sk_live_... / sk_test_...
//   STRIPE_PRICE_STANDARD           — price_... for standard tier
//   STRIPE_PRICE_PREMIUM            — price_... for premium tier
//   STRIPE_PRICE_ENTERPRISE         — price_... for enterprise tier
//   PUBLIC_APP_URL                  — fx https://cirkel.dk (bruges til success/cancel URLs)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY       — server-side kun, service-role
//
// package.json dependencies to add:
//   "stripe": "^17.0.0"
//   "@supabase/supabase-js": "^2.45.0"
//
// F3.8 wiring: admin OR producer-owner may create session for a given producer_id.
// Auth: forward caller's Supabase JWT via `Authorization: Bearer <token>` header.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------- Types ----------

type SubscriptionTier = 'standard' | 'premium' | 'enterprise';

interface CheckoutRequestBody {
  producer_id: string;
  subscription_tier: SubscriptionTier;
}

interface CheckoutResponseBody {
  session_id: string;
  url: string;
}

interface ErrorResponseBody {
  error: string;
  code?: string;
}

interface ProducerRow {
  id: string;
  name: string;
  email: string | null;
  owner_user_id: string | null;
  stripe_customer_id: string | null;
  subscription_tier: SubscriptionTier | null;
}

interface UserClaims {
  sub: string;
  role?: string;
  app_metadata?: { role?: string };
  user_metadata?: Record<string, unknown>;
}

// ---------- Constants ----------

const TIER_PRICE_ENV: Record<SubscriptionTier, string> = {
  standard: 'STRIPE_PRICE_STANDARD',
  premium: 'STRIPE_PRICE_PREMIUM',
  enterprise: 'STRIPE_PRICE_ENTERPRISE',
};

const VALID_TIERS: readonly SubscriptionTier[] = ['standard', 'premium', 'enterprise'] as const;

// ---------- Helpers ----------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isValidTier(value: unknown): value is SubscriptionTier {
  return typeof value === 'string' && (VALID_TIERS as readonly string[]).includes(value);
}

function json<T>(res: VercelResponse, status: number, body: T): void {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(body));
}

function getBearerToken(req: VercelRequest): string | null {
  const header = req.headers['authorization'] || req.headers['Authorization' as unknown as string];
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isAdmin(claims: UserClaims): boolean {
  const role = claims.app_metadata?.role ?? claims.role;
  return role === 'admin' || role === 'service_role';
}

// ---------- Handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Method guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json<ErrorResponseBody>(res, 405, { error: 'Method not allowed', code: 'method_not_allowed' });
  }

  // Parse + validate body
  const body = (req.body ?? {}) as Partial<CheckoutRequestBody>;
  const producerId = typeof body.producer_id === 'string' ? body.producer_id.trim() : '';
  const tier = body.subscription_tier;

  if (!producerId) {
    return json<ErrorResponseBody>(res, 400, { error: 'producer_id is required', code: 'invalid_producer_id' });
  }
  if (!isValidTier(tier)) {
    return json<ErrorResponseBody>(res, 400, {
      error: `subscription_tier must be one of: ${VALID_TIERS.join(', ')}`,
      code: 'invalid_tier',
    });
  }

  // Env
  let stripeSecret: string;
  let supabaseUrl: string;
  let supabaseServiceKey: string;
  let publicAppUrl: string;
  let priceId: string;
  try {
    stripeSecret = requireEnv('STRIPE_SECRET_KEY');
    supabaseUrl = requireEnv('SUPABASE_URL');
    supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    publicAppUrl = requireEnv('PUBLIC_APP_URL').replace(/\/+$/, '');
    priceId = requireEnv(TIER_PRICE_ENV[tier]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server misconfiguration';
    return json<ErrorResponseBody>(res, 500, { error: message, code: 'env_missing' });
  }

  // Auth — require caller JWT so we can verify admin OR producer-owner
  const token = getBearerToken(req);
  if (!token) {
    return json<ErrorResponseBody>(res, 401, { error: 'Missing bearer token', code: 'unauthenticated' });
  }

  const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller identity via service-role client (avoids trusting client-supplied claims)
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json<ErrorResponseBody>(res, 401, { error: 'Invalid or expired token', code: 'invalid_token' });
  }
  const claims: UserClaims = {
    sub: userData.user.id,
    app_metadata: userData.user.app_metadata as { role?: string } | undefined,
    user_metadata: userData.user.user_metadata,
  };

  // Load producer
  const { data: producer, error: prodErr } = await supabaseAdmin
    .from('producers')
    .select('id, name, email, owner_user_id, stripe_customer_id, subscription_tier')
    .eq('id', producerId)
    .maybeSingle<ProducerRow>();

  if (prodErr) {
    return json<ErrorResponseBody>(res, 500, { error: 'Failed to load producer', code: 'db_error' });
  }
  if (!producer) {
    return json<ErrorResponseBody>(res, 404, { error: 'Producer not found', code: 'producer_not_found' });
  }

  // F3.8 authorization: admin OR producer-owner
  const callerIsAdmin = isAdmin(claims);
  const callerIsOwner = producer.owner_user_id !== null && producer.owner_user_id === claims.sub;
  if (!callerIsAdmin && !callerIsOwner) {
    return json<ErrorResponseBody>(res, 403, {
      error: 'Not authorized to create checkout for this producer',
      code: 'forbidden',
    });
  }

  // Stripe client
  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2025-09-30.acacia',
    typescript: true,
    appInfo: { name: 'cirkel-system', version: '1.0.0' },
  });

  // Build session params
  const successUrl = `${publicAppUrl}/b2b/portal?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${publicAppUrl}/b2b/pricing`;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: producer.id,
    metadata: {
      producer_id: producer.id,
      tier,
    },
    subscription_data: {
      metadata: {
        producer_id: producer.id,
        tier,
      },
    },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
  };

  // Reuse existing Stripe customer if we have one; otherwise let Stripe create one via email
  if (producer.stripe_customer_id) {
    sessionParams.customer = producer.stripe_customer_id;
    sessionParams.customer_update = { address: 'auto', name: 'auto' };
  } else if (producer.email) {
    sessionParams.customer_email = producer.email;
  }

  // Create session
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe checkout session creation failed';
    const code =
      err instanceof Stripe.errors.StripeError ? err.code ?? 'stripe_error' : 'stripe_error';
    return json<ErrorResponseBody>(res, 502, { error: message, code });
  }

  if (!session.url) {
    return json<ErrorResponseBody>(res, 502, {
      error: 'Stripe returned session without redirect URL',
      code: 'stripe_no_url',
    });
  }

  const response: CheckoutResponseBody = {
    session_id: session.id,
    url: session.url,
  };
  return json<CheckoutResponseBody>(res, 200, response);
}
