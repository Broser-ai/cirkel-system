// C:\Users\Ambro2\cirkel-system\api\notifications\subscribe.ts
//
// Cirkel — Modul: WebPush subscription registrering.
//
// Vercel serverless handler (Node runtime).
//
// POST body:
//   {
//     endpoint:   string                       — Push service endpoint URL
//     keys:       { p256dh: string; auth: string }  — VAPID keys fra PushSubscription
//     user_agent?: string                      — valgfri client UA-streng
//   }
//
// Persistering:
//   Skrives til `push_subscriptions` (se supabase/migrations/015_push_subscriptions.sql).
//   Unique constraint på (firebase_uid, endpoint) → gentagne subscribes
//   opdaterer eksisterende række (UPSERT) i stedet for at duplikere.
//
// F3.8 authorization:
//   Bearer Firebase ID-token påkrævet via Authorization-header. `resolveTrustedUid`
//   verificerer token cryptografisk og udleder trustedUid. I enforce-mode
//   blokeres manglende/mismatch med 401 UID_SPOOF_DETECTED. Klienten oplyser
//   sit uid enten via body.firebaseUid eller lader token.uid være autoritativt.
//
// Response 201:
//   { success: true, data: { subscription_id: string, firebase_uid: string, upserted: boolean } }
//
// Response 4xx/5xx:
//   { success: false, error: string, detail?: string }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { resolveTrustedUid } from "../_verify-firebase-token.js";
import logger from "../../src/lib/logger.js";

// ────────────────────────────────────────────────────────────────────────────
// Typer
// ────────────────────────────────────────────────────────────────────────────

interface SubscribeRequestBody {
  endpoint?: unknown;
  keys?: unknown;
  user_agent?: unknown;
  firebaseUid?: unknown;
}

interface WebPushKeys {
  readonly p256dh: string;
  readonly auth: string;
}

interface ValidatedSubscribePayload {
  readonly endpoint: string;
  readonly keys: WebPushKeys;
  readonly userAgent: string | null;
  readonly clientProvidedUid: string | null;
}

interface SubscribeSuccessData {
  readonly subscription_id: string;
  readonly firebase_uid: string;
  readonly upserted: boolean;
}

interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly detail?: string;
}

