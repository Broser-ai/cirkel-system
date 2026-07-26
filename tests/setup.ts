// cirkel-system/tests/setup.ts
//
// Global test setup — loades automatisk af vitest via
// vitest.config.ts -> setupFiles: ['./tests/setup.ts'].
//
// Formål:
//   1) Load .env (dotenv) — så tests får samme env-shape som runtime.
//      Sætter dog SIKRE dummy-værdier for alle production-secrets uanset .env,
//      så tests ALDRIG rammer live Supabase/Firebase/Gemini/Claude.
//   2) Mocker firebase-admin — verifyIdToken returnerer altid testUser.
//   3) Mocker @supabase/supabase-js — leverer in-memory query builder-stub
//      der taler samme dialekt som postgrest-js (from/select/insert/update/
//      upsert/delete/eq/order/limit/range/ilike/filter/single/maybeSingle
//      + count-mode via select('*', { count: 'exact' })).
//   4) Mocker @google/genai (Gemini) og @anthropic-ai/sdk (Claude) med
//      deterministiske svar der returnerer gyldig JSON i det format som
//      api/scan.ts, api/chat.ts og api/nudge.ts forventer.
//   5) Eksporterer testUser, testScan og testRedemption som genbrugelige
//      fixtures + små hjælpere til at seede/reset in-memory Supabase.

import { config as loadEnv } from 'dotenv';
import { afterEach, beforeEach, vi } from 'vitest';
import path from 'node:path';

// ============================================================================
// 1) ENV — dotenv + safe overrides
// ============================================================================

loadEnv({ path: path.resolve(process.cwd(), '.env') });

// Uanset .env-indhold: tvinger sikre TEST-værdier så vi ALDRIG rammer live infra.
process.env.NODE_ENV = 'test';
process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.CLAUDE_MODEL = 'claude-sonnet-4-6';
process.env.AI_PROVIDER = process.env.AI_PROVIDER || 'gemini';
process.env.FIREBASE_PROJECT_ID = 'cirkel-test';
process.env.FIREBASE_CLIENT_EMAIL = 'test@cirkel-test.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n';

// ============================================================================
// 2) FIXTURES
// ============================================================================

export interface TestUser {
  id: string;              // Supabase profile-id (uuid)
  firebase_uid: string;    // Firebase Auth UID
  email: string;
  full_name: string;
  municipality: string;
  balance: number;
  points: number;
  scans_count: number;
  co2_saved_kg: number;
  streak_days: number;
  level: number;
  member_status: 'Standard-medlem' | 'Sølv-medlem' | 'Guld-medlem';
  verification_tier: 'standard' | 'cpr' | 'mitid';
  is_mitid_verified: boolean;
  referral_code: string | null;
  has_applied_referral: boolean;
  created_at: string;
  updated_at: string;
}

export interface TestScan {
  id: string;
  user_id: string;
  barcode: string;
  material: string;
  weight_grams: number;
  sorting_compliance: number;
  points_earned: number;
  kroner_earned: number;
  is_processed: boolean;
  created_at: string;
}

export interface TestRedemption {
  id: string;
  user_id: string;
  reward_id: string;
  reward_name: string;
  points_spent: number;
  kroner_value: number;
  status: 'pending' | 'confirmed' | 'delivered' | 'failed';
  created_at: string;
}

export const testUser: TestUser = {
  id: '00000000-0000-4000-8000-000000000001',
  firebase_uid: 'firebase-uid-test-user-1',
  email: 'test@cirkel.dk',
  full_name: 'Test Testesen',
  municipality: 'Aarhus Kommune',
  balance: 42.5,
  points: 425,
  scans_count: 17,
  co2_saved_kg: 3.14,
  streak_days: 4,
  level: 2,
  member_status: 'Standard-medlem',
  verification_tier: 'standard',
  is_mitid_verified: false,
  referral_code: 'TEST-REF-001',
  has_applied_referral: false,
  created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-15T10:00:00.000Z',
};

export const testScan: TestScan = {
  id: '00000000-0000-4000-8000-000000000101',
  user_id: testUser.id,
  barcode: '5701234567890',
  material: 'PET-plast',
  weight_grams: 25.0,
  sorting_compliance: 100.0,
  points_earned: 10,
  kroner_earned: 1.0,
  is_processed: true,
  created_at: '2026-07-20T09:00:00.000Z',
};

