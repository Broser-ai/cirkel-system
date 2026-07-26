// cirkel-system/tests/upload.test.ts
//
// Vitest-suite for POST /api/upload (api/upload.ts).
//
// Fokus (jf. F3.9 kontrakt):
//   * Signed URL-generering (v4, write + read) via Firebase Storage-mock.
//   * `expires_at` og `download_expires_at` — eksakt ISO-8601, deterministisk
//     via vi.useFakeTimers() (upload TTL = 15 min, download TTL = 60 min).
//   * MIME-whitelist (accept / reject / case-insensitivity).
//   * Body-validering, user_id-format, F3.8-auth-guard, method-guard.
//   * Filnavn-sanitizering (path-traversal beskyttelse).
//   * Fejlveje: mangende bucket-env (500), signer throw (502).
//
// Alle eksterne afhængigheder (firebase-admin, verifyFirebaseToken, Supabase)
// mockes lokalt + via ./tests/setup — ingen live network-calls, deterministisk.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Lokale mocks (hoisted af vitest) ─────────────────────────────────────────

vi.mock('../api/_verify-firebase-token.js', () => ({
  verifyFirebaseToken: vi.fn(),
}));

vi.mock('../api/_firebase-admin.js', () => ({
  getAdminApp: vi.fn(),
}));

// ─── Imports (efter vi.mock; hoisting sikrer at upload.ts også får mocks) ─────
import handler from '../api/upload.js';
import { verifyFirebaseToken } from '../api/_verify-firebase-token.js';
import { getAdminApp } from '../api/_firebase-admin.js';
import { testUser, _getStore } from './setup.js';

// ─── Konstanter (skal matche api/upload.ts) ───────────────────────────────────
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000; // 15 min
const DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000; // 60 min
const FIXED_NOW_ISO = '2026-07-22T12:00:00.000Z';
const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);
const EXPECTED_UPLOAD_EXPIRES_ISO = new Date(FIXED_NOW_MS + UPLOAD_URL_TTL_MS).toISOString();
const EXPECTED_DOWNLOAD_EXPIRES_ISO = new Date(FIXED_NOW_MS + DOWNLOAD_URL_TTL_MS).toISOString();
const TEST_BUCKET = 'cirkel-test.appspot.com';
const UPLOAD_URL_STUB = 'https://storage.googleapis.com/cirkel-test.appspot.com/UPLOAD?sig=WRITE';
const DOWNLOAD_URL_STUB = 'https://storage.googleapis.com/cirkel-test.appspot.com/DOWNLOAD?sig=READ';

// ─── Test-app wrapper (supertest → express → handler) ─────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.all('/api/upload', (req, res) => handler(req as any, res as any));
  return app;
}

// ─── Fabrik: firebase-admin App-stub der matcher app.storage().bucket(...).file(...).getSignedUrl(...) ─
interface AdminMockOptions {
  uploadUrl?: string;
  downloadUrl?: string;
  throwOn?: 'read' | 'write' | 'both';
  throwMessage?: string;
}
function makeAdminApp(opts: AdminMockOptions = {}) {
  const getSignedUrl = vi.fn(async (o: { action: 'read' | 'write'; expires: Date | number; contentType?: string }) => {
    const msg = opts.throwMessage ?? 'signed_url_backend_down';
    if (opts.throwOn === 'both') throw new Error(msg);
    if (opts.throwOn === 'write' && o.action === 'write') throw new Error(msg);
    if (opts.throwOn === 'read' && o.action === 'read') throw new Error(msg);
    const url = o.action === 'write' ? opts.uploadUrl ?? UPLOAD_URL_STUB : opts.downloadUrl ?? DOWNLOAD_URL_STUB;
    return [url] as [string];
  });
  const file = vi.fn(() => ({ getSignedUrl }));
  const bucket = vi.fn(() => ({ file }));
  const storage = vi.fn(() => ({ bucket }));
  const app = { storage };
  return { app, storage, bucket, file, getSignedUrl };
}

// ─── Globale defaults pr. test ────────────────────────────────────────────────
beforeEach(() => {
  // Deterministisk tid — nødvendigt for at asserte exact expires_at ISO-strings.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW_ISO));

  // Standard: verify-token er "ok, verified, uid matcher body.user_id".
  vi.mocked(verifyFirebaseToken).mockResolvedValue({
    ok: true,
    uid: testUser.firebase_uid,
    verified: true,
    mode: 'enforce',
    status: 200,
    reason: 'F3.8: token verified + uid match',
  });

  // Standard: firebase-admin storage returnerer signed URLs uden fejl.
  const admin = makeAdminApp();
  vi.mocked(getAdminApp).mockResolvedValue(admin.app as any);

  // Standard: bucket-env er sat.
  process.env.FIREBASE_STORAGE_BUCKET = TEST_BUCKET;
  delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  delete process.env.VITE_FIREBASE_STORAGE_BUCKET;
});

