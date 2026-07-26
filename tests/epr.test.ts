// cirkel-system/tests/epr.test.ts
//
// Vitest-suite for Modul 1.4 — EPR-afgifts-motor (api/_epr.ts).
//
// Formaal:
//   Verificerer det dynamiske producentansvar-regelsaet:
//     - Base   = weight_grams/1000 * BASE_EPR_FEE_PER_KG (2.45 DKK/kg)
//     - +150%  komposit-tillaeg      naar composite_materials.length > 0
//     - +200%  carbon-black-tillaeg  naar primary_material === "Black_Plastic_Carbon"
//     - -15%   mono-recyclable-rabat naar primary_material in RECYCLABLE_MATERIALS
//              ("Clear_PET_Plastic", "Corrugated_Cardboard")
//     - Sort-plast og recyclable er gensidigt udelukkende paa primary_material.
//     - Komposit-tillaeg stables med baade sort-plast OG recyclable.
//     - Slut-fee og multiplier rundes til 2 decimaler (oere).
//
// Alle expected values er beregnet med samme flydende-komma-semantik som
// implementationen bruger (Math.round(raw * 100) / 100).
//
// Ingen live network-calls, ingen Date.now() uden mock.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_EPR_FEE_PER_KG,
  calculateDynamicEPRPenalty,
  type EPRCalculationResult,
  type MaterialPassport,
} from '../api/_epr';

// ---------------------------------------------------------------------------
// Test-helpers
// ---------------------------------------------------------------------------

function makePassport(overrides: Partial<MaterialPassport> = {}): MaterialPassport {
  return {
    primary_material: 'Aluminium_Foil',
    composite_materials: [],
    weight_grams: 1000,
    ...overrides,
  };
}

/**
 * Bekraefter at et EPRCalculationResult har korrekt shape og at breakdown
 * er en ikke-tom liste af strenge (den narrative revisor-log).
 */
function assertResultShape(result: EPRCalculationResult): void {
  expect(result).toEqual(
    expect.objectContaining({
      fee_dkk: expect.any(Number),
      multiplier: expect.any(Number),
      breakdown: expect.any(Array),
    }),
  );
  expect(result.breakdown.length).toBeGreaterThan(0);
  for (const line of result.breakdown) {
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Global state & tid — deterministisk
// ---------------------------------------------------------------------------

beforeEach(() => {
  // EPR-motoren bruger ikke Date.now(), men vi laaser tiden alligevel saa
  // fremtidige udvidelser (fx logging) forbliver deterministiske.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-22T09:00:00.000Z'));
});

// ===========================================================================
// KONSTANTER
// ===========================================================================

describe('EPR — konstanter', () => {
  it('BASE_EPR_FEE_PER_KG er 2.45 DKK/kg (dansk producentansvar-baseline)', () => {
    expect(BASE_EPR_FEE_PER_KG).toBe(2.45);
  });
});

// ===========================================================================
// HAPPY PATH — hver modulering isoleret
// ===========================================================================

describe('calculateDynamicEPRPenalty — happy paths (hver regel isoleret)', () => {
  it('base-only (ingen komposit, neutral primaer): multiplier 1.00x, fee = weight * 2.45', () => {
    const mp = makePassport({
      primary_material: 'Aluminium_Foil',
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(2.45);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('Start-multiplier: 1.00x')]),
    );
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('Aluminium_Foil')]),
    );
    // Sikrer at ingen af de tre justeringer blev anvendt
    for (const line of result.breakdown) {
      expect(line).not.toMatch(/komposit-tillaeg/);
      expect(line).not.toMatch(/sort-plast-tillaeg/);
      expect(line).not.toMatch(/recyclable-rabat/);
    }
  });

  it('komposit +150%: en enkelt composite udloeser 2.50x multiplier', () => {
    const mp = makePassport({
      primary_material: 'Glass_Bottle',
      composite_materials: ['Metal_Cap'],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(2.5);
    expect(result.fee_dkk).toBe(6.13); // 2.45 * 2.5 = 6.125 -> round(612.5)/100 = 6.13
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('+150% komposit-tillaeg')]),
    );
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('Metal_Cap')]),
    );
  });

  it('carbon-black +200%: Black_Plastic_Carbon som primaer giver 3.00x multiplier', () => {
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(3.0);
    expect(result.fee_dkk).toBe(7.35); // 2.45 * 3.0
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('+200% sort-plast-tillaeg')]),
    );
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('NIR-sortering')]),
    );
  });

  it('mono-recyclable -15% (Clear_PET_Plastic) giver 0.85x multiplier', () => {
    const mp = makePassport({
      primary_material: 'Clear_PET_Plastic',
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(0.85);
    expect(result.fee_dkk).toBe(2.08); // 2.45 * 0.85 = 2.0825 -> 2.08
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('-15% recyclable-rabat')]),
    );
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('Clear_PET_Plastic')]),
    );
  });

  it('mono-recyclable -15% (Corrugated_Cardboard) giver ogsaa 0.85x multiplier', () => {
    const mp = makePassport({
      primary_material: 'Corrugated_Cardboard',
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(0.85);
    expect(result.fee_dkk).toBe(2.08);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('Corrugated_Cardboard')]),
    );
  });
});

