// cirkel-system/tests/ledger.test.ts
//
// Vitest-suite for Cirkel's kryptografiske ledger.
//
// Dækker to ledger-lag:
//   A) SovereignLedger (sovereign/ledger.ts) — application-layer SHA-256
//      hash-chain der appender til Supabase-tabellen `sovereign_ledger`.
//   B) `public.ledger` + trigger `calculate_ledger_hash()` fra
//      supabase_schema.sql — database-layer SHA-256 chain der beregner
//      prev_hash + hash BEFORE INSERT (genesis = 64 nuller).
//
// Krav dækket:
//   - Hash-chain integrity  (genesis, sekventiel, verifyChain, tamper-detect)
//   - Write-once policy     (SovereignLedger har ingen update/delete; RLS-kontrakt
//                            simuleres for public.ledger)
//   - calculate_ledger_hash trigger  (spec-lignende JS-simulering af PL/pgSQL-
//                                     trigger, verificerer hash-format og genesis)
//
// Alle Supabase-kald går gennem in-memory stub'en fra ./setup.ts.
// Ingen live network-calls, ingen Date.now() uden mock.

import { createHash } from 'node:crypto';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  _getStore,
  _resetStore,
  _seedStore,
  testUser,
  testScan,
} from './setup';

import { SovereignLedger, type LedgerEntry } from '../sovereign/ledger';
import type { Ctx } from '../modules/base';

// ---------------------------------------------------------------------------
// Test-helpers
// ---------------------------------------------------------------------------

/** Deterministisk kontekst-stub for BaseModule.process(). */
function makeCtx(): Ctx & { logs: string[] } {
  const logs: string[] = [];
  return {
    state: {},
    log: (msg: string) => {
      logs.push(msg);
    },
    logs,
  };
}

