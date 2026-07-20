// cirkel-system/api/webauthn/register.ts
//
// JUDGE-01 opgradering: registrer WebAuthn credential + upsert profile.
// Client sender: credential_id, attestation_object, client_data_json.
// Server: verificerer challenge, hasher credential_id → mitid_uuid_hash, upserter.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyChallengeCookie, _CHALLENGE_COOKIE_NAME } from './challenge';
import { anontomeHash, anontomeBytea } from '../../src/lib/anontome-server';
import { issueSession, cookieHeader } from '../../src/lib/session';

interface RegisterBody {
  credential_id: string;
  attestation_object: string;
  client_data_json: string;
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

  const body = req.body as Partial<RegisterBody>;
  const credentialId = String(body?.credential_id ?? '');
  const attestation = String(body?.attestation_object ?? '');
  const clientData = String(body?.client_data_json ?? '');

  if (!credentialId || !attestation || !clientData) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const cookieVal = readCookie(req.headers.cookie, _CHALLENGE_COOKIE_NAME);
  const expectedChallenge = verifyChallengeCookie(cookieVal, 'register');
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'challenge_invalid_or_expired' });
  }

  const parsedClient = parseClientDataJson(clientData);
  if (!parsedClient) return res.status(400).json({ error: 'client_data_unparseable' });
  if (parsedClient.type !== 'webauthn.create') {
    return res.status(400).json({ error: 'wrong_type', expected: 'webauthn.create', got: parsedClient.type });
  }
  if (parsedClient.challenge !== expectedChallenge) {
    return res.status(400).json({ error: 'challenge_mismatch' });
  }
  if (!isAllowedOrigin(parsedClient.origin)) {
    return res.status(400).json({ error: 'origin_not_allowed', origin: parsedClient.origin });
  }

  // credential_id er base64url — hash det direkte til mitid_uuid_hash
  const sub_hash = anontomeHash(`webauthn|${credentialId}`);
  const sub_bytea = anontomeBytea(`webauthn|${credentialId}`);

  const supabase = getSupabase();
  if (supabase) {
    try {
      // WebAuthn-mapping — profiles-tabellen (Supabase auth) er urørt.
      // webauthn_credentials.mitid_uuid_hash er den anonyme identitet der
      // linker til witness_attestations + citizen_rewards.
      const { error } = await supabase.from('webauthn_credentials').upsert({
        credential_id: credentialId,
        mitid_uuid_hash: sub_bytea,
        attestation_ref: attestation.substring(0, 128),
        last_used_at: new Date().toISOString(),
      }, { onConflict: 'credential_id' });
      if (error) {
        console.error('[webauthn/register] credentials upsert error:', error.message);
      }
    } catch (err: any) {
      console.error('[webauthn/register] supabase exception:', err?.message ?? err);
    }
  }

  const token = issueSession(sub_hash, 'mitid');
  res.setHeader('Set-Cookie', [
    cookieHeader(token),
    `${_CHALLENGE_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  ]);
  return res.status(200).json({
    ok: true,
    sub_hash,
    tier: 'mitid',
  });
}
