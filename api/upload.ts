// cirkel-system/api/upload.ts
//
// F3.9: Firebase Storage signed URL-generator til scan-billeder.
//
// POST body:
//   { mime: string, filename: string, user_id: string }
//
// Response (success):
//   {
//     success: true,
//     data: {
//       uploadUrl: string,       // v4 signed PUT URL (klient PUT'er raw bytes)
//       downloadUrl: string,     // v4 signed GET URL (til fremvisning/AI-analyse)
//       object_path: string,     // GCS-path (til at gemme reference i DB)
//       bucket: string,
//       mime: string,
//       expires_at: string,      // ISO-8601 for uploadUrl-udløb
//       download_expires_at: string
//     }
//   }
//
// Response (error): { success: false, error: string }
//
// SIKKERHED:
//   - Alle secrets via process.env (aldrig hardkodet)
//   - Firebase-token verificeres via _verify-firebase-token (F3.8-pattern)
//     og skal matche body.user_id (spoof-beskyttelse)
//   - MIME whitelist til billed-typer
//   - Filnavn saniteres (path-traversal beskyttelse)
//   - Best-effort audit-log til Supabase (fail-silent hvis tabel mangler)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAdminApp } from './_firebase-admin.js';
import { verifyFirebaseToken } from './_verify-firebase-token.js';

// ---------- Konstanter ---------------------------------------------------

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;         // 15 min til at gennemføre upload
const DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;       // 1 time til fremvisning/AI
const MAX_FILENAME_LENGTH = 128;

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// ---------- Typer --------------------------------------------------------

interface UploadRequestBody {
  mime: string;
  filename: string;
  user_id: string;
}

interface UploadResponseData {
  uploadUrl: string;
  downloadUrl: string;
  object_path: string;
  bucket: string;
  mime: string;
  expires_at: string;
  download_expires_at: string;
}

interface SuccessResponse {
  success: true;
  data: UploadResponseData;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

// ---------- Supabase lazy-init (samme mønster som scan.ts/me.ts) ---------

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ---------- Validering ---------------------------------------------------

function parseBody(raw: unknown): UploadRequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const mime = body.mime;
  const filename = body.filename;
  const user_id = body.user_id;
  if (typeof mime !== 'string' || mime.length === 0) return null;
  if (typeof filename !== 'string' || filename.length === 0) return null;
  if (typeof user_id !== 'string' || user_id.length === 0) return null;
  return { mime, filename, user_id };
}

function validateMime(mime: string): boolean {
  return ALLOWED_MIME_TYPES.has(mime.toLowerCase());
}

/**
 * Sanitér filnavn:
 *  - fjern path-separatorer og null-bytes
 *  - collapse whitespace til '-'
 *  - fjern alt der ikke er alfanumerisk/dash/underscore/dot
 *  - trim længde
 */
function sanitizeFilename(name: string): string {
  const base = name.replace(/[\\/\0]/g, '').trim();
  const cleaned = base
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.'); // ingen '..'
  const truncated = cleaned.slice(0, MAX_FILENAME_LENGTH);
  return truncated.length > 0 ? truncated : 'upload.bin';
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/heic') return 'heic';
  if (m === 'image/heif') return 'heif';
  return 'bin';
}

function isValidFirebaseUid(uid: string): boolean {
  // Firebase UIDs: 1-128 tegn, alfanumerisk (+ evt. dashes fra custom providers).
  // Vi accepterer det brede sæt men afviser path-traversal-tegn.
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

// ---------- Storage helpers ----------------------------------------------

function resolveBucketName(): string | null {
  return (
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    null
  );
}

interface SignedUrls {
  uploadUrl: string;
  downloadUrl: string;
  bucket: string;
  object_path: string;
  upload_expires: Date;
  download_expires: Date;
}

async function createSignedUrls(params: {
  userId: string;
  mime: string;
  filename: string;
}): Promise<SignedUrls> {
  const bucketName = resolveBucketName();
  if (!bucketName) {
    throw new Error('FIREBASE_STORAGE_BUCKET env er ikke sat');
  }

  const app = await getAdminApp();
  // firebase-admin app.storage() returnerer @google-cloud/storage Storage-instans
  const storage = (app as { storage: () => { bucket: (name: string) => unknown } }).storage();
  const bucket = (storage as { bucket: (name: string) => unknown }).bucket(bucketName);

  const safeName = sanitizeFilename(params.filename);
  const ext = extensionFromMime(params.mime);
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `scans/${params.userId}/${timestamp}-${rand}-${safeName}${
    safeName.endsWith(`.${ext}`) ? '' : `.${ext}`
  }`;

  const file = (bucket as { file: (path: string) => unknown }).file(objectPath);

  const uploadExpires = new Date(Date.now() + UPLOAD_URL_TTL_MS);
  const downloadExpires = new Date(Date.now() + DOWNLOAD_URL_TTL_MS);

  const signer = file as {
    getSignedUrl: (opts: {
      version: 'v4';
      action: 'read' | 'write';
      expires: number | Date;
      contentType?: string;
    }) => Promise<[string]>;
  };

  const [uploadUrl] = await signer.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: uploadExpires,
    contentType: params.mime,
  });

  const [downloadUrl] = await signer.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: downloadExpires,
  });

  return {
    uploadUrl,
    downloadUrl,
    bucket: bucketName,
    object_path: objectPath,
    upload_expires: uploadExpires,
    download_expires: downloadExpires,
  };
}