afterEach(() => {
  vi.useRealTimers();
});

// Standard happy-path body — genbruges i flere tests.
const VALID_BODY = {
  mime: 'image/jpeg',
  filename: 'foto.jpg',
  user_id: testUser.firebase_uid,
};

// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/upload — F3.9 signed URL generator', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1) Happy-path
  // ───────────────────────────────────────────────────────────────────────────
  describe('happy-path — signed URL generation', () => {
    it('returnerer success + fulde signed URLs + object_path + bucket + mime', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', 'Bearer valid-token')
        .send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          uploadUrl: UPLOAD_URL_STUB,
          downloadUrl: DOWNLOAD_URL_STUB,
          object_path: expect.stringMatching(
            new RegExp(`^scans/${testUser.firebase_uid}/\\d+-[a-z0-9]{1,8}-foto\\.jpg$`),
          ),
          bucket: TEST_BUCKET,
          mime: 'image/jpeg',
          expires_at: EXPECTED_UPLOAD_EXPIRES_ISO,
          download_expires_at: EXPECTED_DOWNLOAD_EXPIRES_ISO,
        },
      });

      // verifyFirebaseToken skal være kaldt med requiredUid = body.user_id
      expect(vi.mocked(verifyFirebaseToken)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(verifyFirebaseToken).mock.calls[0][1]).toEqual({
        requiredUid: testUser.firebase_uid,
      });
    });

    it('kalder getSignedUrl to gange — write (upload) og read (download) — med korrekt contentType', async () => {
      const admin = makeAdminApp();
      vi.mocked(getAdminApp).mockResolvedValueOnce(admin.app as any);

      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, mime: 'image/png', filename: 'billede.png' });

      expect(res.status).toBe(200);
      expect(admin.getSignedUrl).toHaveBeenCalledTimes(2);

      // Write-kaldet inkluderer contentType og udløber om 15 min.
      const writeCall = admin.getSignedUrl.mock.calls.find((c) => c[0].action === 'write');
      expect(writeCall).toBeDefined();
      expect(writeCall![0]).toMatchObject({
        version: 'v4',
        action: 'write',
        contentType: 'image/png',
      });
      expect(writeCall![0].expires).toBeInstanceOf(Date);
      expect((writeCall![0].expires as Date).toISOString()).toBe(EXPECTED_UPLOAD_EXPIRES_ISO);

      // Read-kaldet har INGEN contentType og udløber om 60 min.
      const readCall = admin.getSignedUrl.mock.calls.find((c) => c[0].action === 'read');
      expect(readCall).toBeDefined();
      expect(readCall![0]).toMatchObject({ version: 'v4', action: 'read' });
      expect(readCall![0].contentType).toBeUndefined();
      expect((readCall![0].expires as Date).toISOString()).toBe(EXPECTED_DOWNLOAD_EXPIRES_ISO);
    });

    it('bruger korrekt bucket-navn fra FIREBASE_STORAGE_BUCKET env', async () => {
      process.env.FIREBASE_STORAGE_BUCKET = 'custom-bucket.appspot.com';
      const admin = makeAdminApp();
      vi.mocked(getAdminApp).mockResolvedValueOnce(admin.app as any);

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.data.bucket).toBe('custom-bucket.appspot.com');
      expect(admin.bucket).toHaveBeenCalledWith('custom-bucket.appspot.com');
    });

    it('audit-logger uploaden til Supabase storage_uploads-tabellen (best-effort)', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);

      // In-memory Supabase-stub fra tests/setup.ts skulle have modtaget insert.
      const store = _getStore();
      const uploads = (store as any).storage_uploads ?? [];
      expect(uploads.length).toBe(1);
      expect(uploads[0]).toMatchObject({
        user_id: testUser.firebase_uid,
        bucket: TEST_BUCKET,
        mime: 'image/jpeg',
        original_filename: 'foto.jpg',
        token_verified: true,
      });
      expect(uploads[0].object_path).toMatch(
        new RegExp(`^scans/${testUser.firebase_uid}/`),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) expires_at — deterministisk ISO-8601
  // ───────────────────────────────────────────────────────────────────────────
  describe('expires_at — deterministisk ISO-8601 fra fake timer', () => {
    it('sætter expires_at nøjagtigt 15 minutter frem i tiden', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.data.expires_at).toBe(EXPECTED_UPLOAD_EXPIRES_ISO);

      // Differencen mod NOW skal være præcis 900_000 ms.
      const diff = Date.parse(res.body.data.expires_at) - FIXED_NOW_MS;
      expect(diff).toBe(UPLOAD_URL_TTL_MS);
    });

    it('sætter download_expires_at nøjagtigt 60 minutter frem i tiden', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.data.download_expires_at).toBe(EXPECTED_DOWNLOAD_EXPIRES_ISO);

      const diff = Date.parse(res.body.data.download_expires_at) - FIXED_NOW_MS;
      expect(diff).toBe(DOWNLOAD_URL_TTL_MS);
    });

    it('download_expires_at ligger 45 minutter EFTER expires_at (upload)', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      const uploadMs = Date.parse(res.body.data.expires_at);
      const downloadMs = Date.parse(res.body.data.download_expires_at);
      expect(downloadMs - uploadMs).toBe(45 * 60 * 1000);
    });

    it('bruger ISO-8601 UTC-format ("Z"-suffix, ikke lokal tidszone)', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.data.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(res.body.data.download_expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) MIME-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('MIME-validering', () => {
    it.each([
      ['image/jpeg'],
      ['image/jpg'],
      ['image/png'],
      ['image/webp'],
      ['image/heic'],
      ['image/heif'],
    ])('accepterer whitelistet MIME: %s', async (mime) => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, mime, filename: 'a.bin' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mime).toBe(mime);
    });

    it('accepterer MIME case-insensitivt (IMAGE/JPEG → 200)', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, mime: 'IMAGE/JPEG' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // handler'en returnerer body.mime som den kom ind (validering er lower-case-normaliseret)
      expect(res.body.data.mime).toBe('IMAGE/JPEG');
    });

    it.each([
      ['image/gif'],
      ['application/pdf'],
      ['image/svg+xml'],
      ['video/mp4'],
      ['text/html'],
      ['application/octet-stream'],
    ])('afviser ikke-whitelistet MIME med 400: %s', async (mime) => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, mime });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/^unsupported_mime: /);
      // firebase-admin må ALDRIG kaldes når MIME afvises
      expect(vi.mocked(getAdminApp)).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) Body-validering
  // ───────────────────────────────────────────────────────────────────────────
  describe('body-validering', () => {
    it('returnerer 400 når mime mangler', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ filename: 'foto.jpg', user_id: testUser.firebase_uid });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'invalid_body: forventet { mime, filename, user_id } som strings',
      });
    });

    it('returnerer 400 når filename mangler', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ mime: 'image/jpeg', user_id: testUser.firebase_uid });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/^invalid_body:/);
    });

    it('returnerer 400 når user_id mangler', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ mime: 'image/jpeg', filename: 'foto.jpg' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/^invalid_body:/);
    });

    it('returnerer 400 når body er null / helt tom', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/upload').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returnerer 400 når felter er non-string (fx tal)', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ mime: 123, filename: 'foto.jpg', user_id: testUser.firebase_uid });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/^invalid_body:/);
    });

    it('afviser user_id med path-traversal-tegn (400 invalid_user_id)', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, user_id: '../../../etc/passwd' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'invalid_user_id' });
      // Firebase-admin må ikke kaldes ved ugyldigt user_id
      expect(vi.mocked(getAdminApp)).not.toHaveBeenCalled();
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
    });

    it('afviser user_id længere end 128 tegn (400 invalid_user_id)', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, user_id: 'a'.repeat(129) });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'invalid_user_id' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) Method-guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('method-guard', () => {
    it('afviser GET med 405 og Allow: POST header', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/upload');

      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('POST');
      expect(res.body).toEqual({ success: false, error: 'method_not_allowed' });
      // Ingen sideeffekter
      expect(vi.mocked(verifyFirebaseToken)).not.toHaveBeenCalled();
      expect(vi.mocked(getAdminApp)).not.toHaveBeenCalled();
    });

    it('afviser PUT med 405', async () => {
      const app = buildApp();
      const res = await request(app).put('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) F3.8 auth-guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3.8 auth-guard', () => {
    it('returnerer 401 auth_failed når verifyFirebaseToken returnerer ok=false', async () => {
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: false,
        uid: null,
        verified: false,
        mode: 'enforce',
        status: 401,
        reason: 'Missing Authorization Bearer token',
      });

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'auth_failed: Missing Authorization Bearer token',
      });
      // Firebase-admin må ALDRIG kaldes når auth fejler
      expect(vi.mocked(getAdminApp)).not.toHaveBeenCalled();
    });

    it('returnerer 403 når verifyFirebaseToken rapporterer spoof', async () => {
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: false,
        uid: 'attacker-uid',
        verified: true,
        mode: 'enforce',
        status: 403,
        reason: 'UID_SPOOF_DETECTED: token.uid="attacker" != body.user_id="victim"',
      });

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/^auth_failed: UID_SPOOF_DETECTED/);
      expect(vi.mocked(getAdminApp)).not.toHaveBeenCalled();
    });

    it('bruger uid fra verify-resultatet (trusted) til objektstien — ikke body.user_id', async () => {
      // verify returnerer et ANDET (verificeret) uid end body.user_id.
      vi.mocked(verifyFirebaseToken).mockResolvedValueOnce({
        ok: true,
        uid: 'trusted-uid-from-token',
        verified: true,
        mode: 'enforce',
        status: 200,
        reason: 'ok',
      });

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      // object_path skal bygges med det VERIFICEREDE uid, ikke body.user_id.
      expect(res.body.data.object_path).toMatch(/^scans\/trusted-uid-from-token\//);
      expect(res.body.data.object_path).not.toContain(testUser.firebase_uid);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) Filnavn-sanitizering (path-traversal beskyttelse)
  // ───────────────────────────────────────────────────────────────────────────
  describe('filnavn-sanitizering', () => {
    it('fjerner path-separatorer og "../" fra filnavn i object_path', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, filename: '../../etc/passwd.jpg' });

      expect(res.status).toBe(200);
      const path: string = res.body.data.object_path;

      // Objektstien MÅ IKKE indeholde ".." (kun præfixet "scans/<uid>/" må have slashes)
      const filenamePart = path.substring(`scans/${testUser.firebase_uid}/`.length);
      expect(filenamePart).not.toContain('..');
      expect(filenamePart).not.toContain('/');
      expect(filenamePart).not.toContain('\\');
      // Extension er stadig .jpg
      expect(path.endsWith('.jpg')).toBe(true);
    });

    it('fjerner null-bytes fra filnavn', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, filename: 'foto malicious.jpg' });

      expect(res.status).toBe(200);
      expect(res.body.data.object_path).not.toContain(' ');
      expect(res.body.data.object_path).toMatch(/-fotomalicious\.jpg$/);
    });

    it('erstatter whitespace med "-" og fjerner ikke-alfanumeriske tegn', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, filename: 'my scan (v2)!.jpg' });

      expect(res.status).toBe(200);
      // "my scan (v2)!.jpg" → whitespace→"-", "(" og ")" og "!" strippet → "my-scan-v2.jpg"
      expect(res.body.data.object_path).toMatch(/-my-scan-v2\.jpg$/);
    });

    it('tilføjer korrekt extension når filnavn mangler den (image/png → .png)', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, mime: 'image/png', filename: 'billede' });

      expect(res.status).toBe(200);
      expect(res.body.data.object_path).toMatch(/-billede\.png$/);
    });

    it('falder tilbage til "upload.bin" når filnavn saniteres væk til tomt', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/upload')
        .send({ ...VALID_BODY, filename: '/// ///' });

      expect(res.status).toBe(200);
      // safeName bliver 'upload.bin' (fallback); ext for image/jpeg = 'jpg' → suffix '.jpg' tilføjes
      expect(res.body.data.object_path).toMatch(/-upload\.bin\.jpg$/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8) Storage-konfiguration & signer-fejl
  // ───────────────────────────────────────────────────────────────────────────
  describe('storage-konfiguration & fejlveje', () => {
    it('returnerer 500 server_misconfigured når FIREBASE_STORAGE_BUCKET mangler', async () => {
      delete process.env.FIREBASE_STORAGE_BUCKET;
      delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      delete process.env.VITE_FIREBASE_STORAGE_BUCKET;

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/^server_misconfigured: FIREBASE_STORAGE_BUCKET/);
    });

    it('returnerer 502 signed_url_failed når getSignedUrl (write) throw', async () => {
      const admin = makeAdminApp({ throwOn: 'write', throwMessage: 'gcs auth token expired' });
      vi.mocked(getAdminApp).mockResolvedValueOnce(admin.app as any);

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        success: false,
        error: 'signed_url_failed: gcs auth token expired',
      });
    });

    it('returnerer 502 signed_url_failed når getSignedUrl (read) throw', async () => {
      const admin = makeAdminApp({ throwOn: 'read', throwMessage: 'read signer down' });
      vi.mocked(getAdminApp).mockResolvedValueOnce(admin.app as any);

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('signed_url_failed: read signer down');
    });

    it('falder tilbage til NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET når primær env mangler', async () => {
      delete process.env.FIREBASE_STORAGE_BUCKET;
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'fallback-bucket.appspot.com';

      const admin = makeAdminApp();
      vi.mocked(getAdminApp).mockResolvedValueOnce(admin.app as any);

      const app = buildApp();
      const res = await request(app).post('/api/upload').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.data.bucket).toBe('fallback-bucket.appspot.com');
      expect(admin.bucket).toHaveBeenCalledWith('fallback-bucket.appspot.com');
    });
  });
});
