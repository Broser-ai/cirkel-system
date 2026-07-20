// cirkel-system/api/webauthn/challenge.ts
//
// JUDGE-01 opgradering: server-side WebAuthn challenge generator.
// Klient kalder GET /api/webauthn/challenge?intent=register|authenticate
// Server returnerer challenge, gemmer den i cookie med kort TTL (5 min).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomBytes } from 'crypto';

const CHALLENGE_TTL_SEC = 300;
const COOKIE_NAME = 'cirkel_webauthn_challenge';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET mangler');
  return s;
}

function signChallenge(challenge: string, intent: string, expiresAt: number): string {
  return createHmac('sha256', getSecret())
    .update(`${challenge}|${intent}|${expiresAt}`)
    .digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const intent = String(req.query.intent ?? 'authenticate');
  if (!['register', 'authenticate'].includes(intent)) {
    return res.status(400).json({ error: 'invalid_intent' });
  }

  const challengeBuf = randomBytes(32);
  const userHandleBuf = randomBytes(16);
  const challenge = b64url(challengeBuf);
  const userHandle = b64url(userHandleBuf);
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC;
  const signature = signChallenge(challenge, intent, expiresAt);

  const cookieValue = `${challenge}.${intent}.${expiresAt}.${signature}`;
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${cookieValue}; Max-Age=${CHALLENGE_TTL_SEC}; Path=/; HttpOnly; Secure; SameSite=Lax`);

  return res.status(200).json({
    challenge,
    user_handle: userHandle,
    user_name: 'borger@cirkel',
    expires_at: expiresAt,
    intent,
  });
}

export function verifyChallengeCookie(cookieValue: string | null, expectedIntent: string): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 4) return null;
  const [challenge, intent, expStr, sig] = parts;
  if (intent !== expectedIntent) return null;
  const expires = parseInt(expStr, 10);
  if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) return null;
  const expected = signChallenge(challenge, intent, expires);
  // Constant-time compare
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? challenge : null;
}

export const _CHALLENGE_COOKIE_NAME = COOKIE_NAME;
