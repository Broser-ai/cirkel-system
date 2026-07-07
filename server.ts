import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Initialize Gemini client safely if API key exists
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not defined. Using mock Gemini responses.");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

const ai = getGeminiClient();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Setup parse limits for base64 image uploads
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  // API endpoint for dynamic circular packaging scan via Gemini
  app.post("/api/scan", async (req, res) => {
    const { image, productName, municipality } = req.body;
    const targetMunicipality = municipality || "Aarhus Kommune";

    if (!ai) {
      // Elegant fallback with high quality Danish data in case the key is missing or invalid
      return res.json({
        success: true,
        data: {
          productName: productName || "Arla® Skyr Naturel 450g",
          materialShort: "PP5 plast · EAN: 5711953068515",
          grade: "A+",
          co2Saved: "42g",
          waterSaved: "1.2L",
          energySaved: "0.8kWh",
          pantValue: "0.35",
          materialType: "Polypropylen PP5",
          recyclablePercent: "100%",
          manufacturer: "Arla Foods, Viby",
          packagingWeight: "18g",
          circularScore: "92",
          eprStatus: "Registreret ✓",
          sortingType: "♻️ Plast (Hård plastik)",
          sortingInstructions: `Sorteringsanbefaling for ${targetMunicipality}: Skyl emballagen kort under koldt vand, flad presset sammen og placér den i beholderen til plastik/metal genanvendelse.`,
          didYouKnow: "Vidste du, at polypropylen (PP5) er blandt de nemmeste og mest værdifulde plasttyper at genanvende? Hvis du muser bægeret fladt og skyller det kort for madrester, kan plasten omsmeltes og genbruges 100% til nye, slidstærke hverdagsredskaber!"
        }
      });
    }

    try {
      let contents: any[] = [];
      let systemInstruction = `Du er en ekspert i genanvendelse, cirkulær økonomi og det danske affaldssorteringssystem.
Din opgave er at analysere et emballageskud (foto eller angivet produktnavn) og udfylde et tætpakket "AI Materialepas" i JSON-format.
Alt tekst skal være på flydende dansk.

Du skal levere følgende felter i JSON:
1. productName: Det præcise navn og mærke på varen (f.eks. "Coca-Cola Flaske 0.5L", "Arla Letmælk 1L").
2. materialShort: En kort beskrivelse af materialets forkortelse samt et opdigtet eller virkeligt tilsvarende EAN nummer (f.eks. "PET plast · EAN: 5701026330058").
3. grade: En karakter fra A+, A, B, C, D baseret på hvor genanvendelig emballagen er i Danmark.
4. co2Saved: CO2 sparet ved genanvendelse (e.g. "45g" eller "110g").
5. waterSaved: Vand sparet i liter (e.g. "1.5L" eller "0.8L").
6. energySaved: Energi sparet i kWh (e.g. "0.7kWh" eller "1.2kWh").
7. pantValue: En rimelig pantværdi eller genanvendelsesværdi i DKK (f.eks. "1.50" eller "0.35" eller "3.00").
8. materialType: Det præcise tekniske materiale navn (f.eks. "Polyethylenterephthalat (PET1)", "Karton med PE-folie").
9. recyclablePercent: Genanvendelsesprocent i Danmark (f.eks. "100%", "85%").
10. manufacturer: Producenten eller mærket (f.eks. "Arla Foods", "Carlsberg", "Coop").
11. packagingWeight: Emballagens vægt i gram (f.eks. "22g").
12. circularScore: En cirkulær score ud af 100 baseret på design til genanvendelse (f.eks. "94").
13. eprStatus: EPR (Udvidet producentansvar) registrering (f.eks. "Registreret ✓").
14. sortingType: Sorteringsbeholder kategori (f.eks. "♻️ Plast eller Plast/Metal" eller "♻️ Restaffald" eller "♻️ Mad- og drikkekartoner").
15. sortingInstructions: Meget præcis instruktion tilpasset ${targetMunicipality}. Fortæl præcis om man skal skylle, skrue låget af, mase den flad, eller sortere låg og bæger hver for sig.
16. didYouKnow: En sjov, engagerende og lærerig "Vidste du?"-faktaboks (ca. 1-2 sætninger) om emballagens præcise materialesammensætning (fx PP5, rPET, mælkespande, aluminium eller komposit) eller dens genanvendelsesmæssige udfordringer, innovative potentialer og sorteringsmæssige 'best practice' i Danmark.`;

      if (image) {
        // Clean prefix if exist e.g. "data:image/jpeg;base64,"
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Data,
          }
        });
        contents.push({
          text: `Analyser venligst denne emballage. Tilpas sorteringsråd til ${targetMunicipality}.`
        });
      } else if (productName) {
        contents.push({
          text: `Analyser venligst følgende produkt eller type emballage: "${productName}". Tilpas sorteringsråd til ${targetMunicipality}.`
        });
      } else {
        return res.status(400).json({ error: "Enten billede eller produktnavn er påkrævet." });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              productName: { type: Type.STRING },
              materialShort: { type: Type.STRING },
              grade: { type: Type.STRING },
              co2Saved: { type: Type.STRING },
              waterSaved: { type: Type.STRING },
              energySaved: { type: Type.STRING },
              pantValue: { type: Type.STRING },
              materialType: { type: Type.STRING },
              recyclablePercent: { type: Type.STRING },
              manufacturer: { type: Type.STRING },
              packagingWeight: { type: Type.STRING },
              circularScore: { type: Type.STRING },
              eprStatus: { type: Type.STRING },
              sortingType: { type: Type.STRING },
              sortingInstructions: { type: Type.STRING },
              didYouKnow: { type: Type.STRING },
            },
            required: [
              "productName",
              "materialShort",
              "grade",
              "co2Saved",
              "waterSaved",
              "energySaved",
              "pantValue",
              "materialType",
              "recyclablePercent",
              "manufacturer",
              "packagingWeight",
              "circularScore",
              "eprStatus",
              "sortingType",
              "sortingInstructions",
              "didYouKnow"
            ]
          }
        }
      });

      const data = JSON.parse(response.text?.trim() || "{}");
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Gemini Scan Error:", error);
      res.status(500).json({ error: "Fejl under scanning med AI: " + error.message });
    }
  });

  // API endpoint for Enterprise/B2B dynamic strategic ESG & Nudging Advisor
  app.post("/api/b2b-advisor", async (req, res) => {
    const { 
      productName, 
      targetMaterial, 
      currentCircularityIndex, 
      packagingWeight, 
      annualTonnage, 
      desiredObjective 
    } = req.body;

    const brandName = productName || "Arla Amba Standard";
    const material = targetMaterial || "Plastik (rPET)";
    const index_pct = currentCircularityIndex || 45;
    const pWeight = packagingWeight || 20;
    const tonnage = annualTonnage || 100;
    const objective = desiredObjective || "reduktion i epr-afgifter, special branding, vouchers og optimerede Cirkel-koder";

    if (!ai) {
      // Premium corporate fallback with high resolution Danish strategy data
      return res.json({
        success: true,
        data: {
          executiveSummary: `Strategisk ESG-revisionsrapport udarbejdet for ${brandName}. Selskabets nuværende materialevalg (${material}) og årlige emballagegennemstrømning på ${tonnage} tons resulterer i en sårbarhed over for de kommende EU PPWR (2026) og danske EPR-retningslinjer. Ved at aktivere Cirkels intelligente micro-nudging pantesløjfer, kan selskabet reducere sin straf-afgift markant og forbedre CSRD Scope 3 rapporteringen.`,
          taxSavingsAnalyses: {
            legacyTaxCalculated: Math.round(tonnage * 2150),
            optimizedTaxCalculated: Math.round(tonnage * 450),
            eprSavingsDkk: Math.round(tonnage * 1700),
            co2SavingsTons: Math.round(tonnage * 1.65)
          },
          suggestedCampaigns: [
            {
              title: `${brandName} ${material.split(' ')[0]} Cirkulær Loop`,
              targetMaterial: material,
              postcode: "8000",
              specialLabelCode: "CIRK-ARLA-PCR-SWIFT",
              specialLabelStyle: "Smart-RFID",
              targetSegment: "Den Aktive Økolog & Studie-Nudgisten",
              voucherValue: "15 kr",
              voucherText: `Køb for 100 kr af ${brandName} produkter og få 15% rabat via Cirkel-pant`,
              pushedNudgeFrequency: 3,
              estimatedConvRate: 88,
              predictedCO2SavingsKg: Math.round(tonnage * 15)
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
              predictedCO2SavingsKg: Math.round(tonnage * 8)
            }
          ],
          deepAnalyses: {
            doubleMaterialityInsights: `Vores Dobbelt Materialitets-analyse for ${brandName} beviser, at overgangen fra traditionel bortskaffelse til Cirkel-tags begrænser selskabets fysiske klima-risiko samt overholdelsestakst-risici relateret til det danske producentansvar.`,
            brandingStrategy: `Anvend 'Smart-RFID' eller 'High-Contrast Laser QR' mærkninger i øverste højre hjørne af emballagen. Special branding med teksten 'Scan for Cirkel-pant via din mobil' øger returraten med 34% på tværs af unge demografier i Aarhus C.`,
            legalComplianceDetails: "Opfylder EU PPWR (Packaging and Packaging Waste Regulation) Artikel 39 og overholder CSRD taksonomi for cirkulære råstoffer. Giver revisorgodkendt audit-dokumentation til Scope 3 indrapportering."
          }
        }
      });
    }

    try {
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

      const contents = [{
        text: `Foretag en dybdegående B2B cirkulær ESG audit og kampagnerådgivning for dette produkt:
Produktnavn: "${brandName}"
Materialetype: "${material}"
Nuværende Cirkularitets-Indeks: ${index_pct}%
Emballage enkeltvægt: ${pWeight} gram
Årlig tonnage: ${tonnage} tons
Særligt fokus/målsætning: "${objective}"`
      }];

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents,
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
                  co2SavingsTons: { type: Type.NUMBER }
                },
                required: ["legacyTaxCalculated", "optimizedTaxCalculated", "eprSavingsDkk", "co2SavingsTons"]
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
                    predictedCO2SavingsKg: { type: Type.INTEGER }
                  },
                  required: ["title", "targetMaterial", "postcode", "specialLabelCode", "specialLabelStyle", "targetSegment", "voucherValue", "voucherText", "pushedNudgeFrequency", "estimatedConvRate", "predictedCO2SavingsKg"]
                }
              },
              deepAnalyses: {
                type: Type.OBJECT,
                properties: {
                  doubleMaterialityInsights: { type: Type.STRING },
                  brandingStrategy: { type: Type.STRING },
                  legalComplianceDetails: { type: Type.STRING }
                },
                required: ["doubleMaterialityInsights", "brandingStrategy", "legalComplianceDetails"]
              }
            },
            required: ["executiveSummary", "taxSavingsAnalyses", "suggestedCampaigns", "deepAnalyses"]
          }
        }
      });

      const data = JSON.parse(response.text?.trim() || "{}");
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Gemini Advisor Error:", error);
      res.status(500).json({ error: "Fejl under strategianalyse: " + error.message });
    }
  });

  // API endpoint for AI Sorteringsassistent chat conversation
  app.post("/api/chat", async (req, res) => {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required." });
    }

    // Map client messages format to Gemini SDK standard format
    const formattedContents = messages.map((msg: any) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text }]
    }));

    if (!ai) {
      // Elegant fallback AI agent chatbot answers if GEMINI_API_KEY is not defined or ai is offline
      const lastMessage = messages[messages.length - 1];
      const lastText = (lastMessage?.text || "").toLowerCase();
      let reply = "Hej! Jeg er din Cirkel Sorteringsassistent. Spørg mig om alt, f.eks. pap, PP5 plast, alu-dåser eller de nyeste EU-emballageregler.";
      
      if (lastText.includes("plast") || lastText.includes("plastik") || lastText.includes("pp5") || lastText.includes("hdpe")) {
        reply = "Hård plastik (som PP5 og HDPE) kan genanvendes helt op til 6-7 gange, hvis det sorteres rent! Husk altid at tømme bøtten/flasken for indhold og skyl den eventuelt kort i koldt vand. Blød plast skal ofte i en separat beholder afhængigt af din kommune.";
      } else if (lastText.includes("pap") || lastText.includes("karton") || lastText.includes("mælk")) {
        reply = "Mad- & drikkekartoner (f.eks. mælkekartoner) består typisk af karton belagt med et ultratyndt lag plast eller aluminium. Fold dem fladt før sortering for at spare plads i genbrugsbilen! Husk at skrue plastlåget af, hvis det kan sorteres for sig.";
      } else if (lastText.includes("metal") || lastText.includes("dåse") || lastText.includes("aluminium")) {
        reply = "Aluminiumsdåser er fantastiske cirkulære materialer: at omsmelte aluminium kræver kun 5% af den energi, der oprindeligt skal bruges på at fremstille nyt aluminium. Husk at pante dem hvis muligt, ellers sorteres de som metal.";
      } else if (lastText.includes("bio") || lastText.includes("mad") || lastText.includes("affald")) {
        reply = "Madaffald bliver i de fleste danske kommuner omdannet til biogas og næringsrig gødning til markerne. Husk kun at lægge biologisk nedbrydeligt madaffald i madaffaldsposen (eller brug biologiske poser, hvis din kommune anbefaler det).";
      } else if (lastText.includes("glas") || lastText.includes("flaske")) {
        reply = "Returglasflasker (som pantflasker) rengøres og genbruges i gennemsnit 30 gange før de omsmeltes! Andet glas (konservesglas, vinflasker osv.) skal i den kommunale glascontainer – husk at tømme og skrabe dem rene.";
      } else if (lastMessage) {
        reply = `Tak for dit spørgsmål om "${lastMessage.text}". Sorteringsreglerne kan virke komplekse, men en god tommelfingerregel er at skille materialer ad (f.eks. papkrave fra et plastbæger) og sortere dem hver for sig. Spørg mig endelig om specifikke materialetyper!`;
      }
      
      return res.json({ success: true, reply });
    }

    try {
      const systemInstruction = `Du er en venlig, hjælpsom og ekspert "Cirkel AI Sorteringsassistent". Din opgave er at besvare brugernes spørgsmål om komplekse materialer, sortering og genanvendelse i Danmark (som fx plastiktyper [PP5, PET, HDPE, LDPE], kompositkartoner, biologisk nedbrydeligt plast, aluminium, glas samt specifikke sorteringsregler i danske kommuner).
Svar på et klart, pædagogisk, moderne og venligt dansk. Hold svarene relativt korte, overskuelige og motiverende (max 3-4 korthandlingselementer, gerne med emojis), så de passer til at blive læst på en mobilskærm. Hvis brugeren spørger om noget uden for affaldssortering, skal du høfligt lede dem tilbage til emnet genbrug og bæredygtighed.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: formattedContents,
        config: {
          systemInstruction,
          temperature: 0.7,
        }
      });

      res.json({ success: true, reply: response.text });
    } catch (error: any) {
      console.error("Gemini Chat Error:", error);
      res.status(500).json({ error: "Fejl under generering af chat-svar: " + error.message });
    }
  });

  // Serve frontend assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
