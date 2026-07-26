// F2.3 — POST /api/redeem  body: { firebaseUid, rewardId }
// Indløser reward — trækker spendable_points, lifetime_points bevares (tier intakt).
//
// F3.8: server-side Firebase ID-token verifikation FØR redeem_reward RPC.
//       Reward-integritet: klienten kan ikke længere frit indløse på fremmed UID.
//       Wired via resolveTrustedUid() — samme kontrakt som case.ts m.fl.
//         - enforce-mode: kaster → 401 { error: 'UID_SPOOF_DETECTED' }
//         - warn_only-mode: pass-through, logges så mismatch stadig er synlig
//       Det TRUSTED uid videregives til RPC'en (ikke det rå body-UID).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { redeemReward } from "../lib/cirkel.js";
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { firebaseUid, rewardId } = req.body || {};
  if (!firebaseUid || !rewardId) {
    return res.status(400).json({ error: "firebaseUid og rewardId er påkrævet." });
  }

  // F3.8 — verificér Firebase ID-token FØR RPC-kald. Reward-integritet.
  let trustedUid: string = firebaseUid;
  let firebaseVerified = false;
  try {
    const verified = await resolveTrustedUid(req, firebaseUid);
    if (verified && verified.trusted_uid) {
      trustedUid = verified.trusted_uid;
      firebaseVerified = verified.verified;
      if (!verified.verified) {
        // warn_only: ingen gyldig token eller mismatch, men mode tillader pass-through
        logger.warn('[F3.8][redeem] warn_only pass-through', { rewardId, uid: firebaseUid, reason: verified.reason });
      }
    } else {
      // Defensivt: hvis wrapperen skulle returnere falsy — behandl som warn_only pass-through
      logger.warn('[F3.8][redeem] warn_only pass-through — ingen verify-resultat, bruger body-UID', { rewardId });
    }
  } catch (err: any) {
    // enforce-mode: kastet af resolveTrustedUid ved manglende/ugyldig token eller UID-mismatch
    const status = typeof err?.status === "number" ? err.status : 401;
    const reason = typeof err?.reason === "string" ? err.reason : err?.message;
    logger.warn('[F3.8][redeem] UID_SPOOF_DETECTED', { rewardId, reason });
    return res.status(status === 403 ? 403 : 401).json({
      error: "UID_SPOOF_DETECTED",
      detail: reason,
    });
  }

  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });

  try {
    const result = await redeemReward(sb, trustedUid, rewardId);
    return res.status(200).json({
      success: true,
      ...result,
      auth: { firebase_verified: firebaseVerified, trusted_uid: trustedUid },
    });
  } catch (err: any) {
    logger.error('redeem_reward fejlede', err);
    return res.status(400).json({ error: err.message });
  }
}