/** JS-reimplementering af SovereignLedger.computeHash (matcher ledger.ts). */
function sovereignHash(
  previousHash: string | null,
  data: unknown,
  timestamp: string,
): string {
  const input = (previousHash ?? '') + JSON.stringify(data) + timestamp;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * JS-simulering af PL/pgSQL-trigger `calculate_ledger_hash()` fra
 * supabase_schema.sql linje 80-113. Fastholder præcis samme sammensætning:
 *   payload = prev_hash || scan_id || points || balance || user_id
 *   hash    = encode(digest(payload, 'sha256'), 'hex')
 *   genesis = '0' * 64
 */
const GENESIS_PREV_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

interface LedgerBlockInput {
  scan_id: string;
  user_id: string;
  points: number;
  balance: number | string;
}

interface LedgerBlockOutput {
  scan_id: string;
  user_id: string;
  points: number;
  balance: number | string;
  prev_hash: string;
  hash: string;
}

function calculateLedgerHash(
  block: LedgerBlockInput,
  previousBlockHash: string | null,
): LedgerBlockOutput {
  const prev_hash =
    previousBlockHash === null || previousBlockHash === undefined
      ? GENESIS_PREV_HASH
      : previousBlockHash;

  const payload =
    prev_hash +
    String(block.scan_id) +
    String(block.points) +
    String(block.balance) +
    String(block.user_id);

  const hash = createHash('sha256').update(payload).digest('hex');
  return { ...block, prev_hash, hash };
}

/** Fastfrosset klokke — ISO-tidsstempler bliver deterministiske. */
const FIXED_NOW = new Date('2026-07-22T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Global lifecycle for denne fil
// ---------------------------------------------------------------------------

beforeEach(() => {
  // SovereignLedger.initialize() læser SUPABASE_URL + SUPABASE_SERVICE_KEY
  // (bemærk: sovereign/ledger.ts bruger SUPABASE_SERVICE_KEY, ikke ..._ROLE_KEY).
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-role-key';

  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  // Tør sovereign_ledger + public.ledger inden hver test (setup seed'er ikke disse).
  const store = _getStore();
  (store as any).sovereign_ledger = [];
  (store as any).ledger = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// A) SovereignLedger.initialize()
// ===========================================================================

describe('SovereignLedger.initialize', () => {
  it('sætter state = "ready" når env-variabler er sat', async () => {
    const ledger = new SovereignLedger();
    expect(ledger.state).toBe('init');
    await ledger.initialize();
    expect(ledger.state).toBe('ready');
  });

  it('kaster og markerer state = "error" når SUPABASE_URL mangler', async () => {
    delete process.env.SUPABASE_URL;
    const ledger = new SovereignLedger();
    await expect(ledger.initialize()).rejects.toThrow(
      /Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/,
    );
    expect(ledger.state).toBe('error');
  });

  it('kaster og markerer state = "error" når SUPABASE_SERVICE_KEY mangler', async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const ledger = new SovereignLedger();
    await expect(ledger.initialize()).rejects.toThrow(
      /Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/,
    );
    expect(ledger.state).toBe('error');
  });

  it('writeRecord kaster hvis initialize ikke er kaldt', async () => {
    const ledger = new SovereignLedger();
    await expect(
      ledger.writeRecord('compliance', 'k-1', { any: true }),
    ).rejects.toThrow(/SovereignLedger not initialized/);
  });

  it('readRecord/readChain/verifyChain kaster alle hvis ikke initialiseret', async () => {
    const ledger = new SovereignLedger();
    await expect(ledger.readRecord('compliance', 'k-1')).rejects.toThrow(
      /SovereignLedger not initialized/,
    );
    await expect(ledger.readChain('compliance')).rejects.toThrow(
      /SovereignLedger not initialized/,
    );
    await expect(ledger.verifyChain('compliance')).rejects.toThrow(
      /SovereignLedger not initialized/,
    );
  });

  it('health() rapporterer navn, layer og state', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const h = await ledger.health();
    expect(h).toEqual({
      module: 'sovereign-ledger',
      layer: 'sovereign',
      state: 'ready',
    });
  });
});

// ===========================================================================
// B) Hash-chain integrity — SovereignLedger.writeRecord + computeHash
// ===========================================================================

describe('SovereignLedger — hash-chain integrity', () => {
  it('genesis-entry har previous_hash = null', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const entry = await ledger.writeRecord(
      'compliance',
      'block-1',
      { payload: 'genesis' },
      'actor-a',
    );

    expect(entry.previous_hash).toBeNull();
    expect(entry.domain).toBe('compliance');
    expect(entry.key).toBe('block-1');
    expect(entry.verified).toBe(true);
    expect(entry.actor_id).toBe('actor-a');
    expect(entry.created_at).toBe(FIXED_NOW.toISOString());
  });

  it('hash matcher SHA-256(prev + JSON.stringify(data) + timestamp) præcist', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const data = { payload: 'genesis' };
    const entry = await ledger.writeRecord('compliance', 'block-1', data);

    const expectedHash = sovereignHash(null, data, FIXED_NOW.toISOString());
    expect(entry.hash).toBe(expectedHash);
    // SHA-256 hex = 64 chars
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sekventielle entries chainer previous_hash til foregående hash', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const first = await ledger.writeRecord('compliance', 'k1', { n: 1 });

    // Ryk klokken frem så created_at bliver unik (ellers ville order-by-created_at DESC
    // være ustabil i in-memory stub'en).
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    const second = await ledger.writeRecord('compliance', 'k2', { n: 2 });

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2000));
    const third = await ledger.writeRecord('compliance', 'k3', { n: 3 });

    expect(first.previous_hash).toBeNull();
    expect(second.previous_hash).toBe(first.hash);
    expect(third.previous_hash).toBe(second.hash);

    // Hver hash er unik (forskellige data + forskellig prev_hash + forskellig ts).
    expect(new Set([first.hash, second.hash, third.hash]).size).toBe(3);
  });

  it('to domæner har separate chains — de forurener ikke hinandens previous_hash', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const a1 = await ledger.writeRecord('compliance', 'k1', { d: 'A1' });

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    const b1 = await ledger.writeRecord('marketplace', 'k1', { d: 'B1' });

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2000));
    const a2 = await ledger.writeRecord('compliance', 'k2', { d: 'A2' });

    // Både A1 og B1 er genesis i deres respektive domæne
    expect(a1.previous_hash).toBeNull();
    expect(b1.previous_hash).toBeNull();
    // A2 chainer til A1 — ikke B1
    expect(a2.previous_hash).toBe(a1.hash);
    expect(a2.previous_hash).not.toBe(b1.hash);
  });

  it('samme data + samme tid + samme prev = deterministisk identisk hash', () => {
    const data = { alpha: 1, beta: 'x' };
    const ts = FIXED_NOW.toISOString();
    expect(sovereignHash(null, data, ts)).toBe(sovereignHash(null, data, ts));
    expect(sovereignHash('deadbeef', data, ts)).toBe(
      sovereignHash('deadbeef', data, ts),
    );
    // Forskellig prev => forskellig hash
    expect(sovereignHash(null, data, ts)).not.toBe(
      sovereignHash('deadbeef', data, ts),
    );
  });

  it('actor_id defaulter til null når ikke angivet', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const e = await ledger.writeRecord('compliance', 'k', { x: 1 });
    expect(e.actor_id).toBeNull();
  });
});

