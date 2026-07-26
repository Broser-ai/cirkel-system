// C:\Users\Ambro2\cirkel-system\api\nudge\schedule.ts
//
// Cirkel — Modul 11 (Nudging): schedule a nudge.
//
// Vercel serverless handler (Node runtime).
//
// POST body:
//   {
//     user_id:      string   — the recipient user (Supabase auth uid)
//     campaign_id:  string   — logical campaign this nudge belongs to
//     nudge_type:  'push' | 'email' | 'sms'
//     scheduled_at: string   — ISO-8601 UTC timestamp, must be in the future
//     message:      string   — 1..500 chars, plain text
//     deep_link?:   string   — optional https:// / cirkel:// URL
//   }
//
// Response 201:
//   { nudge_id: string, scheduled_at: string, status: 'queued' }
//
// F3.8 authorization (wired via SUPABASE_JWT bearer):
//   - caller must present a valid Supabase JWT (Authorization: Bearer <token>)
//   - caller may schedule for THEMSELVES (claims.sub === user_id) always
//   - caller may schedule for OTHERS only if:
//        (a) app_metadata.role === 'admin' | 'service_role', OR
//        (b) caller owns the campaign (campaigns.owner_user_id === claims.sub)
//
// Rate-limit:
//   max 100 nudges per rolling hour per campaign_id
//   (in-memory sliding window; per-instance — see _rate-limit.ts caveat)
//
// Persistence:
//   Preferred:  INSERT INTO `nudges` (implicit schema, see below).
//   Fallback:   in-memory queue (Fase 1 / migration not yet applied) so this
//               handler stays green until the SQL migration lands.
//
// Implicit `nudges` table (target schema — add via supabase migration):
//   CREATE TABLE nudges (
//     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id       text        NOT NULL,
//     campaign_id   text        NOT NULL,
//     nudge_type    text        NOT NULL CHECK (nudge_type IN ('push','email','sms')),
//     scheduled_at  timestamptz NOT NULL,
//     message       text        NOT NULL,
//     deep_link     text,
//     status        text        NOT NULL DEFAULT 'queued'
//                       CHECK (status IN ('queued','sent','failed','cancelled')),
//     created_by    text        NOT NULL,
//     created_at    timestamptz NOT NULL DEFAULT now()
//   );
//   CREATE INDEX ON nudges (campaign_id, created_at);
//   CREATE INDEX ON nudges (user_id, scheduled_at);

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import {
  createRateLimiter,
  type RateLimiter,
  type RateLimitRequest,
} from '../_rate-limit.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NudgeType = 'push' | 'email' | 'sms';
type NudgeStatus = 'queued' | 'sent' | 'failed' | 'cancelled';

interface ScheduleRequestBody {
  user_id: string;
  campaign_id: string;
  nudge_type: NudgeType;
  scheduled_at: string;
  message: string;
  deep_link?: string;
}

interface ScheduleResponseBody {
  nudge_id: string;
  scheduled_at: string;
  status: 'queued';
}

interface ErrorResponseBody {
  error: string;
  code?: string;
  detail?: string;
}

interface UserAppMetadata {
  role?: string;
}

interface AuthedCaller {
  sub: string;
  role: string | null;
}

interface CampaignRow {
  id: string;
  owner_user_id: string | null;
}

