// F3 — GET/POST portal-features flags
// GET: åben, alle kan læse (service-role kalder get_portal_features RPC)
// POST body {firebaseUid, business_custom_content, kommune_custom_content}:
//   Kalder set_portal_features RPC som verificerer admin-rolle server-side.
//   INGEN service-role i frontend.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "Supabase service-role-nøgle ikke konfigureret." });

  if (req.method === "GET") {
    try {
      const { data, error } = await sb.rpc("get_portal_features");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return res.status(200).json({
        success: true,
        features: row || { business_custom_content: false, kommune_custom_content: false },
      });
    } catch (err: any) {
      console.error("get_portal_features fejlede:", err?.message);
      return res.status(500).json({ error: "Kunne ikke hente feature-flags." });
    }
  }

  if (req.method === "POST") {
    const { firebaseUid, business_custom_content, kommune_custom_content } = req.body || {};
    if (!firebaseUid) {
      return res.status(401).json({ error: "firebaseUid påkrævet." });
    }
    try {
      const { data, error } = await sb.rpc("set_portal_features", {
        p_firebase_uid: firebaseUid,
        p_business_custom_content: !!business_custom_content,
        p_kommune_custom_content: !!kommune_custom_content,
      });
      if (error) {
        if (String(error.message).toLowerCase().includes("forbidden")) {
          return res.status(403).json({ error: "Kun admin må ændre feature-flags." });
        }
        throw error;
      }
      return res.status(200).json({ success: true, features: data });
    } catch (err: any) {
      console.error("set_portal_features fejlede:", err?.message);
      return res.status(500).json({ error: "Kunne ikke opdatere feature-flags." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