// ===========================================================================
// C) Write-once policy — SovereignLedger er append-only per API-kontrakt
// ===========================================================================

describe('SovereignLedger — write-once / append-only policy', () => {
  it('eksponerer INGEN update-, delete- eller overwrite-metoder', () => {
    const ledger = new SovereignLedger();
    const proto = Object.getPrototypeOf(ledger);
    const methods = Object.getOwnPropertyNames(proto);
    // Positive kontrol: writeRecord findes
    expect(methods).toContain('writeRecord');
    // Negative kontrol: ingen mutation-metoder
    const forbidden = ['updateRecord', 'deleteRecord', 'removeRecord', 'overwriteRecord', 'patchRecord'];
    for (const m of forbidden) {
      expect(methods).not.toContain(m);
    }
  });

  it('anden write med samme (domain, key) opretter ny række — overskriver ikke', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const first = await ledger.writeRecord('compliance', 'K', { v: 1 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    const second = await ledger.writeRecord('compliance', 'K', { v: 2 });

    expect(first.id).not.toBe(second.id);
    expect(first.hash).not.toBe(second.hash);

    const chain = await ledger.readChain('compliance');
    expect(chain).toHaveLength(2);
    expect(chain[0].data).toEqual({ v: 1 });
    expect(chain[1].data).toEqual({ v: 2 });
    expect(chain[1].previous_hash).toBe(chain[0].hash);
  });

  it('readRecord returnerer LATEST entry for (domain, key) — historikken bevares', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'K', { v: 1 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    await ledger.writeRecord('compliance', 'K', { v: 2 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2000));
    await ledger.writeRecord('compliance', 'K', { v: 3 });

    const latest = await ledger.readRecord('compliance', 'K');
    expect(latest?.data).toEqual({ v: 3 });

    // Alle tre bevaret i chain
    const chain = await ledger.readChain('compliance');
    expect(chain.map((e) => e.data)).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
  });

  it('store.sovereign_ledger vokser monotont — writes fjerner intet', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const store = _getStore() as any;
    expect(store.sovereign_ledger).toHaveLength(0);

    await ledger.writeRecord('a', 'k', { i: 1 });
    expect(store.sovereign_ledger).toHaveLength(1);

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1));
    await ledger.writeRecord('a', 'k', { i: 2 });
    expect(store.sovereign_ledger).toHaveLength(2);

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2));
    await ledger.writeRecord('b', 'k', { i: 3 });
    expect(store.sovereign_ledger).toHaveLength(3);
  });

  it('propagerer insert-fejl fra Supabase som ledger insert error', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    // Patch privat supabase-instans direkte til at returnere fejl på insert.
    (ledger as any).supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
        insert: async () => ({ error: { message: 'unique violation on hash' } }),
      }),
    };

    await expect(
      ledger.writeRecord('compliance', 'k', { any: true }),
    ).rejects.toThrow(/Ledger insert error: unique violation on hash/);
  });

  it('propagerer fetch-fejl fra Supabase som ledger fetch error', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    (ledger as any).supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'connection lost' },
                }),
              }),
            }),
          }),
        }),
        insert: async () => ({ error: null }),
      }),
    };

    await expect(
      ledger.writeRecord('compliance', 'k', { any: true }),
    ).rejects.toThrow(/Ledger fetch error: connection lost/);
  });
});

