// cirkel-system/api/auth/mitid-verify.ts
//
// Modul 5.2 — MitID callback + token exchange (GET only).
//
// Flow:
//   1. Læs ?code & ?state fra request.
//   2. Slå state op i `mitid_pkce_state`-tabellen (migration 014) → hent
//      code_verifier, nonce, user_id og expires_at.
//   3. TTL-check via expires_at (afvis > 10 min gammel / udløbet).
//   4. DELETE rækken UMIDDELBART efter TTL-valid SELECT → engangs-forbrug,
//      hindrer replay selv hvis token-exchange senere skulle retryes.
//   5. POST authorization_code + code_verifier til MITID_TOKEN_URL.
//   6. Parse response → access_token + id_token.
//   7. Hent MitID JWKS, verifér id_token-signatur (RS256), tjek iss/aud/exp/nonce.
//   8. Ekstrahér claims: sub (obligatorisk), name, cpr (kun hvis scope tillod).
//   9. Hvis state havde user_id: opdatér profiles med mitid_sub + tier.
//  10. Udsted session-cookie og returner {status,name,tier}.
//
// VIGTIGT — tabel-alignment:
//   * mitid-init skriver til public.mitid_pkce_state (UPSERT).
//   * mitid-verify (denne fil) læser + SLETTER samme tabel.
//   * expires_at er kilden til TTL-check — ingen used_at/used-flag kolonne.
//
// SIKKERHED:
//   * Ingen ægte MitID SDK — kun Node `crypto` + `fetch`.
//   * State DELETES ved consume — replay udelukket på DB-niveau.
//   * INGEN 'any'. Alle claims valideres eksplicit.
//   * CPR aldrig logget; ikke persisteret her (kan hashes i separat lag).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createPublicKey,
  createVerify,
  type KeyObject,
} from 'crypto';
import { anontomeHash } from '../../src/lib/anontome-server.js';
import { issueSession, cookieHeader } from '../../src/lib/session.js';

// -------------------------------------------------------------------------
// Env
// -------------------------------------------------------------------------

const MITID_TOKEN_URL = process.env.MITID_TOKEN_URL
  ?? 'https://pp.netseidbroker.dk/op/connect/token';
const MITID_JWKS_URL = process.env.MITID_JWKS_URL
  ?? 'https://pp.netseidbroker.dk/op/.well-known/openid-configuration/jwks';
const MITID_CLIENT_ID = process.env.MITID_CLIENT_ID ?? 'cirkel-web-app';
const MITID_CLIENT_SECRET = process.env.MITID_CLIENT_SECRET;

// SKAL være identisk med redirect_uri i mitid-init.ts, ellers fejler
// token-exchange med invalid_grant.
const MITID_REDIRECT_URI = process.env.MITID_REDIRECT_URI
  ?? 'https://cirkel-system.vercel.app/api/auth/mitid-verify';

const MITID_ISSUER = process.env.MITID_ISSUER
  ?? 'https://pp.netseidbroker.dk/op';

// TTL-margin — brugt som fallback hvis expires_at mangler af en eller anden
// grund (bør aldrig ske: kolonnen har NOT NULL DEFAULT NOW() + 10 min).
const STATE_TTL_MS = 10 * 60 * 1000;

// -------------------------------------------------------------------------
// Typing — matcher public.mitid_pkce_state (migration 014)
// -------------------------------------------------------------------------

interface MitidPkceStateRow {
  state: string;
  code_verifier: string;
  nonce: string | null;
  created_at: string;           // ISO 8601
  expires_at: string;           // ISO 8601
  user_id: string | null;       // UUID — nullable
}

interface MitidTokenResponse {
  access_token: string;
  id_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface JwtHeader {
  alg: 'RS256';
  typ?: string;
  kid: string;
}

interface MitidIdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nbf?: number;
  auth_time?: number;
  nonce?: string;
  // MitID-broker claims — alle valgfrie, valideres per-tilfælde
  name?: string;
  cpr?: string;               // KUN til stede hvis scope inkluderede 'nemid.cpr' / 'mitid.cpr'
  identity_type?: string;
  uuid?: string;
}

interface Jwk {
  kty: 'RSA';
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: Jwk[];
}

interface VerifySuccessResponse {
  status: 'verified';
  name: string | null;
  tier: 'mitid';
}

interface VerifyErrorResponse {
  status: 'error';
  error: string;
}

type VerifyResponse = VerifySuccessResponse | VerifyErrorResponse;

// -------------------------------------------------------------------------
// Supabase helper (service-role — mitid_pkce_state er RLS-låst)
// -------------------------------------------------------------------------

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// -------------------------------------------------------------------------
// Base64URL helpers
// -------------------------------------------------------------------------

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

// -------------------------------------------------------------------------
// JWKS cache (proces-scope; koldstartes hver deployment)
// -------------------------------------------------------------------------

interface JwksCache {
  fetchedAt: number;
  keys: Map<string, KeyObject>;
}

let jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 time

