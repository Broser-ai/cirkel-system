// cirkel-system/src/lib/session.ts
//
// Session-JWT for borger-noden. HttpOnly cookie med signed payload.
// Kaldes fra api/auth/mitid-callback.ts (issue) og api/me.ts + guards (verify).
//
// SIKKERHED:
//   * SESSION_SECRET SKAL være sat i Vercel env (min. 32 tegn)
//   * JWT algoritme: HS256
//   * Cookie: HttpOnly, Secure, SameSite=Lax
//   * Payload indeholder KUN mitid_uuid_hash + expiration + verification_tier
//   * INGEN CPR, navn, email nogensinde i payload

import { createHmac, randomBytes } from 'crypto';

const SESSION_TTL_SEC = 7 * 24 * 3600; // 7 dage
const COOKIE_NAME = 'cirkel_session';

export interface SessionPayload {
  sub_hash: string;              // mitid_uuid_hash (SHA-256 hex)
  tier: 'mitid' | 'biometric' | 'demo';
  iat: number;                   // issued at (unix seconds)
  exp: number;                   // expires (unix seconds)
  jti: string;                   // JWT ID (revocation nøgle)
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET mangler eller er kortere end 32 tegn. Sæt i Vercel env.');
  }
  return s;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function issueSession(sub_hash: string, tier: SessionPayload['tier']): string {
  if (!sub_hash || sub_hash.length !== 64) {
    throw new Error('issueSession: sub_hash skal være 64-hex');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub_hash,
    tier,
    iat: now,
    exp: now + SESSION_TTL_SEC,
    jti: randomBytes(16).toString('hex'),
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64UrlEncode(JSON.stringify(header));
  const encPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', getSecret())
    .update(`${encHeader}.${encPayload}`)
    .digest();
  return `${encHeader}.${encPayload}.${base64UrlEncode(signature)}`;
}

export function verifySession(token: string): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const expected = createHmac('sha256', getSecret())
    .update(`${encHeader}.${encPayload}`)
    .digest();
  const actual = base64UrlDecode(encSig);
  if (expected.length !== actual.length) return null;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  if (diff !== 0) return null;

  try {
    const payload: SessionPayload = JSON.parse(base64UrlDecode(encPayload).toString('utf-8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub_hash || payload.sub_hash.length !== 64) return null;
    return payload;
  } catch {
    return null;
  }
}

export function cookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL_SEC}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookieFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(';').map(p => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${COOKIE_NAME}=`)) return p.substring(COOKIE_NAME.length + 1);
  }
  return null;
}