interface NudgeInsertRow {
  id: string;
  user_id: string;
  campaign_id: string;
  nudge_type: NudgeType;
  scheduled_at: string;
  message: string;
  deep_link: string | null;
  status: NudgeStatus;
  created_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_NUDGE_TYPES: readonly NudgeType[] = ['push', 'email', 'sms'] as const;
const MAX_MESSAGE_LEN = 500;
const MAX_DEEP_LINK_LEN = 2048;
const ONE_HOUR_MS = 60 * 60 * 1000;
const NUDGES_TABLE = 'nudges';
const CAMPAIGNS_TABLE = 'campaigns';

// Rate limiter: 100 nudges / hour / campaign_id.
// key_extractor reads `x-cirkel-campaign-id` — populated by the handler
// before every `.check(req)` call so we bucket by campaign, not IP.
const CAMPAIGN_RATE_LIMITER: RateLimiter = createRateLimiter({
  window_ms: ONE_HOUR_MS,
  max_requests: 100,
  key_extractor: (req: RateLimitRequest): string => {
    const raw = req.headers['x-cirkel-campaign-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value.length > 0
      ? `campaign:${value}`
      : 'campaign:unknown';
  },
});

// ---------------------------------------------------------------------------
// In-memory fallback queue (used only if `nudges` table is missing).
// Reset on every cold start; per-instance. Not durable — this is just a
// safety net so the endpoint remains 2xx while the migration is pending.
// ---------------------------------------------------------------------------

const MEMORY_QUEUE: NudgeInsertRow[] = [];
const MEMORY_QUEUE_MAX = 1000;

function pushToMemoryQueue(row: NudgeInsertRow): void {
  if (MEMORY_QUEUE.length >= MEMORY_QUEUE_MAX) {
    MEMORY_QUEUE.shift();
  }
  MEMORY_QUEUE.push(row);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json<T>(res: VercelResponse, status: number, body: T): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .send(JSON.stringify(body));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getBearerToken(req: VercelRequest): string | null {
  const raw =
    req.headers['authorization'] ??
    req.headers['Authorization' as unknown as string];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isAdminRole(role: string | null): boolean {
  return role === 'admin' || role === 'service_role';
}

function isNudgeType(value: unknown): value is NudgeType {
  return (
    typeof value === 'string' &&
    (VALID_NUDGE_TYPES as readonly string[]).includes(value)
  );
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseIsoFuture(value: unknown): { ok: true; date: Date; iso: string } | { ok: false; reason: string } {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'scheduled_at must be an ISO-8601 string' };
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, reason: 'scheduled_at is not a valid date' };
  }
  if (d.getTime() <= Date.now()) {
    return { ok: false, reason: 'scheduled_at must be in the future' };
  }
  return { ok: true, date: d, iso: d.toISOString() };
}

function isSafeDeepLink(value: string): boolean {
  if (value.length > MAX_DEEP_LINK_LEN) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'cirkel:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth: verify caller JWT via service-role Supabase client.
// ---------------------------------------------------------------------------

async function verifyCaller(
  supabase: SupabaseClient,
  token: string,
): Promise<{ ok: true; caller: AuthedCaller } | { ok: false; status: number; reason: string }> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, reason: 'Invalid or expired token' };
  }
  const appMeta = data.user.app_metadata as UserAppMetadata | undefined;
  const role = appMeta?.role ?? null;
  return {
    ok: true,
    caller: {
      sub: data.user.id,
      role: role === null || role === undefined ? null : String(role),
    },
  };
}

/**
 * Best-effort campaign-owner lookup. If the `campaigns` table doesn't exist
 * (or the query fails), we return `null` (unknown) — authorization then
 * falls back to admin-only for scheduling on behalf of other users.
 */
