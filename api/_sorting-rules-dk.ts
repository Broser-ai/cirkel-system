// F4.2 — Danske kommuners affaldssortering pr. materialetype.
// Siden juli 2021 (fuldt indfaset 2023) har Danmark 10 nationale affaldsfraktioner.
// Hver kommune har egne beholdertyper/farver/sammensætninger inden for rammerne.
//
// Denne tabel dækker top-15 kommuner (ca. 60% af befolkningen). Andre kommuner
// får et generelt 10-fraktion-fallback. Data verificeres pr. 2026 og bør auditeres
// kvartalsvis — kommuner ændrer fraktionering jævnligt.
//
// Mapping: scan-materiale (PET/PP5/HDPE/Aluminium/Karton/Glas) → kommune-specifik beholder.

export interface KommuneRules {
  navn: string;
  bins: Record<string, string>;
  notes: string;
  url?: string;
}

const ALL_MATERIALS = ["PET", "PP5", "HDPE", "Aluminium", "Karton", "Glas"] as const;
export type Material = typeof ALL_MATERIALS[number];

// Hjælper: kommuner med sammenslået Plast+Metal-beholder.
const PLAST_METAL = (extra: Partial<Record<Material, string>> = {}): Record<string, string> => ({
  PET: "Plast/Metal-beholder",
  PP5: "Plast/Metal-beholder",
  HDPE: "Plast/Metal-beholder",
  Aluminium: "Plast/Metal-beholder",
  Karton: "Mad- & drikkekartoner-beholder",
  Glas: "Glas-beholder",
  ...extra,
});

// Hjælper: kommuner med separat Plast og Metal.
const PLAST_OG_METAL = (extra: Partial<Record<Material, string>> = {}): Record<string, string> => ({
  PET: "Plast-beholder",
  PP5: "Plast-beholder",
  HDPE: "Plast-beholder",
  Aluminium: "Metal-beholder",
  Karton: "Mad- & drikkekartoner-beholder",
  Glas: "Glas-beholder",
  ...extra,
});

export const KOMMUNE_RULES: Record<string, KommuneRules> = {
  "Aarhus": {
    navn: "Aarhus",
    bins: PLAST_METAL(),
    notes: "Aarhus har siden 2023 sammenslået plast og metal i én beholder. Mad- & drikkekartoner sorteres separat.",
    url: "https://aarhus.dk/borger/affald-og-genbrug",
  },
  "København": {
    navn: "København",
    bins: PLAST_METAL(),
    notes: "København har plast/metal i fælles beholder. Mad- & drikkekartoner i grønne minicontainere.",
    url: "https://www.kk.dk/borger/affald-og-genbrug",
  },
  "Frederiksberg": {
    navn: "Frederiksberg",
    bins: PLAST_METAL(),
    notes: "Frederiksberg har plast/metal sammen. Bemærk: spørg gårdmand om kartoner i flere af de gamle ejendomme.",
    url: "https://www.frederiksberg.dk/borger/affald-og-genbrug",
  },
  "Aalborg": {
    navn: "Aalborg",
    bins: PLAST_OG_METAL(),
    notes: "Aalborg har plast og metal i SEPARATE beholdere. Mad- & drikkekartoner sammen med plast i nogle distrikter — tjek din adresse.",
    url: "https://www.aalborg.dk/borger/affald-og-genbrug",
  },
  "Odense": {
    navn: "Odense",
    bins: PLAST_METAL(),
    notes: "Odense har plast/metal i én beholder siden 2022.",
    url: "https://www.odense.dk/borger/affald",
  },
  "Esbjerg": {
    navn: "Esbjerg",
    bins: PLAST_METAL(),
    notes: "Esbjerg samler plast og metal. Spørg Energnist hvis du er i tvivl.",
    url: "https://energnist.dk",
  },
  "Randers": {
    navn: "Randers",
    bins: PLAST_OG_METAL(),
    notes: "Randers Kommune har plast og metal separat.",
    url: "https://www.randers.dk",
  },
  "Kolding": {
    navn: "Kolding",
    bins: PLAST_METAL(),
    notes: "Kolding samler plast og metal.",
    url: "https://www.kolding.dk",
  },
  "Vejle": {
    navn: "Vejle",
    bins: PLAST_METAL(),
    notes: "Vejle har plast/metal i fælles beholder. Pant: brug Dansk Retursystem ved køb.",
    url: "https://www.vejle.dk",
  },
  "Horsens": {
    navn: "Horsens",
    bins: PLAST_METAL(),
    notes: "Horsens samler plast og metal.",
    url: "https://www.horsens.dk",
  },
  "Roskilde": {
    navn: "Roskilde",
    bins: PLAST_OG_METAL(),
    notes: "Roskilde har plast og metal separat. ARGO håndterer sorteringen.",
    url: "https://argo.dk",
  },
  "Herning": {
    navn: "Herning",
    bins: PLAST_METAL(),
    notes: "Herning har plast/metal sammen via AFLD.",
    url: "https://www.herning.dk",
  },
  "Næstved": {
    navn: "Næstved",
    bins: PLAST_METAL(),
    notes: "Næstved samler plast og metal.",
    url: "https://www.naestved.dk",
  },
  "Silkeborg": {
    navn: "Silkeborg",
    bins: PLAST_METAL(),
    notes: "Silkeborg har plast/metal sammen.",
    url: "https://www.silkeborg.dk",
  },
  "Gentofte": {
    navn: "Gentofte",
    bins: PLAST_METAL(),
    notes: "Gentofte har plast/metal sammen. Vestforbrænding håndterer.",
    url: "https://www.gentofte.dk",
  },
};

const GENERIC_FALLBACK: KommuneRules = {
  navn: "Generisk DK-fallback",
  bins: {
    PET: "Plast-fraktion (10-fraktion-systemet)",
    PP5: "Plast-fraktion",
    HDPE: "Plast-fraktion",
    Aluminium: "Metal-fraktion",
    Karton: "Mad- & drikkekartoner-fraktion",
    Glas: "Glas-fraktion",
  },
  notes: "Generisk dansk 10-fraktion-sortering. Din kommune kan have sammenslået fraktioner — tjek borgerservice.",
};

// Slår sorteringsregler op for en given kommune (uppercase-insensitiv match).
// Falder til generisk DK-fallback hvis kommunen ikke er i tabellen.
export function rulesFor(kommune: string): KommuneRules {
  const k = (kommune || "").trim().replace(/^København\s+.*/i, "København");
  const direct = KOMMUNE_RULES[k];
  if (direct) return direct;
  // Case-insensitiv fallback
  const key = Object.keys(KOMMUNE_RULES).find(n => n.toLowerCase() === k.toLowerCase());
  if (key) return KOMMUNE_RULES[key];
  return GENERIC_FALLBACK;
}

// Returnerer beholder-tekst for en given material+kommune-kombination.
export function binFor(material: string, kommune: string): string {
  const rules = rulesFor(kommune);
  return rules.bins[material] || "Restaffald (kontakt din kommune)";
}

// Liste over alle kommune-navne i tabellen.
export function listKommuner(): string[] {
  return Object.keys(KOMMUNE_RULES).sort();
}
