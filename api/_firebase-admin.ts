// cirkel-system/api/_firebase-admin.ts
//
// F3.8: Server-side Firebase Admin helper.
// Lazy-loader firebase-admin så modulet kun installeres/loades på server.
//
// SIKKERHED: service account credentials læses FRA env:
//   - FIREBASE_SERVICE_ACCOUNT_JSON (hele JSON'en som string)
//   - eller FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
// Aldrig hardcoded, aldrig committed.

// Bruger `any` typer så modulet ikke fejler build hvis firebase-admin ikke
// endnu er installeret som dep — det loades dynamisk.
type AdminApp = any;
type AdminAuth = any;

let cachedApp: AdminApp | null = null;
let cachedAdminModule: any = null;

async function loadAdminModule(): Promise<any> {
  if (cachedAdminModule) return cachedAdminModule;
  try {
    // Dynamic import — bygges kun hvis modul findes ved runtime
    const mod = await import('firebase-admin');
    cachedAdminModule = (mod as any).default ?? mod;
    return cachedAdminModule;
  } catch (err: any) {
    throw new Error(
      `firebase-admin ikke installeret (${err?.message ?? err}). ` +
      `Kør 'npm install firebase-admin' i cirkel-system for at aktivere F3.8.`
    );
  }
}

function buildServiceAccountFromEnv(): any | null {
  // Prioritet 1: hele JSON'en som string
  const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonStr) {
    try {
      return JSON.parse(jsonStr);
    } catch (err: any) {
      console.error('[_firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON kunne ikke parses:', err?.message);
      return null;
    }
  }
  // Prioritet 2: individuelle felter
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),  // Vercel escaper newlines
    };
  }
  return null;
}

export async function getAdminApp(): Promise<AdminApp> {
  if (cachedApp) return cachedApp;
  const admin = await loadAdminModule();

  // Genbrug eksisterende app hvis initialiseret (fx via Vercel warm-start)
  if (admin.apps && admin.apps.length > 0) {
    cachedApp = admin.apps[0];
    return cachedApp;
  }

  const serviceAccount = buildServiceAccountFromEnv();
  if (!serviceAccount) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON eller FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY mangler. ' +
      'F3.8 server-verify kan ikke aktiveres uden service account credentials.'
    );
  }

  cachedApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return cachedApp;
}

export async function getAdminAuth(): Promise<AdminAuth> {
  const app = await getAdminApp();
  return app.auth();
}

/** Reset cache — bruges i tests. IKKE til produktion. */
export function _resetForTests(): void {
  cachedApp = null;
  cachedAdminModule = null;
}

export function isAdminAvailable(): boolean {
  return cachedAdminModule !== null;
}
