// F1.10 — regelbaseret scan-vej via CirkelEngine.
// Wires perception→knowledge→reasoning_engine→execution→communication ind i /api/scan
// additivt. Gemini/Claude er stadig default. Denne vej aktiveres når AI_PROVIDER=rules
// eller indgår i AI_PROVIDER=auto før mock-fallback.
//
// Konstanter for vand/energi-estimater holdes her (ikke i modules/) for at undgå at
// ændre det 23-moduls fundament. Skemaet matcher Gemini/Claude-svaret 1:1 så frontend
// ikke behøver kende kilden.

import { CirkelEngine } from "../modules/engine.js";
import { rulesFor } from "./_sorting-rules-dk.js";

let _engine: CirkelEngine | null = null;
async function getEngine(): Promise<CirkelEngine> {
  if (_engine) return _engine;
  const e = new CirkelEngine();
  await e.initialize();
  _engine = e;
  return e;
}

const WATER_PER_KG_L: Record<string, number> = {
  PET: 3.0, PP5: 2.5, HDPE: 2.5, Aluminium: 4.0, Karton: 5.0, Glas: 1.5,
};
const ENERGY_PER_KG_KWH: Record<string, number> = {
  PET: 0.9, PP5: 0.8, HDPE: 0.85, Aluminium: 13.0, Karton: 1.2, Glas: 0.5,
};
const TYPE_FULL: Record<string, string> = {
  PET: "Polyethylenterephthalat (PET1)",
  PP5: "Polypropylen (PP5)",
  HDPE: "High-Density Polyethylene (HDPE)",
  Aluminium: "Aluminium",
  Karton: "Karton (multilayer)",
  Glas: "Glas",
};

export async function runRules(opts: {
  productName?: string;
  weight_grams?: number;
  municipality: string;
}): Promise<any | null> {
  const engine = await getEngine();
  const weight = Math.max(0, Number(opts.weight_grams) || 0);
  const input = {
    barcode: "",
    material: opts.productName || "",
    weight_grams: weight || 18,
    municipality: opts.municipality,
  };
  const { output } = await engine.run(
    ["data", "perception", "knowledge", "reasoning_engine", "execution", "communication"],
    input,
  );
  if (!output.observation || output.observation.detectedType === "Ukendt") return null;

  const k = output.knowledge || {};
  const r = output.reasoning || {};
  const e = output.execution || {};
  const kg = weight / 1000;
  const waterL = kg ? Number((kg * (WATER_PER_KG_L[k.type] ?? 2)).toFixed(2)) : 0;
  const energyKwh = kg ? Number((kg * (ENERGY_PER_KG_KWH[k.type] ?? 0.8)).toFixed(2)) : 0;

  // F4.2: kommune-specifik beholder + note (falder til generisk fallback hvis ikke i tabellen).
  const kommuneRules = rulesFor(opts.municipality);
  const specificBin = k.type ? kommuneRules.bins[k.type] : undefined;
  const sortingType = specificBin ? `♻️ ${specificBin}` : `♻️ ${r.bin || "Restaffald"}`;
  const sortingInstructions = specificBin
    ? `${kommuneRules.navn}: Læg i ${specificBin}. ${r.sorting || ""} ${kommuneRules.notes}`.trim()
    : `${r.sorting || "Tjek din kommunes sorteringsguide."} (${opts.municipality})`;

  return {
    productName: opts.productName || "Ukendt produkt",
    materialShort: `${k.type} · regelbaseret estimat`,
    grade: r.grade || "C",
    co2Saved: e.co2Kg ? `${Math.round(e.co2Kg * 1000)}g` : "estimat mangler vægt",
    waterSaved: waterL ? `${waterL}L` : "estimat mangler vægt",
    energySaved: energyKwh ? `${energyKwh}kWh` : "estimat mangler vægt",
    pantValue: (e.kroner ?? 0).toFixed(2),
    materialType: TYPE_FULL[k.type] || k.type || "Ukendt",
    recyclablePercent: `${k.recyclable ?? 0}%`,
    manufacturer: "Ikke detekteret (regelbaseret)",
    packagingWeight: weight ? `${weight}g` : "ukendt",
    circularScore: String(r.circularScore ?? 0),
    eprStatus: "Regelbaseret estimat",
    sortingType,
    sortingInstructions,
    didYouKnow: k.fact || "—",
  };
}

/**
 * F1.10 explicit helper matcher Aurelle's skitse — kort compat-wrapper for
 * kode der forventer signaturen `ruleBasedScan(imageData, ...)`. Bruger samme
 * CirkelEngine pipeline som runRules() men accepterer image-baseret input.
 *
 * imageData er informativt kun i Fase 1 (regelbaseret pipeline læser ikke pixels),
 * men reserveres i output.metadata så downstream ved at rå-input var vedhæftet.
 */
export async function ruleBasedScan(
  imageData: Buffer | string | undefined,
  opts: { productName?: string; weight_grams?: number; municipality?: string } = {},
): Promise<any | null> {
  const municipality = opts.municipality || "Aarhus Kommune";
  const result = await runRules({
    productName: opts.productName,
    weight_grams: opts.weight_grams,
    municipality,
  });
  if (!result) return null;
  const hasImage = imageData !== undefined && (
    Buffer.isBuffer(imageData) ||
    (typeof imageData === "string" && imageData.length > 0)
  );
  return {
    ...result,
    _pipeline: "rule_based",
    _image_attached: hasImage,
    _phase1_note: hasImage
      ? "Fase 1: image bevaret som metadata; pipeline er stadig regel-baseret (ikke pixel-analyse)."
      : "Fase 1: pure product-name pipeline.",
  };
}
