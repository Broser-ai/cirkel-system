// F2.3 — POST /api/redeem  body: { firebaseUid, rewardId }
// Indløser reward — trækker spendable_points, lifetime_points bevares (tier intakt).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { redeemReward } from "../lib/cirkel.js";

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
  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });
  try {
    const result = await redeemReward(sb, firebaseUid, rewardId);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error("redeem_reward fejlede:", err?.message);
    return res.status(400).json({ error: err.message });
  }
}