// ===========================================================================
// STACKING — komposit-tillaeg lagres oven paa primaer-modulering
// ===========================================================================

describe('calculateDynamicEPRPenalty — kombinerede modificatorer', () => {
  it('komposit + carbon-black stables: 1.0 + 1.5 + 2.0 = 4.50x', () => {
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: ['Aluminium_Foil', 'Paper_Label'],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(4.5);
    expect(result.fee_dkk).toBe(11.03); // 2.45 * 4.5 = 11.025 -> round(1102.5)/100 = 11.03
    // Baade komposit- OG sort-plast-linje skal vaere i breakdown
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('+150% komposit-tillaeg')]),
    );
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('+200% sort-plast-tillaeg')]),
    );
    // recyclable-rabatten maa ALDRIG trigge naar primaer er sort plast
    for (const line of result.breakdown) {
      expect(line).not.toMatch(/recyclable-rabat/);
    }
  });

  it('komposit + mono-recyclable stables: 1.0 + 1.5 - 0.15 = 2.35x', () => {
    const mp = makePassport({
      primary_material: 'Clear_PET_Plastic',
      composite_materials: ['Shrink_Wrap_Label'],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(2.35);
    expect(result.fee_dkk).toBe(5.76); // 2.45 * 2.35 = 5.7575 -> 5.76
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('+150% komposit-tillaeg')]),
    );
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('-15% recyclable-rabat')]),
    );
    // Sort-plast-linje maa ALDRIG optraede
    for (const line of result.breakdown) {
      expect(line).not.toMatch(/sort-plast-tillaeg/);
    }
  });

  it('sort-plast og recyclable er gensidigt udelukkende paa primary_material', () => {
    // Sort plast som primaer med recyclable-materiale KUN i composite -> ingen rabat
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: ['Clear_PET_Plastic'], // opfoert som composite, ikke primaer
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    // multiplier = 1.0 + 1.5 (composite) + 2.0 (sort plast) = 4.5
    expect(result.multiplier).toBe(4.5);
    expect(result.fee_dkk).toBe(11.03);
    for (const line of result.breakdown) {
      expect(line).not.toMatch(/recyclable-rabat/);
    }
  });

  it('flere composite-materialer udloeser stadig kun EN +150% (ikke pr. materiale)', () => {
    const mp = makePassport({
      primary_material: 'Aluminium_Foil',
      composite_materials: ['Paper_Label', 'Ink_Coating', 'Adhesive_Layer'],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    assertResultShape(result);
    expect(result.multiplier).toBe(2.5); // ikke 1.0 + 3*1.5
    expect(result.fee_dkk).toBe(6.13);
    // Antal materialer skal vaere naevnt i breakdown-linjen
    expect(result.breakdown.some((l) => l.includes('3 ekstra materialer'))).toBe(true);
    expect(result.breakdown.some((l) => l.includes('Paper_Label'))).toBe(true);
    expect(result.breakdown.some((l) => l.includes('Ink_Coating'))).toBe(true);
    expect(result.breakdown.some((l) => l.includes('Adhesive_Layer'))).toBe(true);
  });
});

