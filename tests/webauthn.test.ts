// cirkel-system/tests/webauthn.test.ts
//
// Vitest-suite for JUDGE-01 WebAuthn-endpoints:
//   * GET  /api/webauthn/challenge      (api/webauthn/challenge.ts)
//   * POST /api/webauthn/register       (api/webauthn/register.ts)
//   * POST /api/webauthn/authenticate   (api/webauthn/authenticate.ts)
//
// Fokus:
//   A) Challenge         — happy (register+authenticate), default intent,
//                          invalid intent, method-guard, cookie-format,
//                          shape/længde af challenge/user_handle, TTL=300s.
//   B) Register          — happy (200 + session-cookie), missing fields (400),
//                          challenge cookie mangler / wrong intent / expired /
//                          tampered signature (400), wrong ceremony type (400),
//                          challenge-mismatch (400), origin ikke tilladt (400),
//                          unparseable client_data (400), method-guard (405),
//                          challenge-cookie ryddes efter success,
//                          webauthn_credentials-tabellen får upsert med det
//                          korrekte anontome-hash.
//   C) Authenticate      — happy (200 + session-cookie), credential ukendt (401),
//                          missing fields (400), forkert intent i cookie (400),
//                          wrong ceremony type (400), challenge-mismatch (400),
//                          origin ikke tilladt (400), method-guard (405),
//                          last_used_at bumpes.
//   D) End-to-end        — challenge → register → authenticate (fuld runde).
//
// Alt eksternt er isoleret:
//   * @supabase/supabase-js       — mocket via ./tests/setup (in-memory store).
//   * @/anontome-server           — bruger den ægte implementation (ren funktion,
//                                    ingen network). Deterministisk pr. salt.
//   * SESSION_SECRET / origins    — sat pr. test i beforeEach.
//
// Ingen live network-calls. Ingen Date.now() uden mock — vi.useFakeTimers()
// pinnes til 2026-07-22T10:00:00.000Z før hver test.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';

// ─── Handlers under test ────────────────────────────────────────────────────
import challengeHandler, {
  verifyChallengeCookie,
  _CHALLENGE_COOKIE_NAME,
} from '../api/webauthn/challenge.js';
import registerHandler from '../api/webauthn/register.js';
import authenticateHandler from '../api/webauthn/authenticate.js';

// ─── Test-hjælpere / fixtures ───────────────────────────────────────────────
import { _getStore, _seedStore } from './setup.js';
import { verifySession } from '../src/lib/session.js';
import { anontomeHash } from '../src/lib/anontome-server.js';

// ─── Konstanter (deterministiske) ───────────────────────────────────────────
const SESSION_SECRET = 'a'.repeat(64);                     // ≥32 tegn (challenge + session)
const ALLOWED_ORIGIN = 'http://localhost:3000';            // matcher default-allowlist
const DISALLOWED_ORIGIN = 'https://evil.example.com';
const FIXED_NOW = new Date('2026-07-22T10:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);
const CHALLENGE_TTL_SEC = 300;
const EXPECTED_EXPIRES_AT = FIXED_NOW_SEC + CHALLENGE_TTL_SEC;

// Konstant credential_id på tværs af tests — anontomeHash er deterministisk
// givet ANONTOME_SALT, så vi kan sammenligne det direkte.
const CREDENTIAL_ID = 'test-credential-id-base64url-000001';
const ATTESTATION_OBJECT = 'attestation-object-payload-abcdef';
const ATT_ATT_REF_128 = ATTESTATION_OBJECT.substring(0, 128);
const AUTHENTICATOR_DATA = 'authenticator-data-payload-123';
const SIGNATURE = 'signature-payload-abc';

// ─── Base64url-helpers (deterministiske; matcher server-side) ──────────────
function toB64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeClientData(
  type: 'webauthn.create' | 'webauthn.get' | (string & {}),
  challenge: string,
  origin: string,
  extra: Record<string, unknown> = {},
): string {
  return toB64Url(
    JSON.stringify({ type, challenge, origin, ...extra }),
  );
}

// Signér manuelt en challenge-cookie (matcher signChallenge i challenge.ts).
function signChallenge(challenge: string, intent: string, expiresAt: number): string {
  return createHmac('sha256', SESSION_SECRET)
    .update(`${challenge}|${intent}|${expiresAt}`)
    .digest('hex');
}

function makeChallengeCookieValue(
  challenge: string,
  intent: 'register' | 'authenticate' | (string & {}),
  expiresAt: number,
  signature?: string,
): string {
  const sig = signature ?? signChallenge(challenge, intent, expiresAt);
  return `${challenge}.${intent}.${expiresAt}.${sig}`;
}

function cookieHeader(value: string): string {
  return `${_CHALLENGE_COOKIE_NAME}=${value}`;
}

// Ekstraher raw cookie-value (før første ';') fra Set-Cookie header.
function extractCookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of arr) {
    const first = raw.split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq < 0) continue;
    const k = first.substring(0, eq);
    const v = first.substring(eq + 1);
    if (k === name) return v;
  }
  return null;
}

