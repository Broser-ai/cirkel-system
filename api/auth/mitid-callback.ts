// cirkel-system/api/auth/mitid-callback.ts
//
// JUDGE-01 Anontome Login flow — MitID OAuth callback.
//
// Modtager authorization code, exchanger til id_token, hasher sub, upserter
// profiles, udsteder session-JWT cookie. Ingen plaintext PII persisteres.
//
// FASE 1: mock-broker (samme kode-path som rigtig). Sæt MITID_MODE=live for
// at ramme rigtige MitID endpoints (kræver PSP-aftale + certifikater).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { anontomeHash, anontomeBytea } from '../../src/lib/anontome-server';
import { issueSession, cookieHeader } from '../../src/lib/session';

const MITID_TOKEN_ENDPOINT = process.env.MITID_TOKEN_ENDPOINT
  || 'https://pp.netseidbroker.dk/op/connect/token'; // MitID broker preprod
const MITID_CLIENT_ID = process.env.MITID_CLIENT_ID || 'cirkel-web-app';
const MITID_CLIENT_SECRET = process.env.MITID_CLIENT_SECRET;
const MITID_REDIRECT_URI = process.env.MITID_REDIRECT_URI
  || 'https://cirkel-system.vercel.app/api/auth/mitid-callback';
const MITID_MODE = (process.env.MITID_MODE || 'mock') as 'mock' | 'live';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Fase 1: deterministic mock der producerer en fake sub baseret på code. */
function mockExchange(code: string): { sub: string } {
  const sub = `mock-mitid-${anontomeHash(`mock-input:${code}`).substring(0, 32)}`;
  return { sub };
}

async function liveExchange(code: string, codeVerifier: string): Promise<{ sub: string } | null> {
  if (!MITID_CLIENT_SECRET) {
    console.error('[mitid-callback] MITID_CLIENT_SECRET mangler i live-mode');
    return null;
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: MITID_REDIRECT_URI,
    client_id: MITID_CLIENT_ID,
    client_secret: MITID_CLIENT_SECRET,
    code_verifier: codeVerifier,
  });
  const res = await fetch(MITID_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    console.error(`[mitid-callback] token-exchange fejlede: HTTP ${res.status}`);
    return null;
  }
  const json = await res.json();
  const idToken = json.id_token;
  if (!idToken || typeof idToken !== 'string') return null;
  // Parse JWT-payload (uden signatur-check her; broker har allerede signeret)
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    if (!payload.sub) return null;
    return { sub: String(payload.sub) };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const codeVerifier = String(req.query.code_verifier ?? req.body?.code_verifier ?? '');

  if (!code) {
    return res.status(400).json({ error: 'missing_code' });
  }

  // Exchange code → sub
  let exchange: { sub: string } | null;
  if (MITID_MODE === 'live') {
    exchange = await liveExchange(code, codeVerifier);
  } else {
    exchange = mockExchange(code);
  }
  if (!exchange) {
    return res.status(502).json({ error: 'token_exchange_failed' });
  }

  // Hash sub — ingen plaintext videre
  const sub_hash = anontomeHash(exchange.sub);
  const sub_bytea = anontomeBytea(exchange.sub);

  // Upsert profiles (INGEN CPR/navn/email persisteres — kun hash + tidsstempler)
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: sub_hash, // brug hash som primary key alias (Fase 2: separat UUID)
          mitid_uuid_hash: sub_bytea,
          anontome_created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
        }, { onConflict: 'mitid_uuid_hash' });
      if (error) {
        console.error('[mitid-callback] profile upsert fejlede:', error.message);
      }
    } catch (err: any) {
      console.error('[mitid-callback] supabase exception:', err?.message ?? err);
    }
  }

  // Udsted session
  const token = issueSession(sub_hash, 'mitid');
  res.setHeader('Set-Cookie', cookieHeader(token));

  // Redirect til wallet — client læser session via /api/me
  const returnTo = /^\/[a-zA-Z0-9\/_\-]*$/.test(String(req.query.return_to ?? ''))
    ? String(req.query.return_to)
    : '/wallet';

  if (req.method === 'GET') {
    res.setHeader('Location', returnTo);
    return res.status(302).end();
  }
  return res.status(200).json({ ok: true, redirect: returnTo, state });
}
