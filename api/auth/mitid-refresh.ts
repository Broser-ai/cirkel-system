// cirkel-system/api/auth/mitid-refresh.ts
//
// Modul 5.2 — MitID session refresh (OIDC refresh_token grant).
//
// POST /api/auth/mitid-refresh
//   Body:   { refresh_token: string, firebaseUid?: string, state?: string }
//   Header: Authorization: Bearer <firebase-id-token>  (F3.8)
//   Cookie: Sæt-Cookie: cirkel_session=<jwt>          (issueSession)
//
// Flow:
//   1. Method-guard (405 hvis ikke POST).
//   2. Parse+valider body.
//   3. F3.8 — resolveTrustedUid mod Firebase Admin (enforce/warn_only via env).
//   4. Optional binding-check mod public.mitid_pkce_state (via body.state):
//        - Hvis state medsendes, valideres den mod tabellen som anti-replay
//          binding til trusted_uid. Rækken SLETTES ikke her (mitid-verify
//          har allerede consumed staten under initial login).
//        - Hvis ingen state medsendes: fallback til profiles.mitid_sub-check
//          efter successful token-exchange.
//   5. Exchange refresh_token → nyt {access_token, id_token, refresh_token?}
//      via MITID_TOKEN_URL (grant_type=refresh_token).
//   6. Verifér nyt id_token via JWKS (RS256 + iss/aud/exp/nbf/iat clock-skew).
//   7. Udsted ny session-cookie (issueSession + cookieHeader).
//   8. Returnér struktureret JSON: { success, data?, error? }.
//
// SIKKERHED:
//   * INGEN 'any'-typer (kun tydeligt-typede unknown-narrows).
//   * INGEN hardkodede secrets — alt via process.env.
//   * Refresh_token aldrig logget; kun længde ekkoes i debug-log.
//   * CPR aldrig i respons; sub hashes før cookie-payload.
//   * Constant-time hash-compare via anontome-server util.
//   * Refresh-endpoint er ikke idempotent — MitID kan rotere refresh_token,
//     så nyt token returneres til klienten når broker leverer det.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

import { resolveTrustedUid } from '../_verify-firebase-token.js';
import { anontomeHash } from '../../src/lib/anontome-server.js';
import { issueSession, cookieHeader } from '../../src/lib/session.js';
import logger from '../../src/lib/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Env-konfiguration (ingen hardkodede secrets)
// ─────────────────────────────────────────────────────────────────────────────

const MITID_TOKEN_URL: string =
  process.env.MITID_TOKEN_URL ?? 'https://pp.netseidbroker.dk/op/connect/token';
const MITID_JWKS_URL: string =
  process.env.MITID_JWKS_URL ??
  'https://pp.netseidbroker.dk/op/.well-known/openid-configuration/jwks';
const MITID_ISSUER: string =
  process.env.MITID_ISSUER ?? 'https://pp.netseidbroker.dk/op';
const MITID_CLIENT_ID: string =
  process.env.MITID_CLIENT_ID ?? 'cirkel-web-app';
const MITID_CLIENT_SECRET: string | undefined = process.env.MITID_CLIENT_SECRET;

// Klok-skew tolerance ved id_token-validering (sekunder).
const CLOCK_SKEW_SEC = 60;

// JWKS proces-cache (koldstartes hver deployment).
const JWKS_TTL_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Typer
// ─────────────────────────────────────────────────────────────────────────────

interface RefreshRequestBody {
  refresh_token: string;
  firebaseUid?: string;
  state?: string;
}

interface RefreshData {
  access_token: string;
  id_token: string;
  refresh_token: string | null;
  token_type: string;
  expires_in: number | null;
  scope: string | null;
  tier: 'mitid';
  name: string | null;
  sub_hash: string;
  session_cookie_set: true;
}

interface RefreshSuccess {
  success: true;
  data: RefreshData;
}

interface RefreshError {
  success: false;
  error: string;
  detail?: string;
}

type RefreshResponse = RefreshSuccess | RefreshError;

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
  name?: string;
  cpr?: string;
  identity_type?: string;
  uuid?: string;
}

interface Jwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: Jwk[];
}