// ---------- Audit-log (best-effort) --------------------------------------

async function auditLog(entry: {
  user_id: string;
  object_path: string;
  bucket: string;
  mime: string;
  filename: string;
  verified: boolean;
}): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    // Tabellen 'storage_uploads' er valgfri — fail-silent hvis den ikke findes.
    const { error } = await sb.from('storage_uploads').insert({
      user_id: entry.user_id,
      object_path: entry.object_path,
      bucket: entry.bucket,
      mime: entry.mime,
      original_filename: entry.filename,
      token_verified: entry.verified,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.warn(`[upload] audit-log skipped: ${error.message}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[upload] audit-log threw: ${msg}`);
  }
}

// ---------- Handler ------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // 1) Method-guard
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    const payload: ErrorResponse = { success: false, error: 'method_not_allowed' };
    return res.status(405).json(payload satisfies ApiResponse);
  }

  // 2) Body-parsing + validering
  const body = parseBody(req.body);
  if (!body) {
    const payload: ErrorResponse = {
      success: false,
      error: 'invalid_body: forventet { mime, filename, user_id } som strings',
    };
    return res.status(400).json(payload satisfies ApiResponse);
  }

  if (!validateMime(body.mime)) {
    const payload: ErrorResponse = {
      success: false,
      error: `unsupported_mime: '${body.mime}'. Tilladt: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`,
    };
    return res.status(400).json(payload satisfies ApiResponse);
  }

  if (!isValidFirebaseUid(body.user_id)) {
    const payload: ErrorResponse = { success: false, error: 'invalid_user_id' };
    return res.status(400).json(payload satisfies ApiResponse);
  }

  // 3) Firebase-token verify (F3.8-pattern).
  //    Kræver at token.uid matcher body.user_id — beskytter mod cross-user upload.
  const verified = await verifyFirebaseToken(req, { requiredUid: body.user_id });
  if (!verified.ok) {
    const payload: ErrorResponse = {
      success: false,
      error: `auth_failed: ${verified.reason}`,
    };
    return res.status(verified.status).json(payload satisfies ApiResponse);
  }

  // Brug det VERIFICEREDE uid (hvis warn_only + intet token: falder tilbage til body.user_id).
  const trustedUid = verified.uid ?? body.user_id;

  // 4) Generér signed URLs
  let signed: SignedUrls;
  try {
    signed = await createSignedUrls({
      userId: trustedUid,
      mime: body.mime,
      filename: body.filename,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[upload] createSignedUrls fejlede: ${msg}`);
    // Manglende bucket / manglende Firebase-credentials = server-config-fejl (500)
    if (/FIREBASE_STORAGE_BUCKET|FIREBASE_SERVICE_ACCOUNT_JSON|FIREBASE_PROJECT_ID/i.test(msg)) {
      const payload: ErrorResponse = { success: false, error: `server_misconfigured: ${msg}` };
      return res.status(500).json(payload satisfies ApiResponse);
    }
    const payload: ErrorResponse = { success: false, error: `signed_url_failed: ${msg}` };
    return res.status(502).json(payload satisfies ApiResponse);
  }

  // 5) Best-effort audit-log (fail-silent, blokerer aldrig response)
  await auditLog({
    user_id: trustedUid,
    object_path: signed.object_path,
    bucket: signed.bucket,
    mime: body.mime,
    filename: body.filename,
    verified: verified.verified,
  });

  // 6) Success
  const payload: SuccessResponse = {
    success: true,
    data: {
      uploadUrl: signed.uploadUrl,
      downloadUrl: signed.downloadUrl,
      object_path: signed.object_path,
      bucket: signed.bucket,
      mime: body.mime,
      expires_at: signed.upload_expires.toISOString(),
      download_expires_at: signed.download_expires.toISOString(),
    },
  };
  return res.status(200).json(payload satisfies ApiResponse);
}
