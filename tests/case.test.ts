// cirkel-system/tests/case.test.ts
//
// Vitest-suite for /api/case (api/case.ts) — Modul 5.2 Case Management.
//
// Fokus:
//   1. Method-dispatch      — kun GET/POST/PATCH; ellers 405
//   2. Envelope-integritet  — { success:true, data:{...} } / { success:false, error, detail? }
//   3. F3.8 wire            — resolveTrustedUid kaldes ALTID før DB-skriv;
//                              spoof/UID-mismatch blokerer skriv
//   4. RLS-mimic (server-side håndhævelse):
//        - list filtreres på user_id (owner) eller assigned_to (assignee)
//        - PATCH kræver caller er owner ELLER assignee (403 forbidden)
//        - status/resolution/assigned_to må kun ændres af assignee
//        - resolved/rejected sager er låst (409 case_locked)
//   5. Validering           — case_type, status, priority, description-længde,
//                              UUID-format for case_id/scan_id/assigned_to
//   6. Foreign-key violation (23503) → 400 foreign_key_violation
//   7. Supabase-config gate — mangler URL/service key → 503
//   8. Determinisme         — ingen Date.now/uuid uden mock; alle svar er faste
//
// Alle eksterne motorer er mocket via vi.mock (Supabase-client + F3.8-verify).
// Ingen live network-calls.
//
// Bemærk: Denne fil re-mocker @supabase/supabase-js OVER setup.ts's globale
// stub, fordi vi har brug for .range() + { count:'exact' } support som stub'en
// ikke implementerer, samt kontrolleret rpc('get_dashboard')-adfærd.
//
// FIX 2026-07-24: Mock-state (casesStore, rpcHandler, force*Error, supabaseClientMock)
// er nu wrapped i vi.hoisted() så det eksisterer FØR den hoisted vi.mock-factory
// kører. Derudover har vi.mock('_verify-firebase-token.js') fået en default
// resolver, så resolveTrustedUid aldrig returnerer undefined ved paths der
// rammer den før 503-gate. Se analyse-fund (mock-not-wired / TDZ).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── UUID-fixtures (deterministiske; v4-formatterede) ────────────────────────
const OWNER_PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_PROFILE_ID = '99999999-9999-4999-8999-999999999999';
const ASSIGNEE_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_FIREBASE_UID = 'firebase-uid-test-user-1';
const CASE_ID_OPEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CASE_ID_RESOLVED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CASE_ID_UNKNOWN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SCAN_ID_VALID = '11111111-1111-4111-8111-111111111111';
const FROZEN_UPDATED_AT = '2026-07-22T12:00:00.000Z';
const FROZEN_CREATED_AT = '2026-07-20T09:00:00.000Z';

