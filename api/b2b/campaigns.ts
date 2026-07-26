// cirkel-system/api/b2b/campaigns.ts
//
// GET  /api/b2b/campaigns  — List kampagner for én producent.
// POST /api/b2b/campaigns  — Opret ny kampagne for én producent.
//
// Kobler til migration 013 (public.b2b_producers) — hver kampagne skal
// referere en aktiv producent identificeret ved producer_id.
// Downstream: Modul 11 (nudge/schedule) læser campaign_id fra denne
// tabel; response fra POST er dermed input til nudge-planlægning.
//
// ─────────────────────────────────────────────────────────────────────────
// GET-kontrakt
// ─────────────────────────────────────────────────────────────────────────
// Query params:
//   firebaseUid   (required)  Klient-oplyst Firebase-UID. F3.8 verify
//                              matcher denne mod Authorization: Bearer <token>.
//   producer_id   (required)  UUID for producenten (b2b_producers.producer_id).
//   status        (optional)  Filter: 'draft' | 'live' | 'paused' | 'ended'.
//                              Udelades = alle statusser.
//   limit         (optional)  1-200, default 50.
//   offset        (optional)  ≥ 0, default 0.
//
// Response 200:
//   {
//     success: true,
//     data: {
//       producer_id: string,
//       total: number,           // rækker returneret (op til limit)
//       limit: number,
//       offset: number,
//       campaigns: Campaign[]
//     }
//   }
//
// ─────────────────────────────────────────────────────────────────────────
// POST-kontrakt
// ─────────────────────────────────────────────────────────────────────────
// Body (application/json):
//   {
//     firebaseUid:        string   // required, F3.8 verify
//     producer_id:        string   // required, UUID
//     title:              string   // required, 1-255 tegn
//     description?:       string   // optional, ≤ 4000 tegn
//     campaign_type?:     string   // 'scan_challenge' (default) | 'sort_challenge' | 'trade_in' | 'give_back'
//     target_scans?:      number   // ≥ 1 hvis sat
//     reward_type?:       string   // 'kr' | 'cp' | 'discount' | 'product'
//     reward_value?:      number   // ≥ 0 hvis sat
//     reward_description?: string  // ≤ 500 tegn
//     starts_at?:         string   // ISO-8601 timestamp
//     ends_at?:           string   // ISO-8601 timestamp, > starts_at
//     status?:            string   // 'draft' (default) | 'live' | 'paused'
//                                  //   ('ended' må kun sættes via lifecycle-endpoint)
//   }
//
// Response 201:
//   { success: true, data: { campaign: Campaign } }
//
// ─────────────────────────────────────────────────────────────────────────
// Sikkerhed
// ─────────────────────────────────────────────────────────────────────────
//   • F3.8 — Firebase-token verificeres via resolveTrustedUid() FØR nogen
//     data-fetch. Klient-oplyst firebaseUid skal matche token.uid.
//     Enforce-mode: hard 401 ved spoof/mismatch.
//     Warn_only-mode: log advarsel og fortsæt med token-UID (bag-kompat).
//   • Supplerende authorization via verifyFirebaseToken() → decoded_token.email:
//     Kalderen skal enten (a) matche producentens contact_email (email_verified
//     påkrævet), ELLER (b) have Firebase custom claim admin === true / role === 'admin'.
//     Ellers 403 FORBIDDEN.
//   • Producent verificeres eksisterende + is_active FØR skrive/læse.
//   • Supabase service-role klient (lazy init, samme pattern som api/scan.ts
//     og api/b2b/analytics.ts).
//   • Alle secrets via process.env — INGEN hardkodede secrets.
//   • Body/query valideres strengt (UUID-regex, ISO-8601-parse, enum-guards).
//
// ─────────────────────────────────────────────────────────────────────────
// Target-tabel (opret via kommende migration)
// ─────────────────────────────────────────────────────────────────────────
//   CREATE TABLE public.b2b_campaigns (
//     campaign_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//     producer_id         UUID NOT NULL REFERENCES public.b2b_producers(producer_id)
//                         ON DELETE CASCADE,
//     title               VARCHAR(255) NOT NULL,
//     description         TEXT,
//     campaign_type       VARCHAR(32) NOT NULL DEFAULT 'scan_challenge'
//       CHECK (campaign_type IN ('scan_challenge','sort_challenge','trade_in','give_back')),
//     target_scans        INTEGER CHECK (target_scans IS NULL OR target_scans > 0),
//     current_scans       INTEGER NOT NULL DEFAULT 0 CHECK (current_scans >= 0),
//     reward_type         VARCHAR(16) CHECK (reward_type IS NULL
//                         OR reward_type IN ('kr','cp','discount','product')),
//     reward_value        NUMERIC(8, 2) CHECK (reward_value IS NULL OR reward_value >= 0),
//     reward_description  TEXT,
//     starts_at           TIMESTAMPTZ,
//     ends_at             TIMESTAMPTZ,
//     status              VARCHAR(16) NOT NULL DEFAULT 'draft'
//       CHECK (status IN ('draft','live','paused','ended')),
//     created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     CONSTRAINT b2b_campaigns_dates_chk
//       CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
//   );

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  resolveTrustedUid,
  verifyFirebaseToken,
} from '../_verify-firebase-token.js';