export const testRedemption: TestRedemption = {
  id: '00000000-0000-4000-8000-000000000201',
  user_id: testUser.id,
  reward_id: 'reward-coffee-01',
  reward_name: 'Kaffe hos Kaffekooperativet',
  points_spent: 100,
  kroner_value: 30.0,
  status: 'confirmed',
  created_at: '2026-07-20T10:00:00.000Z',
};

// Factory-hjælpere til unikke, deterministiske fixtures
let _seq = 1000;
function nextId(prefix: string): string {
  _seq += 1;
  const n = String(_seq).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${n}`;
}

export function makeTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return { ...testUser, id: nextId('11111111'), ...overrides };
}

export function makeTestScan(overrides: Partial<TestScan> = {}): TestScan {
  return { ...testScan, id: nextId('22222222'), ...overrides };
}

export function makeTestRedemption(
  overrides: Partial<TestRedemption> = {}
): TestRedemption {
  return { ...testRedemption, id: nextId('33333333'), ...overrides };
}

// ============================================================================
// 3) IN-MEMORY SUPABASE STUB
// ============================================================================
// Tabel-navn -> array af rows. Reset mellem hver test via beforeEach nedenfor.

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

const store: Store = {
  profiles: [],
  scans: [],
  ledger: [],
  redemptions: [],
  rewards: [],
  nudges: [],
};

export function _resetStore(): void {
  for (const key of Object.keys(store)) store[key] = [];
}

export function _seedStore(seed: Partial<Store>): void {
  for (const [table, rows] of Object.entries(seed)) {
    if (!store[table]) store[table] = [];
    if (Array.isArray(rows)) store[table].push(...rows);
  }
}

export function _getStore(): Readonly<Store> {
  return store;
}

interface Filter {
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'ilike' | 'like' | 'raw';
  column: string;
  value: any;
  rawOp?: string; // used when op === 'raw' (via .filter())
}

interface QueryState {
  table: string;
  filters: Filter[];
  order?: { column: string; ascending: boolean };
  limitCount?: number;
  rangeFrom?: number;
  rangeTo?: number;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload?: Row | Row[];
  selectColumns?: string;
  countMode?: 'exact' | 'planned' | 'estimated' | null;
}

// Convert an ilike/like pattern (SQL % and _) to a RegExp.
function sqlPatternToRegex(pattern: string, caseInsensitive: boolean): RegExp {
  // Escape regex specials except % and _
  let re = '';
  for (const ch of String(pattern)) {
    if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else if ('.*+?^${}()|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp('^' + re + '$', caseInsensitive ? 'i' : '');
}

function applyRawFilter(v: any, op: string, target: any): boolean {
  switch (op) {
    case 'eq': return v === target;
    case 'neq': return v !== target;
    case 'gt': return v > target;
    case 'gte': return v >= target;
    case 'lt': return v < target;
    case 'lte': return v <= target;
    case 'in': {
      // Accepts either an array or the postgrest string form "(a,b,c)"
      if (Array.isArray(target)) return target.includes(v);
      if (typeof target === 'string') {
        const inner = target.replace(/^\(|\)$/g, '');
        return inner.split(',').map((s) => s.trim()).includes(String(v));
      }
      return false;
    }
    case 'is': return v === target;
    case 'like': return sqlPatternToRegex(String(target), false).test(String(v ?? ''));
    case 'ilike': return sqlPatternToRegex(String(target), true).test(String(v ?? ''));
    case 'not.is': return v !== target;
    case 'not.eq': return v !== target;
    default: return false;
  }
}

function matchRow(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.column];
    switch (f.op) {
      case 'eq': return v === f.value;
      case 'neq': return v !== f.value;
      case 'gt': return v > f.value;
      case 'gte': return v >= f.value;
      case 'lt': return v < f.value;
      case 'lte': return v <= f.value;
      case 'in': return Array.isArray(f.value) && f.value.includes(v);
      case 'is': return v === f.value;
      case 'ilike': return sqlPatternToRegex(String(f.value), true).test(String(v ?? ''));
      case 'like': return sqlPatternToRegex(String(f.value), false).test(String(v ?? ''));
      case 'raw': return applyRawFilter(v, f.rawOp ?? 'eq', f.value);
      default: return false;
    }
  });
}

function pickColumns(rows: Row[], select?: string): Row[] {
  if (!select || select.trim() === '*' || select.trim() === '') return rows;
  const cols = select.split(',').map((c) => c.trim()).filter(Boolean);
  return rows.map((r) => {
    const out: Row = {};
    for (const c of cols) if (c in r) out[c] = r[c];
    return out;
  });
}

function newId(): string {
  const rand = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  return `00000000-0000-4000-8000-${rand}`;
}

interface QueryResult {
  data: any;
  error: any;
  count?: number | null;
}

function executeQuery(state: QueryState): QueryResult {
  const table = store[state.table] ?? (store[state.table] = []);
  const wantCount = !!state.countMode;

  if (state.action === 'insert' || state.action === 'upsert') {
    const rows = Array.isArray(state.payload) ? state.payload : [state.payload!];
    const inserted: Row[] = rows.map((r) => ({
      id: r.id ?? newId(),
      created_at: r.created_at ?? new Date().toISOString(),
      ...r,
    }));
    if (state.action === 'upsert') {
      for (const row of inserted) {
        const idx = table.findIndex((t) => t.id === row.id);
        if (idx >= 0) table[idx] = { ...table[idx], ...row };
        else table.push(row);
      }
    } else {
      table.push(...inserted);
    }
    const data = pickColumns(inserted, state.selectColumns);
    return wantCount
      ? { data, error: null, count: inserted.length }
      : { data, error: null };
  }

  if (state.action === 'update') {
    const patched: Row[] = [];
    for (let i = 0; i < table.length; i++) {
      if (matchRow(table[i], state.filters)) {
        table[i] = {
          ...table[i],
          ...state.payload,
          updated_at: new Date().toISOString(),
        };
        patched.push(table[i]);
      }
    }
    const data = pickColumns(patched, state.selectColumns);
    return wantCount
      ? { data, error: null, count: patched.length }
      : { data, error: null };
  }

  if (state.action === 'delete') {
    const kept: Row[] = [];
    const removed: Row[] = [];
    for (const row of table) {
      if (matchRow(row, state.filters)) removed.push(row);
      else kept.push(row);
    }
    store[state.table] = kept;
    const data = pickColumns(removed, state.selectColumns);
    return wantCount
      ? { data, error: null, count: removed.length }
      : { data, error: null };
  }

  // select
  let rows = table.filter((r) => matchRow(r, state.filters));

  // Total count BEFORE pagination — this is what postgrest returns for
  // select('*', { count: 'exact' }).
  const totalCount = rows.length;

  if (state.order) {
    const { column, ascending } = state.order;
    rows = [...rows].sort((a, b) => {
      if (a[column] < b[column]) return ascending ? -1 : 1;
      if (a[column] > b[column]) return ascending ? 1 : -1;
      return 0;
    });
  }

  // range takes precedence over limit if both are set (postgrest behaviour:
  // range is the actual slice; limit is a ceiling). Here we apply whichever
  // was set — if both, apply range then limit.
  if (typeof state.rangeFrom === 'number' && typeof state.rangeTo === 'number') {
    // postgrest .range(from, to) is INCLUSIVE on both ends.
    rows = rows.slice(state.rangeFrom, state.rangeTo + 1);
  }
  if (typeof state.limitCount === 'number') rows = rows.slice(0, state.limitCount);

  const data = pickColumns(rows, state.selectColumns);
  return wantCount
    ? { data, error: null, count: totalCount }
    : { data, error: null };
}

function createBuilder(table: string) {
  const state: QueryState = {
    table,
    filters: [],
    action: 'select',
    selectColumns: '*',
    countMode: null,
  };

  const builder: any = {
    select(columns: string = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
      state.selectColumns = columns;
      if (opts && opts.count) {
        state.countMode = opts.count;
      }
      if (state.action === 'insert' || state.action === 'update' || state.action === 'upsert') {
        // insert().select() chain — behold action, sæt select-kolonner
        return builder;
      }
      state.action = 'select';
      return builder;
    },
    insert(payload: Row | Row[]) {
      state.action = 'insert';
      state.payload = payload;
      return builder;
    },
    upsert(payload: Row | Row[]) {
      state.action = 'upsert';
      state.payload = payload;
      return builder;
    },
    update(payload: Row) {
      state.action = 'update';
      state.payload = payload;
      return builder;
    },
    delete() {
      state.action = 'delete';
      return builder;
    },
    eq(col: string, v: any) { state.filters.push({ op: 'eq', column: col, value: v }); return builder; },
    neq(col: string, v: any) { state.filters.push({ op: 'neq', column: col, value: v }); return builder; },
    gt(col: string, v: any) { state.filters.push({ op: 'gt', column: col, value: v }); return builder; },
    gte(col: string, v: any) { state.filters.push({ op: 'gte', column: col, value: v }); return builder; },
    lt(col: string, v: any) { state.filters.push({ op: 'lt', column: col, value: v }); return builder; },
    lte(col: string, v: any) { state.filters.push({ op: 'lte', column: col, value: v }); return builder; },
    in(col: string, v: any[]) { state.filters.push({ op: 'in', column: col, value: v }); return builder; },
    is(col: string, v: any) { state.filters.push({ op: 'is', column: col, value: v }); return builder; },
    like(col: string, pattern: string) {
      state.filters.push({ op: 'like', column: col, value: pattern });
      return builder;
    },
    ilike(col: string, pattern: string) {
      state.filters.push({ op: 'ilike', column: col, value: pattern });
      return builder;
    },
    filter(col: string, op: string, value: any) {
      state.filters.push({ op: 'raw', column: col, value, rawOp: op });
      return builder;
    },
    match(criteria: Record<string, any>) {
      for (const [col, v] of Object.entries(criteria)) {
        state.filters.push({ op: 'eq', column: col, value: v });
      }
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      state.order = { column: col, ascending: opts?.ascending ?? true };
      return builder;
    },
    limit(n: number) { state.limitCount = n; return builder; },
    range(from: number, to: number) {
      state.rangeFrom = from;
      state.rangeTo = to;
      return builder;
    },
    async single() {
      const result = executeQuery(state);
      if (result.error) {
        return state.countMode
          ? { data: null, error: result.error, count: null }
          : { data: null, error: result.error };
      }
      const arr = Array.isArray(result.data) ? result.data : [result.data];
      if (arr.length === 0) {
        const err = { code: 'PGRST116', message: 'No rows returned' };
        return state.countMode
          ? { data: null, error: err, count: result.count ?? 0 }
          : { data: null, error: err };
      }
      if (arr.length > 1) {
        const err = { code: 'PGRST117', message: 'Multiple rows returned' };
        return state.countMode
          ? { data: null, error: err, count: result.count ?? arr.length }
          : { data: null, error: err };
      }
      return state.countMode
        ? { data: arr[0], error: null, count: result.count ?? 1 }
        : { data: arr[0], error: null };
    },
    async maybeSingle() {
      const result = executeQuery(state);
      if (result.error) {
        return state.countMode
          ? { data: null, error: result.error, count: null }
          : { data: null, error: result.error };
      }
      const arr = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
      const first = arr[0] ?? null;
      return state.countMode
        ? { data: first, error: null, count: result.count ?? (first ? 1 : 0) }
        : { data: first, error: null };
    },
    then(resolve: (r: QueryResult) => void, reject?: (e: any) => void) {
      try {
        const result = executeQuery(state);
        resolve(result);
      } catch (err) {
        if (reject) reject(err);
        else resolve(state.countMode
          ? { data: null, error: err, count: null }
          : { data: null, error: err });
      }
    },
  };
  return builder;
}

function makeSupabaseStub() {
  return {
    from: (table: string) => createBuilder(table),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: testUser.id, email: testUser.email } },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => ({
        data: { user: { id: testUser.id, email: testUser.email }, session: { access_token: 'test-token' } },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async (_fn: string, _args?: any) => ({ data: null, error: null })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ data: { path: 'test/path' }, error: null })),
        download: vi.fn(async () => ({ data: new Blob(), error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'http://localhost/test' } })),
      })),
    },
  };
}

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => makeSupabaseStub()),
  };
});

// ============================================================================
// 4) FIREBASE ADMIN MOCK
// ============================================================================

vi.mock('firebase-admin', () => {
  const app = { name: '[DEFAULT]' };
  const authInstance = {
    verifyIdToken: vi.fn(async (token: string) => {
      if (!token || token === 'invalid') {
        throw new Error('Firebase ID token has expired or is invalid.');
      }
      return {
        uid: testUser.firebase_uid,
        email: testUser.email,
        email_verified: true,
        name: testUser.full_name,
      };
    }),
    getUser: vi.fn(async (uid: string) => ({
      uid,
      email: testUser.email,
      displayName: testUser.full_name,
    })),
    createCustomToken: vi.fn(async (uid: string) => `custom-token-${uid}`),
  };

  const admin: any = {
    apps: [app],
    initializeApp: vi.fn(() => app),
    credential: {
      cert: vi.fn(() => ({ __credential: true })),
      applicationDefault: vi.fn(() => ({ __credential: true })),
    },
    auth: vi.fn(() => authInstance),
  };
  return { default: admin, ...admin };
});

// ============================================================================
// 5) GEMINI MOCK (@google/genai)
// ============================================================================

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    public models: {
      generateContent: (args: any) => Promise<any>;
    };
    constructor(_opts: any) {
      this.models = {
        generateContent: vi.fn(async (args: any) => {
          const prompt: string =
            typeof args?.contents === 'string'
              ? args.contents
              : Array.isArray(args?.contents)
              ? JSON.stringify(args.contents)
              : '';
          const text = defaultAiJsonForPrompt(prompt);
          return {
            text,
            response: { text: () => text },
            candidates: [{ content: { parts: [{ text }] } }],
          };
        }),
      };
    }
  }
  return { GoogleGenAI };
});

// ============================================================================
// 6) CLAUDE MOCK (@anthropic-ai/sdk)
// ============================================================================

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    public messages: { create: (args: any) => Promise<any> };
    constructor(_opts: any) {
      this.messages = {
        create: vi.fn(async (args: any) => {
          const userBlocks = args?.messages?.[0]?.content;
          let prompt = '';
          if (typeof userBlocks === 'string') prompt = userBlocks;
          else if (Array.isArray(userBlocks)) {
            prompt = userBlocks
              .filter((b: any) => b?.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
          }
          const text = defaultAiJsonForPrompt(prompt);
          return {
            id: 'msg_test_' + Math.random().toString(36).slice(2, 10),
            type: 'message',
            role: 'assistant',
            model: process.env.CLAUDE_MODEL,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 20 },
          };
        }),
      };
    }
  }
  return { default: Anthropic };
});

// Deterministisk JSON-svar der matcher formen scan.ts/nudge.ts/chat.ts forventer.
function defaultAiJsonForPrompt(prompt: string): string {
  const p = (prompt || '').toLowerCase();
  if (p.includes('nudge') || p.includes('motivér') || p.includes('opmuntr')) {
    return JSON.stringify({
      message: 'Godt gået! Fortsæt med at genanvende — hver flaske tæller.',
      tone: 'encouraging',
    });
  }
  if (p.includes('chat') || p.includes('spørg') || p.includes('question')) {
    return JSON.stringify({
      reply: 'Hej! Jeg er Cirkel-assistenten. Hvad kan jeg hjælpe med?',
    });
  }
  // Default: scan/klassificering-svar
  return JSON.stringify({
    material: testScan.material,
    weight_grams: testScan.weight_grams,
    sorting_compliance: testScan.sorting_compliance,
    points_earned: testScan.points_earned,
    kroner_earned: testScan.kroner_earned,
    confidence: 0.95,
    reasoning: 'Test-klassificering fra mock AI.',
  });
}

// ============================================================================
// 7) TEST LIFECYCLE — reset in-memory state før hver test
// ============================================================================

beforeEach(() => {
  _resetStore();
  _seedStore({
    profiles: [{
      id: testUser.id,
      full_name: testUser.full_name,
      email: testUser.email,
      municipality: testUser.municipality,
      balance: testUser.balance,
      points: testUser.points,
      scans_count: testUser.scans_count,
      co2_saved_kg: testUser.co2_saved_kg,
      streak_days: testUser.streak_days,
      level: testUser.level,
      member_status: testUser.member_status,
      verification_tier: testUser.verification_tier,
      is_mitid_verified: testUser.is_mitid_verified,
      referral_code: testUser.referral_code,
      has_applied_referral: testUser.has_applied_referral,
      firebase_uid: testUser.firebase_uid,
      created_at: testUser.created_at,
      updated_at: testUser.updated_at,
    }],
    scans: [{ ...testScan }],
    redemptions: [{ ...testRedemption }],
    rewards: [{
      id: testRedemption.reward_id,
      name: testRedemption.reward_name,
      points_cost: testRedemption.points_spent,
      kroner_value: testRedemption.kroner_value,
      is_active: true,
    }],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