async function loadCampaignOwner(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<string | null | 'unknown'> {
  try {
    const { data, error } = await supabase
      .from(CAMPAIGNS_TABLE)
      .select('id, owner_user_id')
      .eq('id', campaignId)
      .maybeSingle<CampaignRow>();
    if (error) return 'unknown';
    if (!data) return null;
    return data.owner_user_id;
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // -------- Method guard --------
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json<ErrorResponseBody>(res, 405, {
      error: 'Method not allowed',
      code: 'method_not_allowed',
    });
  }

  // -------- Parse + validate body --------
  const raw = (req.body ?? {}) as Partial<ScheduleRequestBody>;

  if (!isNonEmptyString(raw.user_id, 128)) {
    return json<ErrorResponseBody>(res, 400, {
      error: 'user_id is required (non-empty string ≤128 chars)',
      code: 'invalid_user_id',
    });
  }
  if (!isNonEmptyString(raw.campaign_id, 128)) {
    return json<ErrorResponseBody>(res, 400, {
      error: 'campaign_id is required (non-empty string ≤128 chars)',
      code: 'invalid_campaign_id',
    });
  }
  if (!isNudgeType(raw.nudge_type)) {
    return json<ErrorResponseBody>(res, 400, {
      error: `nudge_type must be one of: ${VALID_NUDGE_TYPES.join(', ')}`,
      code: 'invalid_nudge_type',
    });
  }
  if (!isNonEmptyString(raw.message, MAX_MESSAGE_LEN)) {
    return json<ErrorResponseBody>(res, 400, {
      error: `message is required (1..${MAX_MESSAGE_LEN} chars)`,
      code: 'invalid_message',
    });
  }

  const parsedTime = parseIsoFuture(raw.scheduled_at);
  if (!parsedTime.ok) {
    return json<ErrorResponseBody>(res, 400, {
      error: parsedTime.reason,
      code: 'invalid_scheduled_at',
    });
  }

  let deepLink: string | null = null;
  if (raw.deep_link !== undefined && raw.deep_link !== null && raw.deep_link !== '') {
    if (typeof raw.deep_link !== 'string' || !isSafeDeepLink(raw.deep_link)) {
      return json<ErrorResponseBody>(res, 400, {
        error: 'deep_link must be an https:// or cirkel:// URL ≤2048 chars',
        code: 'invalid_deep_link',
      });
    }
    deepLink = raw.deep_link;
  }

  const body: ScheduleRequestBody = {
    user_id: raw.user_id,
    campaign_id: raw.campaign_id,
    nudge_type: raw.nudge_type,
    scheduled_at: parsedTime.iso,
    message: raw.message,
    deep_link: deepLink ?? undefined,
  };

  // -------- Env --------
  let supabaseUrl: string;
  let supabaseServiceKey: string;
  try {
    supabaseUrl = requireEnv('SUPABASE_URL');
    supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server misconfiguration';
    return json<ErrorResponseBody>(res, 500, {
      error: message,
      code: 'env_missing',
    });
  }

  // -------- Auth (F3.8) --------
  const token = getBearerToken(req);
  if (!token) {
    return json<ErrorResponseBody>(res, 401, {
      error: 'Missing bearer token',
      code: 'unauthenticated',
    });
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authResult = await verifyCaller(supabase, token);
  if (!authResult.ok) {
    return json<ErrorResponseBody>(res, authResult.status, {
      error: authResult.reason,
      code: 'invalid_token',
    });
  }
  const caller = authResult.caller;

  // -------- Authorization (F3.8) --------
  //   - self-scheduling: always ok
  //   - admin/service_role: always ok
  //   - otherwise: caller must own the campaign
  const isSelf = caller.sub === body.user_id;
  const isAdmin = isAdminRole(caller.role);

  if (!isSelf && !isAdmin) {
    const owner = await loadCampaignOwner(supabase, body.campaign_id);
    if (owner === 'unknown') {
      return json<ErrorResponseBody>(res, 403, {
        error: 'Cannot verify campaign ownership; only admin may schedule for other users',
        code: 'forbidden_campaign_lookup_failed',
      });
    }
    if (owner === null) {
      return json<ErrorResponseBody>(res, 404, {
        error: 'campaign_id not found',
        code: 'campaign_not_found',
      });
    }
    if (owner !== caller.sub) {
      return json<ErrorResponseBody>(res, 403, {
        error: 'Not authorized to schedule nudges for this user under this campaign',
        code: 'forbidden',
      });
    }
  }

  // -------- Rate-limit: 100 / hour / campaign_id --------
  // Inject campaign_id into headers so the shared limiter bucket keys on it.
  (req.headers as Record<string, string | string[] | undefined>)[
    'x-cirkel-campaign-id'
  ] = body.campaign_id;

  const rl = await CAMPAIGN_RATE_LIMITER.check(req as unknown as RateLimitRequest);
  const rlHeaders = CAMPAIGN_RATE_LIMITER.headers(rl);
  for (const [k, v] of Object.entries(rlHeaders)) {
    res.setHeader(k, v);
  }
  if (!rl.allow) {
    return json<ErrorResponseBody>(res, 429, {
      error: 'Rate limit exceeded for this campaign (100 nudges/hour)',
      code: 'rate_limit_exceeded',
    });
  }

  // -------- Persist --------
  const nowIso = new Date().toISOString();
  const row: NudgeInsertRow = {
    id: randomUUID(),
    user_id: body.user_id,
    campaign_id: body.campaign_id,
    nudge_type: body.nudge_type,
    scheduled_at: body.scheduled_at,
    message: body.message,
    deep_link: body.deep_link ?? null,
    status: 'queued',
    created_by: caller.sub,
    created_at: nowIso,
  };

  let persistedId: string = row.id;
  let usedMemoryFallback = false;

  try {
    const { data, error } = await supabase
      .from(NUDGES_TABLE)
      .insert(row)
      .select('id')
      .single<{ id: string }>();

    if (error) {
      // Table missing / migration not yet applied → memory fallback.
      // Postgres error codes: 42P01 = undefined_table, 42703 = undefined_column
      const code = (error as { code?: string }).code;
      if (code === '42P01' || code === '42703') {
        pushToMemoryQueue(row);
        usedMemoryFallback = true;
        console.warn(
          `[nudge/schedule] ${NUDGES_TABLE} table missing (${code}); using in-memory queue`,
        );
      } else {
        console.error('[nudge/schedule] supabase insert failed:', error);
        return json<ErrorResponseBody>(res, 500, {
          error: 'Failed to persist nudge',
          code: 'db_error',
          detail: error.message,
        });
      }
    } else if (data?.id) {
      persistedId = data.id;
    }
  } catch (err) {
    // Network / unexpected failure → memory fallback to keep endpoint 2xx.
    pushToMemoryQueue(row);
    usedMemoryFallback = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[nudge/schedule] supabase unreachable, using memory queue: ${msg}`);
  }

  if (usedMemoryFallback) {
    res.setHeader('X-Cirkel-Nudge-Storage', 'memory');
  } else {
    res.setHeader('X-Cirkel-Nudge-Storage', 'supabase');
  }

  const response: ScheduleResponseBody = {
    nudge_id: persistedId,
    scheduled_at: row.scheduled_at,
    status: 'queued',
  };
  return json<ScheduleResponseBody>(res, 201, response);
}
