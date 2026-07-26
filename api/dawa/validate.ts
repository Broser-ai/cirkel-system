// cirkel-system/api/dawa/validate.ts
//
// F4.2 — DAWA-adresse validation endpoint.
//
//   GET /api/dawa/validate?address=<fritekst>&zip=<4-cifret postnr>
//
// Formål:
//   Ét single-shot lookup der returnerer den DAWA-verificerede kommune for et
//   givet postnummer og/eller fritekst-adresse. Bruges af Cirkel-frontenden
//   under onboarding (sortering-guide + kommunespecifikke regler) og af B2B-
//   portalen (adresse-validering ved producenter/aftagere).
//
// Fallback-strategi:
//   1) Primær   → _dawa-v2.lookupAddress(...)
//                 sekventiel chain:
//                   a. api.dataforsyningen.dk       (df-v2, primær)
//                   b. dawa.aws.dk                  (dawa-legacy, dødsdato
//                                                    2026-08-17)
//                   c. embedded 15-kommune subset   (in-file constant)
//   2) Fallback → _dawa-cached.lookupByPostcode(zip)
//                 static 15-kommune snapshot (inkl. Viborg + sorterings-URL).
//                 Bruges når _dawa-v2 returnerede null (fx tvivlsomme
//                 adresser + hvor dawa.aws.dk er lukket ned).
//
// F3.8:
//   Firebase-UID verifikation via `resolveTrustedUid` er wired ind, men KUN
//   aktiveret hvis `firebaseUid` er tilstede i query-string. Anonyme
//   validerings-opslag (fx public sorteringsside) springer verify over —
//   samme mønster som `api/scan.ts` bruger til anonyme scans.
//
// Response-kontrakt:
//   { success: true, data: {...} }       — 200
//   { success: false, error, detail? }   — 400 | 401 | 404 | 405 | 500

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveTrustedUid } from '../_verify-firebase-token.js';
import { lookupAddress, type AddressResult } from '../_dawa-v2.js';
import { lookupByPostcode, type CachedKommune } from '../_dawa-cached.js';

// ─────────────────────────────────────────────────────────────
// Typer — public response shape (ingen 'any')
// ─────────────────────────────────────────────────────────────

type ResolvedSource = AddressResult['source'] | 'cached-static';

interface ValidateData {
  kommune_navn: string;
  kommune_kode: string;
  postcode: string;
  address_input: string | null;
  source: ResolvedSource;
  sorting_rules_url?: string;
}

interface SuccessResponse {
  success: true;
  data: ValidateData;
}

interface ErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

type ValidateResponse = SuccessResponse | ErrorResponse;

// ─────────────────────────────────────────────────────────────
// Supabase — lazy service-role klient (samme mønster som api/scan.ts)
// ─────────────────────────────────────────────────────────────
//
// Klienten reserveres til fremtidig persistering af kommune-lookups i
// `sovereign_ledger` (revision-safe DPIA-trail). Endpointet fungerer 100%
// uden Supabase-env — så lokal dev og preview-branches uden secrets kan
// stadig kalde /api/dawa/validate.

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ─────────────────────────────────────────────────────────────
// Query-helpers (Vercel giver string | string[] | undefined)
// ─────────────────────────────────────────────────────────────

function firstQueryValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' ? v : undefined;
}

function normalizeZip(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d{4}$/.test(trimmed) ? trimmed : null;
}

function normalizeAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Typed err→message uden 'any' cast.
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Ukendt fejl';
}

function errStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

function errReason(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'reason' in err) {
    const r = (err as { reason?: unknown }).reason;
    if (typeof r === 'string') return r;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Method-guard
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    const body: ValidateResponse = {
      success: false,
      error: 'Method not allowed',
      detail: `Kun GET er understøttet. Modtaget: ${req.method ?? 'unknown'}`,
    };
    res.status(405).json(body);
    return;
  }

  const address = normalizeAddress(firstQueryValue(req.query.address));
  const zip = normalizeZip(firstQueryValue(req.query.zip));

  if (!address && !zip) {
    const body: ValidateResponse = {
      success: false,
      error: 'BAD_REQUEST',
      detail: 'Enten "address" eller "zip" (4-cifret postnummer) skal angives.',
    };
    res.status(400).json(body);
    return;
  }

  // ───────────────────────────────────────────────────────────
  // F3.8 — resolveTrustedUid FØR opslag (kun hvis firebaseUid oplyst)
  //   • enforce-mode: kaster hvis token mangler/mismatcher → 401
  //   • warn_only-mode: logger advarsel, fortsætter med opslag
  //   • anonymt (ingen firebaseUid): springes over — samme mønster som scan.ts
  // ───────────────────────────────────────────────────────────
  const clientProvidedUid = normalizeAddress(firstQueryValue(req.query.firebaseUid));
  if (clientProvidedUid) {
    try {
      const verify = await resolveTrustedUid(req, clientProvidedUid);
      if (verify.spoofed) {
        console.warn('[F3.8] dawa/validate warn_only: spoof detected', {
          clientProvidedUid,
          trustedUid: verify.trusted_uid,
          reason: verify.reason,
        });
      } else if (!verify.verified) {
        console.warn('[F3.8] dawa/validate warn_only: ingen crypto-verify', {
          reason: verify.reason,
        });
      }
    } catch (err: unknown) {
      const status = errStatus(err) ?? 401;
      const reason = errReason(err) ?? errMessage(err);
      console.error('[F3.8] dawa/validate enforce: BLOKERET', { status, reason });
      const body: ValidateResponse = {
        success: false,
        error: 'UID_SPOOF_DETECTED',
        detail: reason,
      };
      res.status(status).json(body);
      return;
    }
  }

  // Supabase-handle er reserveret til fremtidig persistering — lazy init
  // sikrer at endpointet fungerer selv uden service-role-env i lokal dev.
  const sb = getSupabase();
  void sb;

  try {
    // 1) PRIMÆR — _dawa-v2 chain (df-v2 → dawa-legacy → embedded subset)
    const remote: AddressResult | null = await lookupAddress({
      address: address ?? undefined,
      postcode: zip ?? undefined,
    });

    if (remote) {
      const body: ValidateResponse = {
        success: true,
        data: {
          kommune_navn: remote.kommune_navn,
          kommune_kode: remote.kommune_kode,
          postcode: remote.postcode || zip || '',
          address_input: address,
          source: remote.source,
        },
      };
      res.status(200).json(body);
      return;
    }

    // 2) FALLBACK — _dawa-cached (15-kommune static snapshot)
    //    Kun mulig når vi har et gyldigt postnummer, da cache er postnr-indekseret.
    if (zip) {
      const cached: CachedKommune | null = lookupByPostcode(zip);
      if (cached) {
        const body: ValidateResponse = {
          success: true,
          data: {
            kommune_navn: cached.kommune_navn,
            kommune_kode: cached.kommune_kode,
            postcode: zip,
            address_input: address,
            source: 'cached-static',
            sorting_rules_url: cached.sorting_rules_url,
          },
        };
        res.status(200).json(body);
        return;
      }
    }

    // Intet fundet — hverken remote eller cache.
    const notFound: ValidateResponse = {
      success: false,
      error: 'NOT_FOUND',
      detail: `Ingen kommune fundet for input (address="${address ?? ''}", zip="${zip ?? ''}").`,
    };
    res.status(404).json(notFound);
  } catch (err: unknown) {
    console.error('[dawa/validate] lookup fejlede', err);
    const body: ValidateResponse = {
      success: false,
      error: 'INTERNAL_ERROR',
      detail: errMessage(err),
    };
    res.status(500).json(body);
  }
}
