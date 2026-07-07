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
          sortingInstructions: `Sorteringsanbefaling for ${targetMunicipality}: Skyl emballagen kort under koldt vand, flad presset sammen og placér den i beholderen til plastik/metal genanvendelse.`
        }
      });
    }

    try {
      let contents: any[] = [];
      let systemInstruction = `Du er en ekspert i genanvendelse, cirkulær økonomi og det danske affaldssorteringssystem.
Din opgave er at analysere et emballageskud (foto eller angivet produktnavn) og udfylde et tætpakket "AI Materialepas" i JSON-format.
All tekst skal være på flydende dansk.

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
15. sortingInstructions: Meget præcis instruktion tilpasset ${targetMunicipality}. Fortæl præcis om man skal skylle, skrue låget af, mase den flad, eller sortere låg og bæger hver for sig.`;

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
              "sortingInstructions"
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