// ─── In-memory cases-store + fejl-hooks til Supabase-mock ────────────────────
interface CaseRow {
  case_id: string;
  user_id: string;
  scan_id: string | null;
  case_type: 'fraud_review' | 'dispute' | 'refund' | 'complaint';
  status: 'open' | 'in_review' | 'resolved' | 'rejected';
  assigned_to: string | null;
  priority: number;
  description: string;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

// ─── vi.hoisted: opret ALT mock-state FØR vi.mock factories kører ────────────
// TDZ-fix: vi.mock hoistes til toppen af filen, så en factory der refererer
// top-level `const` risikerer at ramme dem før de er initialiseret. vi.hoisted
// kører BEFORE both imports og vi.mock, så bindings er sikre.
const {
  casesStore,
  supabaseClientMock,
  getRpcHandler,
  setRpcHandler,
  resetRpcHandler,
  getForceListError,
  setForceListError,
  getForceInsertError,
  setForceInsertError,
  getForceFetchError,
  setForceFetchError,
  getForceUpdateError,
  setForceUpdateError,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store: any[] = [];
  const OWNER_PID = '00000000-0000-4000-8000-000000000001';
  const FROZEN_UPDATE = '2026-07-22T12:00:00.000Z';
  const CASE_ID_DEFAULT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const defaultRpc = async (fn: string, _args: any) => {
    if (fn === 'get_dashboard') {
      return { data: { profile: { id: OWNER_PID } }, error: null };
    }
    return { data: null, error: null };
  };

  const state: {
    rpcHandler: (fn: string, args: any) => Promise<{ data: any; error: any }>;
    forceListError: { message: string } | null;
    forceInsertError: { code?: string; message: string } | null;
    forceFetchError: { message: string } | null;
    forceUpdateError: { code?: string; message: string } | null;
  } = {
    rpcHandler: defaultRpc,
    forceListError: null,
    forceInsertError: null,
    forceFetchError: null,
    forceUpdateError: null,
  };

  function makeSupabaseMock() {
    const rpc = vi.fn(async (fn: string, args: any) => state.rpcHandler(fn, args));

    function fromBuilder(table: string) {
      const bstate = {
        table,
        op: 'select' as 'select' | 'insert' | 'update',
        wantCount: false,
        selectCols: '*',
        filters: [] as { col: string; val: any }[],
        orders: [] as { col: string; asc: boolean }[],
        range: null as null | { from: number; to: number },
        insertPayload: null as any,
        updatePayload: null as any,
      };

      function execute(): { data: any; error: any; count?: number | null } {
        if (bstate.table !== 'cases') {
          return { data: [], error: null, count: 0 };
        }
        if (bstate.op === 'insert') {
          if (state.forceInsertError)
            return { data: null, error: state.forceInsertError };
          const now = FROZEN_UPDATE;
          const row = {
            case_id: bstate.insertPayload.case_id ?? CASE_ID_DEFAULT,
            user_id: bstate.insertPayload.user_id,
            scan_id: bstate.insertPayload.scan_id ?? null,
            case_type: bstate.insertPayload.case_type,
            status: 'open',
            assigned_to: null,
            priority: bstate.insertPayload.priority ?? 3,
            description: bstate.insertPayload.description,
            resolution: null,
            created_at: now,
            updated_at: now,
          };
          store.push(row);
          return { data: [row], error: null };
        }
        if (bstate.op === 'update') {
          if (state.forceUpdateError)
            return { data: null, error: state.forceUpdateError };
          const patched: any[] = [];
          for (let i = 0; i < store.length; i++) {
            const r = store[i];
            if (bstate.filters.every((f) => (r as any)[f.col] === f.val)) {
              store[i] = {
                ...r,
                ...bstate.updatePayload,
                updated_at: FROZEN_UPDATE,
              };
              patched.push(store[i]);
            }
          }
          return { data: patched, error: null };
        }
        // select
        if (state.forceListError && bstate.wantCount) {
          return { data: null, error: state.forceListError, count: null };
        }
        if (state.forceFetchError && !bstate.wantCount) {
          return { data: null, error: state.forceFetchError };
        }
        let rows = store.filter((r) =>
          bstate.filters.every((f) => (r as any)[f.col] === f.val),
        );
        for (const ord of bstate.orders) {
          rows = [...rows].sort((a: any, b: any) => {
            if (a[ord.col] < b[ord.col]) return ord.asc ? -1 : 1;
            if (a[ord.col] > b[ord.col]) return ord.asc ? 1 : -1;
            return 0;
          });
        }
        const totalCount = rows.length;
        if (bstate.range)
          rows = rows.slice(bstate.range.from, bstate.range.to + 1);
        const result: { data: any; error: any; count?: number | null } = {
          data: rows,
          error: null,
        };
        if (bstate.wantCount) result.count = totalCount;
        return result;
      }

      const builder: any = {
        select(cols?: string, opts?: { count?: string }) {
          if (typeof cols === 'string') bstate.selectCols = cols;
          if (opts?.count === 'exact') bstate.wantCount = true;
          return builder;
        },
        insert(payload: any) {
          bstate.op = 'insert';
          bstate.insertPayload = payload;
          return builder;
        },
        update(payload: any) {
          bstate.op = 'update';
          bstate.updatePayload = payload;
          return builder;
        },
        eq(col: string, val: any) {
          bstate.filters.push({ col, val });
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          bstate.orders.push({ col, asc: opts?.ascending ?? true });
          return builder;
        },
        range(from: number, to: number) {
          bstate.range = { from, to };
          return builder;
        },
        async single() {
          const { data, error } = execute();
          if (error) return { data: null, error };
          const arr = Array.isArray(data) ? data : data ? [data] : [];
          if (arr.length === 0) {
            return {
              data: null,
              error: { code: 'PGRST116', message: 'No rows returned' },
            };
          }
          if (arr.length > 1) {
            return {
              data: null,
              error: { code: 'PGRST117', message: 'Multiple rows returned' },
            };
          }
          return { data: arr[0], error: null };
        },
        async maybeSingle() {
          const { data, error } = execute();
          if (error) return { data: null, error };
          const arr = Array.isArray(data) ? data : data ? [data] : [];
          return { data: arr[0] ?? null, error: null };
        },
        then(
          resolve: (r: {
            data: any;
            error: any;
            count?: number | null;
          }) => void,
        ) {
          resolve(execute());
        },
      };
      return builder;
    }

    return {
      from: (table: string) => fromBuilder(table),
      rpc,
    };
  }

  const mock = makeSupabaseMock();

  return {
    casesStore: store,
    supabaseClientMock: mock,
    getRpcHandler: () => state.rpcHandler,
    setRpcHandler: (
      fn: (fn: string, args: any) => Promise<{ data: any; error: any }>,
    ) => {
      state.rpcHandler = fn;
    },
    resetRpcHandler: () => {
      state.rpcHandler = defaultRpc;
    },
    getForceListError: () => state.forceListError,
    setForceListError: (v: { message: string } | null) => {
      state.forceListError = v;
    },
    getForceInsertError: () => state.forceInsertError,
    setForceInsertError: (v: { code?: string; message: string } | null) => {
      state.forceInsertError = v;
    },
    getForceFetchError: () => state.forceFetchError,
    setForceFetchError: (v: { message: string } | null) => {
      state.forceFetchError = v;
    },
    getForceUpdateError: () => state.forceUpdateError,
    setForceUpdateError: (v: { code?: string; message: string } | null) => {
      state.forceUpdateError = v;
    },
  };
});

