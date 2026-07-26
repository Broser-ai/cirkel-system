// cirkel-system/api/health.ts
//
// Health-check endpoint.
//
// GET /api/health
//   200 -> alle sub-checks er "ok"
//   503 -> 1+ sub-check er "down" (degraded eller down samlet status)
//
// Sub-checks:
//   - supabase             : HEAD mod ledger via SUPABASE_ANON_KEY, timeout 500ms.
//                            Enhver HTTP-respons (også 401/403/404) tælles som "ok",
//                            fordi det beviser at Supabase-projektet svarer.
//                            Netværksfejl eller timeout -> "down".
//   - gemini_configured    : Ren env-check for GEMINI_API_KEY (ingen kald).
//   - firebase_admin_configured : Env-check for FIREBASE_SERVICE_ACCOUNT_JSON
//                            eller (FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
//                            FIREBASE_PRIVATE_KEY). Ingen kald.

import type { VercelRequest, VercelResponse } from '@vercel/node';

type CheckStatus = 'ok' | 'down';
type OverallStatus = 'ok' | 'degraded' | 'down';

interface HealthChecks {
  supabase: CheckStatus;
  gemini_configured: CheckStatus;
  firebase_admin_configured: CheckStatus;
}

interface HealthResponse {
  status: OverallStatus;
  checks: HealthChecks;
  version: string;
  timestamp: string;
  details?: Record<string, string>;
}

const SUPABASE_TIMEOUT_MS = 500;

function readVersion(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.npm_package_version ||
    process.env.APP_VERSION ||
    'unknown'
  );
}

function checkGeminiConfigured(): CheckStatus {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? 'ok' : 'down';
}

function checkFirebaseAdminConfigured(): CheckStatus {
  const jsonBlob = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (typeof jsonBlob === 'string' && jsonBlob.trim().length > 0) {
    try {
      const parsed = JSON.parse(jsonBlob);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.project_id === 'string' &&
        typeof parsed.client_email === 'string' &&
        typeof parsed.private_key === 'string'
      ) {
        return 'ok';
      }
    } catch {
      // falder igennem til individuel-felt check
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (
    typeof projectId === 'string' && projectId.trim().length > 0 &&
    typeof clientEmail === 'string' && clientEmail.trim().length > 0 &&
    typeof privateKey === 'string' && privateKey.trim().length > 0
  ) {
    return 'ok';
  }
  return 'down';
}

interface SupabaseCheckResult {
  status: CheckStatus;
  detail: string;
}

async function checkSupabase(): Promise<SupabaseCheckResult> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    return { status: 'down', detail: 'env_missing' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    // HEAD /rest/v1/ledger?select=id&limit=1
    // Enhver HTTP-respons beviser at PostgREST er nået.
    const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/ledger?select=id&limit=1`;
    const response = await fetch(endpoint, {
      method: 'HEAD',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    return { status: 'ok', detail: `http_${response.status}` };
  } catch (err: any) {
    const name = err?.name ?? 'Error';
    const msg = err?.message ?? String(err);
    if (name === 'AbortError') {
      return { status: 'down', detail: `timeout_${SUPABASE_TIMEOUT_MS}ms` };
    }
    return { status: 'down', detail: `network_error:${msg.slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}

function deriveOverall(checks: HealthChecks): OverallStatus {
  const values: CheckStatus[] = [
    checks.supabase,
    checks.gemini_configured,
    checks.firebase_admin_configured,
  ];
  const downCount = values.filter((v) => v === 'down').length;
  if (downCount === 0) return 'ok';
  if (downCount === values.length) return 'down';
  return 'degraded';
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const [supabaseResult] = await Promise.all([checkSupabase()]);
  const gemini = checkGeminiConfigured();
  const firebase = checkFirebaseAdminConfigured();

  const checks: HealthChecks = {
    supabase: supabaseResult.status,
    gemini_configured: gemini,
    firebase_admin_configured: firebase,
  };

  const overall = deriveOverall(checks);
  const body: HealthResponse = {
    status: overall,
    checks,
    version: readVersion(),
    timestamp: new Date().toISOString(),
    details: {
      supabase: supabaseResult.detail,
    },
  };

  // 200 hvis intet er "down"; 503 hvis mindst ét sub-check er "down".
  const httpStatus = overall === 'ok' ? 200 : 503;

  // Health-checks bør ikke caches.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(httpStatus).json(body);
}
