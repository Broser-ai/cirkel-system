// F1.11 v2 — GET /api/dashboard?firebaseUid=... (eller POST med {firebaseUid})
// Returnerer profil + seneste 10 scans + KPI'er i ÉT kald via get_dashboard RPC.
// Server-side med service-role; aldrig klient.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getDashboard } from "../lib/cirkel.js";

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
  const firebaseUid = req.method === "GET"
    ? (req.query?.firebaseUid || "").toString().trim()
    : (req.body?.firebaseUid || "").toString().trim();

  if (!firebaseUid) {
    return res.status(400).json({ error: "firebaseUid er påkrævet." });
  }

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });
  }

  try {
    const data = await getDashboard(sb, firebaseUid);
    return res.status(200).json({ success: true, ...data });
  } catch (err: any) {
    console.error("get_dashboard fejlede:", err?.message);
    return res.status(500).json({ error: "Kunne ikke hente dashboard: " + err.message });
  }
}