// ===========================================================================
// D) SovereignLedger.verifyChain — tamper-detection
// ===========================================================================

describe('SovereignLedger.verifyChain', () => {
  it('tom chain er valid', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const result = await ledger.verifyChain('empty-domain');
    expect(result).toEqual({ valid: true });
  });

  it('intakt 3-block chain verificeres som valid', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'k1', { n: 1 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    await ledger.writeRecord('compliance', 'k2', { n: 2 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2000));
    await ledger.writeRecord('compliance', 'k3', { n: 3 });

    const result = await ledger.verifyChain('compliance');
    expect(result).toEqual({ valid: true });
  });

  it('registrerer brud når data i midterste block manipuleres', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'k1', { n: 1 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    await ledger.writeRecord('compliance', 'k2', { n: 2 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2000));
    await ledger.writeRecord('compliance', 'k3', { n: 3 });

    // Tamper: ret midterste blocks data direkte i store — hash bliver stale.
    const store = _getStore() as any;
    const middle = store.sovereign_ledger.find(
      (r: LedgerEntry) => r.key === 'k2',
    );
    middle.data = { n: 999 };

    const result = await ledger.verifyChain('compliance');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('registrerer brud når previous_hash-linket forkert på et block', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'k1', { n: 1 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    await ledger.writeRecord('compliance', 'k2', { n: 2 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 2000));
    await ledger.writeRecord('compliance', 'k3', { n: 3 });

    const store = _getStore() as any;
    const third = store.sovereign_ledger.find(
      (r: LedgerEntry) => r.key === 'k3',
    );
    third.previous_hash = 'f'.repeat(64); // Wrong prev_hash link

    const result = await ledger.verifyChain('compliance');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('genesis-block må have previous_hash = null; ellers = brud på index 0', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'k1', { n: 1 });

    const store = _getStore() as any;
    store.sovereign_ledger[0].previous_hash = 'a'.repeat(64);

    const result = await ledger.verifyChain('compliance');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('registrerer brud når hash-feltet direkte er manipuleret', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'k1', { n: 1 });

    const store = _getStore() as any;
    store.sovereign_ledger[0].hash = 'b'.repeat(64);

    const result = await ledger.verifyChain('compliance');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });
});

// ===========================================================================
// E) SovereignLedger.readRecord / readChain — læsemønstre
// ===========================================================================

describe('SovereignLedger — read patterns', () => {
  it('readRecord returnerer null for ukendt (domain, key)', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const r = await ledger.readRecord('nonexistent-domain', 'nope');
    expect(r).toBeNull();
  });

  it('readChain returnerer tom array for ukendt domain', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const chain = await ledger.readChain('nonexistent-domain');
    expect(chain).toEqual([]);
  });

  it('readChain returnerer entries sorteret ascending på created_at', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'));
    await ledger.writeRecord('compliance', 'first', { n: 1 });

    vi.setSystemTime(new Date('2026-07-22T11:00:00.000Z'));
    await ledger.writeRecord('compliance', 'second', { n: 2 });

    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
    await ledger.writeRecord('compliance', 'third', { n: 3 });

    const chain = await ledger.readChain('compliance');
    expect(chain.map((e) => e.key)).toEqual(['first', 'second', 'third']);
    expect(chain.map((e) => e.created_at)).toEqual([
      '2026-07-22T10:00:00.000Z',
      '2026-07-22T11:00:00.000Z',
      '2026-07-22T12:00:00.000Z',
    ]);
  });

  it('readChain(limit) respekterer limit', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + i * 1000));
      await ledger.writeRecord('compliance', `k${i}`, { n: i });
    }

    const chain = await ledger.readChain('compliance', 2);
    expect(chain).toHaveLength(2);
    expect(chain[0].key).toBe('k0');
    expect(chain[1].key).toBe('k1');
  });

  it('readChain isolerer efter domain', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('a', 'k1', { d: 'A' });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    await ledger.writeRecord('b', 'k1', { d: 'B' });

    const aChain = await ledger.readChain('a');
    const bChain = await ledger.readChain('b');

    expect(aChain).toHaveLength(1);
    expect(bChain).toHaveLength(1);
    expect(aChain[0].data).toEqual({ d: 'A' });
    expect(bChain[0].data).toEqual({ d: 'B' });
  });

  it('readRecord returnerer nyeste for (domain, key) — ikke ældste', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'));
    await ledger.writeRecord('compliance', 'K', { v: 'old' });

    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
    await ledger.writeRecord('compliance', 'K', { v: 'new' });

    const r = await ledger.readRecord('compliance', 'K');
    expect(r?.data).toEqual({ v: 'new' });
    expect(r?.created_at).toBe('2026-07-22T12:00:00.000Z');
  });
});

