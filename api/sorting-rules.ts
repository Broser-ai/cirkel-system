// F4.2 — GET /api/sorting-rules?postnr=8000  eller  ?kommune=Aarhus
// Returnerer kommune-specifikke sorteringsregler for de 6 cirkel-materialer.

import { rulesFor, listKommuner } from "./_sorting-rules-dk.js";
import { kommuneFromPostnr } from "./_dawa.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { postnr, kommune } = req.query || {};
  let resolved = (kommune || "").toString().trim();
  let source: "postnr" | "kommune" | "default" = "default";

  if (postnr && !resolved) {
    const fromDawa = await kommuneFromPostnr(postnr.toString());
    if (fromDawa) { resolved = fromDawa; source = "postnr"; }
  } else if (resolved) {
    source = "kommune";
  }

  if (!resolved) {
    return res.status(200).json({
      success: true,
      source: "default",
      kommune: null,
      rules: rulesFor(""),
      hint: "Angiv ?postnr=8000 eller ?kommune=Aarhus for kommune-specifikke regler.",
      supportedKommuner: listKommuner(),
    });
  }

  return res.status(200).json({
    success: true,
    source,
    kommune: resolved,
    rules: rulesFor(resolved),
    supportedKommuner: listKommuner(),
  });
}