async function loadJwks(): Promise<Map<string, KeyObject>> {
  const now = Date.now();
  if (jwksCache && (now - jwksCache.fetchedAt) < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(MITID_JWKS_URL);
  if (!res.ok) {
    throw new Error(`jwks_fetch_failed_${res.status}`);
  }
  const parsed = (await res.json()) as JwksResponse;
  if (!parsed || !Array.isArray(parsed.keys)) {
    throw new Error('jwks_invalid_format');
  }
  const keys = new Map<string, KeyObject>();
  for (const jwk of parsed.keys) {
    if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
    try {
      const keyObject = createPublicKey({ key: jwk, format: 'jwk' });
      keys.set(jwk.kid, keyObject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mitid-verify] JWK ${jwk.kid} parse-fejl: ${msg}`);
    }
  }
  if (keys.size === 0) {
    throw new Error('jwks_no_valid_keys');
  }
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

// -------------------------------------------------------------------------
// JWT verify (RS256 kun)
// -------------------------------------------------------------------------

function parseJwtHeader(encoded: string): JwtHeader {
  const raw = JSON.parse(base64UrlDecode(encoded).toString('utf-8')) as unknown;
  if (!raw || typeof raw !== 'object') throw new Error('jwt_header_invalid');
  const hdr = raw as Record<string, unknown>;
  if (hdr.alg !== 'RS256') throw new Error('jwt_alg_unsupported');
  if (typeof hdr.kid !== 'string' || hdr.kid.length === 0) {
    throw new Error('jwt_kid_missing');
  }
  return {
    alg: 'RS256',
    typ: typeof hdr.typ === 'string' ? hdr.typ : undefined,
    kid: hdr.kid,
  };
}

function parseJwtPayload(encoded: string): MitidIdTokenClaims {
  const raw = JSON.parse(base64UrlDecode(encoded).toString('utf-8')) as unknown;
  if (!raw || typeof raw !== 'object') throw new Error('jwt_payload_invalid');
  const p = raw as Record<string, unknown>;

  if (typeof p.iss !== 'string') throw new Error('jwt_iss_missing');
  if (typeof p.sub !== 'string' || p.sub.length === 0) throw new Error('jwt_sub_missing');
  if (typeof p.exp !== 'number') throw new Error('jwt_exp_missing');
  if (typeof p.iat !== 'number') throw new Error('jwt_iat_missing');
  if (typeof p.aud !== 'string' && !Array.isArray(p.aud)) throw new Error('jwt_aud_missing');

  const claims: MitidIdTokenClaims = {
    iss: p.iss,
    aud: p.aud as string | string[],
    sub: p.sub,
    exp: p.exp,
    iat: p.iat,
  };
  if (typeof p.nbf === 'number') claims.nbf = p.nbf;
  if (typeof p.auth_time === 'number') claims.auth_time = p.auth_time;
  if (typeof p.nonce === 'string') claims.nonce = p.nonce;
  if (typeof p.name === 'string') claims.name = p.name;
  if (typeof p.cpr === 'string') claims.cpr = p.cpr;
  if (typeof p.identity_type === 'string') claims.identity_type = p.identity_type;
  if (typeof p.uuid === 'string') claims.uuid = p.uuid;
  return claims;
}

async function verifyIdToken(
  idToken: string,
  expectedNonce: string | null,
): Promise<MitidIdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('jwt_malformed');
  const [encHeader, encPayload, encSig] = parts;

  const header = parseJwtHeader(encHeader);
  const jwks = await loadJwks();
  const key = jwks.get(header.kid);
  if (!key) throw new Error('jwt_kid_unknown');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encHeader}.${encPayload}`);
  verifier.end();
  const ok = verifier.verify(key, base64UrlDecode(encSig));
  if (!ok) throw new Error('jwt_signature_invalid');

  const claims = parseJwtPayload(encPayload);

  // Standard OIDC-validering
  if (claims.iss !== MITID_ISSUER) throw new Error('jwt_iss_mismatch');
  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(MITID_CLIENT_ID)
    : claims.aud === MITID_CLIENT_ID;
  if (!audOk) throw new Error('jwt_aud_mismatch');
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp < nowSec) throw new Error('jwt_expired');
  if (claims.iat > nowSec + 60) throw new Error('jwt_iat_future'); // 60 s clock-skew
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 60) {
    throw new Error('jwt_nbf_future');
  }

  // Nonce-binding: hvis vi genererede en nonce i init, SKAL id_token indeholde
  // samme værdi. Beskytter mod token-injection.
  if (expectedNonce !== null) {
    if (typeof claims.nonce !== 'string' || claims.nonce !== expectedNonce) {
      throw new Error('jwt_nonce_mismatch');
    }
  }

  return claims;
}

// -------------------------------------------------------------------------
// Token-exchange
// -------------------------------------------------------------------------

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<MitidTokenResponse> {
  if (!MITID_CLIENT_SECRET) throw new Error('mitid_client_secret_missing');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: MITID_REDIRECT_URI,
    client_id: MITID_CLIENT_ID,
    client_secret: MITID_CLIENT_SECRET,
    code_verifier: codeVerifier,
  });
  const res = await fetch(MITID_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`token_exchange_http_${res.status}`);
  }
  const json = (await res.json()) as Partial<MitidTokenResponse>;
  if (typeof json.access_token !== 'string' || typeof json.id_token !== 'string') {
    throw new Error('token_response_invalid');
  }
  return {
    access_token: json.access_token,
    id_token: json.id_token,
    token_type: json.token_type,
    expires_in: json.expires_in,
    refresh_token: json.refresh_token,
    scope: json.scope,
  };
}