interface UpsertedRow {
  readonly id: string;
  readonly firebase_uid: string;
  readonly created_at: string;
  readonly updated_at: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Supabase service-role klient (lazy init, samme pattern som api/scan.ts).
// KUN server-side; SUPABASE_SERVICE_ROLE_KEY må aldrig eksponeres til klient.
// ────────────────────────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * WebPush endpoints er altid https:// URLs (fx https://fcm.googleapis.com/...
 * eller https://updates.push.services.mozilla.com/...). Validér billigt uden
 * netværks-lookup.
 */
function isValidPushEndpoint(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * VAPID keys er base64url-encoded byte-strings. p256dh er 65 bytes (uncompressed
 * ECDH pubkey), auth er 16 bytes. Base64url-længderne bliver hhv. ~87 og ~22
 * tegn — vi validerer bare format og en rimelig længde-øvre grænse.
 */
function isValidBase64UrlString(value: string, maxLen: number): boolean {
  if (value.length === 0 || value.length > maxLen) return false;
  return /^[A-Za-z0-9_-]+=*$/.test(value);
}

function validateBody(body: SubscribeRequestBody): {
  ok: true;
  payload: ValidatedSubscribePayload;
} | {
  ok: false;
  error: string;
} {
  if (!isNonEmptyString(body.endpoint)) {
    return { ok: false, error: "Felt 'endpoint' skal være en ikke-tom streng." };
  }
  const endpoint = body.endpoint.trim();
  if (!isValidPushEndpoint(endpoint)) {
    return { ok: false, error: "Felt 'endpoint' skal være en gyldig https://-URL under 2048 tegn." };
  }

  if (!isPlainObject(body.keys)) {
    return { ok: false, error: "Felt 'keys' skal være et objekt med 'p256dh' og 'auth'." };
  }
  const p256dhRaw = body.keys.p256dh;
  const authRaw = body.keys.auth;
  if (!isNonEmptyString(p256dhRaw) || !isValidBase64UrlString(p256dhRaw, 256)) {
    return { ok: false, error: "Felt 'keys.p256dh' skal være en gyldig base64url-streng." };
  }
  if (!isNonEmptyString(authRaw) || !isValidBase64UrlString(authRaw, 128)) {
    return { ok: false, error: "Felt 'keys.auth' skal være en gyldig base64url-streng." };
  }

  let userAgent: string | null = null;
  if (body.user_agent !== undefined && body.user_agent !== null) {
    if (!isNonEmptyString(body.user_agent)) {
      return { ok: false, error: "Felt 'user_agent' skal — hvis angivet — være en ikke-tom streng." };
    }
    const trimmed = body.user_agent.trim();
    if (trimmed.length > 512) {
      return { ok: false, error: "Felt 'user_agent' må ikke overstige 512 tegn." };
    }
    userAgent = trimmed;
  }

  let clientProvidedUid: string | null = null;
  if (body.firebaseUid !== undefined && body.firebaseUid !== null) {
    if (!isNonEmptyString(body.firebaseUid)) {
      return { ok: false, error: "Felt 'firebaseUid' skal — hvis angivet — være en ikke-tom streng." };
    }
    const trimmed = body.firebaseUid.trim();
    if (trimmed.length > 128) {
      return { ok: false, error: "Felt 'firebaseUid' må ikke overstige 128 tegn." };
    }
    clientProvidedUid = trimmed;
  }

  return {
    ok: true,
    payload: {
      endpoint,
      keys: { p256dh: p256dhRaw.trim(), auth: authRaw.trim() },
      userAgent,
      clientProvidedUid,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Response-helpers — struktureret { success, data?, error?, detail? }
// ────────────────────────────────────────────────────────────────────────────

function respondError(
  res: VercelResponse,
  status: number,
  error: string,
  detail?: string,
): void {
  const body: ApiResponse<never> = detail
    ? { success: false, error, detail }
    : { success: false, error };
  res.status(status).json(body);
}

function respondSuccess<T>(res: VercelResponse, status: number, data: T): void {
  const body: ApiResponse<T> = { success: true, data };
  res.status(status).json(body);
}

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Method-guard — kun POST må registrere subscriptions.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    respondError(res, 405, "Method not allowed", `Received ${req.method ?? "unknown"}, expected POST.`);
    return;
  }

  const rawBody: SubscribeRequestBody = isPlainObject(req.body)
    ? (req.body as SubscribeRequestBody)
    : {};

  const validation = validateBody(rawBody);
  if (!validation.ok) {
    respondError(res, 400, "Invalid payload", validation.error);
    return;
  }
  const { endpoint, keys, userAgent, clientProvidedUid } = validation.payload;

  // ──────────────────────────────────────────────────────────────────────────
  // F3.8 — verificér Bearer-token FØR persistering.
  // Enforce-mode: kaster ved manglende/mismatch → 401 UID_SPOOF_DETECTED.
  // Warn_only-mode: fortsætter med klient-oplyst UID hvis token mangler.
  // ──────────────────────────────────────────────────────────────────────────
  let trustedUid: string;
  let uidVerified = false;
  let uidSpoofed = false;
  try {
    // resolveTrustedUid kræver en string. Hvis klienten ikke oplyste et UID,
    // sender vi en tom streng — i warn_only-mode falder handleren tilbage til
    // en advarsel; i enforce-mode kastes den, og vi returnerer 401.
    const uidHint = clientProvidedUid ?? "";
    const verified = await resolveTrustedUid(req, uidHint);
    if (!verified.trusted_uid) {
      respondError(
        res,
        401,
        "UID_UNRESOLVED",
        "Kunne ikke udlede et brugbart firebase-uid. Vedhæft en Authorization: Bearer <ID-token> header.",
      );
      return;
    }
    trustedUid = verified.trusted_uid;
    uidVerified = verified.verified;
    uidSpoofed = verified.spoofed;
    if (uidSpoofed) {
      logger.warn("[F3.8] notifications/subscribe warn_only: spoof detected", {
        clientProvidedUid,
        trustedUid,
        reason: verified.reason,
      });
    } else if (!uidVerified) {
      logger.warn("[F3.8] notifications/subscribe warn_only: token ikke verificeret", {
        reason: verified.reason,
      });
    }
  } catch (err) {
    const e = err as { status?: number; reason?: string; message?: string };
    const status = e?.status ?? 401;
    const reason = e?.reason ?? e?.message ?? "UID_SPOOF_DETECTED";
    logger.error("[F3.8] notifications/subscribe enforce BLOCKED", err as Error, { status, reason });
    respondError(res, status, "UID_SPOOF_DETECTED", reason);
    return;
  }

  const sb = getSupabase();
  if (!sb) {
    logger.warn("[notifications/subscribe] Supabase service-role env mangler", {
      hasUrl: !!process.env.VITE_SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    respondError(
      res,
      503,
      "SUPABASE_UNAVAILABLE",
      "Supabase service-role-nøgle er ikke konfigureret på serveren.",
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UPSERT ind i push_subscriptions.
  // Unique-index på (firebase_uid, endpoint) sikrer idempotens — samme device
  // der subscriber igen (fx efter token-refresh) opdaterer keys/user_agent
  // frem for at oprette en dublet.
  // ──────────────────────────────────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const row = {
    firebase_uid: trustedUid,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent,
    uid_verified: uidVerified,
    updated_at: nowIso,
  };

  try {
    const { data, error } = await sb
      .from("push_subscriptions")
      .upsert(row, { onConflict: "firebase_uid,endpoint", ignoreDuplicates: false })
      .select("id, firebase_uid, created_at, updated_at")
      .single<UpsertedRow>();

    if (error) {
      logger.error("[notifications/subscribe] upsert fejlede", error, {
        firebaseUid: trustedUid,
      });
      respondError(
        res,
        500,
        "PERSIST_FAILED",
        `Kunne ikke gemme push-subscription: ${error.message}`,
      );
      return;
    }
    if (!data) {
      logger.error(
        "[notifications/subscribe] upsert returnerede ingen række",
        new Error("no-data"),
        { firebaseUid: trustedUid },
      );
      respondError(
        res,
        500,
        "PERSIST_EMPTY",
        "Upsert returnerede ingen række — kontrollér RLS/policies på push_subscriptions.",
      );
      return;
    }

    const isNewRow = data.created_at === data.updated_at;
    logger.info("[notifications/subscribe] gemt", {
      subscription_id: data.id,
      firebase_uid: data.firebase_uid,
      upserted: !isNewRow,
      uid_verified: uidVerified,
    });

    respondSuccess<SubscribeSuccessData>(res, isNewRow ? 201 : 200, {
      subscription_id: data.id,
      firebase_uid: data.firebase_uid,
      upserted: !isNewRow,
    });
  } catch (err) {
    const e = err as { message?: string };
    logger.error("[notifications/subscribe] uventet fejl", err as Error);
    respondError(
      res,
      500,
      "INTERNAL_ERROR",
      e?.message ?? "Uventet fejl under registrering af push-subscription.",
    );
  }
}