// ===========================================================================
// VAEGT-SKALERING — base-fee skalerer lineaert med masse
// ===========================================================================

describe('calculateDynamicEPRPenalty — vaegt-skalering', () => {
  it('500 g Clear_PET_Plastic (-15%): fee = 2.45 * 0.5 * 0.85 = 1.04', () => {
    const mp = makePassport({
      primary_material: 'Clear_PET_Plastic',
      composite_materials: [],
      weight_grams: 500,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(0.85);
    expect(result.fee_dkk).toBe(1.04);
  });

  it('250 g Black_Plastic_Carbon (+200%): fee = 2.45 * 0.25 * 3 = 1.84', () => {
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: [],
      weight_grams: 250,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(3.0);
    expect(result.fee_dkk).toBe(1.84);
  });

  it('2000 g base (2 kg, ingen justering): fee = 2.45 * 2 = 4.90', () => {
    const mp = makePassport({
      primary_material: 'Aluminium_Foil',
      composite_materials: [],
      weight_grams: 2000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(4.9);
  });

  it('750 g komposit-emballage (+150%): fee = 2.45 * 0.75 * 2.5 = 4.59', () => {
    const mp = makePassport({
      primary_material: 'Glass_Bottle',
      composite_materials: ['Metal_Cap'],
      weight_grams: 750,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(2.5);
    expect(result.fee_dkk).toBe(4.59);
  });

  it('100 g Black_Plastic_Carbon (typisk kaffe-lock): fee = 0.74', () => {
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: [],
      weight_grams: 100,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(3.0);
    expect(result.fee_dkk).toBe(0.74);
  });
});

// ===========================================================================
// EDGE CASES — nul-vaegt, mikro-vaegt, breakdown-format
// ===========================================================================

describe('calculateDynamicEPRPenalty — edge cases', () => {
  it('nul-vaegt: fee = 0.00 DKK selv om multiplier justeres', () => {
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: ['Foil'],
      weight_grams: 0,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(4.5);
    expect(result.fee_dkk).toBe(0);
    // Base-linje skal vise 0.000 kg
    expect(result.breakdown[0]).toContain('0.000 kg');
  });

  it('nul-vaegt uden justeringer: fee = 0, multiplier = 1.00x', () => {
    const mp = makePassport({
      primary_material: 'Aluminium_Foil',
      composite_materials: [],
      weight_grams: 0,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(0);
  });

  it('sub-gram-vaegt (0.5 g mikro-etiket): base afrundes til foerste oere', () => {
    const mp = makePassport({
      primary_material: 'Aluminium_Foil',
      composite_materials: [],
      weight_grams: 0.5,
    });

    const result = calculateDynamicEPRPenalty(mp);

    // 2.45 * 0.0005 = 0.001225 -> round(0.1225)/100 = 0/100 = 0.00 (afrundet til oere)
    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(0);
  });

  it('meget stor vaegt (10 kg komposit): lineaer skalerning, ingen overflow', () => {
    const mp = makePassport({
      primary_material: 'Glass_Bottle',
      composite_materials: ['Metal_Cap'],
      weight_grams: 10_000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    // 2.45 * 10 * 2.5 = 61.25 -> round(6125)/100 = 61.25
    expect(result.multiplier).toBe(2.5);
    expect(result.fee_dkk).toBe(61.25);
  });

  it('breakdown-formatet er stabilt: base, start-multiplier, primaer-linje, slut-multiplier, total', () => {
    const mp = makePassport({
      primary_material: 'Clear_PET_Plastic',
      composite_materials: ['Plastic_Sleeve'],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    // Foerste linje = base
    expect(result.breakdown[0]).toMatch(/^Base: /);
    // Anden linje = start-multiplier
    expect(result.breakdown[1]).toMatch(/^Start-multiplier: 1\.00x/);
    // Sidste to linjer = slut-multiplier og total (i den raekkefoelge)
    const n = result.breakdown.length;
    expect(result.breakdown[n - 2]).toMatch(/^Slut-multiplier: 2\.35x/);
    expect(result.breakdown[n - 1]).toMatch(/^Total EPR-afgift: 5\.76 DKK/);
  });

  it('to identiske input giver identisk output (rene funktion, ingen skjult state)', () => {
    const mp = makePassport({
      primary_material: 'Black_Plastic_Carbon',
      composite_materials: ['Foil'],
      weight_grams: 500,
    });

    const first = calculateDynamicEPRPenalty(mp);
    const second = calculateDynamicEPRPenalty(mp);

    expect(second).toEqual(first);
  });

  it('funktionen muterer ikke input-passport', () => {
    const mp: MaterialPassport = {
      primary_material: 'Clear_PET_Plastic',
      composite_materials: ['Cap'],
      weight_grams: 1000,
    };
    const snapshot = JSON.parse(JSON.stringify(mp));

    calculateDynamicEPRPenalty(mp);

    expect(mp).toEqual(snapshot);
    // composite_materials-referencen skal stadig pege paa samme array
    expect(mp.composite_materials.length).toBe(1);
    expect(mp.composite_materials[0]).toBe('Cap');
  });
});

// ===========================================================================
// ERROR CASES — motoren er defensiv men typet: verificer robust adfaerd
// ===========================================================================

describe('calculateDynamicEPRPenalty — robust adfaerd', () => {
  it('ukendt primary_material udloeser INGEN justering (kun base + evt. komposit)', () => {
    const mp = makePassport({
      primary_material: 'Unknown_Material_XYZ',
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(2.45);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Unknown_Material_XYZ: ingen justering'),
      ]),
    );
  });

  it('tom streng som primary_material behandles som ukendt materiale', () => {
    const mp = makePassport({
      primary_material: '',
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(2.45);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.stringContaining('ingen justering')]),
    );
  });

  it('case-sensitivity: "black_plastic_carbon" (lower-case) matcher IKKE sort-plast-reglen', () => {
    const mp = makePassport({
      primary_material: 'black_plastic_carbon', // forkert case
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    // Regelsaettet er strengt case-sensitivt: forkert case = ukendt materiale
    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(2.45);
    for (const line of result.breakdown) {
      expect(line).not.toMatch(/sort-plast-tillaeg/);
    }
  });

  it('case-sensitivity: "clear_pet_plastic" (lower-case) matcher IKKE recyclable-rabatten', () => {
    const mp = makePassport({
      primary_material: 'clear_pet_plastic', // forkert case
      composite_materials: [],
      weight_grams: 1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(2.45);
    for (const line of result.breakdown) {
      expect(line).not.toMatch(/recyclable-rabat/);
    }
  });

  it('negativ vaegt (defekt input) giver negativ fee — ingen implicit clamp', () => {
    // Motoren clamper ikke — den er defensiv paa strukturen, ikke paa semantikken.
    // Denne test doksemer den EKSISTERENDE adfaerd saa fremtidige aendringer
    // (fx en clamp) fanges eksplicit.
    const mp = makePassport({
      primary_material: 'Aluminium_Foil',
      composite_materials: [],
      weight_grams: -1000,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBe(1.0);
    expect(result.fee_dkk).toBe(-2.45);
  });

  it('multiplier bliver aldrig negativ ved lovlige input (max -0.15 fra 1.0 = 0.85)', () => {
    const mp = makePassport({
      primary_material: 'Corrugated_Cardboard',
      composite_materials: [],
      weight_grams: 1,
    });

    const result = calculateDynamicEPRPenalty(mp);

    expect(result.multiplier).toBeGreaterThan(0);
    expect(result.multiplier).toBe(0.85);
  });
});