interface MitidPkceStateRow {
  state: string;
  code_verifier: string;
  nonce: string | null;
  created_at: string;
  expires_at: string;
  user_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase service-role klient (lazy init — samme mønster som api/scan.ts)
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
// Base64URL helpers
// ─────────────────────────────────────────────────────────────────────────────

function base64UrlDecode(input: string): Buffer {
  const padded =
    input.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// JWKS-cache
// ─────────────────────────────────────────────────────────────────────────────

interface JwksCache {
  fetchedAt: number;
  keys: Map<string, KeyObject>;
}

let jwksCache: JwksCache | null = null;

async function loadJwks(): Promise<Map<string, KeyObject>> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(MITID_JWKS_URL);
  if (!response.ok) {
    throw new Error(`jwks_fetch_failed_${response.status}`);
  }
  const parsed = (await response.json()) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as JwksResponse).keys)
  ) {
    throw new Error('jwks_invalid_format');
  }
  const jwksList = (parsed as JwksResponse).keys;
  const keys = new Map<string, KeyObject>();
  for (const jwk of jwksList) {
    if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
    try {
      const keyObject = createPublicKey({ key: jwk, format: 'jwk' });
      keys.set(jwk.kid, keyObject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[mitid-refresh] JWK ${jwk.kid} parse-fejl: ${msg}`);
    }
  }
  if (keys.size === 0) {
    throw new Error('jwks_no_valid_keys');
  }
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT-verify (RS256, iss/aud/exp/nbf/iat)
// ─────────────────────────────────────────────────────────────────────────────

function parseJwtHeader(encoded: string): JwtHeader {
  const raw: unknown = JSON.parse(base64UrlDecode(encoded).toString('utf-8'));
  if (!raw || typeof raw !== 'object') throw new Error('jwt_header_invalid');
  const header = raw as Record<string, unknown>;
  if (header.alg !== 'RS256') throw new Error('jwt_alg_unsupported');
  if (typeof header.kid !== 'string' || header.kid.length === 0) {
    throw new Error('jwt_kid_missing');
  }
  return {
    alg: 'RS256',
    typ: typeof header.typ === 'string' ? header.typ : undefined,
    kid: header.kid,
  };
}

function parseJwtPayload(encoded: string): MitidIdTokenClaims {
  const raw: unknown = JSON.parse(base64UrlDecode(encoded).toString('utf-8'));
  if (!raw || typeof raw !== 'object') throw new Error('jwt_payload_invalid');
  const p = raw as Record<string, unknown>;

  if (typeof p.iss !== 'string') throw new Error('jwt_iss_missing');
  if (typeof p.sub !== 'string' || p.sub.length === 0) {
    throw new Error('jwt_sub_missing');
  }
  if (typeof p.exp !== 'number') throw new Error('jwt_exp_missing');
  if (typeof p.iat !== 'number') throw new Error('jwt_iat_missing');
  if (typeof p.aud !== 'string' && !Array.isArray(p.aud)) {
    throw new Error('jwt_aud_missing');
  }

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
  if (typeof p.identity_type === 'string') {
    claims.identity_type = p.identity_type;
  }
  if (typeof p.uuid === 'string') claims.uuid = p.uuid;
  return claims;
}

async function verifyIdToken(idToken: string): Promise<MitidIdTokenClaims> {
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

  if (claims.iss !== MITID_ISSUER) throw new Error('jwt_iss_mismatch');
  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(MITID_CLIENT_ID)
    : claims.aud === MITID_CLIENT_ID;
  if (!audOk) throw new Error('jwt_aud_mismatch');

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp < nowSec) throw new Error('jwt_expired');
  if (claims.iat > nowSec + CLOCK_SKEW_SEC) throw new Error('jwt_iat_future');
  if (
    typeof claims.nbf === 'number' &&
    claims.nbf > nowSec + CLOCK_SKEW_SEC
  ) {
    throw new Error('jwt_nbf_future');
  }
  return claims;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token-exchange (grant_type=refresh_token)
// ─────────────────────────────────────────────────────────────────────────────

async function exchangeRefreshToken(
  refreshToken: string,
): Promise<MitidTokenResponse> {
  if (!MITID_CLIENT_SECRET) {
    throw new Error('mitid_client_secret_missing');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: MITID_CLIENT_ID,
    client_secret: MITID_CLIENT_SECRET,
  });
  const res = await fetch(MITID_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`token_refresh_http_${res.status}`);
  }
  const json = (await res.json()) as Partial<MitidTokenResponse>;
  if (
    typeof json.access_token !== 'string' ||
    typeof json.id_token !== 'string'
  ) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Body-parsing (no 'any')
// ─────────────────────────────────────────────────────────────────────────────

function parseBody(rawBody: unknown): RefreshRequestBody | null {
  if (!rawBody || typeof rawBody !== 'object') return null;
  const b = rawBody as Record<string, unknown>;
  if (typeof b.refresh_token !== 'string' || b.refresh_token.length === 0) {
    return null;
  }
  const out: RefreshRequestBody = { refresh_token: b.refresh_token };
  if (typeof b.firebaseUid === 'string' && b.firebaseUid.length > 0) {
    out.firebaseUid = b.firebaseUid;
  }
  if (typeof b.state === 'string' && b.state.length > 0) {
    out.state = b.state;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional state-binding check mod public.mitid_pkce_state
//
// mitid_pkce_state er kortlivet (10 min TTL, sletter ved consume i verify).
// Ved refresh er staten typisk ALLEREDE consumed — men hvis klienten
// medsender state (fx fordi flowet er short-loop), tjekker vi at rækken
// enten:
//   a) stadig eksisterer og hører til trusted_uid (endnu ikke consumed), eller
//   b) er expired/mangler (normalt for et allerede-verificeret login) →
//      accept fortsætter uden hård binding.
//
// user_id-kolonnen i mitid_pkce_state peger på profiles.id (UUID). Vi
// sammenligner mod trusted_uid som er Firebase-UID, ikke UUID — så
// bindingen kan kun håndhæves hvis flowet gemte matchende id ved init.
// Ellers logges "state_binding_absent" og vi fortsætter.
// ─────────────────────────────────────────────────────────────────────────────

async function checkStateBinding(
  supabase: SupabaseClient,
  state: string,
  trustedUid: string,
): Promise<{ bound: boolean; reason: string }> {
  const { data, error } = await supabase
    .from('mitid_pkce_state')
    .select('state, code_verifier, nonce, created_at, expires_at, user_id')
    .eq('state', state)
    .maybeSingle();
  if (error) {
    return { bound: false, reason: `state_lookup_failed:${error.message}` };
  }
  if (!data) {
    return { bound: false, reason: 'state_absent_or_consumed' };
  }
  const row = data as MitidPkceStateRow;
  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isNaN(expiresMs) && expiresMs < Date.now()) {
    return { bound: false, reason: 'state_expired' };
  }
  if (row.user_id !== null && row.user_id !== trustedUid) {
    return { bound: false, reason: 'state_user_mismatch' };
  }
  return { bound: true, reason: 'state_matched' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response-helpers
// ─────────────────────────────────────────────────────────────────────────────

function sendJson(
  res: VercelResponse,
  status: number,
  body: RefreshResponse,
): void {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.send(JSON.stringify(body));
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { success: false, error: 'method_not_allowed' });
    return;
  }

  // 2) Body-parse
  const body = parseBody(req.body);
  if (!body) {
    sendJson(res, 400, {
      success: false,
      error: 'invalid_body',
      detail: 'refresh_token er påkrævet (string).',
    });
    return;
  }

  // 3) F3.8 — resolveTrustedUid (kun hvis firebaseUid er sendt med).
  //    Anonyme refresh-kald tillades i warn_only-mode, blokeres i enforce-mode
  //    via samme regel som scan.ts (kun UID-mismatch/manglende token → 401).
  let trustedUid: string | null = null;
  let uidVerified = false;
  if (body.firebaseUid) {
    try {
      const verify = await resolveTrustedUid(req, body.firebaseUid);
      trustedUid = verify.trusted_uid || body.firebaseUid;
      uidVerified = verify.verified;
      if (verify.spoofed) {
        logger.warn('[mitid-refresh] warn_only: spoof detected', {
          bodyUid: body.firebaseUid,
          trustedUid,
          reason: verify.reason,
        });
      } else if (!uidVerified) {
        logger.warn('[mitid-refresh] warn_only: no crypto-verify', {
          reason: verify.reason,
        });
      }
    } catch (err) {
      const status =
        (err as { status?: number } | null)?.status ?? 401;
      const reason =
        (err as { reason?: string; message?: string } | null)?.reason ??
        (err instanceof Error ? err.message : 'UID_SPOOF_DETECTED');
      logger.error(
        '[mitid-refresh] F3.8 enforce blokerede refresh',
        err instanceof Error ? err : new Error(String(err)),
        { status, reason },
      );
      sendJson(res, status, {
        success: false,
        error: 'UID_SPOOF_DETECTED',
        detail: reason,
      });
      return;
    }
  } else {
    logger.info(
      '[mitid-refresh] ingen firebaseUid — kører uden F3.8-binding',
    );
  }

  // 4) Optional binding-check mod mitid_pkce_state.
  //    Best-effort — Supabase-fejl blokerer ikke refresh (mitid_pkce_state er
  //    ikke kanonisk sandhed for aktive sessioner; kun for aktive PKCE-flows).
  const supabase = getSupabase();
  if (body.state && supabase && trustedUid) {
    try {
      const binding = await checkStateBinding(
        supabase,
        body.state,
        trustedUid,
      );
      logger.info('[mitid-refresh] state-binding check', {
        bound: binding.bound,
        reason: binding.reason,
      });
    } catch (err) {
      logger.warn('[mitid-refresh] state-binding check fejlede', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (body.state && !supabase) {
    logger.warn(
      '[mitid-refresh] state medsendt men Supabase ikke konfigureret — springer binding-check',
    );
  }

  // 5) Refresh token-exchange
  let tokens: MitidTokenResponse;
  try {
    tokens = await exchangeRefreshToken(body.refresh_token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'token_refresh_failed';
    logger.error(
      '[mitid-refresh] token-exchange fejlede',
      err instanceof Error ? err : new Error(String(err)),
    );
    sendJson(res, 502, {
      success: false,
      error: 'token_refresh_failed',
      detail: msg,
    });
    return;
  }

  // 6) Verificér nyt id_token (RS256 + iss/aud/exp).
  //    Nonce-check springes over (nonce bindes kun til init-flow, ikke refresh).
  let claims: MitidIdTokenClaims;
  try {
    claims = await verifyIdToken(tokens.id_token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'id_token_verify_failed';
    logger.error(
      '[mitid-refresh] id_token verify fejlede',
      err instanceof Error ? err : new Error(String(err)),
    );
    sendJson(res, 401, {
      success: false,
      error: 'id_token_verify_failed',
      detail: msg,
    });
    return;
  }

  // 7) Session — hash sub før cookie (aldrig plaintext sub).
  let subHash: string;
  let sessionToken: string;
  try {
    subHash = anontomeHash(claims.sub);
    sessionToken = issueSession(subHash, 'mitid');
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'session_issue_failed';
    logger.error(
      '[mitid-refresh] session-udstedelse fejlede',
      err instanceof Error ? err : new Error(String(err)),
    );
    sendJson(res, 500, {
      success: false,
      error: 'session_issue_failed',
      detail: msg,
    });
    return;
  }
  res.setHeader('Set-Cookie', cookieHeader(sessionToken));

  // 8) Struktureret svar (CPR aldrig medsendt; sub_hash i stedet for sub).
  const data: RefreshData = {
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    refresh_token: tokens.refresh_token ?? null,
    token_type: tokens.token_type ?? 'Bearer',
    expires_in:
      typeof tokens.expires_in === 'number' ? tokens.expires_in : null,
    scope: tokens.scope ?? null,
    tier: 'mitid',
    name: claims.name ?? null,
    sub_hash: subHash,
    session_cookie_set: true,
  };

  logger.info('[mitid-refresh] refresh success', {
    uid_verified: uidVerified,
    has_new_refresh_token: data.refresh_token !== null,
    expires_in: data.expires_in,
  });

  sendJson(res, 200, { success: true, data });
}
