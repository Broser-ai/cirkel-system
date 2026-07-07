// Bestemmer rækkefølgen af AI-motorer ud fra env-variablen AI_PROVIDER.
//   (uset / "gemini") → kun Gemini    → UÆNDRET adfærd som i dag
//   "claude"          → kun Claude
//   "rules"           → kun regelbaseret CirkelEngine (F1.10, kun /api/scan)
//   "auto"            → Gemini → Claude → rules → mock-fallback
// Lykkes ingen aktiv motor, falder hver handler tilbage til sin eksisterende mock.
export function providerOrder(): string[] {
  const p = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  if (p === "claude") return ["claude"];
  if (p === "rules") return ["rules"];
  if (p === "auto") return ["gemini", "claude", "rules"];
  return ["gemini"];
}
