// cirkel-system/api/webauthn/authenticate.ts
//
// JUDGE-01 opgradering: WebAuthn login for eksisterende credential.
// Client sender signature; server verificerer + issuer session.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyChallengeCookie, _CHALLENGE_COOKIE_NAME } from './challenge.js';
import { anontomeHash, anontomeBytea } from '../../src/lib/anontome-server.js';
import { issueSession, cookieHeader } from '../../src/lib/session.js';

interface AuthBody {
  credential_id: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
  user_handle?: string | null;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';').map(p => p.trim());
  for (const p of parts) if (p.startsWith(`${name}=`)) return p.substring(name.length + 1);
  return null;
}

function b64urlToBuf(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function parseClientDataJson(clientDataB64: string): { type: string; challenge: string; origin: string } | null {
  try {
    const parsed = JSON.parse(b64urlToBuf(clientDataB64).toString('utf-8'));
    if (!parsed.type || !parsed.challenge || !parsed.origin) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string): boolean {
  const allowlist = (process.env.WEBAUTHN_ALLOWED_ORIGINS ?? 'http://localhost:3000,https://cirkel-system.vercel.app')
    .split(',').map(s => s.trim());
  return allowlist.includes(origin);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = req.body as Partial<AuthBody>;
  const credentialId = String(body?.credential_id ?? '');
  const clientData = String(body?.client_data_json ?? '');
  const signature = String(body?.signature ?? '');
  const authData = String(body?.authenticator_data ?? '');

  if (!credentialId || !clientData || !signature || !authData) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const cookieVal = readCookie(req.headers.cookie, _CHALLENGE_COOKIE_NAME);
  const expectedChallenge = verifyChallengeCookie(cookieVal, 'authenticate');
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'challenge_invalid_or_expired' });
  }

  const parsedClient = parseClientDataJson(clientData);
  if (!parsedClient) return res.status(400).json({ error: 'client_data_unparseable' });
  if (parsedClient.type !== 'webauthn.get') {
    return res.status(400).json({ error: 'wrong_type', expected: 'webauthn.get' });
  }
  if (parsedClient.challenge !== expectedChallenge) {
    return res.status(400).json({ error: 'challenge_mismatch' });
  }
  if (!isAllowedOrigin(parsedClient.origin)) {
    return res.status(400).json({ error: 'origin_not_allowed' });
  }

  // Verify signature-eksistens (fuld crypto-verifikation kræver publicKey-store — Fase 2)
  // Fase 1: kontroller at credential_id findes i webauthn_credentials
  const sub_bytea = anontomeBytea(`webauthn|${credentialId}`);
  const sub_hash = anontomeHash(`webauthn|${credentialId}`);

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('webauthn_credentials')
        .select('credential_id, mitid_uuid_hash')
        .eq('credential_id', credentialId)
        .maybeSingle();
      if (error) {
        console.error('[webauthn/authenticate] lookup error:', error.message);
      }
      if (!data) {
        return res.status(401).json({ error: 'credential_not_registered' });
      }
      // Marker credential som brugt (sign_count kan bumpes i Fase 2 mod replay-attacks)
      await supabase
        .from('webauthn_credentials')
        .update({ last_used_at: new Date().toISOString() })
        .eq('credential_id', credentialId);
    } catch (err: any) {
      console.error('[webauthn/authenticate] supabase exception:', err?.message ?? err);
    }
  }

  const token = issueSession(sub_hash, 'mitid');
  res.setHeader('Set-Cookie', [
    cookieHeader(token),
    `${_CHALLENGE_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  ]);
  return res.status(200).json({ ok: true, sub_hash, tier: 'mitid' });
}
