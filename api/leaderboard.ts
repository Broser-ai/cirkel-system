// F2.4 — GET /api/leaderboard?limit=10
// Top-N brugere efter lifetime_points (kun fornavn returneres af RPC for privacy).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getLeaderboard } from "../lib/cirkel.js";

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
  const limit = Math.min(Math.max(Number(req.query?.limit) || 10, 1), 100);
  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });
  try {
    const entries = await getLeaderboard(sb, limit);
    return res.status(200).json({ success: true, leaderboard: entries });
  } catch (err: any) {
    console.error("get_leaderboard fejlede:", err?.message);
    return res.status(500).json({ error: "Kunne ikke hente leaderboard: " + err.message });
  }
}