// -------------------------------------------------------------------------
// State-storage: SELECT + DELETE fra public.mitid_pkce_state
// -------------------------------------------------------------------------

/**
 * Slår state op, verificerer TTL via expires_at, og SLETTER rækken.
 *
 * Rækkefølge: SELECT → validate TTL → DELETE → returnér data.
 * DELETE sker FØR token-exchange fordi vi kun må consume state én gang;
 * hvis token-exchange fejler, må klienten starte et nyt flow via mitid-init.
 */
async function consumeState(
  supabase: SupabaseClient,
  state: string,
): Promise<MitidPkceStateRow> {
  const { data, error } = await supabase
    .from('mitid_pkce_state')
    .select('state, code_verifier, nonce, created_at, expires_at, user_id')
    .eq('state', state)
    .maybeSingle();
  if (error) throw new Error(`state_lookup_failed:${error.message}`);
  if (!data) throw new Error('state_not_found');

  const row = data as MitidPkceStateRow;

  // TTL-check — primær kilde er expires_at fra DB (default NOW() + 10 min).
  const expiresMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresMs)) throw new Error('state_expiry_invalid');
  if (expiresMs < Date.now()) throw new Error('state_expired');

  // Ekstra beskyttelse: hvis expires_at af en eller anden grund er sat langt
  // ud i fremtiden, håndhæves 10-min-loft via created_at.
  const createdMs = Date.parse(row.created_at);
  if (!Number.isNaN(createdMs) && (Date.now() - createdMs) > STATE_TTL_MS) {
    throw new Error('state_expired_ttl');
  }

  // DELETE — engangs-forbrug. Race-safe pga. PRIMARY KEY på state.
  const { error: delErr } = await supabase
    .from('mitid_pkce_state')
    .delete()
    .eq('state', state);
  if (delErr) throw new Error(`state_consume_failed:${delErr.message}`);

  return row;
}

/** Cleanup: fjern udløbne states opportunistisk (best-effort). */
async function cleanupExpired(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from('mitid_pkce_state')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) {
    console.warn(`[mitid-verify] cleanup_expired: ${error.message}`);
  }
}

async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  sub: string,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      verification_tier: 'mitid',
      is_mitid_verified: true,
      mitid_sub: sub,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw new Error(`profile_update_failed:${error.message}`);
}

// -------------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------------

function sendJson(
  res: VercelResponse,
  status: number,
  body: VerifyResponse,
): void {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { status: 'error', error: 'method_not_allowed' });
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code) { sendJson(res, 400, { status: 'error', error: 'missing_code' }); return; }
  if (!state) { sendJson(res, 400, { status: 'error', error: 'missing_state' }); return; }

  const supabase = getSupabase();
  if (!supabase) {
    sendJson(res, 500, { status: 'error', error: 'supabase_not_configured' });
    return;
  }

  // Opportunistisk cleanup — kører før SELECT så udløbne rækker ikke ligger
  // og fylder. Ignorerer fejl (best-effort).
  void cleanupExpired(supabase);

  let stateRow: MitidPkceStateRow;
  try {
    stateRow = await consumeState(supabase, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'state_error';
    console.warn(`[mitid-verify] state-fejl: ${msg}`);
    sendJson(res, 400, { status: 'error', error: msg });
    return;
  }

  let tokens: MitidTokenResponse;
  try {
    tokens = await exchangeCode(code, stateRow.code_verifier);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'token_exchange_failed';
    console.error(`[mitid-verify] token-exchange: ${msg}`);
    sendJson(res, 502, { status: 'error', error: msg });
    return;
  }

  let claims: MitidIdTokenClaims;
  try {
    claims = await verifyIdToken(tokens.id_token, stateRow.nonce);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'id_token_verify_failed';
    console.error(`[mitid-verify] id_token: ${msg}`);
    sendJson(res, 401, { status: 'error', error: msg });
    return;
  }

  // Profile update kun hvis init havde en kendt user_id at binde til.
  // Ellers cementeres tilhørsforholdet senere via mitid_sub-lookup.
  if (stateRow.user_id !== null) {
    try {
      await updateProfile(supabase, stateRow.user_id, claims.sub);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'profile_update_failed';
      console.error(`[mitid-verify] profile: ${msg}`);
      sendJson(res, 500, { status: 'error', error: msg });
      return;
    }
  }

  // Session — brug hash af sub, aldrig plaintext
  const subHash = anontomeHash(claims.sub);
  const token = issueSession(subHash, 'mitid');
  res.setHeader('Set-Cookie', cookieHeader(token));

  // Bemærk: name returneres, cpr gør IKKE — CPR må aldrig forlade backend.
  sendJson(res, 200, {
    status: 'verified',
    name: claims.name ?? null,
    tier: 'mitid',
  });
}
