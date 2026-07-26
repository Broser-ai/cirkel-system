// cirkel-system/api/auth/mitid-init.ts
//
// Modul 5.2 — MitID broker initialisering (OIDC Authorization Code + PKCE).
//
// Genererer PKCE code_verifier + code_challenge, opaque state-parameter, og
// gemmer parret {state, code_verifier, expires_at} kort tid i Supabase-tabellen
// `mitid_pkce_state` (migration 014). Redirecter derefter browseren (HTTP 302)
// til MitID broker authorize-endpointet med korrekte query-parametre.
//
// Følges op af `api/auth/mitid-verify.ts`, som slår code_verifier op via state,
// SLETTER rækken (engangs-forbrug), exchanger authorization code → id_token,
// hasher sub og udsteder session-cookie.
//
// VIGTIGT — tabel-alignment:
//   * INSERT/UPSERT sker HER (mitid-init) i public.mitid_pkce_state
//   * SELECT + DELETE sker i mitid-verify samme tabel
//   * expires_at bruges til TTL-check (10 min) — stale states afvises
//
// VIGTIGT — redirect_uri:
//   * Skal være IDENTISK mellem authorize-request (her) og token-exchange
//     (i mitid-verify), ellers fejler token endpoint med invalid_grant.
//   * Peger på mitid-verify som er den fil der reelt håndterer callback.
//
// Ingen ægte MitID SDK-afhængighed — vi bygger request-URL'en efter
// standard OIDC PKCE (RFC 7636 + OpenID Connect Core 1.0).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────────────────────
// Konfiguration (miljøvariabler)
// ────────────────────────────────────────────────────────────────────────────

const MITID_CLIENT_ID: string =
  process.env.MITID_CLIENT_ID ?? 'cirkel-web-app';

const MITID_AUTHORIZE_URL: string =
  process.env.MITID_AUTHORIZE_URL ??
  'https://pp.netseidbroker.dk/op/connect/authorize'; // preprod default

// Peger på mitid-verify (samme fil som slår state op og laver token-exchange).
// SKAL matche den redirect_uri der bruges i mitid-verify.exchangeCode().
const MITID_REDIRECT_URI: string =
  process.env.MITID_REDIRECT_URI ??
  'https://cirkel-system.vercel.app/api/auth/mitid-verify';

const MITID_SCOPE: string = process.env.MITID_SCOPE ?? 'openid';

// Levetid på state/verifier i Supabase — MitID-flow forventes gennemført
// indenfor få minutter; 10 min matcher default i migration 014.
const PKCE_TTL_SECONDS = 600;

// ────────────────────────────────────────────────────────────────────────────
// Typer — matcher public.mitid_pkce_state (migration 014)
// ────────────────────────────────────────────────────────────────────────────

interface PkceRecord {
  state: string;               // VARCHAR(64) PRIMARY KEY
  code_verifier: string;       // VARCHAR(128) NOT NULL
  nonce: string | null;        // VARCHAR(64) NULL
  created_at: string;          // TIMESTAMPTZ (ISO)
  expires_at: string;          // TIMESTAMPTZ (ISO)
  user_id: string | null;      // UUID NULL — sættes senere hvis kendt
}

interface AuthorizeQuery {
  client_id: string;
  redirect_uri: string;
  response_type: 'code';
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  nonce: string;
}

// ────────────────────────────────────────────────────────────────────────────
// PKCE helpers (RFC 7636)
// ────────────────────────────────────────────────────────────────────────────

/** base64url uden padding — påkrævet af RFC 7636 §4.2. */
function base64url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * code_verifier: high-entropy random string, 43–128 tegn, alfabet [A-Z a-z 0-9 -._~].
 * 32 tilfældige bytes → 43 tegn i base64url — inden for spec.
 */
function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** code_challenge = base64url(SHA-256(code_verifier)). */
function generateCodeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** Opaque state — CSRF-token binder browser-session til callback. Max 64 tegn. */
function generateState(): string {
  // 32 bytes → 43 tegn base64url — passer i VARCHAR(64).
  return base64url(randomBytes(32));
}

/** OIDC nonce — binder id_token til denne request. Max 64 tegn. */
function generateNonce(): string {
  return base64url(randomBytes(32));
}

// ────────────────────────────────────────────────────────────────────────────
// Supabase-klient (service_role — mitid_pkce_state er RLS-låst for klienter)
// ────────────────────────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * UPSERT PKCE state til public.mitid_pkce_state.
 *
 * Vi bruger UPSERT (on conflict do update) fordi state er PRIMARY KEY og en
 * kollision i praksis kun kan opstå ved ekstremt usandsynlig genbrug af
 * randomBytes(32) — men UPSERT gør operationen idempotent og undgår hård
 * fejl hvis noget uventet retryer.
 */
async function persistPkceState(
  supabase: SupabaseClient,
  record: PkceRecord,
): Promise<void> {
  const { error } = await supabase
    .from('mitid_pkce_state')
    .upsert(record, { onConflict: 'state' });
  if (error) {
    throw new Error(`pkce_persist_failed:${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// URL-bygning
// ────────────────────────────────────────────────────────────────────────────

function buildAuthorizeUrl(query: AuthorizeQuery): string {
  const params = new URLSearchParams({
    client_id: query.client_id,
    redirect_uri: query.redirect_uri,
    response_type: query.response_type,
    scope: query.scope,
    state: query.state,
    code_challenge: query.code_challenge,
    code_challenge_method: query.code_challenge_method,
    nonce: query.nonce,
  });
  const separator = MITID_AUTHORIZE_URL.includes('?') ? '&' : '?';
  return `${MITID_AUTHORIZE_URL}${separator}${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error('[mitid-init] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mangler');
    res.status(500).json({ error: 'supabase_not_configured' });
    return;
  }

  // Optional: user_id kan sendes med hvis brugeren allerede har en Cirkel-session
  // og vi vil koble MitID-verifikationen til den. Ellers null → knyttes senere
  // via mitid_sub i profiles.
  const userIdFromQuery =
    typeof req.query.user_id === 'string' && req.query.user_id.length > 0
      ? req.query.user_id
      : null;

  try {
    // 1) Generér PKCE-materiale + state + nonce
    const code_verifier = generateCodeVerifier();
    const code_challenge = generateCodeChallenge(code_verifier);
    const state = generateState();
    const nonce = generateNonce();

    // 2) Persistér {state, code_verifier, nonce, expires_at} med udløb
    const now = new Date();
    const expires = new Date(now.getTime() + PKCE_TTL_SECONDS * 1000);
    const record: PkceRecord = {
      state,
      code_verifier,
      nonce,
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      user_id: userIdFromQuery,
    };
    await persistPkceState(supabase, record);

    // 3) Byg authorize-URL
    const authorizeUrl = buildAuthorizeUrl({
      client_id: MITID_CLIENT_ID,
      redirect_uri: MITID_REDIRECT_URI,
      response_type: 'code',
      scope: MITID_SCOPE,
      state,
      code_challenge,
      code_challenge_method: 'S256',
      nonce,
    });

    // 4) 302 redirect til MitID broker
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Location', authorizeUrl);
    res.status(302).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mitid-init] uventet fejl:', message);
    res.status(500).json({ error: 'internal_error' });
  }
}