function seedCase(overrides: Partial<CaseRow> = {}): CaseRow {
  const row: CaseRow = {
    case_id: CASE_ID_OPEN,
    user_id: OWNER_PROFILE_ID,
    scan_id: null,
    case_type: 'dispute',
    status: 'open',
    assigned_to: null,
    priority: 3,
    description: 'Test-sag beskrivelse.',
    resolution: null,
    created_at: FROZEN_CREATED_AT,
    updated_at: FROZEN_CREATED_AT,
    ...overrides,
  };
  casesStore.push(row);
  return row;
}

// ─── vi.mock: refererer nu til hoisted bindings (ingen TDZ) ──────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => supabaseClientMock),
}));

// ─── F3.8 verify-mock — default resolver returnerer OWNER_FIREBASE_UID ───────
// Uden en default resolver returnerer vi.fn() undefined, hvilket får case.ts til
// at throwe når den destrukturerer resultatet. beforeEach overrider stadig med
// mockResolvedValue.
vi.mock('../api/_verify-firebase-token.js', () => ({
  resolveTrustedUid: vi.fn(async () => ({
    trusted_uid: 'firebase-uid-test-user-1',
    verified: true,
    spoofed: false,
    reason: 'default-hoisted-mock',
  })),
}));

// ─── Imports (efter vi.mock; hoisting sikrer at case.ts også får mocks) ──────
import handler from '../api/case.js';
import { resolveTrustedUid } from '../api/_verify-firebase-token.js';

// ─── Test-app wrapper (supertest → express → Vercel-handler) ─────────────────
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/api/case', (req, res) => handler(req as any, res as any));
  return app;
}

