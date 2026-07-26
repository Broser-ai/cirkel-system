// cirkel-system/api/scans/classify.ts
//
// POST /api/scans/classify — AI image classification via Anthropic Claude vision.
//
// Wrapper omkring @anthropic-ai/sdk der klassificerer et emballage-foto og
// returnerer strukturet materialeklassifikation til sorterings-flowet.
//
// Body:
//   {
//     image_base64: string,          // rå base64 (evt. med data:-prefix) — påkrævet
//     prompt?: string,               // valgfri override af det danske analyse-prompt
//     firebaseUid?: string,          // valgfri — trigger F3.8 verify hvis sat
//   }
//
// Response ved success (200):
//   {
//     success: true,
//     data: {
//       classification: string,      // menneskelig-læsbar klasse (fx "Plastflaske")
//       confidence: number,          // 0..1
//       materialType: string,        // teknisk material-slug (fx "PET1")
//       sortingCategory: string,     // sorteringsbeholder (fx "Plast/Metal")
//     },
//   }
//
// Response ved fejl (5xx / timeout):
//   {
//     success: false,
//     error: string,
//     fallback: { use: 'mockClassify', reason: string }
//   }
//   → Klienten bør bruge lokal mockClassify() når fallback.use === 'mockClassify'.
//
// F3.8 er wired via resolveTrustedUid — samme mønster som api/scan.ts &
// api/dashboard.ts. Ved warn_only-mode fortsætter kaldet uden verifikation;
// ved enforce-mode blokeres UID-spoof med 401.
//
// Ingen hardkodede secrets — ANTHROPIC_API_KEY læses fra process.env.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';

// ─── Typer ────────────────────────────────────────────────────────────────

interface ClassifyRequestBody {
  image_base64?: unknown;
  prompt?: unknown;
  firebaseUid?: unknown;
}

interface ClassificationResult {
  classification: string;
  confidence: number;
  materialType: string;
  sortingCategory: string;
}

interface FallbackHint {
  use: 'mockClassify';
  reason: string;
}

interface SuccessResponse {
  success: true;
  data: ClassificationResult;
  meta?: {
    uid_verified: boolean;
    uid_spoofed: boolean;
    model: string;
  };
}

interface ErrorResponse {
  success: false;
  error: string;
  fallback?: FallbackHint;
}

type ClassifyResponse = SuccessResponse | ErrorResponse;

// ─── Konfiguration ────────────────────────────────────────────────────────

const CLAUDE_MODEL: string = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS: number = Number.parseInt(
  process.env.CLAUDE_CLASSIFY_MAX_TOKENS || '1024',
  10,
);
const CLAUDE_TIMEOUT_MS: number = Number.parseInt(
  process.env.CLAUDE_CLASSIFY_TIMEOUT_MS || '25000',
  10,
);

const DEFAULT_PROMPT: string =
  'Analyser emballagen på billedet og klassificér det til dansk affaldssortering. ' +
  'Fokusér på materialetype (PET, HDPE, PP5, aluminium, karton, glas, etc.) og ' +
  'hvilken sorteringsbeholder det tilhører i det danske 10-fraktioners system.';

const SYSTEM_INSTRUCTION: string = `Du er en ekspert i dansk affaldssortering og materialeidentifikation.
Analyser billedet af emballagen og returnér KUN gyldig JSON med præcis disse felter:

{
  "classification": string,   // menneskelig-læsbar klasse på dansk (fx "PET-plastflaske 0.5L")
  "confidence": number,        // 0.0..1.0 — din sikkerhed for materialebestemmelsen
  "materialType": string,      // teknisk materialekode (fx "PET1", "HDPE2", "PP5", "AL", "PAP", "GLAS")
  "sortingCategory": string    // dansk sorteringsbeholder — én af:
                               //   "Plast/Metal", "Mad- og drikkekartoner", "Pap",
                               //   "Papir", "Glas", "Metal", "Farligt affald",
                               //   "Restaffald", "Madaffald", "Tekstilaffald"
}

Ingen forklaring, ingen markdown, ingen backticks. Kun rå JSON.`;

// ─── Supabase (lazy service-role klient, samme mønster som api/scan.ts) ──

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ─── Anthropic-klient (lazy) ─────────────────────────────────────────────

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic | null {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _anthropic = new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS });
  return _anthropic;
}

// ─── Hjælpere ────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

interface NormalizedImage {
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

function normalizeImage(raw: string): NormalizedImage {
  const dataUrlMatch = raw.match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/i);
  if (dataUrlMatch) {
    const ext = dataUrlMatch[1].toLowerCase();
    const mediaType: NormalizedImage['mediaType'] =
      ext === 'jpg' ? 'image/jpeg' : (`image/${ext}` as NormalizedImage['mediaType']);
    return { data: dataUrlMatch[2], mediaType };
  }
  return { data: raw, mediaType: 'image/jpeg' };
}

function extractTextFromClaudeMessage(msg: Anthropic.Message): string {
  const blocks = msg.content ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('').trim();
}

function stripJsonFencing(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function coerceClassification(parsed: Record<string, unknown>): ClassificationResult {
  const classification = isNonEmptyString(parsed.classification)
    ? parsed.classification
    : 'Ukendt';
  const rawConfidence = parsed.confidence;
  let confidence = 0;
  if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    confidence = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
  } else if (typeof rawConfidence === 'string') {
    const parsedNum = Number.parseFloat(rawConfidence.replace(',', '.'));
    if (Number.isFinite(parsedNum)) {
      confidence = parsedNum > 1 ? parsedNum / 100 : parsedNum;
    }
  }
  confidence = Math.max(0, Math.min(1, confidence));
  const materialType = isNonEmptyString(parsed.materialType)
    ? parsed.materialType
    : 'UNKNOWN';
  const sortingCategory = isNonEmptyString(parsed.sortingCategory)
    ? parsed.sortingCategory
    : 'Restaffald';
  return { classification, confidence, materialType, sortingCategory };
}

