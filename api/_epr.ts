// Modul 1.4 — EPR-afgifts-motor (Extended Producer Responsibility)
// Dansk producentansvar: dynamisk modulering af emballageafgift baseret paa
// materialesammensaetning. Additive procent-justeringer paa multiplier-basis 1.0.

export const BASE_EPR_FEE_PER_KG = 2.45;

// Modulerings-konstanter (som andele af base = 1.0)
const COMPOSITE_SURCHARGE = 1.5;        // +150% — svaert-genanvendelige komposit-strukturer
const BLACK_PLASTIC_SURCHARGE = 2.0;    // +200% — carbon-sort plast usynlig for NIR-sortering
const RECYCLABLE_DISCOUNT = 0.15;       // -15%  — rene mono-materialer med etableret genanvendelseskaede

// Materialer der udloeser rabatten. Explicit Set for O(1) opslag og typet indeholdelse.
const RECYCLABLE_MATERIALS: ReadonlySet<string> = new Set<string>([
  "Clear_PET_Plastic",
  "Corrugated_Cardboard",
]);

const BLACK_PLASTIC_KEY = "Black_Plastic_Carbon";

export interface MaterialPassport {
  primary_material: string;
  composite_materials: string[];
  weight_grams: number;
}

export interface EPRCalculationResult {
  fee_dkk: number;
  multiplier: number;
  breakdown: string[];
}

/**
 * Beregner den dynamiske EPR-afgift for et emballage-materialpas.
 *
 * Regelsaet:
 *   1. Base = vaegt(kg) * BASE_EPR_FEE_PER_KG
 *   2. composite_materials.length > 0        => multiplier += 1.5   (+150%)
 *   3. primary_material === Black_Plastic    => multiplier += 2.0   (+200%)
 *      ellers hvis primary_material in RECYCLABLE => multiplier -= 0.15 (-15%)
 *   4. fee_dkk = base * multiplier
 *
 * Sort plast og "recyclable" er gensidigt udelukkende paa primary_material.
 * Composite-tillaeg kan stables med baade sort-plast og recyclable-rabatten.
 */
export function calculateDynamicEPRPenalty(mp: MaterialPassport): EPRCalculationResult {
  const breakdown: string[] = [];

  const weightKg: number = mp.weight_grams / 1000;
  const baseFee: number = BASE_EPR_FEE_PER_KG * weightKg;

  breakdown.push(
    `Base: ${weightKg.toFixed(3)} kg x ${BASE_EPR_FEE_PER_KG.toFixed(2)} DKK/kg = ${baseFee.toFixed(2)} DKK`,
  );

  let multiplier = 1.0;
  breakdown.push(`Start-multiplier: 1.00x (100%)`);

  if (mp.composite_materials.length > 0) {
    multiplier += COMPOSITE_SURCHARGE;
    breakdown.push(
      `+150% komposit-tillaeg (${mp.composite_materials.length} ekstra materialer: ${mp.composite_materials.join(", ")}) — svaerere at genanvende`,
    );
  }

  if (mp.primary_material === BLACK_PLASTIC_KEY) {
    multiplier += BLACK_PLASTIC_SURCHARGE;
    breakdown.push(
      `+200% sort-plast-tillaeg (${BLACK_PLASTIC_KEY}) — usynlig for NIR-sortering, ryger til forbraending`,
    );
  } else if (RECYCLABLE_MATERIALS.has(mp.primary_material)) {
    multiplier -= RECYCLABLE_DISCOUNT;
    breakdown.push(
      `-15% recyclable-rabat (${mp.primary_material}) — rent mono-materiale med etableret genanvendelseskaede`,
    );
  } else {
    breakdown.push(`Primaer-materiale ${mp.primary_material}: ingen justering`);
  }

  const rawFee: number = baseFee * multiplier;

  // Runder til 2 decimaler (oere) for beloeb og multiplier for UI-visning.
  const feeRounded: number = Math.round(rawFee * 100) / 100;
  const multiplierRounded: number = Math.round(multiplier * 100) / 100;

  breakdown.push(`Slut-multiplier: ${multiplierRounded.toFixed(2)}x (${Math.round(multiplierRounded * 100)}%)`);
  breakdown.push(`Total EPR-afgift: ${feeRounded.toFixed(2)} DKK`);

  return {
    fee_dkk: feeRounded,
    multiplier: multiplierRounded,
    breakdown,
  };
}