// Find hele Set-Cookie-strengen (inkl. attributter) for et navn.
function findSetCookieString(
  setCookie: string | string[] | undefined,
  name: string,
): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of arr) {
    const first = raw.split(';')[0].trim();
    if (first.startsWith(`${name}=`)) return raw;
  }
  return null;
}

// ─── Test-app builders ─────────────────────────────────────────────────────
function wrap(handler: (req: any, res: any) => Promise<any> | any) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: 'test_handler_threw', message: (err as Error).message });
      }
    }
  };
}

function buildChallengeApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/webauthn/challenge', wrap(challengeHandler));
  return app;
}

function buildRegisterApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/webauthn/register', wrap(registerHandler));
  return app;
}

function buildAuthenticateApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/webauthn/authenticate', wrap(authenticateHandler));
  return app;
}

// ─── Global lifecycle ──────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.WEBAUTHN_ALLOWED_ORIGINS = `${ALLOWED_ORIGIN},https://cirkel-system.vercel.app`;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  // ANONTOME_SALT sat til deterministisk værdi så webauthn_credentials-
  // rækkens mitid_uuid_hash er reproducerbar.
  process.env.ANONTOME_SALT = 'test-anontome-salt-cirkel-2026';

  // Sørg for at webauthn_credentials-tabellen findes og er tom pr. test.
  _seedStore({ webauthn_credentials: [] } as any);
});

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// 0) Test-hjælpere sanity — så tests aldrig er falsk-grønne
// ═══════════════════════════════════════════════════════════════════════════

