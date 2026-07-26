// cirkel-system/tests/rate-limit.test.ts
//
// Vitest-suite for api/_rate-limit.ts — in-memory sliding-window rate-limiter.
//
// Fokus:
//   - createRateLimiter: sliding-window over window_ms, allow/remaining/reset_at
//   - createRateLimiter: input-validering (window_ms > 0, max_requests > 0)
//   - createRateLimiter: LRU-bucketing pr. key_extractor
//   - extractIp: x-forwarded-for (multi-value), x-real-ip, socket, fallback "unknown"
//   - extractUserOrIp: x-user-id prefix "u:", ellers "ip:" prefix
//   - headers(): X-RateLimit-Limit/Remaining/Reset, Retry-After når blokeret
//   - presets: SCAN_LIMITER (10), CHAT_LIMITER (30), UPLOAD_LIMITER (5),
//              PUBLIC_API_LIMITER (100), alle 60_000 ms window
//
// Determinisme:
//   * vi.useFakeTimers() + vi.setSystemTime(FIXED_NOW) i beforeEach.
//   * Ingen network-calls, ingen Date.now-drift.
//   * Alle expected reset_at-værdier er præcise tal (now + window_ms).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  createRateLimiter,
  extractIp,
  extractUserOrIp,
  SCAN_LIMITER,
  CHAT_LIMITER,
  UPLOAD_LIMITER,
  PUBLIC_API_LIMITER,
  type RateLimitRequest,
} from '../api/_rate-limit.js';

// ─── Deterministisk klokke ──────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-07-22T10:00:00.000Z');
const FIXED_MS = FIXED_NOW.getTime();
const WINDOW_MS = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Fixture-hjælpere ───────────────────────────────────────────────────────

function makeReq(overrides: Partial<RateLimitRequest> = {}): RateLimitRequest {
  return {
    headers: {},
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides,
  };
}

// ============================================================================
// 1) createRateLimiter — grundlæggende sliding-window
// ============================================================================

