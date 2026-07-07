// F2.3 — GET /api/rewards
// Katalog over rewards (offentligt synligt; indløsning kræver firebaseUid via /api/redeem).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getRewards } from "../lib/cirkel.js";

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
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });
  try {
    const rewards = await getRewards(sb);
    return res.status(200).json({ success: true, rewards });
  } catch (err: any) {
    console.error("get_rewards fejlede:", err?.message);
    return res.status(500).json({ error: "Kunne ikke hente rewards: " + err.message });
  }
}