// ─── Reset pr. test — case.ts cacher SupabaseClient i modul-scope, men
//     createClient returnerer altid vores supabaseClientMock, så det er OK. ──
beforeEach(() => {
  casesStore.length = 0;
  setForceListError(null);
  setForceInsertError(null);
  setForceFetchError(null);
  setForceUpdateError(null);

  // Default RPC: get_dashboard returnerer profile.id = OWNER_PROFILE_ID
  resetRpcHandler();

  // Default F3.8: verificeret + trusted uid = OWNER_FIREBASE_UID
  vi.mocked(resolveTrustedUid).mockResolvedValue({
    trusted_uid: OWNER_FIREBASE_UID,
    verified: true,
    spoofed: false,
    reason: 'F3.8: token verified + uid match',
  });

  // Env for Supabase-init
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// ═══════════════════════════════════════════════════════════════════════════
// A) Method-dispatch + Supabase-gate
// ═══════════════════════════════════════════════════════════════════════════
describe('/api/case — method-dispatch + Supabase-gate', () => {
  it('afviser DELETE med 405 method_not_allowed + Allow-header', async () => {
    const app = buildApp();
    const res = await request(app).delete('/api/case');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'method_not_allowed' });
    expect(res.headers.allow).toBe('GET, POST, PATCH');
    expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
  });

  it('afviser PUT med 405 method_not_allowed', async () => {
    const app = buildApp();
    const res = await request(app).put('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
    });
    expect(res.status).toBe(405);
    expect(res.body.error).toBe('method_not_allowed');
    expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
  });

  it('returnerer 503 supabase_not_configured når SUPABASE_URL og VITE_SUPABASE_URL mangler', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;

    vi.resetModules();
    // Reset casesStore for fresh module — se analyse-fund line 322.
    casesStore.length = 0;
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => supabaseClientMock),
    }));
    vi.doMock('../api/_verify-firebase-token.js', () => ({
      resolveTrustedUid: vi.fn(async () => ({
        trusted_uid: OWNER_FIREBASE_UID,
        verified: true,
        spoofed: false,
        reason: 'default-doMock',
      })),
    }));
    const mod = await import('../api/case.js');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.all('/api/case', (req, res) => mod.default(req as any, res as any));

    const res = await request(app).get('/api/case?firebaseUid=' + OWNER_FIREBASE_UID);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'supabase_not_configured' });
  });

  it('returnerer 503 supabase_not_configured når service-role-key mangler', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    vi.resetModules();
    casesStore.length = 0;
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => supabaseClientMock),
    }));
    vi.doMock('../api/_verify-firebase-token.js', () => ({
      resolveTrustedUid: vi.fn(async () => ({
        trusted_uid: OWNER_FIREBASE_UID,
        verified: true,
        spoofed: false,
        reason: 'default-doMock',
      })),
    }));
    const mod = await import('../api/case.js');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.all('/api/case', (req, res) => mod.default(req as any, res as any));

    const res = await request(app).get('/api/case?firebaseUid=' + OWNER_FIREBASE_UID);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('supabase_not_configured');
  });

  it('sætter Cache-Control: no-store på alle response-typer', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/case');
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B) GET /api/case — liste (RLS-mimic: filtreret på user_id / assigned_to)
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/case — liste + RLS-mimic', () => {
  it('returnerer 200 med kun ejerens sager når role=owner (default)', async () => {
    seedCase({ case_id: CASE_ID_OPEN, user_id: OWNER_PROFILE_ID, priority: 5 });
    seedCase({
      case_id: 'aaaaaaaa-1111-4111-8111-111111111111',
      user_id: OTHER_PROFILE_ID, // fremmed bruger — MÅ IKKE lækkes
      priority: 4,
    });

    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('owner');
    expect(res.body.data.cases).toHaveLength(1);
    expect(res.body.data.cases[0].case_id).toBe(CASE_ID_OPEN);
    expect(res.body.data.cases[0].user_id).toBe(OWNER_PROFILE_ID);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.limit).toBe(50);
    expect(res.body.data.offset).toBe(0);
    expect(res.body.data.auth).toEqual({
      firebase_verified: true,
      trusted_uid: OWNER_FIREBASE_UID,
    });
  });

  it('returnerer 200 med kun assignee-sager når role=assignee', async () => {
    seedCase({ case_id: CASE_ID_OPEN, user_id: OWNER_PROFILE_ID });
    seedCase({
      case_id: 'aaaaaaaa-2222-4222-8222-222222222222',
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID, // caller er sagsbehandler
      status: 'in_review',
    });

    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}&role=assignee`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('assignee');
    expect(res.body.data.cases).toHaveLength(1);
    expect(res.body.data.cases[0].assigned_to).toBe(OWNER_PROFILE_ID);
    expect(res.body.data.cases[0].status).toBe('in_review');
  });

  it('honorerer status-filter og case_type-filter', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OWNER_PROFILE_ID,
      case_type: 'dispute',
      status: 'open',
    });
    seedCase({
      case_id: 'aaaaaaaa-3333-4333-8333-333333333333',
      user_id: OWNER_PROFILE_ID,
      case_type: 'refund',
      status: 'in_review',
    });
    seedCase({
      case_id: 'aaaaaaaa-4444-4444-8444-444444444444',
      user_id: OWNER_PROFILE_ID,
      case_type: 'dispute',
      status: 'in_review',
    });

    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}&status=in_review&case_type=dispute`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.cases).toHaveLength(1);
    expect(res.body.data.cases[0].case_id).toBe(
      'aaaaaaaa-4444-4444-8444-444444444444',
    );
    expect(res.body.data.cases[0].status).toBe('in_review');
    expect(res.body.data.cases[0].case_type).toBe('dispute');
  });

  it('respekterer limit + offset og clamper limit til MAX_LIMIT=200', async () => {
    for (let i = 0; i < 5; i++) {
      seedCase({
        case_id: `aaaaaaaa-${String(i).padStart(4, '0')}-4000-8000-000000000000`,
        user_id: OWNER_PROFILE_ID,
        priority: 5 - i,
      });
    }
    const app = buildApp();

    // limit=2, offset=1 → skip 1, tag 2. Sortering: priority DESC.
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}&limit=2&offset=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.cases).toHaveLength(2);
    expect(res.body.data.limit).toBe(2);
    expect(res.body.data.offset).toBe(1);
    expect(res.body.data.total).toBe(5);

    // Test at limit>200 clampes ned
    const res2 = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}&limit=9999`,
    );
    expect(res2.body.data.limit).toBe(200);
  });

  it('afviser ugyldig status med 400 status_invalid', async () => {
    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}&status=bogus`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'status_invalid' });
  });

  it('afviser ugyldig case_type med 400 case_type_invalid', async () => {
    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}&case_type=phishing`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('case_type_invalid');
  });

  it('returnerer 400 firebaseUid_required når query-param mangler', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/case');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'firebaseUid_required' });
    expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
  });

  it('propagerer 401 firebase_verify_failed når F3.8 kaster spoof-fejl', async () => {
    vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
      const err: any = new Error(
        'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"',
      );
      err.status = 401;
      err.reason =
        'UID_SPOOF_DETECTED: token.uid="attacker" != body.firebaseUid="victim"';
      throw err;
    });

    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}`,
    );
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('firebase_verify_failed');
    expect(res.body.detail).toContain('UID_SPOOF_DETECTED');
  });

  it('returnerer 404 profile_not_found når get_dashboard ikke leverer profile.id', async () => {
    setRpcHandler(async () => ({ data: { profile: null }, error: null }));

    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'profile_not_found' });
  });

  it('returnerer 500 db_query_failed når Supabase select fejler', async () => {
    setForceListError({ message: 'connection refused' });
    const app = buildApp();
    const res = await request(app).get(
      `/api/case?firebaseUid=${OWNER_FIREBASE_UID}`,
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db_query_failed');
    expect(res.body.detail).toBe('connection refused');
  });

  it('bruger TRUSTED uid fra F3.8 (ikke body-uid) til profile-resolution', async () => {
    vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
      trusted_uid: 'trusted-uid-from-token',
      verified: true,
      spoofed: true,
      reason: 'warn_only pass-through (spoofed)',
    });
    let capturedArg: any = null;
    setRpcHandler(async (fn, args) => {
      if (fn === 'get_dashboard') capturedArg = args;
      return { data: { profile: { id: OWNER_PROFILE_ID } }, error: null };
    });

    const app = buildApp();
    const res = await request(app).get(
      '/api/case?firebaseUid=body-uid-spoofed',
    );
    expect(res.status).toBe(200);
    expect(capturedArg).toEqual({ p_firebase_uid: 'trusted-uid-from-token' });
    expect(res.body.data.auth.trusted_uid).toBe('trusted-uid-from-token');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C) POST /api/case — opret
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/case — opret', () => {
  it('returnerer 201 med ny sag når payload er gyldig (default priority=3)', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'dispute',
      description: 'Min flaske blev afvist forkert.',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.case.case_type).toBe('dispute');
    expect(res.body.data.case.description).toBe(
      'Min flaske blev afvist forkert.',
    );
    expect(res.body.data.case.priority).toBe(3); // default
    expect(res.body.data.case.status).toBe('open'); // default fra insert
    expect(res.body.data.case.scan_id).toBeNull();
    expect(res.body.data.case.user_id).toBe(OWNER_PROFILE_ID);
    expect(res.body.data.auth.firebase_verified).toBe(true);
    expect(casesStore).toHaveLength(1);
    expect(vi.mocked(resolveTrustedUid)).toHaveBeenCalledTimes(1);
  });

  it('trimmer description og accepterer custom priority + scan_id', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'fraud_review',
      description: '   Mistanke om organiseret svindel.   ',
      priority: 5,
      scan_id: SCAN_ID_VALID,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.case.description).toBe(
      'Mistanke om organiseret svindel.',
    );
    expect(res.body.data.case.priority).toBe(5);
    expect(res.body.data.case.scan_id).toBe(SCAN_ID_VALID);
    expect(res.body.data.case.case_type).toBe('fraud_review');
  });

  it('afviser 400 firebaseUid_required når firebaseUid mangler — F3.8 kaldes IKKE', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      case_type: 'dispute',
      description: 'foo bar',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('firebaseUid_required');
    expect(vi.mocked(resolveTrustedUid)).not.toHaveBeenCalled();
    expect(casesStore).toHaveLength(0);
  });

  it('afviser 400 case_type_invalid med detail-liste over gyldige typer', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'phishing',
      description: 'foo bar',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('case_type_invalid');
    expect(res.body.detail).toContain('fraud_review');
    expect(res.body.detail).toContain('dispute');
    expect(res.body.detail).toContain('refund');
    expect(res.body.detail).toContain('complaint');
  });

  it('afviser 400 description_required når description mangler', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'dispute',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('description_required');
  });

  it('afviser 400 description_too_short (<3 tegn efter trim)', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'dispute',
      description: '  ab  ',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('description_too_short');
  });

  it('afviser 400 description_too_long (>8000 tegn)', async () => {
    const app = buildApp();
    const longDesc = 'x'.repeat(8001);
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'dispute',
      description: longDesc,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('description_too_long');
  });

  it('afviser 400 scan_id_invalid når scan_id ikke er UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'fraud_review',
      description: 'Test-beskrivelse.',
      scan_id: 'not-a-uuid',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('scan_id_invalid');
  });

  it('afviser 400 priority_invalid for out-of-range priority (0, 6, "abc")', async () => {
    const app = buildApp();
    for (const badPriority of [0, 6, 'abc', 3.5]) {
      const res = await request(app).post('/api/case').send({
        firebaseUid: OWNER_FIREBASE_UID,
        case_type: 'dispute',
        description: 'Test-beskrivelse.',
        priority: badPriority,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('priority_invalid');
    }
  });

  it('propagerer 400 foreign_key_violation når scan_id peger på ikke-eksisterende scan', async () => {
    setForceInsertError({
      code: '23503',
      message:
        'insert or update on table "cases" violates foreign key constraint "cases_scan_id_fkey"',
    });
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'dispute',
      description: 'Test-beskrivelse.',
      scan_id: SCAN_ID_VALID,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('foreign_key_violation');
    expect(res.body.detail).toContain('cases_scan_id_fkey');
  });

  it('propagerer 500 db_insert_failed ved generisk DB-fejl', async () => {
    setForceInsertError({ code: 'XX000', message: 'internal error' });
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'refund',
      description: 'Test-beskrivelse.',
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db_insert_failed');
    expect(res.body.detail).toBe('internal error');
  });

  it('blokerer insert med 401 når F3.8 kaster spoof-fejl (INGEN DB-skriv)', async () => {
    vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
      const err: any = new Error('UID_SPOOF_DETECTED');
      err.status = 401;
      err.reason = 'UID_SPOOF_DETECTED';
      throw err;
    });

    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: 'victim-uid',
      case_type: 'dispute',
      description: 'Angreb-forsøg.',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('firebase_verify_failed');
    expect(casesStore).toHaveLength(0); // ingen DB-skriv ved spoof
  });

  it('returnerer 404 profile_not_found når Firebase-uid ikke har profile-mapping', async () => {
    setRpcHandler(async () => ({ data: { profile: {} }, error: null })); // ingen id
    const app = buildApp();
    const res = await request(app).post('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_type: 'dispute',
      description: 'Test-beskrivelse.',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('profile_not_found');
    expect(casesStore).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D) PATCH /api/case — opdater (RLS-mimic: kun owner|assignee, låst når resolved)
// ═══════════════════════════════════════════════════════════════════════════
describe('PATCH /api/case — opdater + RLS-mimic', () => {
  it('returnerer 200 når assignee ændrer status til resolved + resolution', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OTHER_PROFILE_ID, // ejer er en anden bruger
      assigned_to: OWNER_PROFILE_ID, // caller er sagsbehandler
      status: 'in_review',
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      status: 'resolved',
      resolution: 'Refunderet 25 kr til brugerens saldo.',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.case.status).toBe('resolved');
    expect(res.body.data.case.resolution).toBe(
      'Refunderet 25 kr til brugerens saldo.',
    );
    expect(res.body.data.case.updated_at).toBe(FROZEN_UPDATED_AT);
  });

  it('RLS: returnerer 403 forbidden når caller HVERKEN er owner eller assignee', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OTHER_PROFILE_ID, // ejer = anden
      assigned_to: ASSIGNEE_PROFILE_ID, // sagsbehandler = tredje
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID, // caller er hverken
      case_id: CASE_ID_OPEN,
      priority: 4,
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'forbidden' });

    // Ingen DB-mutation
    expect(casesStore[0].priority).toBe(3);
    expect(casesStore[0].updated_at).toBe(FROZEN_CREATED_AT);
  });

  it('RLS: owner må ændre PRIORITY men IKKE status (only_assignee_can_close)', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OWNER_PROFILE_ID, // caller er ejer
      assigned_to: ASSIGNEE_PROFILE_ID,
      status: 'open',
      priority: 3,
    });

    const app = buildApp();

    // Owner forsøger at ændre status → 403 only_assignee_can_close
    const res1 = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      status: 'resolved',
    });
    expect(res1.status).toBe(403);
    expect(res1.body.error).toBe('only_assignee_can_close');
    expect(casesStore[0].status).toBe('open'); // uændret

    // Owner må dog eskalere priority (fx egen dispute)
    const res2 = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      priority: 5,
    });
    expect(res2.status).toBe(200);
    expect(res2.body.data.case.priority).toBe(5);
  });

  it('RLS: owner må IKKE ændre resolution eller assigned_to (only_assignee_can_close)', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OWNER_PROFILE_ID,
      assigned_to: ASSIGNEE_PROFILE_ID,
    });

    const app = buildApp();
    const resResolution = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      resolution: 'Ejeren prøver at skrive konklusion',
    });
    expect(resResolution.status).toBe(403);
    expect(resResolution.body.error).toBe('only_assignee_can_close');

    const resAssign = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      assigned_to: OWNER_PROFILE_ID, // ejer prøver at "stjæle" sagen
    });
    expect(resAssign.status).toBe(403);
    expect(resAssign.body.error).toBe('only_assignee_can_close');
  });

  it('returnerer 409 case_locked når sagen er resolved og patch forsøges', async () => {
    seedCase({
      case_id: CASE_ID_RESOLVED,
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID, // caller er assignee
      status: 'resolved', // LÅST
      resolution: 'Tidligere afsluttet.',
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_RESOLVED,
      status: 'in_review', // forsøg på at genåbne
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('case_locked');
    expect(res.body.detail).toBe('status=resolved');
  });

  it('returnerer 409 case_locked når sagen er rejected', async () => {
    seedCase({
      case_id: CASE_ID_RESOLVED,
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID,
      status: 'rejected',
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_RESOLVED,
      resolution: 'Prøver at åbne igen',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('case_locked');
    expect(res.body.detail).toBe('status=rejected');
  });

  it('returnerer 404 case_not_found for ukendt case_id', async () => {
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_UNKNOWN,
      priority: 2,
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'case_not_found' });
  });

  it('afviser 400 case_id_invalid når case_id ikke er UUID', async () => {
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: 'ikke-en-uuid',
      priority: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('case_id_invalid');
  });

  it('afviser 400 no_patch_fields når intet ændringsfelt sendes', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OWNER_PROFILE_ID,
    });
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_patch_fields');
  });

  it('afviser 400 status_invalid for ugyldig status', async () => {
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      status: 'closed', // ikke i enum
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('status_invalid');
  });

  it('afviser 400 assigned_to_invalid når assigned_to ikke er UUID (og ikke null)', async () => {
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      assigned_to: 'ikke-en-uuid',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('assigned_to_invalid');
  });

  it('afviser 400 resolution_invalid når resolution er et tal', async () => {
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      resolution: 12345, // ikke string og ikke null
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resolution_invalid');
  });

  it('afviser 400 resolution_too_long (>8000 tegn)', async () => {
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      resolution: 'x'.repeat(8001),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resolution_too_long');
  });

  it('normaliserer whitespace-only resolution til null (assignee)', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID,
      resolution: 'gammel tekst',
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      resolution: '   ',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.case.resolution).toBeNull();
  });

  it('tillader assignee at nulstille assigned_to=null (frigive sagen)', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID,
      status: 'in_review',
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      assigned_to: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.case.assigned_to).toBeNull();
  });

  it('blokerer PATCH med 401 når F3.8 kaster (INGEN DB-mutation)', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OWNER_PROFILE_ID,
      priority: 3,
    });
    vi.mocked(resolveTrustedUid).mockImplementationOnce(async () => {
      const err: any = new Error('UID_SPOOF_DETECTED');
      err.status = 401;
      err.reason = 'UID_SPOOF_DETECTED';
      throw err;
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: 'attacker-uid',
      case_id: CASE_ID_OPEN,
      priority: 5,
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('firebase_verify_failed');
    expect(casesStore[0].priority).toBe(3); // uændret
  });

  it('returnerer 500 db_fetch_failed når SELECT (existing) fejler', async () => {
    seedCase({ case_id: CASE_ID_OPEN, user_id: OWNER_PROFILE_ID });
    setForceFetchError({ message: 'timeout reading cases' });
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      priority: 4,
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db_fetch_failed');
    expect(res.body.detail).toBe('timeout reading cases');
  });

  it('propagerer 400 foreign_key_violation fra UPDATE-fejl (fx ugyldig assigned_to)', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID,
    });
    setForceUpdateError({
      code: '23503',
      message: 'update on "cases" violates fk "cases_assigned_to_fkey"',
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      assigned_to: '55555555-5555-4555-8555-555555555555',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('foreign_key_violation');
    expect(res.body.detail).toContain('cases_assigned_to_fkey');
  });

  it('returnerer 500 db_update_failed for generiske UPDATE-fejl', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OTHER_PROFILE_ID,
      assigned_to: OWNER_PROFILE_ID,
    });
    setForceUpdateError({ code: 'XX000', message: 'disk full' });
    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: OWNER_FIREBASE_UID,
      case_id: CASE_ID_OPEN,
      status: 'in_review',
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db_update_failed');
    expect(res.body.detail).toBe('disk full');
  });

  it('bruger TRUSTED uid fra F3.8 til profile-resolution i PATCH-sti', async () => {
    seedCase({
      case_id: CASE_ID_OPEN,
      user_id: OWNER_PROFILE_ID,
      priority: 3,
    });
    vi.mocked(resolveTrustedUid).mockResolvedValueOnce({
      trusted_uid: 'trusted-uid-from-token',
      verified: true,
      spoofed: true,
      reason: 'warn_only pass-through (spoofed)',
    });
    let capturedArg: any = null;
    setRpcHandler(async (fn, args) => {
      if (fn === 'get_dashboard') capturedArg = args;
      return { data: { profile: { id: OWNER_PROFILE_ID } }, error: null };
    });

    const app = buildApp();
    const res = await request(app).patch('/api/case').send({
      firebaseUid: 'body-uid-spoofed',
      case_id: CASE_ID_OPEN,
      priority: 4,
    });
    expect(res.status).toBe(200);
    expect(capturedArg).toEqual({ p_firebase_uid: 'trusted-uid-from-token' });
    expect(res.body.data.auth.trusted_uid).toBe('trusted-uid-from-token');
    expect(res.body.data.case.priority).toBe(4);
  });
});