describe('createRateLimiter — sliding window', () => {
  it('tillader op til max_requests og blokerer derefter', async () => {
    const rl = createRateLimiter({
      key_extractor: () => 'k1',
      window_ms: WINDOW_MS,
      max_requests: 3,
    });
    const req = makeReq();

    const r1 = await rl.check(req);
    expect(r1.allow).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r1.reset_at).toBe(FIXED_MS + WINDOW_MS);

    const r2 = await rl.check(req);
    expect(r2.allow).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await rl.check(req);
    expect(r3.allow).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await rl.check(req);
    expect(r4.allow).toBe(false);
    expect(r4.remaining).toBe(0);
    // reset_at = oldest fresh timestamp + window_ms = FIXED_MS + WINDOW_MS
    expect(r4.reset_at).toBe(FIXED_MS + WINDOW_MS);
  });

  it('frigiver kapacitet når vindue glider forbi ældste request', async () => {
    const rl = createRateLimiter({
      key_extractor: () => 'k2',
      window_ms: WINDOW_MS,
      max_requests: 2,
    });
    const req = makeReq();

    await rl.check(req);
    await rl.check(req);
    const blocked = await rl.check(req);
    expect(blocked.allow).toBe(false);

    // Ryk klokken 61 sek frem — alle timestamps er nu udenfor vindue.
    vi.setSystemTime(new Date(FIXED_MS + WINDOW_MS + 1));
    const after = await rl.check(req);
    expect(after.allow).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it('bucketer separat pr. key_extractor-value', async () => {
    const rl = createRateLimiter({
      key_extractor: (req) => String(req.headers['x-key'] ?? 'default'),
      window_ms: WINDOW_MS,
      max_requests: 1,
    });

    const a = await rl.check(makeReq({ headers: { 'x-key': 'user-a' } }));
    const b = await rl.check(makeReq({ headers: { 'x-key': 'user-b' } }));
    expect(a.allow).toBe(true);
    expect(b.allow).toBe(true);

    const a2 = await rl.check(makeReq({ headers: { 'x-key': 'user-a' } }));
    expect(a2.allow).toBe(false);
    const b2 = await rl.check(makeReq({ headers: { 'x-key': 'user-b' } }));
    expect(b2.allow).toBe(false);
  });

  it('exposer limit og window_ms som read-only felter', () => {
    const rl = createRateLimiter({
      key_extractor: () => 'k',
      window_ms: 30_000,
      max_requests: 7,
    });
    expect(rl.limit).toBe(7);
    expect(rl.window_ms).toBe(30_000);
  });
});

// ============================================================================
// 2) createRateLimiter — input-validering
// ============================================================================

describe('createRateLimiter — input-validering', () => {
  it('kaster når window_ms <= 0', () => {
    expect(() =>
      createRateLimiter({ key_extractor: () => 'k', window_ms: 0, max_requests: 1 }),
    ).toThrow('createRateLimiter: window_ms must be > 0');
    expect(() =>
      createRateLimiter({ key_extractor: () => 'k', window_ms: -1, max_requests: 1 }),
    ).toThrow('createRateLimiter: window_ms must be > 0');
  });

  it('kaster når max_requests <= 0', () => {
    expect(() =>
      createRateLimiter({ key_extractor: () => 'k', window_ms: 1000, max_requests: 0 }),
    ).toThrow('createRateLimiter: max_requests must be > 0');
    expect(() =>
      createRateLimiter({ key_extractor: () => 'k', window_ms: 1000, max_requests: -5 }),
    ).toThrow('createRateLimiter: max_requests must be > 0');
  });
});

// ============================================================================
// 3) headers() — HTTP header-shape
// ============================================================================

describe('rate-limiter.headers()', () => {
  it('returnerer X-RateLimit-* når allow=true (uden Retry-After)', async () => {
    const rl = createRateLimiter({
      key_extractor: () => 'h1',
      window_ms: WINDOW_MS,
      max_requests: 5,
    });
    const result = await rl.check(makeReq());
    const h = rl.headers(result);

    expect(h['X-RateLimit-Limit']).toBe('5');
    expect(h['X-RateLimit-Remaining']).toBe('4');
    // reset er Unix-seconds
    expect(h['X-RateLimit-Reset']).toBe(String(Math.ceil((FIXED_MS + WINDOW_MS) / 1000)));
    expect(h['Retry-After']).toBeUndefined();
  });

  it('inkluderer Retry-After når blokeret', async () => {
    const rl = createRateLimiter({
      key_extractor: () => 'h2',
      window_ms: WINDOW_MS,
      max_requests: 1,
    });
    await rl.check(makeReq());
    const blocked = await rl.check(makeReq());
    const h = rl.headers(blocked);

    expect(h['X-RateLimit-Limit']).toBe('1');
    expect(h['X-RateLimit-Remaining']).toBe('0');
    // Retry-After skal være >= 1 (mindst 1 sekund).
    expect(Number(h['Retry-After'])).toBeGreaterThanOrEqual(1);
    // Ved FIXED_MS er reset_at = FIXED_MS + WINDOW_MS, så retry ~ 60 sek.
    expect(Number(h['Retry-After'])).toBe(60);
  });

  it('normaliserer remaining til minimum 0 i header (aldrig negativ)', async () => {
    const rl = createRateLimiter({
      key_extractor: () => 'h3',
      window_ms: WINDOW_MS,
      max_requests: 1,
    });
    await rl.check(makeReq());
    const blocked = await rl.check(makeReq());
    // Manuelt manipuler til negativ remaining for at teste Math.max(0, ...).
    blocked.remaining = -3;
    const h = rl.headers(blocked);
    expect(h['X-RateLimit-Remaining']).toBe('0');
  });
});

// ============================================================================
// 4) extractIp — header/socket prioritering
// ============================================================================

describe('extractIp', () => {
  it('foretrækker x-forwarded-for (første værdi ved komma-separeret)', () => {
    const req = makeReq({
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(extractIp(req)).toBe('203.0.113.5');
  });

  it('bruger første element hvis x-forwarded-for er et array', () => {
    const req = makeReq({
      headers: { 'x-forwarded-for': ['198.51.100.7', '10.0.0.1'] },
    });
    expect(extractIp(req)).toBe('198.51.100.7');
  });

  it('falder tilbage til x-real-ip når x-forwarded-for mangler', () => {
    const req = makeReq({
      headers: { 'x-real-ip': '203.0.113.99' },
    });
    expect(extractIp(req)).toBe('203.0.113.99');
  });

  it('falder tilbage til socket.remoteAddress når begge headers mangler', () => {
    const req = makeReq({
      headers: {},
      socket: { remoteAddress: '10.0.0.42' },
    });
    expect(extractIp(req)).toBe('10.0.0.42');
  });

  it('falder tilbage til connection.remoteAddress hvis socket mangler', () => {
    const req: RateLimitRequest = {
      headers: {},
      connection: { remoteAddress: '10.0.0.99' },
    };
    expect(extractIp(req)).toBe('10.0.0.99');
  });

  it('returnerer "unknown" når intet er tilgængeligt', () => {
    const req: RateLimitRequest = { headers: {} };
    expect(extractIp(req)).toBe('unknown');
  });

  it('behandler tom x-forwarded-for som fravær', () => {
    const req = makeReq({
      headers: { 'x-forwarded-for': '' },
      socket: { remoteAddress: '10.0.0.7' },
    });
    expect(extractIp(req)).toBe('10.0.0.7');
  });
});

// ============================================================================
// 5) extractUserOrIp — user-id foran IP
// ============================================================================

describe('extractUserOrIp', () => {
  it('præfikser x-user-id med "u:"', () => {
    const req = makeReq({
      headers: { 'x-user-id': 'user-abc-123' },
    });
    expect(extractUserOrIp(req)).toBe('u:user-abc-123');
  });

  it('falder tilbage til "ip:<ip>" når x-user-id mangler', () => {
    const req = makeReq({
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(extractUserOrIp(req)).toBe('ip:203.0.113.10');
  });

  it('bruger "ip:unknown" når hverken user-id eller IP kan udledes', () => {
    const req: RateLimitRequest = { headers: {} };
    expect(extractUserOrIp(req)).toBe('ip:unknown');
  });
});

// ============================================================================
// 6) Presets — SCAN/CHAT/UPLOAD/PUBLIC_API limits
// ============================================================================

describe('rate-limiter presets', () => {
  it('SCAN_LIMITER: 10 requests / minut', () => {
    expect(SCAN_LIMITER.limit).toBe(10);
    expect(SCAN_LIMITER.window_ms).toBe(60_000);
  });

  it('CHAT_LIMITER: 30 requests / minut', () => {
    expect(CHAT_LIMITER.limit).toBe(30);
    expect(CHAT_LIMITER.window_ms).toBe(60_000);
  });

  it('UPLOAD_LIMITER: 5 requests / minut', () => {
    expect(UPLOAD_LIMITER.limit).toBe(5);
    expect(UPLOAD_LIMITER.window_ms).toBe(60_000);
  });

  it('PUBLIC_API_LIMITER: 100 requests / minut', () => {
    expect(PUBLIC_API_LIMITER.limit).toBe(100);
    expect(PUBLIC_API_LIMITER.window_ms).toBe(60_000);
  });
});