describe('test-hjælpere', () => {
  it('toB64Url producerer padding-fri base64url uden +, /, =', () => {
    const encoded = toB64Url('cirkel-webauthn-test-string-01');
    expect(encoded).not.toMatch(/[+/=]/);
    // decodable
    const padded =
      encoded.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (encoded.length % 4)) % 4);
    expect(Buffer.from(padded, 'base64').toString('utf-8')).toBe(
      'cirkel-webauthn-test-string-01',
    );
  });

  it('signChallenge er deterministisk givet samme SESSION_SECRET', () => {
    const a = signChallenge('chal-x', 'register', 1000);
    const b = signChallenge('chal-x', 'register', 1000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    // Ændring i input ændrer signaturen
    expect(signChallenge('chal-y', 'register', 1000)).not.toBe(a);
    expect(signChallenge('chal-x', 'authenticate', 1000)).not.toBe(a);
    expect(signChallenge('chal-x', 'register', 1001)).not.toBe(a);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A) GET /api/webauthn/challenge
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/webauthn/challenge', () => {
  it('happy: intent=register returnerer challenge + user_handle + korrekt expires_at og sætter signeret cookie', async () => {
    const res = await request(buildChallengeApp())
      .get('/api/webauthn/challenge')
      .query({ intent: 'register' });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('register');
    expect(res.body.user_name).toBe('borger@cirkel');
    expect(res.body.expires_at).toBe(EXPECTED_EXPIRES_AT);

    // 32 tilfældige bytes → base64url ~43 tegn, ingen padding, ingen +/=/dot
    expect(res.body.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.body.challenge.length).toBe(43);
    // 16 bytes → base64url ~22 tegn
    expect(res.body.user_handle).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.body.user_handle.length).toBe(22);

    const cookieStr = findSetCookieString(res.headers['set-cookie'], _CHALLENGE_COOKIE_NAME);
    expect(cookieStr).not.toBeNull();
    expect(cookieStr).toContain(`Max-Age=${CHALLENGE_TTL_SEC}`);
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('Secure');
    expect(cookieStr).toContain('SameSite=Lax');
    expect(cookieStr).toContain('Path=/');

    // Cookie-værdi skal være challenge.intent.expiresAt.signature — og signaturen
    // valideres med verifyChallengeCookie mod netop 'register'.
    const cookieVal = extractCookieValue(res.headers['set-cookie'], _CHALLENGE_COOKIE_NAME);
    expect(cookieVal).not.toBeNull();
    const parts = cookieVal!.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(res.body.challenge);
    expect(parts[1]).toBe('register');
    expect(parts[2]).toBe(String(EXPECTED_EXPIRES_AT));
    expect(parts[3]).toMatch(/^[a-f0-9]{64}$/);

    // Round-trip: verifyChallengeCookie skal godkende og returnere selve challenge.
    expect(verifyChallengeCookie(cookieVal, 'register')).toBe(res.body.challenge);
    expect(verifyChallengeCookie(cookieVal, 'authenticate')).toBeNull();
  });

  it('happy: intent=authenticate returnerer intent=authenticate og korrekt signeret cookie', async () => {
    const res = await request(buildChallengeApp())
      .get('/api/webauthn/challenge')
      .query({ intent: 'authenticate' });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('authenticate');
    expect(res.body.expires_at).toBe(EXPECTED_EXPIRES_AT);

    const cookieVal = extractCookieValue(res.headers['set-cookie'], _CHALLENGE_COOKIE_NAME);
    expect(cookieVal).not.toBeNull();
    expect(cookieVal!.split('.')[1]).toBe('authenticate');
    expect(verifyChallengeCookie(cookieVal, 'authenticate')).toBe(res.body.challenge);
  });

  it('default intent = authenticate når query-param mangler', async () => {
    const res = await request(buildChallengeApp()).get('/api/webauthn/challenge');
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('authenticate');
  });

  it('invalid intent → 400 { error: "invalid_intent" }', async () => {
    const res = await request(buildChallengeApp())
      .get('/api/webauthn/challenge')
      .query({ intent: 'delete-account' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_intent' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('POST → 405 { error: "method_not_allowed" }', async () => {
    const res = await request(buildChallengeApp()).post('/api/webauthn/challenge');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });

  it('to sekventielle kald producerer forskellige challenges (randomBytes garanti)', async () => {
    const app = buildChallengeApp();
    const first = await request(app).get('/api/webauthn/challenge').query({ intent: 'register' });
    const second = await request(app).get('/api/webauthn/challenge').query({ intent: 'register' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.challenge).not.toBe(second.body.challenge);
    expect(first.body.user_handle).not.toBe(second.body.user_handle);
    // Tid er frozen, så expires_at er identisk
    expect(first.body.expires_at).toBe(second.body.expires_at);
  });

  it('manglende SESSION_SECRET → handler throw'
    + ' (fanges af express-wrapper → 500 test_handler_threw)', async () => {
    delete process.env.SESSION_SECRET;
    const res = await request(buildChallengeApp())
      .get('/api/webauthn/challenge')
      .query({ intent: 'register' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('test_handler_threw');
    expect(res.body.message).toMatch(/SESSION_SECRET/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2) verifyChallengeCookie — direkte enhedsverifikation
// ═══════════════════════════════════════════════════════════════════════════

describe('verifyChallengeCookie (pure)', () => {
  const CHALLENGE = toB64Url(Buffer.from('challenge-bytes-32-000000000000'.padEnd(32, 'x')));

  it('null / tom / forkert format → null', () => {
    expect(verifyChallengeCookie(null, 'register')).toBeNull();
    expect(verifyChallengeCookie('', 'register')).toBeNull();
    expect(verifyChallengeCookie('only.three.parts', 'register')).toBeNull();
    expect(verifyChallengeCookie('a.b.c.d.e', 'register')).toBeNull();
  });

  it('forkert intent → null', () => {
    const cookie = makeChallengeCookieValue(CHALLENGE, 'register', EXPECTED_EXPIRES_AT);
    expect(verifyChallengeCookie(cookie, 'authenticate')).toBeNull();
    expect(verifyChallengeCookie(cookie, 'register')).toBe(CHALLENGE);
  });

  it('expired (exp < now) → null', () => {
    const expiredAt = FIXED_NOW_SEC - 1;
    const cookie = makeChallengeCookieValue(CHALLENGE, 'register', expiredAt);
    expect(verifyChallengeCookie(cookie, 'register')).toBeNull();
  });

  it('NaN i expires → null', () => {
    const sig = signChallenge(CHALLENGE, 'register', Number.NaN);
    const cookie = `${CHALLENGE}.register.notanumber.${sig}`;
    expect(verifyChallengeCookie(cookie, 'register')).toBeNull();
  });

  it('tampered signatur (samme længde, forkerte bytes) → null (constant-time)', () => {
    const good = makeChallengeCookieValue(CHALLENGE, 'register', EXPECTED_EXPIRES_AT);
    const parts = good.split('.');
    // Erstat signaturen med 64 hex-nuller — samme længde, forkerte bytes.
    const bad = `${parts[0]}.${parts[1]}.${parts[2]}.${'0'.repeat(64)}`;
    expect(verifyChallengeCookie(bad, 'register')).toBeNull();
  });

  it('signatur af forkert længde → null (uden constant-time compare-fejl)', () => {
    const cookie = `${CHALLENGE}.register.${EXPECTED_EXPIRES_AT}.deadbeef`;
    expect(verifyChallengeCookie(cookie, 'register')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B) POST /api/webauthn/register
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/webauthn/register', () => {
  // Deterministisk challenge til register-intent, signeret så cookie er gyldig.
  const REG_CHALLENGE = toB64Url(Buffer.from('register-challenge-bytes-000001'));
  const REG_COOKIE_VALUE = makeChallengeCookieValue(REG_CHALLENGE, 'register', EXPECTED_EXPIRES_AT);
  const REG_COOKIE = cookieHeader(REG_COOKIE_VALUE);

  function buildBody(overrides: Partial<{ client_data_json: string; credential_id: string; attestation_object: string }> = {}) {
    const clientData = overrides.client_data_json ?? encodeClientData(
      'webauthn.create',
      REG_CHALLENGE,
      ALLOWED_ORIGIN,
    );
    return {
      credential_id: overrides.credential_id ?? CREDENTIAL_ID,
      attestation_object: overrides.attestation_object ?? ATTESTATION_OBJECT,
      client_data_json: clientData,
    };
  }

  it('happy: 200 + sub_hash + tier=mitid, session-cookie sat, challenge-cookie ryddet, upsert i webauthn_credentials', async () => {
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .set('Content-Type', 'application/json')
      .send(buildBody());

    expect(res.status).toBe(200);
    const expectedSubHash = anontomeHash(`webauthn|${CREDENTIAL_ID}`);
    expect(res.body).toEqual({ ok: true, sub_hash: expectedSubHash, tier: 'mitid' });
    expect(res.body.sub_hash).toMatch(/^[a-f0-9]{64}$/);

    // Set-Cookie skal indeholde både session-cookie og en cleared challenge-cookie.
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();

    const sessionRaw = findSetCookieString(setCookie, 'cirkel_session');
    expect(sessionRaw).not.toBeNull();
    expect(sessionRaw).toContain('HttpOnly');
    expect(sessionRaw).toContain('Secure');
    expect(sessionRaw).toContain('SameSite=Lax');

    const sessionToken = extractCookieValue(setCookie, 'cirkel_session')!;
    const payload = verifySession(sessionToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub_hash).toBe(expectedSubHash);
    expect(payload!.tier).toBe('mitid');
    expect(payload!.iat).toBe(FIXED_NOW_SEC);

    const clearedRaw = findSetCookieString(setCookie, _CHALLENGE_COOKIE_NAME);
    expect(clearedRaw).not.toBeNull();
    expect(clearedRaw).toContain('Max-Age=0');

    // In-memory Supabase-store bør nu have en række med credential_id + hash.
    const store = _getStore() as any;
    expect(store.webauthn_credentials).toHaveLength(1);
    const row = store.webauthn_credentials[0];
    expect(row.credential_id).toBe(CREDENTIAL_ID);
    expect(row.mitid_uuid_hash).toBe(`\\x${expectedSubHash}`);
    expect(row.attestation_ref).toBe(ATT_ATT_REF_128);
    expect(row.last_used_at).toBe(FIXED_NOW.toISOString());
  });

  it('missing fields → 400 missing_fields (og ingen upsert)', async () => {
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .send({ credential_id: CREDENTIAL_ID }); // manglende attestation + client_data

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'missing_fields' });
    const store = _getStore() as any;
    expect(store.webauthn_credentials).toHaveLength(0);
  });

  it('ingen challenge-cookie → 400 challenge_invalid_or_expired', async () => {
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .send(buildBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });

  it('cookie med wrong intent (authenticate) → 400 challenge_invalid_or_expired', async () => {
    const wrongIntentCookie = makeChallengeCookieValue(
      REG_CHALLENGE,
      'authenticate',
      EXPECTED_EXPIRES_AT,
    );
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', cookieHeader(wrongIntentCookie))
      .send(buildBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });

  it('expired cookie → 400 challenge_invalid_or_expired', async () => {
    const expiredCookie = makeChallengeCookieValue(
      REG_CHALLENGE,
      'register',
      FIXED_NOW_SEC - 1,
    );
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', cookieHeader(expiredCookie))
      .send(buildBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });

  it('tampered signatur → 400 challenge_invalid_or_expired', async () => {
    const tampered = `${REG_CHALLENGE}.register.${EXPECTED_EXPIRES_AT}.${'0'.repeat(64)}`;
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', cookieHeader(tampered))
      .send(buildBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });

  it('client_data_json der ikke er parseable base64/JSON → 400 client_data_unparseable', async () => {
    // "%%%" er ikke gyldig base64 og decoder til noget der ikke er JSON.
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .send(buildBody({ client_data_json: '%%%not-base64%%%' }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'client_data_unparseable' });
  });

  it('client_data mangler krævede felter (origin) → 400 client_data_unparseable', async () => {
    const bad = toB64Url(
      JSON.stringify({ type: 'webauthn.create', challenge: REG_CHALLENGE }),
    );
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .send(buildBody({ client_data_json: bad }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'client_data_unparseable' });
  });

  it('forkert ceremonitype (webauthn.get) → 400 wrong_type med expected/got', async () => {
    const clientData = encodeClientData('webauthn.get', REG_CHALLENGE, ALLOWED_ORIGIN);
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .send(buildBody({ client_data_json: clientData }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'wrong_type',
      expected: 'webauthn.create',
      got: 'webauthn.get',
    });
  });

  it('challenge i client_data matcher ikke cookie → 400 challenge_mismatch', async () => {
    const otherChallenge = toB64Url(Buffer.from('a-different-challenge-000000000'));
    const clientData = encodeClientData('webauthn.create', otherChallenge, ALLOWED_ORIGIN);
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .send(buildBody({ client_data_json: clientData }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_mismatch' });
  });

  it('origin ikke i allowlist → 400 origin_not_allowed', async () => {
    const clientData = encodeClientData(
      'webauthn.create',
      REG_CHALLENGE,
      DISALLOWED_ORIGIN,
    );
    const res = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', REG_COOKIE)
      .send(buildBody({ client_data_json: clientData }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'origin_not_allowed',
      origin: DISALLOWED_ORIGIN,
    });
  });

  it('GET → 405 method_not_allowed', async () => {
    const res = await request(buildRegisterApp()).get('/api/webauthn/register');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C) POST /api/webauthn/authenticate
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/webauthn/authenticate', () => {
  const AUTH_CHALLENGE = toB64Url(Buffer.from('authenticate-challenge-bytes-01'));
  const AUTH_COOKIE_VALUE = makeChallengeCookieValue(
    AUTH_CHALLENGE,
    'authenticate',
    EXPECTED_EXPIRES_AT,
  );
  const AUTH_COOKIE = cookieHeader(AUTH_COOKIE_VALUE);

  function buildBody(overrides: Partial<{ client_data_json: string; credential_id: string; signature: string; authenticator_data: string }> = {}) {
    const clientData = overrides.client_data_json ?? encodeClientData(
      'webauthn.get',
      AUTH_CHALLENGE,
      ALLOWED_ORIGIN,
    );
    return {
      credential_id: overrides.credential_id ?? CREDENTIAL_ID,
      authenticator_data: overrides.authenticator_data ?? AUTHENTICATOR_DATA,
      client_data_json: clientData,
      signature: overrides.signature ?? SIGNATURE,
    };
  }

  // Præ-seed credential som "registreret" for happy-cases.
  function seedRegisteredCredential(): void {
    const expectedSubHash = anontomeHash(`webauthn|${CREDENTIAL_ID}`);
    _seedStore({
      webauthn_credentials: [
        {
          credential_id: CREDENTIAL_ID,
          mitid_uuid_hash: `\\x${expectedSubHash}`,
          attestation_ref: ATT_ATT_REF_128,
          last_used_at: '2026-07-20T00:00:00.000Z',
        },
      ],
    } as any);
  }

  it('happy: 200 + sub_hash + tier=mitid, session-cookie sat, last_used_at bumpes', async () => {
    seedRegisteredCredential();

    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send(buildBody());

    expect(res.status).toBe(200);
    const expectedSubHash = anontomeHash(`webauthn|${CREDENTIAL_ID}`);
    expect(res.body).toEqual({ ok: true, sub_hash: expectedSubHash, tier: 'mitid' });

    // Session-cookie sat, HttpOnly/Secure/SameSite=Lax
    const setCookie = res.headers['set-cookie'];
    const sessionRaw = findSetCookieString(setCookie, 'cirkel_session');
    expect(sessionRaw).not.toBeNull();
    expect(sessionRaw).toContain('HttpOnly');
    expect(sessionRaw).toContain('Secure');
    expect(sessionRaw).toContain('SameSite=Lax');

    const sessionToken = extractCookieValue(setCookie, 'cirkel_session')!;
    const payload = verifySession(sessionToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub_hash).toBe(expectedSubHash);
    expect(payload!.tier).toBe('mitid');

    // Challenge-cookie ryddet.
    const clearedRaw = findSetCookieString(setCookie, _CHALLENGE_COOKIE_NAME);
    expect(clearedRaw).not.toBeNull();
    expect(clearedRaw).toContain('Max-Age=0');

    // last_used_at bumpes til FIXED_NOW.
    const store = _getStore() as any;
    expect(store.webauthn_credentials).toHaveLength(1);
    expect(store.webauthn_credentials[0].last_used_at).toBe(FIXED_NOW.toISOString());
  });

  it('missing fields → 400 missing_fields', async () => {
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send({ credential_id: CREDENTIAL_ID });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'missing_fields' });
  });

  it('ingen challenge-cookie → 400 challenge_invalid_or_expired', async () => {
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .send(buildBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });

  it('cookie med wrong intent (register) → 400 challenge_invalid_or_expired', async () => {
    const wrong = makeChallengeCookieValue(AUTH_CHALLENGE, 'register', EXPECTED_EXPIRES_AT);
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', cookieHeader(wrong))
      .send(buildBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });

  it('forkert ceremonitype (webauthn.create) → 400 wrong_type', async () => {
    const badClient = encodeClientData('webauthn.create', AUTH_CHALLENGE, ALLOWED_ORIGIN);
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send(buildBody({ client_data_json: badClient }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'wrong_type', expected: 'webauthn.get' });
  });

  it('challenge-mismatch → 400 challenge_mismatch', async () => {
    const otherChallenge = toB64Url(Buffer.from('a-completely-other-challenge-x'));
    const badClient = encodeClientData('webauthn.get', otherChallenge, ALLOWED_ORIGIN);
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send(buildBody({ client_data_json: badClient }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_mismatch' });
  });

  it('origin ikke i allowlist → 400 origin_not_allowed', async () => {
    const badClient = encodeClientData('webauthn.get', AUTH_CHALLENGE, DISALLOWED_ORIGIN);
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send(buildBody({ client_data_json: badClient }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'origin_not_allowed' });
  });

  it('credential ikke registreret → 401 credential_not_registered', async () => {
    // Ingen seeding — tabellen er tom fra global beforeEach.
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send(buildBody());

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'credential_not_registered' });

    // Ingen session-cookie må være sat.
    const setCookie = res.headers['set-cookie'];
    const sessionRaw = findSetCookieString(setCookie, 'cirkel_session');
    expect(sessionRaw).toBeNull();
  });

  it('client_data_unparseable → 400', async () => {
    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', AUTH_COOKIE)
      .send(buildBody({ client_data_json: '%%%not-base64-json%%%' }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'client_data_unparseable' });
  });

  it('GET → 405 method_not_allowed', async () => {
    const res = await request(buildAuthenticateApp()).get('/api/webauthn/authenticate');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ error: 'method_not_allowed' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D) End-to-end integration: challenge → register → authenticate
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: challenge → register → authenticate', () => {
  it('registrerer og logger derefter ind med samme credential_id (fuld runde)', async () => {
    // 1) Registrér-challenge
    const challengeApp = buildChallengeApp();
    const c1 = await request(challengeApp)
      .get('/api/webauthn/challenge')
      .query({ intent: 'register' });
    expect(c1.status).toBe(200);
    const regCookieVal = extractCookieValue(c1.headers['set-cookie'], _CHALLENGE_COOKIE_NAME)!;
    const regChallenge = c1.body.challenge;

    // 2) Register
    const regRes = await request(buildRegisterApp())
      .post('/api/webauthn/register')
      .set('Cookie', cookieHeader(regCookieVal))
      .send({
        credential_id: CREDENTIAL_ID,
        attestation_object: ATTESTATION_OBJECT,
        client_data_json: encodeClientData('webauthn.create', regChallenge, ALLOWED_ORIGIN),
      });
    expect(regRes.status).toBe(200);
    const expectedSubHash = anontomeHash(`webauthn|${CREDENTIAL_ID}`);
    expect(regRes.body.sub_hash).toBe(expectedSubHash);

    // 3) Authenticate-challenge
    const c2 = await request(challengeApp)
      .get('/api/webauthn/challenge')
      .query({ intent: 'authenticate' });
    expect(c2.status).toBe(200);
    const authCookieVal = extractCookieValue(c2.headers['set-cookie'], _CHALLENGE_COOKIE_NAME)!;
    const authChallenge = c2.body.challenge;

    // De to challenges skal være forskellige (randomBytes)
    expect(authChallenge).not.toBe(regChallenge);

    // 4) Authenticate
    const authRes = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', cookieHeader(authCookieVal))
      .send({
        credential_id: CREDENTIAL_ID,
        authenticator_data: AUTHENTICATOR_DATA,
        client_data_json: encodeClientData('webauthn.get', authChallenge, ALLOWED_ORIGIN),
        signature: SIGNATURE,
      });
    expect(authRes.status).toBe(200);
    expect(authRes.body).toEqual({ ok: true, sub_hash: expectedSubHash, tier: 'mitid' });

    // Session token fra authenticate skal validere med samme sub_hash.
    const sessionToken = extractCookieValue(authRes.headers['set-cookie'], 'cirkel_session')!;
    const payload = verifySession(sessionToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub_hash).toBe(expectedSubHash);
  });

  it('kan ikke bruge register-cookie til authenticate-endpoint (cross-intent replay blokeres)', async () => {
    const c = await request(buildChallengeApp())
      .get('/api/webauthn/challenge')
      .query({ intent: 'register' });
    const regCookieVal = extractCookieValue(c.headers['set-cookie'], _CHALLENGE_COOKIE_NAME)!;
    const regChallenge = c.body.challenge;

    const res = await request(buildAuthenticateApp())
      .post('/api/webauthn/authenticate')
      .set('Cookie', cookieHeader(regCookieVal))
      .send({
        credential_id: CREDENTIAL_ID,
        authenticator_data: AUTHENTICATOR_DATA,
        client_data_json: encodeClientData('webauthn.get', regChallenge, ALLOWED_ORIGIN),
        signature: SIGNATURE,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'challenge_invalid_or_expired' });
  });
});
