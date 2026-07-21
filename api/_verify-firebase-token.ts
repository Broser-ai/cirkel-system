// cirkel-system/api/_verify-firebase-token.ts
//
// F3.8 middleware: server-side ID-token verifikation.
//
// USAGE:
//   const verified = await verifyFirebaseToken(req, { requiredUid: bodyUid });
//   if (!verified.ok) return res.status(verified.status).json({ error: verified.reason });
//   const trustedUid = verified.uid;  // Brug DENNE, ikke body.firebaseUid
//
// OPT-IN via env:
//   FIREBASE_ADMIN_ENFORCE=1 → hård-enforce (rejects hvis token mangler eller mismatcher)
//   FIREBASE_ADMIN_ENFORCE=0 (default) → advarer men lader klient-UID passere
//     (backward-compat mens migration ruller ud endpoint-for-endpoint)

import { getAdminAuth } from './_firebase-admin.js';

export type VerifyMode = 'enforce' | 'warn_only' | 'skip';

export interface VerifyResult {
  ok: boolean;
  uid: string | null;
  verified: boolean;             // true = token blev valideret cryptografisk
  mode: VerifyMode;
  status: number;                // HTTP-status hvis fejl
  reason: string;
  decoded_token?: any;
}

export interface VerifyOpts {
  requiredUid?: string;          // UID som skal matche decoded.uid
  mode?: VerifyMode;             // override env-default
}

function currentMode(): VerifyMode {
  const env = String(process.env.FIREBASE_ADMIN_ENFORCE ?? '').toLowerCase();
  if (env === '1' || env === 'true' || env === 'enforce') return 'enforce';
  if (env === 'skip') return 'skip';
  return 'warn_only';
}

function extractBearer(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function verifyFirebaseToken(req: any, opts?: VerifyOpts): Promise<VerifyResult> {
  const mode = opts?.mode ?? currentMode();
  const requiredUid = opts?.requiredUid ?? null;

  // Skip-mode: pass through uden verify (kun til lokal dev/mock)
  if (mode === 'skip') {
    return {
      ok: true,
      uid: requiredUid ?? null,
      verified: false,
      mode,
      status: 200,
      reason: 'F3.8 mode=skip — token IKKE valideret. Kun til lokal dev.',
    };
  }

  const idToken = extractBearer(req?.headers?.authorization);

  if (!idToken) {
    if (mode === 'warn_only') {
      console.warn('[F3.8] warn_only: Authorization Bearer-token mangler. Pass through uden verify.');
      return {
        ok: true,
        uid: requiredUid,
        verified: false,
        mode,
        status: 200,
        reason: 'Ingen token — warn_only pass-through.',
      };
    }
    return { ok: false, uid: null, verified: false, mode, status: 401, reason: 'Missing Authorization Bearer token' };
  }

  let decoded: any;
  try {
    const auth = await getAdminAuth();
    decoded = await auth.verifyIdToken(idToken, /* checkRevoked */ true);
  } catch (err: any) {
    const reason = `verifyIdToken fejlede: ${err?.message ?? err}`;
    if (mode === 'warn_only') {
      console.warn(`[F3.8] warn_only: ${reason}`);
      return { ok: true, uid: requiredUid, verified: false, mode, status: 200, reason };
    }
    return { ok: false, uid: null, verified: false, mode, status: 401, reason };
  }

  // Token er cryptografisk gyldigt. Nu tjekker vi mismatch mod body-UID.
  if (requiredUid && decoded.uid !== requiredUid) {
    const reason = `UID_SPOOF_DETECTED: token.uid="${decoded.uid}" != body.firebaseUid="${requiredUid}"`;
    if (mode === 'warn_only') {
      console.warn(`[F3.8] warn_only: ${reason}`);
      return { ok: true, uid: decoded.uid, verified: true, mode, status: 200, reason, decoded_token: decoded };
    }
    return { ok: false, uid: decoded.uid, verified: true, mode, status: 403, reason, decoded_token: decoded };
  }

  return {
    ok: true,
    uid: decoded.uid,
    verified: true,
    mode,
    status: 200,
    reason: 'F3.8: token verified + uid match',
    decoded_token: decoded,
  };
}

/**
 * Hjælper til at wire ind i eksisterende endpoints der bruger firebaseUid fra body.
 * Returnerer det VERIFICEREDE uid til brug som p_firebase_uid i process_scan.
 */
export async function resolveTrustedUid(req: any, clientProvidedUid: string): Promise<{
  trusted_uid: string;
  verified: boolean;
  spoofed: boolean;
  reason: string;
}> {
  const result = await verifyFirebaseToken(req, { requiredUid: clientProvidedUid });
  if (!result.ok) {
    // Enforce-mode har blokeret — kaster så caller ved det er hard fejl
    const err = new Error(result.reason);
    (err as any).status = result.status;
    (err as any).reason = result.reason;
    throw err;
  }
  return {
    trusted_uid: result.uid ?? clientProvidedUid,
    verified: result.verified,
    spoofed: result.verified && result.uid !== clientProvidedUid,
    reason: result.reason,
  };
}

/** Modes for verify — eksporteret så andre modules kan læse. */
export { currentMode as _currentMode };
