// Modul 20.1 — Multi-Provider AI Router
// ---------------------------------------------------------------------------
// Bevarer eksisterende providerOrder() (env-baseret) og udvider med et
// multi-provider registry + routePayload() der vælger provider ud fra
// kompleksitet, GDPR-krav og billed-input, samt en fallback-chain.

// ---- Region + provider identifiers -----------------------------------------
export type Region = "EU" | "US";

export type ProviderId =
  | "gemini-2.5-flash"
  | "claude-3-5-sonnet"
  | "roboflow-fallback";

// ---- Model registry entry ---------------------------------------------------
export interface ModelEntry {
  id: ProviderId;
  /** Relativ omkostning pr. request (lower = cheaper). */
  cost: number;
  /** Data-lokation for GDPR-filtrering. */
  region: Region;
  /** True hvis provider understøtter multimodal billed-input. */
  supportsVision: boolean;
  /** True hvis provider egner sig til komplekse reasoning-opgaver. */
  highComplexity: boolean;
  /**
   * Prioritet ved primær-valg (higher = foretrækkes først).
   * Bruges kun som deterministisk tiebreaker.
   */
  priority: number;
}

// ---- Registry ---------------------------------------------------------------
export const MODEL_REGISTRY: Readonly<Record<ProviderId, ModelEntry>> = {
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    cost: 0.1,
    region: "EU",
    supportsVision: true,
    highComplexity: false,
    priority: 90,
  },
  "claude-3-5-sonnet": {
    id: "claude-3-5-sonnet",
    cost: 1.5,
    region: "US",
    supportsVision: true,
    highComplexity: true,
    priority: 80,
  },
  "roboflow-fallback": {
    id: "roboflow-fallback",
    cost: 0.3,
    region: "EU",
    supportsVision: true,
    highComplexity: false,
    priority: 50,
  },
} as const;

// ---- Routing context --------------------------------------------------------
export interface RouteContext {
  isHighComplexity: boolean;
  enforceGDPR: boolean;
  hasImage: boolean;
}

export interface RouteDecision {
  selectedProvider: ProviderId;
  /** Fuld fallback-chain (primary + fallbacks) i valgt rækkefølge. */
  chain: ProviderId[];
  /** Kort menneske-læsbar begrundelse for valget. */
  reason: string;
}

// ---- Interne helpers --------------------------------------------------------
function allEntries(): ModelEntry[] {
  return Object.values(MODEL_REGISTRY);
}

function filterByContext(ctx: RouteContext): ModelEntry[] {
  let candidates = allEntries();

  if (ctx.enforceGDPR) {
    candidates = candidates.filter((m) => m.region === "EU");
  }

  if (ctx.hasImage) {
    const withVision = candidates.filter((m) => m.supportsVision);
    if (withVision.length > 0) {
      candidates = withVision;
    }
  }

  return candidates;
}

function rankCandidates(
  candidates: ModelEntry[],
  ctx: RouteContext,
): ModelEntry[] {
  // Score: complexity-match først, derefter lav cost, derefter priority.
  const scored: Array<{ entry: ModelEntry; score: number }> = candidates.map(
    (entry) => {
      let score = 0;
      if (ctx.isHighComplexity && entry.highComplexity) score += 1000;
      if (!ctx.isHighComplexity && !entry.highComplexity) score += 500;
      if (ctx.hasImage && entry.supportsVision) score += 200;
      // Billigere = højere score (invers cost, skaleret).
      score += Math.max(0, 100 - entry.cost * 10);
      score += entry.priority;
      return { entry, score };
    },
  );

  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);
}

// ---- Public API -------------------------------------------------------------
/**
 * Vælger primær provider ud fra kontekst og returnerer fuld fallback-chain.
 * GDPR=true tillader kun EU-providers. hasImage=true foretrækker vision-
 * providers (men falder tilbage til alle hvis ingen matcher).
 */
export function routePayload(ctx: RouteContext): RouteDecision {
  const filtered = filterByContext(ctx);

  if (filtered.length === 0) {
    // Ingen provider matcher hårde krav (fx GDPR med tomt EU-udvalg).
    // Vi degraderer bevidst til roboflow-fallback som last resort.
    return {
      selectedProvider: "roboflow-fallback",
      chain: ["roboflow-fallback"],
      reason:
        "Ingen provider matchede hårde krav; benytter roboflow-fallback (EU, vision).",
    };
  }

  const ranked = rankCandidates(filtered, ctx);
  const primary = ranked[0];

  // Byg fallback-chain: primary først, resten sorteret som ranked.
  const chain: ProviderId[] = ranked.map((m) => m.id);

  // Sørg for at roboflow-fallback ALTID er sidste udvej hvis den er tilladt.
  if (
    !chain.includes("roboflow-fallback") &&
    (!ctx.enforceGDPR || MODEL_REGISTRY["roboflow-fallback"].region === "EU")
  ) {
    chain.push("roboflow-fallback");
  }

  const reasonParts: string[] = [];
  reasonParts.push(
    ctx.isHighComplexity
      ? "høj kompleksitet foretrækker reasoning-model"
      : "lav kompleksitet foretrækker cost-optimeret model",
  );
  if (ctx.enforceGDPR) reasonParts.push("GDPR → kun EU-providers");
  if (ctx.hasImage) reasonParts.push("billede-input → vision-provider");

  return {
    selectedProvider: primary.id,
    chain,
    reason: reasonParts.join("; "),
  };
}

// ---- Bevaret eksisterende API (uændret adfærd) -----------------------------
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