// ---------- Konstanter ---------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CAMPAIGN_TYPES = [
  'scan_challenge',
  'sort_challenge',
  'trade_in',
  'give_back',
] as const;
type CampaignType = (typeof VALID_CAMPAIGN_TYPES)[number];

const VALID_REWARD_TYPES = ['kr', 'cp', 'discount', 'product'] as const;
type RewardType = (typeof VALID_REWARD_TYPES)[number];

// 'ended' kan IKKE sættes ved oprettelse — reserveret til lifecycle-endpoint
// der samtidig kan skrive audit-trail til sovereign_ledger.
const VALID_STATUSES = ['draft', 'live', 'paused', 'ended'] as const;
type CampaignStatus = (typeof VALID_STATUSES)[number];
const CREATABLE_STATUSES: readonly CampaignStatus[] = ['draft', 'live', 'paused'];

const CAMPAIGNS_TABLE = 'b2b_campaigns';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MAX_TITLE_LEN = 255;
const MAX_DESCRIPTION_LEN = 4000;
const MAX_REWARD_DESCRIPTION_LEN = 500;

// ---------- Typer --------------------------------------------------------

interface Campaign {
  readonly campaign_id: string;
  readonly producer_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly campaign_type: CampaignType;
  readonly target_scans: number | null;
  readonly current_scans: number;
  readonly reward_type: RewardType | null;
  readonly reward_value: number | null;
  readonly reward_description: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly status: CampaignStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CampaignRowRaw {
  readonly campaign_id: string;
  readonly producer_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly campaign_type: string;
  readonly target_scans: number | null;
  readonly current_scans: number | string | null;
  readonly reward_type: string | null;
  readonly reward_value: number | string | null;
  readonly reward_description: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ProducerRow {
  readonly producer_id: string;
  readonly contact_email: string;
  readonly is_active: boolean;
}

interface DecodedTokenLite {
  readonly uid?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly admin?: boolean;
  readonly role?: string;
}

interface ListParams {
  readonly firebaseUid: string;
  readonly producer_id: string;
  readonly status: CampaignStatus | null;
  readonly limit: number;
  readonly offset: number;
}

interface CreateParams {
  readonly firebaseUid: string;
  readonly producer_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly campaign_type: CampaignType;
  readonly target_scans: number | null;
  readonly reward_type: RewardType | null;
  readonly reward_value: number | null;
  readonly reward_description: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly status: CampaignStatus;
}

interface ListSuccessResponse {
  readonly success: true;
  readonly data: {
    readonly producer_id: string;
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
    readonly campaigns: readonly Campaign[];
  };
}

interface CreateSuccessResponse {
  readonly success: true;
  readonly data: { readonly campaign: Campaign };
}

interface ErrorResponse {
  readonly success: false;
  readonly error: string;
}

type ApiResponse = ListSuccessResponse | CreateSuccessResponse | ErrorResponse;

// ---------- Supabase lazy-init (samme mønster som api/scan.ts) -----------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ---------- Utilities ----------------------------------------------------

function normalizeQueryValue(
  raw: string | string[] | undefined,
): string | null {
  if (raw === undefined || raw === null) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return null;
  const trimmed = first.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toIntegerOrNull(v: unknown, opts: { min?: number; max?: number }): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

function toFiniteNumberOrNull(v: unknown, opts: { min?: number }): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  return n;
}

function parseIsoTimestampOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function isCampaignType(v: string): v is CampaignType {
  return (VALID_CAMPAIGN_TYPES as readonly string[]).includes(v);
}

function isRewardType(v: string): v is RewardType {
  return (VALID_REWARD_TYPES as readonly string[]).includes(v);
}

function isCampaignStatus(v: string): v is CampaignStatus {
  return (VALID_STATUSES as readonly string[]).includes(v);
}

function trimOrNull(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s.length === 0) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function toNumberOrNull(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function toIntFieldOrZero(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function narrowCampaign(row: CampaignRowRaw): Campaign {
  const rawType = String(row.campaign_type);
  const rawStatus = String(row.status);
  const rawReward = row.reward_type == null ? null : String(row.reward_type);
  return {
    campaign_id: row.campaign_id,
    producer_id: row.producer_id,
    title: row.title,
    description: row.description ?? null,
    campaign_type: isCampaignType(rawType) ? rawType : 'scan_challenge',
    target_scans: row.target_scans ?? null,
    current_scans: toIntFieldOrZero(row.current_scans),
    reward_type: rawReward && isRewardType(rawReward) ? rawReward : null,
    reward_value: toNumberOrNull(row.reward_value),
    reward_description: row.reward_description ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    status: isCampaignStatus(rawStatus) ? rawStatus : 'draft',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------- Query/body validering ---------------------------------------

function parseListQuery(
  query: VercelRequest['query'],
):
  | { ok: true; value: ListParams }
  | { ok: false; reason: string } {
  const firebaseUid = normalizeQueryValue(query?.firebaseUid);
  if (!firebaseUid) {
    return { ok: false, reason: "Query-param 'firebaseUid' er påkrævet." };
  }

  const producer_id = normalizeQueryValue(query?.producer_id);
  if (!producer_id) {
    return { ok: false, reason: "Query-param 'producer_id' er påkrævet." };
  }
  if (!UUID_RE.test(producer_id)) {
    return { ok: false, reason: "Query-param 'producer_id' skal være et gyldigt UUID." };
  }

  const statusRaw = normalizeQueryValue(query?.status);
  let status: CampaignStatus | null = null;
  if (statusRaw !== null) {
    if (!isCampaignStatus(statusRaw)) {
      return {
        ok: false,
        reason: `Query-param 'status' skal være én af: ${VALID_STATUSES.join(', ')}.`,
      };
    }
    status = statusRaw;
  }

  const limitRaw = normalizeQueryValue(query?.limit);
  const limit =
    limitRaw === null
      ? DEFAULT_LIMIT
      : toIntegerOrNull(limitRaw, { min: 1, max: MAX_LIMIT }) ?? -1;
  if (limit < 1) {
    return { ok: false, reason: `Query-param 'limit' skal være et heltal 1-${MAX_LIMIT}.` };
  }

  const offsetRaw = normalizeQueryValue(query?.offset);
  const offset =
    offsetRaw === null ? 0 : toIntegerOrNull(offsetRaw, { min: 0 }) ?? -1;
  if (offset < 0) {
    return { ok: false, reason: "Query-param 'offset' skal være et heltal ≥ 0." };
  }

  return {
    ok: true,
    value: { firebaseUid, producer_id, status, limit, offset },
  };
}

function parseCreateBody(
  body: unknown,
):
  | { ok: true; value: CreateParams }
  | { ok: false; reason: string } {
  if (body === null || typeof body !== 'object') {
    return { ok: false, reason: 'Body skal være JSON-objekt.' };
  }
  const b = body as Record<string, unknown>;

  const firebaseUid = typeof b.firebaseUid === 'string' ? b.firebaseUid.trim() : '';
  if (!firebaseUid) {
    return { ok: false, reason: "Body-felt 'firebaseUid' er påkrævet." };
  }

  const producer_id = typeof b.producer_id === 'string' ? b.producer_id.trim() : '';
  if (!producer_id) {
    return { ok: false, reason: "Body-felt 'producer_id' er påkrævet." };
  }
  if (!UUID_RE.test(producer_id)) {
    return { ok: false, reason: "Body-felt 'producer_id' skal være et gyldigt UUID." };
  }

  const titleRaw = typeof b.title === 'string' ? b.title.trim() : '';
  if (titleRaw.length === 0) {
    return { ok: false, reason: "Body-felt 'title' er påkrævet." };
  }
  if (titleRaw.length > MAX_TITLE_LEN) {
    return { ok: false, reason: `Body-felt 'title' må højst være ${MAX_TITLE_LEN} tegn.` };
  }

  const description = trimOrNull(b.description, MAX_DESCRIPTION_LEN);

  let campaign_type: CampaignType = 'scan_challenge';
  if (b.campaign_type !== undefined && b.campaign_type !== null && b.campaign_type !== '') {
    const raw = String(b.campaign_type).trim();
    if (!isCampaignType(raw)) {
      return {
        ok: false,
        reason: `Body-felt 'campaign_type' skal være én af: ${VALID_CAMPAIGN_TYPES.join(', ')}.`,
      };
    }
    campaign_type = raw;
  }

  let target_scans: number | null = null;
  if (b.target_scans !== undefined && b.target_scans !== null && b.target_scans !== '') {
    const n = toIntegerOrNull(b.target_scans, { min: 1 });
    if (n === null) {
      return { ok: false, reason: "Body-felt 'target_scans' skal være et positivt heltal." };
    }
    target_scans = n;
  }

  let reward_type: RewardType | null = null;
  if (b.reward_type !== undefined && b.reward_type !== null && b.reward_type !== '') {
    const raw = String(b.reward_type).trim();
    if (!isRewardType(raw)) {
      return {
        ok: false,
        reason: `Body-felt 'reward_type' skal være én af: ${VALID_REWARD_TYPES.join(', ')}.`,
      };
    }
    reward_type = raw;
  }

  let reward_value: number | null = null;
  if (b.reward_value !== undefined && b.reward_value !== null && b.reward_value !== '') {
    const n = toFiniteNumberOrNull(b.reward_value, { min: 0 });
    if (n === null) {
      return { ok: false, reason: "Body-felt 'reward_value' skal være et ikke-negativt tal." };
    }
    reward_value = n;
  }

  const reward_description = trimOrNull(b.reward_description, MAX_REWARD_DESCRIPTION_LEN);

  const starts_at = parseIsoTimestampOrNull(b.starts_at);
  if (b.starts_at !== undefined && b.starts_at !== null && b.starts_at !== '' && starts_at === null) {
    return { ok: false, reason: "Body-felt 'starts_at' skal være en gyldig ISO-8601 timestamp." };
  }

  const ends_at = parseIsoTimestampOrNull(b.ends_at);
  if (b.ends_at !== undefined && b.ends_at !== null && b.ends_at !== '' && ends_at === null) {
    return { ok: false, reason: "Body-felt 'ends_at' skal være en gyldig ISO-8601 timestamp." };
  }

  if (starts_at !== null && ends_at !== null) {
    if (new Date(ends_at).getTime() <= new Date(starts_at).getTime()) {
      return { ok: false, reason: "Body-felt 'ends_at' skal ligge efter 'starts_at'." };
    }
  }

  let status: CampaignStatus = 'draft';
  if (b.status !== undefined && b.status !== null && b.status !== '') {
    const raw = String(b.status).trim();
    if (!isCampaignStatus(raw) || !CREATABLE_STATUSES.includes(raw)) {
      return {
        ok: false,
        reason: `Body-felt 'status' ved oprettelse skal være én af: ${CREATABLE_STATUSES.join(', ')}.`,
      };
    }
    status = raw;
  }

  // Live-kampagner skal have et start-tidspunkt for at kunne aktiveres deterministisk.
  if (status === 'live' && starts_at === null) {
    return {
      ok: false,
      reason: "Body-felt 'starts_at' er påkrævet når status='live'.",
    };
  }

  return {
    ok: true,
    value: {
      firebaseUid,
      producer_id,
      title: titleRaw,
      description,
      campaign_type,
      target_scans,
      reward_type,
      reward_value,
      reward_description,
      starts_at,
      ends_at,
      status,
    },
  };
}

// ---------- Authorization -----------------------------------------------

function isAuthorizedForProducer(
  decoded: DecodedTokenLite | null | undefined,
  producer: ProducerRow,
): boolean {
  if (!decoded) return false;
  if (decoded.admin === true) return true;
  if (typeof decoded.role === 'string' && decoded.role.toLowerCase() === 'admin') return true;

  const tokenEmail = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const producerEmail = producer.contact_email.trim().toLowerCase();
  if (!tokenEmail || !producerEmail) return false;
  if (tokenEmail !== producerEmail) return false;
  if (decoded.email_verified !== true) return false;

  return true;
}

// ---------- Data-fetch --------------------------------------------------

async function fetchProducer(
  sb: SupabaseClient,
  producer_id: string,
): Promise<ProducerRow | null> {
  const { data, error } = await sb
    .from('b2b_producers')
    .select('producer_id,contact_email,is_active')
    .eq('producer_id', producer_id)
    .maybeSingle();

  if (error) {
    const err = new Error(`b2b_producers-lookup fejlede: ${error.message}`);
    (err as Error & { supabase?: unknown }).supabase = error;
    throw err;
  }
  if (!data) return null;

  const row = data as { producer_id: string; contact_email: string; is_active: boolean };
  return {
    producer_id: row.producer_id,
    contact_email: row.contact_email,
    is_active: row.is_active,
  };
}

async function fetchCampaigns(
  sb: SupabaseClient,
  params: ListParams,
): Promise<readonly Campaign[]> {
  let query = sb
    .from(CAMPAIGNS_TABLE)
    .select(
      'campaign_id,producer_id,title,description,campaign_type,target_scans,current_scans,reward_type,reward_value,reward_description,starts_at,ends_at,status,created_at,updated_at',
    )
    .eq('producer_id', params.producer_id)
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (params.status !== null) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) {
    const err = new Error(`${CAMPAIGNS_TABLE}-list fejlede: ${error.message}`);
    (err as Error & { supabase?: unknown; code?: string }).supabase = error;
    (err as Error & { supabase?: unknown; code?: string }).code = error.code;
    throw err;
  }

  const rows = (Array.isArray(data) ? data : []) as CampaignRowRaw[];
  return rows.map(narrowCampaign);
}

async function insertCampaign(
  sb: SupabaseClient,
  params: CreateParams,
): Promise<Campaign> {
  const insertRow: Record<string, unknown> = {
    producer_id: params.producer_id,
    title: params.title,
    description: params.description,
    campaign_type: params.campaign_type,
    target_scans: params.target_scans,
    current_scans: 0,
    reward_type: params.reward_type,
    reward_value: params.reward_value,
    reward_description: params.reward_description,
    starts_at: params.starts_at,
    ends_at: params.ends_at,
    status: params.status,
  };

  const { data, error } = await sb
    .from(CAMPAIGNS_TABLE)
    .insert(insertRow)
    .select(
      'campaign_id,producer_id,title,description,campaign_type,target_scans,current_scans,reward_type,reward_value,reward_description,starts_at,ends_at,status,created_at,updated_at',
    )
    .single();

  if (error) {
    const err = new Error(`${CAMPAIGNS_TABLE}-insert fejlede: ${error.message}`);
    (err as Error & { supabase?: unknown; code?: string }).supabase = error;
    (err as Error & { supabase?: unknown; code?: string }).code = error.code;
    throw err;
  }
  if (!data) {
    throw new Error(`${CAMPAIGNS_TABLE}-insert returnerede ingen række.`);
  }

  return narrowCampaign(data as CampaignRowRaw);
}

// ---------- F3.8 verify wrapper -----------------------------------------

interface AuthResult {
  readonly trustedUid: string;
  readonly decoded: DecodedTokenLite | null;
}

/**
 * F3.8 — 2-fase verifikation:
 *   1. resolveTrustedUid(): håndhæver at klient-oplyst firebaseUid matcher
 *      token.uid. Enforce-mode: hard 401. Warn_only-mode: pass-through.
 *   2. verifyFirebaseToken({}): henter decoded_token så vi kan bruge
 *      email + custom claims til producer-authorization.
 *
 * Kaster (med .status) hvis F3.8 blokerer requestet.
 */
async function runF38Verify(
  req: VercelRequest,
  clientProvidedUid: string,
): Promise<AuthResult> {
  const resolved = await resolveTrustedUid(req, clientProvidedUid);
  const trustedUid = resolved.trusted_uid || clientProvidedUid;

  // Second call for decoded_token (email + admin-claim).
  // verifyFirebaseToken re-validerer token og returnerer decoded felter.
  // Ved warn_only uden Bearer-header returneres verified=false (decoded=undefined)
  // — så decoded er null og admin-check falder tilbage til email-match (som
  // også vil fejle uden email). Vi tillader forsigtigt call'et at fortsætte
  // så authorize-tjekket kan give et præcist 403.
  const verified = await verifyFirebaseToken(req, {});
  const decoded = (verified.decoded_token ?? null) as DecodedTokenLite | null;

  return { trustedUid, decoded };
}

// ---------- Handler ------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Method-guard: kun GET og POST.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    const body: ErrorResponse = { success: false, error: 'Method not allowed' };
    res.status(405).json(body);
    return;
  }

  const sb = getSupabase();
  if (!sb) {
    const body: ErrorResponse = {
      success: false,
      error: 'Supabase service-role-nøgle ikke konfigureret.',
    };
    res.status(503).json(body);
    return;
  }

  try {
    if (req.method === 'GET') {
      await handleGet(req, res, sb);
    } else {
      await handlePost(req, res, sb);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/b2b/campaigns] uventet fejl:', message);
    const body: ErrorResponse = { success: false, error: `Serverfejl: ${message}` };
    res.status(500).json(body);
  }
}

async function handleGet(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<void> {
  const parsed = parseListQuery(req.query);
  if (!parsed.ok) {
    const body: ErrorResponse = { success: false, error: parsed.reason };
    res.status(400).json(body);
    return;
  }
  const params = parsed.value;

  // F3.8 verify (kaster ved spoof i enforce-mode).
  let auth: AuthResult;
  try {
    auth = await runF38Verify(req, params.firebaseUid);
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status?: unknown }).status) || 401
        : 401;
    const reason =
      err instanceof Error ? err.message : 'Firebase-token verifikation fejlede.';
    console.warn('[api/b2b/campaigns GET] F3.8 blokerede request:', reason);
    const body: ErrorResponse = { success: false, error: reason };
    res.status(status).json(body);
    return;
  }
  void auth.trustedUid; // reserveret til fremtidig audit-logging.

  // Producer eksistens + authorization.
  const producer = await fetchProducer(sb, params.producer_id);
  if (!producer) {
    const body: ErrorResponse = { success: false, error: 'Producer_id findes ikke.' };
    res.status(404).json(body);
    return;
  }
  if (!producer.is_active) {
    const body: ErrorResponse = {
      success: false,
      error: 'Producer er ikke aktiv (is_active=false).',
    };
    res.status(409).json(body);
    return;
  }
  if (!isAuthorizedForProducer(auth.decoded, producer)) {
    const body: ErrorResponse = {
      success: false,
      error: 'FORBIDDEN — kalderen har ikke adgang til denne producents kampagner.',
    };
    res.status(403).json(body);
    return;
  }

  // Fetch kampagner.
  let campaigns: readonly Campaign[];
  try {
    campaigns = await fetchCampaigns(sb, params);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    // 42P01 = undefined_table — hjælp klienten med præcis fejlbesked.
    if (code === '42P01') {
      const body: ErrorResponse = {
        success: false,
        error: `Tabel '${CAMPAIGNS_TABLE}' findes ikke. Kør campaigns-migrationen først.`,
      };
      res.status(503).json(body);
      return;
    }
    throw err;
  }

  const body: ListSuccessResponse = {
    success: true,
    data: {
      producer_id: params.producer_id,
      total: campaigns.length,
      limit: params.limit,
      offset: params.offset,
      campaigns,
    },
  };
  res.status(200).json(body);
}

async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  sb: SupabaseClient,
): Promise<void> {
  const parsed = parseCreateBody(req.body);
  if (!parsed.ok) {
    const body: ErrorResponse = { success: false, error: parsed.reason };
    res.status(400).json(body);
    return;
  }
  const params = parsed.value;

  // F3.8 verify (kaster ved spoof i enforce-mode).
  let auth: AuthResult;
  try {
    auth = await runF38Verify(req, params.firebaseUid);
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status?: unknown }).status) || 401
        : 401;
    const reason =
      err instanceof Error ? err.message : 'Firebase-token verifikation fejlede.';
    console.warn('[api/b2b/campaigns POST] F3.8 blokerede request:', reason);
    const body: ErrorResponse = { success: false, error: reason };
    res.status(status).json(body);
    return;
  }
  void auth.trustedUid;

  // Producer eksistens + authorization.
  const producer = await fetchProducer(sb, params.producer_id);
  if (!producer) {
    const body: ErrorResponse = { success: false, error: 'Producer_id findes ikke.' };
    res.status(404).json(body);
    return;
  }
  if (!producer.is_active) {
    const body: ErrorResponse = {
      success: false,
      error: 'Producer er ikke aktiv — kan ikke oprette kampagner.',
    };
    res.status(409).json(body);
    return;
  }
  if (!isAuthorizedForProducer(auth.decoded, producer)) {
    const body: ErrorResponse = {
      success: false,
      error: 'FORBIDDEN — kalderen har ikke adgang til denne producents kampagner.',
    };
    res.status(403).json(body);
    return;
  }

  // Insert.
  let campaign: Campaign;
  try {
    campaign = await insertCampaign(sb, params);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    if (code === '42P01') {
      const body: ErrorResponse = {
        success: false,
        error: `Tabel '${CAMPAIGNS_TABLE}' findes ikke. Kør campaigns-migrationen først.`,
      };
      res.status(503).json(body);
      return;
    }
    if (code === '23503') {
      // foreign_key_violation — producer_id findes ikke i b2b_producers.
      // (Skulle være dækket af fetchProducer-check, men race conditions.)
      const body: ErrorResponse = {
        success: false,
        error: 'Producer_id refererer til en ikke-eksisterende producent.',
      };
      res.status(409).json(body);
      return;
    }
    throw err;
  }

  const body: CreateSuccessResponse = {
    success: true,
    data: { campaign },
  };
  res.status(201).json(body);
}

// Eksporterede typer — public kontrakt for klienter der vil importere response-formen.
export type {
  ApiResponse,
  ListSuccessResponse,
  CreateSuccessResponse,
  ErrorResponse,
  Campaign,
  CampaignType,
  CampaignStatus,
  RewardType,
};