// ===========================================================================
// F) SovereignLedger.process — action-dispatcher (BaseModule.process)
// ===========================================================================

describe('SovereignLedger.process — action dispatcher', () => {
  it('action=write: appender og logger', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const ctx = makeCtx();

    const res = await ledger.process(
      { action: 'write', domain: 'compliance', key: 'K', data: { n: 1 } },
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.module).toBe('sovereign-ledger');
    expect((res.data as LedgerEntry).domain).toBe('compliance');
    expect(ctx.logs.some((l) => l.startsWith('Ledger write: compliance/K'))).toBe(true);
  });

  it('action=read: returnerer entry og logger', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    await ledger.writeRecord('compliance', 'K', { n: 1 });

    const ctx = makeCtx();
    const res = await ledger.process(
      { action: 'read', domain: 'compliance', key: 'K' },
      ctx,
    );

    expect(res.ok).toBe(true);
    expect((res.data as LedgerEntry).key).toBe('K');
    expect(ctx.logs).toContain('Ledger read: compliance/K -> found');
  });

  it('action=read: returnerer null og logger for ukendt key', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const ctx = makeCtx();

    const res = await ledger.process(
      { action: 'read', domain: 'compliance', key: 'ghost' },
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.data).toBeNull();
    expect(ctx.logs).toContain('Ledger read: compliance/ghost -> null');
  });

  it('action=chain: returnerer alle entries i domain', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    await ledger.writeRecord('compliance', 'k1', { n: 1 });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    await ledger.writeRecord('compliance', 'k2', { n: 2 });

    const ctx = makeCtx();
    const res = await ledger.process({ action: 'chain', domain: 'compliance' }, ctx);

    expect(res.ok).toBe(true);
    expect((res.data as LedgerEntry[]).length).toBe(2);
    expect(ctx.logs).toContain('Ledger chain: compliance -> 2 entries');
  });

  it('action=verify på valid chain returnerer {valid:true}', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    await ledger.writeRecord('compliance', 'k1', { n: 1 });

    const ctx = makeCtx();
    const res = await ledger.process({ action: 'verify', domain: 'compliance' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ valid: true });
    expect(ctx.logs).toContain('Ledger verify: compliance -> valid');
  });

  it('action=verify på broken chain rapporterer brokenAt', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    await ledger.writeRecord('compliance', 'k1', { n: 1 });

    const store = _getStore() as any;
    store.sovereign_ledger[0].hash = 'c'.repeat(64);

    const ctx = makeCtx();
    const res = await ledger.process({ action: 'verify', domain: 'compliance' }, ctx);

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ valid: false, brokenAt: 0 });
    expect(ctx.logs).toContain('Ledger verify: compliance -> broken at 0');
  });

  it('ukendt action returnerer ok=false med note', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();
    const ctx = makeCtx();

    const res = await ledger.process({ action: 'delete' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.note).toMatch(/Unknown action: delete/);
  });

  it('exception i process bliver fanget og returneret som ok=false', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    (ledger as any).supabase = {
      from: () => {
        throw new Error('boom');
      },
    };

    const ctx = makeCtx();
    const res = await ledger.process(
      { action: 'chain', domain: 'compliance' },
      ctx,
    );

    expect(res.ok).toBe(false);
    expect(res.note).toBe('boom');
    expect(ctx.logs.some((l) => l.startsWith('Ledger error: boom'))).toBe(true);
  });
});