async function classifyWithClaude(
  client: Anthropic,
  image: NormalizedImage,
  userPrompt: string,
): Promise<ClassificationResult> {
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: SYSTEM_INSTRUCTION,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.data,
            },
          },
          {
            type: 'text',
            text:
              userPrompt +
              '\n\nSvar UDELUKKENDE med gyldig JSON matchende skemaet. Ingen forklaring.',
          },
        ],
      },
    ],
  });

  const rawText = extractTextFromClaudeMessage(message);
  if (!rawText) {
    throw new Error('Claude returnerede tom respons');
  }
  const cleaned = stripJsonFencing(rawText);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Claude JSON-parse fejlede: ${detail}. Raw: ${cleaned.slice(0, 200)}`);
  }
  return coerceClassification(parsed);
}

function isTimeoutError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { name?: string; code?: string; status?: number; message?: string };
  if (anyErr.name === 'AbortError') return true;
  if (anyErr.code === 'ETIMEDOUT' || anyErr.code === 'ECONNABORTED') return true;
  if (anyErr.status === 408 || anyErr.status === 504) return true;
  const msg = String(anyErr.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out');
}

// ─── Handler ─────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    const body: ErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(body);
  }

  // Body-parsing (Vercel har allerede parset JSON når Content-Type er application/json)
  const body: ClassifyRequestBody =
    typeof req.body === 'string'
      ? (JSON.parse(req.body || '{}') as ClassifyRequestBody)
      : ((req.body ?? {}) as ClassifyRequestBody);

  const rawImage = body.image_base64;
  if (!isNonEmptyString(rawImage)) {
    const errBody: ErrorResponse = {
      success: false,
      error: 'image_base64 er påkrævet (non-empty string)',
    };
    return res.status(400).json(errBody);
  }

  const userPrompt: string = isNonEmptyString(body.prompt) ? body.prompt : DEFAULT_PROMPT;
  const firebaseUid: string | undefined = isNonEmptyString(body.firebaseUid)
    ? body.firebaseUid
    : undefined;

  // ─── F3.8 — resolveTrustedUid før arbejde (kun hvis firebaseUid oplyst) ─
  let uidVerified = false;
  let uidSpoofed = false;
  if (firebaseUid) {
    try {
      const verify = await resolveTrustedUid(req, firebaseUid);
      uidVerified = verify.verified;
      uidSpoofed = verify.spoofed;
      if (uidSpoofed) {
        console.warn('[F3.8] classify warn_only: spoof detected', {
          firebaseUidBody: firebaseUid,
          trustedUid: verify.trusted_uid,
          reason: verify.reason,
        });
      } else if (!uidVerified) {
        console.warn('[F3.8] classify warn_only: ingen crypto-verify', {
          reason: verify.reason,
        });
      }
    } catch (err) {
      const status = (err as { status?: number })?.status ?? 401;
      const reason =
        (err as { reason?: string })?.reason ??
        (err instanceof Error ? err.message : 'UID_SPOOF_DETECTED');
      console.error('[F3.8] classify enforce BLOCKED', { status, reason });
      const errBody: ErrorResponse = { success: false, error: reason };
      return res.status(status).json(errBody);
    }
  }

  // ─── Anthropic-klient tilgængelig? ────────────────────────────────────
  const anthropic = getAnthropic();
  if (!anthropic) {
    console.warn('[classify] ANTHROPIC_API_KEY mangler — suggest mock fallback');
    const errBody: ErrorResponse = {
      success: false,
      error: 'anthropic_unavailable',
      fallback: { use: 'mockClassify', reason: 'ANTHROPIC_API_KEY er ikke konfigureret' },
    };
    return res.status(503).json(errBody);
  }

  // ─── Klassificér ──────────────────────────────────────────────────────
  const normalized = normalizeImage(rawImage);
  try {
    const data = await classifyWithClaude(anthropic, normalized, userPrompt);

    // Touch Supabase-klienten så tilgang er tilgængelig for fremtidige
    // persist-hooks (fx logging af klassifikationer til sovereign_scans).
    // I dag ingen writes — behold pattern-symmetri med api/scan.ts.
    void getSupabase();

    const successBody: SuccessResponse = {
      success: true,
      data,
      meta: {
        uid_verified: uidVerified,
        uid_spoofed: uidSpoofed,
        model: CLAUDE_MODEL,
      },
    };
    return res.status(200).json(successBody);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const timeout = isTimeoutError(err);
    console.error('[classify] Claude vision fejlede', {
      timeout,
      detail,
    });
    const errBody: ErrorResponse = {
      success: false,
      error: timeout ? 'claude_timeout' : 'claude_error',
      fallback: {
        use: 'mockClassify',
        reason: timeout
          ? `Claude timeout efter ${CLAUDE_TIMEOUT_MS}ms — brug lokal mockClassify`
          : `Claude fejlede: ${detail.slice(0, 200)} — brug lokal mockClassify`,
      },
    };
    return res.status(timeout ? 504 : 500).json(errBody);
  }
}
