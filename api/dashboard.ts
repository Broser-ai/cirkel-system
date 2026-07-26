// F1.11 v2 — GET /api/dashboard?firebaseUid=... (eller POST med {firebaseUid})
// Returnerer profil + seneste 10 scans + KPI'er i ÉT kald via get_dashboard RPC.
// Server-side med service-role; aldrig klient.
//
// F3.8 wired: resolveTrustedUid kaldes FØR data-fetch. Scans/rewards filtreres
// på det verificerede Firebase-UID i stedet for det klient-oplyste. I enforce-
// mode blokeres UID-spoofing med 401; i warn_only logges advarslen og
// bagudkompatibiliteten bevares.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getDashboard } from "../lib/cirkel.js";
import { resolveTrustedUid } from "./_verify-firebase-token.js";
import logger from "../src/lib/logger.js";

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

export default async function handler(req: any, res: any) {
  // Klient-oplyst UID (fra query ved GET, body ved POST) — bruges kun som
  // "hint" til resolveTrustedUid; den endelige sandhed er token.uid.
  const clientProvidedUid = req.method === "GET"
    ? (req.query?.firebaseUid || "").toString().trim()
    : (req.body?.firebaseUid || "").toString().trim();

  if (!clientProvidedUid) {
    return res.status(400).json({ error: "firebaseUid er påkrævet." });
  }

  // F3.8 — verificér Bearer-token FØR nogen data-fetch.
  // Enforce-mode: kaster ved manglende/mismatch → 401 UID_SPOOF_DETECTED.
  // Warn_only-mode: returnerer verified=false → log advarsel, fortsæt med
  //   det klient-oplyste UID (bagudkompat under gradvis udrulning).
  let trustedUid: string;
  try {
    const verified = await resolveTrustedUid(req, clientProvidedUid);
    if (!verified || !verified.trusted_uid) {
      logger.warn('[F3.8] dashboard: resolveTrustedUid returnerede intet UID — fortsætter i warn_only med klient-UID');
      trustedUid = clientProvidedUid;
    } else {
      if (!verified.verified) {
        logger.warn('[F3.8] dashboard warn_only: token IKKE verificeret. Fortsætter med klient-UID', { reason: verified.reason });
      } else if (verified.spoofed) {
        logger.warn('[F3.8] dashboard warn_only: UID-spoof detekteret. Bruger token-UID', { reason: verified.reason });
      }
      trustedUid = verified.trusted_uid;
    }
  } catch (err: any) {
    // Enforce-mode har blokeret — token mangler, invalid, eller UID mismatcher.
    const status = err?.status ?? 401;
    logger.error('[F3.8] dashboard enforce: blokerede request', err, { reason: err?.reason });
    return res.status(status).json({
      error: "UID_SPOOF_DETECTED",
      detail: err?.reason ?? err?.message ?? "Firebase-token verifikation fejlede.",
    });
  }

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });
  }

  try {
    // Filtrer scans/rewards på det VERIFICEREDE UID — ikke det klient-oplyste.
    const data = await getDashboard(sb, trustedUid);
    return res.status(200).json({ success: true, ...data });
  } catch (err: any) {
    logger.error('get_dashboard fejlede', err);
    return res.status(500).json({ error: "Kunne ikke hente dashboard: " + err.message });
  }
}