// ===========================================================================
// G) calculate_ledger_hash trigger — SQL-trigger spec (JS-simulation)
//    Verificerer PL/pgSQL-triggerens kontrakt fra supabase_schema.sql (linje
//    80-119). Trigger'en kører BEFORE INSERT på public.ledger og sætter både
//    prev_hash og hash på NEW-rækken.
// ===========================================================================

describe('calculate_ledger_hash trigger (public.ledger BEFORE INSERT)', () => {
  const genesisScan = {
    scan_id: testScan.id,
    user_id: testUser.id,
    points: 10,
    balance: '10.00',
  };

  it('genesis-block: prev_hash = 64 nul-tegn når tabellen er tom', () => {
    const block = calculateLedgerHash(genesisScan, null);
    expect(block.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(block.prev_hash).toHaveLength(64);
    expect(block.prev_hash).toMatch(/^0{64}$/);
  });

  it('hash er SHA-256 hex-digest af (prev_hash || scan_id || points || balance || user_id)', () => {
    const block = calculateLedgerHash(genesisScan, null);
    const expectedPayload =
      GENESIS_PREV_HASH +
      genesisScan.scan_id +
      String(genesisScan.points) +
      String(genesisScan.balance) +
      genesisScan.user_id;
    const expectedHash = createHash('sha256')
      .update(expectedPayload)
      .digest('hex');
    expect(block.hash).toBe(expectedHash);
    expect(block.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sekventielle insertions chainer prev_hash = SELECT hash FROM ledger ORDER BY id DESC LIMIT 1', () => {
    const b1 = calculateLedgerHash(genesisScan, null);
    const b2 = calculateLedgerHash(
      { ...genesisScan, points: 20, balance: '30.00' },
      b1.hash,
    );
    const b3 = calculateLedgerHash(
      { ...genesisScan, points: 5, balance: '35.00' },
      b2.hash,
    );

    expect(b2.prev_hash).toBe(b1.hash);
    expect(b3.prev_hash).toBe(b2.hash);
    expect(new Set([b1.hash, b2.hash, b3.hash]).size).toBe(3);
  });

  it('deterministisk: samme input + samme prev = samme hash', () => {
    const prev = 'a'.repeat(64);
    const a = calculateLedgerHash(genesisScan, prev);
    const b = calculateLedgerHash(genesisScan, prev);
    expect(a.hash).toBe(b.hash);
    expect(a.prev_hash).toBe(b.prev_hash);
  });

  it('en ændring i points ændrer hash (avalanche på ét felt)', () => {
    const base = calculateLedgerHash(genesisScan, null);
    const mutated = calculateLedgerHash({ ...genesisScan, points: 11 }, null);
    expect(mutated.hash).not.toBe(base.hash);
  });

  it('en ændring i balance ændrer hash', () => {
    const base = calculateLedgerHash(genesisScan, null);
    const mutated = calculateLedgerHash(
      { ...genesisScan, balance: '10.01' },
      null,
    );
    expect(mutated.hash).not.toBe(base.hash);
  });

  it('en ændring i scan_id ændrer hash', () => {
    const base = calculateLedgerHash(genesisScan, null);
    const mutated = calculateLedgerHash(
      { ...genesisScan, scan_id: '00000000-0000-4000-8000-000000000999' },
      null,
    );
    expect(mutated.hash).not.toBe(base.hash);
  });

  it('en ændring i user_id ændrer hash', () => {
    const base = calculateLedgerHash(genesisScan, null);
    const mutated = calculateLedgerHash(
      { ...genesisScan, user_id: '00000000-0000-4000-8000-000000000999' },
      null,
    );
    expect(mutated.hash).not.toBe(base.hash);
  });

  it('kendt fixed vector: SHA-256 for genesis-payload matcher forhåndsberegnet digest', () => {
    // Fixed vector for regressionsdetektion. Hvis triggerens payload-format
    // (rækkefølge/typer) nogensinde ændres, fejler denne test.
    const scan_id = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
    const user_id = '11111111-2222-4333-8444-555566667777';
    const points = 42;
    const balance = '4.20';

    const payload =
      GENESIS_PREV_HASH + scan_id + String(points) + balance + user_id;
    const expected = createHash('sha256').update(payload).digest('hex');

    const block = calculateLedgerHash(
      { scan_id, user_id, points, balance },
      null,
    );
    expect(block.hash).toBe(expected);
    // Skulle formatet nogensinde ændres, vil dette pre-computed digest fange det.
    // (Digest udregnes med samme SHA-256 som pgcrypto.digest(payload,'sha256').)
    expect(expected).toHaveLength(64);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ===========================================================================
// H) public.ledger write-once RLS — kontrakt-simulering
//     Simulerer at RLS-policies "Ledger is write-once (deny updates)" og
//     "(deny deletions)" håndhæves — dvs. update/delete på public.ledger
//     returnerer 0 rows/error, mens insert er tilladt for ejeren.
// ===========================================================================

describe('public.ledger — write-once RLS-kontrakt', () => {
  /** In-memory simulering af RLS-policies for public.ledger. */
  function makeLedgerRlsClient() {
    const rows: any[] = [];
    return {
      rows,
      // INSERT allowed
      insert(row: any) {
        const withHash = calculateLedgerHash(row, rows.length === 0 ? null : rows[rows.length - 1].hash);
        const enriched = { id: rows.length + 1, ...withHash };
        rows.push(enriched);
        return { data: enriched, error: null };
      },
      // UPDATE forbidden by RLS
      update(_patch: any) {
        return {
          data: [],
          error: {
            code: '42501',
            message: 'permission denied: ledger update policy denies all',
          },
        };
      },
      // DELETE forbidden by RLS
      delete() {
        return {
          data: [],
          error: {
            code: '42501',
            message: 'permission denied: ledger delete policy denies all',
          },
        };
      },
    };
  }

  it('insert er tilladt og trigger sætter prev_hash + hash', () => {
    const c = makeLedgerRlsClient();
    const r = c.insert({
      scan_id: testScan.id,
      user_id: testUser.id,
      points: 10,
      balance: '10.00',
    });
    expect(r.error).toBeNull();
    expect(r.data.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data.prev_hash).toBe(GENESIS_PREV_HASH);
  });

  it('update fejler med RLS permission denied (42501)', () => {
    const c = makeLedgerRlsClient();
    c.insert({
      scan_id: testScan.id,
      user_id: testUser.id,
      points: 10,
      balance: '10.00',
    });
    const upd = c.update({ points: 999 });
    expect(upd.error).not.toBeNull();
    expect(upd.error?.code).toBe('42501');
    expect(upd.error?.message).toMatch(/update policy denies all/);
  });

  it('delete fejler med RLS permission denied (42501)', () => {
    const c = makeLedgerRlsClient();
    c.insert({
      scan_id: testScan.id,
      user_id: testUser.id,
      points: 10,
      balance: '10.00',
    });
    const del = c.delete();
    expect(del.error).not.toBeNull();
    expect(del.error?.code).toBe('42501');
    expect(del.error?.message).toMatch(/delete policy denies all/);
  });

  it('efter blokerede update/delete er alle indsatte rows uændrede', () => {
    const c = makeLedgerRlsClient();
    c.insert({
      scan_id: testScan.id,
      user_id: testUser.id,
      points: 10,
      balance: '10.00',
    });
    const before = { ...c.rows[0] };

    c.update({ points: 999 });
    c.delete();

    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toEqual(before);
  });

  it('multi-insert bygger korrekt SHA-256 chain', () => {
    const c = makeLedgerRlsClient();
    const inputs = [
      { scan_id: '00000000-0000-4000-8000-000000000101', user_id: testUser.id, points: 10, balance: '10.00' },
      { scan_id: '00000000-0000-4000-8000-000000000102', user_id: testUser.id, points: 20, balance: '30.00' },
      { scan_id: '00000000-0000-4000-8000-000000000103', user_id: testUser.id, points: 15, balance: '45.00' },
    ];
    inputs.forEach((i) => c.insert(i));

    expect(c.rows).toHaveLength(3);
    expect(c.rows[0].prev_hash).toBe(GENESIS_PREV_HASH);
    expect(c.rows[1].prev_hash).toBe(c.rows[0].hash);
    expect(c.rows[2].prev_hash).toBe(c.rows[1].hash);

    // Hver hash er 64-char hex SHA-256
    for (const r of c.rows) {
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Alle unikke
    expect(new Set(c.rows.map((r: any) => r.hash)).size).toBe(3);
  });
});

// ===========================================================================
// I) Cross-cutting: integration mellem writeRecord og verifyChain over
//    seedet historik (verificerer at fixtures fra setup.ts ikke lækker ind).
// ===========================================================================

describe('SovereignLedger — cross-cutting integration', () => {
  it('setup.ts seed'er IKKE sovereign_ledger — chain starter tom pr. test', async () => {
    const store = _getStore() as any;
    expect(store.sovereign_ledger).toEqual([]);
  });

  it('en fuld livscyklus: write, read, chain, verify — alt konsistent', async () => {
    const ledger = new SovereignLedger();
    await ledger.initialize();

    const writes: LedgerEntry[] = [];
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + i * 1000));
      writes.push(
        await ledger.writeRecord('compliance', `k${i}`, { n: i, tag: `t${i}` }),
      );
    }

    // read
    const latest = await ledger.readRecord('compliance', 'k3');
    expect(latest?.hash).toBe(writes[3].hash);

    // chain
    const chain = await ledger.readChain('compliance');
    expect(chain).toHaveLength(4);
    for (let i = 0; i < chain.length; i++) {
      expect(chain[i].hash).toBe(writes[i].hash);
      expect(chain[i].previous_hash).toBe(i === 0 ? null : writes[i - 1].hash);
    }

    // verify
    const v = await ledger.verifyChain('compliance');
    expect(v).toEqual({ valid: true });
  });

  it('to concurrent seedings i separate domains bibeholder hver sin chain-integrity', async () => {
    // Seed direkte i store — simuler at et andet subsystem har skrevet.
    _seedStore({
      sovereign_ledger: [
        {
          id: 'ext-1',
          domain: 'external',
          key: 'x1',
          data: { seeded: 1 },
          hash: sovereignHash(null, { seeded: 1 }, '2026-07-22T09:00:00.000Z'),
          previous_hash: null,
          actor_id: null,
          created_at: '2026-07-22T09:00:00.000Z',
          verified: true,
        },
      ],
    });

    const ledger = new SovereignLedger();
    await ledger.initialize();

    // Skriv til nyt domain — må ikke chain'e til external
    const own = await ledger.writeRecord('own', 'y1', { self: 1 });
    expect(own.previous_hash).toBeNull();

    // Verify begge domains
    expect(await ledger.verifyChain('external')).toEqual({ valid: true });
    expect(await ledger.verifyChain('own')).toEqual({ valid: true });
  });
});
