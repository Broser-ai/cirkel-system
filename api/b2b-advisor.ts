import { Type } from "@google/genai";
import { getAI } from "./_gemini.js";
import { getClaude, claudeJSON } from "./_claude.js";
import { providerOrder } from "./_ai.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    productName,
    targetMaterial,
    currentCircularityIndex,
    packagingWeight,
    annualTonnage,
    desiredObjective,
  } = req.body;

  const brandName = productName || "Arla Amba Standard";
  const material = targetMaterial || "Plastik (rPET)";
  const index_pct = currentCircularityIndex || 45;
  const pWeight = packagingWeight || 20;
  const tonnage = annualTonnage || 100;
  const objective = desiredObjective || "reduktion i epr-afgifter, special branding, vouchers og optimerede Cirkel-koder";

  // Din eksisterende premium-mock (uændret).
  const mock = {
    executiveSummary: `Strategisk ESG-revisionsrapport udarbejdet for ${brandName}. Selskabets nuværende materialevalg (${material}) og årlige emballagegennemstrømning på ${tonnage} tons resulterer i en sårbarhed over for de kommende EU PPWR (2026) og danske EPR-retningslinjer. Ved at aktivere Cirkels intelligente micro-nudging pantesløjfer, kan selskabet reducere sin straf-afgift markant og forbedre CSRD Scope 3 rapporteringen.`,
    taxSavingsAnalyses: {
      legacyTaxCalculated: Math.round(tonnage * 2150),
      optimizedTaxCalculated: Math.round(tonnage * 450),
      eprSavingsDkk: Math.round(tonnage * 1700),
      co2SavingsTons: Math.round(tonnage * 1.65),
    },
    suggestedCampaigns: [
      {
        title: `${brandName} ${material.split(" ")[0]} Cirkulær Loop`,
        targetMaterial: material,
        postcode: "8000",
        specialLabelCode: "CIRK-ARLA-PCR-SWIFT",
        specialLabelStyle: "Smart-RFID",
        targetSegment: "Den Aktive Økolog & Studie-Nudgisten",
        voucherValue: "15 kr",
        voucherText: `Køb for 100 kr af ${brandName} produkter og få 15% rabat via Cirkel-pant`,
        pushedNudgeFrequency: 3,
        estimatedConvRate: 88,
        predictedCO2SavingsKg: Math.round(tonnage * 15),
      },
      {
        title: `${brandName} Grøn Aarhus V Re-turn`,
        targetMaterial: material,
        postcode: "8210",
        specialLabelCode: "CIRK-MUNI-QR-SPECIAL",
        specialLabelStyle: "High-Contrast QR",
        targetSegment: "Den Travle Børnefamilie",
        voucherValue: "Gratis genbrugskop",
        voucherText: `Returner 10 stk ${brandName} emballager og indløs gratis kaffe`,
        pushedNudgeFrequency: 4,
        estimatedConvRate: 72,
        predictedCO2SavingsKg: Math.round(tonnage * 8),
      },
    ],
    deepAnalyses: {
      doubleMaterialityInsights: `Vores Dobbelt Materialitets-analyse for ${brandName} beviser, at overgangen fra traditionel bortskaffelse til Cirkel-tags begrænser selskabets fysiske klima-risiko samt overholdelsestakst-risici relateret til det danske producentansvar.`,
      brandingStrategy: `Anvend 'Smart-RFID' eller 'High-Contrast Laser QR' mærkninger i øverste højre hjørne af emballagen. Special branding med teksten 'Scan for Cirkel-pant via din mobil' øger returraten med 34% på tværs af unge demografier i Aarhus C.`,
      legalComplianceDetails: "Opfylder EU PPWR (Packaging and Packaging Waste Regulation) Artikel 39 og overholder CSRD taksonomi for cirkulære råstoffer. Giver revisorgodkendt audit-dokumentation til Scope 3 indrapportering.",
    },
  };

  const systemInstruction = `Du er en elite ESG og EPR (Udvidet Producentansvar) rådgiver og adfærds-marketing ekspert i cirkulær økonomi i Danmark.
Dine klienter er store B2B virksomheder og danske kommuner.
Din opgave er at tage de leverede parametre (emballage vægt, årlig vægt i tons, emballage materiale, nuværende cirkularitet og strategisk ønske) og udfylde en ekstremt professionel, dybdegående B2B revisionsanalyse i JSON-format.
Alt tekst skal være på formelt, forretningsorienteret dansk.

Vigtigt: Beregn realistiske finansielle og miljømæssige tab og besparelser. Generer ultra-kreative og specifikke kampagneidéer, brandede vouchers og præcise instruktioner til Cirkel-emballagemærkning.

Du skal levere følgende felter i din JSON-response:
1. executiveSummary: En omfattende strategisk vurdering af emballagemodellen.
2. taxSavingsAnalyses: Et objekt indeholdende:
   - legacyTaxCalculated: Beregnet traditionel emballageafgift uden cirkulære løkker (i DKK).
   - optimizedTaxCalculated: Beregnet optimeret eco-moduleret afgift ved fuld implementering af Cirkel Connect (i DKK).
   - eprSavingsDkk: Den direkte årlige besparelse i DKK (forskellen mellem overstående).
   - co2SavingsTons: Samlede tons undgået CO2e om året.
3. suggestedCampaigns: Array af 2 elementer med foreslåede nudging-kampagner der skal pushes i Cirkel-appen, hver indeholdende:
   - title: Kreativt navn på kampagnen (f.eks "Arla rPET Loop Crusade").
   - targetMaterial: Mål-materiale.
   - postcode: Bedste målgruppe postnummer i Aarhus (f.eks "8000" eller "8210").
   - specialLabelCode: Præcis mærknings-kode (f.eks "CIRK-ARLA-PCR").
   - specialLabelStyle: Mærkat-stil (f.eks "Smart-RFID", "High-Contrast QR", "Laser QR Sticker").
   - targetSegment: Målgruppe-segmentbeskrivelse (f.eks "Den Aktive Økolog").
   - voucherValue: Voucherens kortfattede rabatværdi (f.eks "10 kr" eller "20% rabat").
   - voucherText: Beskrivelse af voucheren og hvor den kan indløses (f.eks "20% Rabat på Øko-Mælk hos Salling").
   - pushedNudgeFrequency: Foreslået nudge frekvens (f.eks 3 push pr uge).
   - estimatedConvRate: Estimeret konverteringsprocent (f.eks 85).
   - predictedCO2SavingsKg: CO2 besparelse i kg for kampagnen.
4. deepAnalyses: Et objekt indeholdende:
   - doubleMaterialityInsights: Dyb finansiel og økologisk materialitetsvurdering.
   - brandingStrategy: Præcis instruktion om hvordan man implementerer special branding på emballagen (placering af Cirkel Smart-tags, farvevalg og forbruger-notitser).
   - legalComplianceDetails: Dybdegående evaluering af EU PPWR og CSRD lovmæssig overholdelse samt revisorgodkendelse.`;

  const userText = `Foretag en dybdegående B2B cirkulær ESG audit og kampagnerådgivning for dette produkt:
Produktnavn: "${brandName}"
Materialetype: "${material}"
Nuværende Cirkularitets-Indeks: ${index_pct}%
Emballage enkeltvægt: ${pWeight} gram
Årlig tonnage: ${tonnage} tons
Særligt fokus/målsætning: "${objective}"`;

  async function viaGemini() {
    const ai = getAI();
    if (!ai) throw new Error("gemini-unavailable");
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ text: userText }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            taxSavingsAnalyses: {
              type: Type.OBJECT,
              properties: {
                legacyTaxCalculated: { type: Type.INTEGER },
                optimizedTaxCalculated: { type: Type.INTEGER },
                eprSavingsDkk: { type: Type.INTEGER },
                co2SavingsTons: { type: Type.NUMBER },
              },
              required: ["legacyTaxCalculated", "optimizedTaxCalculated", "eprSavingsDkk", "co2SavingsTons"],
            },
            suggestedCampaigns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  targetMaterial: { type: Type.STRING },
                  postcode: { type: Type.STRING },
                  specialLabelCode: { type: Type.STRING },
                  specialLabelStyle: { type: Type.STRING },
                  targetSegment: { type: Type.STRING },
                  voucherValue: { type: Type.STRING },
                  voucherText: { type: Type.STRING },
                  pushedNudgeFrequency: { type: Type.INTEGER },
                  estimatedConvRate: { type: Type.INTEGER },
                  predictedCO2SavingsKg: { type: Type.INTEGER },
                },
                required: ["title", "targetMaterial", "postcode", "specialLabelCode", "specialLabelStyle", "targetSegment", "voucherValue", "voucherText", "pushedNudgeFrequency", "estimatedConvRate", "predictedCO2SavingsKg"],
              },
            },
            deepAnalyses: {
              type: Type.OBJECT,
              properties: {
                doubleMaterialityInsights: { type: Type.STRING },
                brandingStrategy: { type: Type.STRING },
                legalComplianceDetails: { type: Type.STRING },
              },
              required: ["doubleMaterialityInsights", "brandingStrategy", "legalComplianceDetails"],
            },
          },
          required: ["executiveSummary", "taxSavingsAnalyses", "suggestedCampaigns", "deepAnalyses"],
        },
      },
    });
    return JSON.parse(response.text?.trim() || "{}");
  }

  async function viaClaude() {
    const c = getClaude();
    if (!c) throw new Error("claude-unavailable");
    return await claudeJSON(c, systemInstruction, userText, { maxTokens: 4096 });
  }

  for (const p of providerOrder()) {
    try {
      if (p === "gemini") return res.json({ success: true, data: await viaGemini() });
      if (p === "claude") return res.json({ success: true, data: await viaClaude() });
    } catch (error: any) {
      console.error(`B2B-advisor via ${p} fejlede:`, error?.message);
    }
  }
  return res.json({ success: true, data: mock });
}
