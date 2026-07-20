import { Type } from "@google/genai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getAI } from "./_gemini.js";
import { getClaude, claudeJSON } from "./_claude.js";
import { providerOrder } from "./_ai.js";
import { runRules } from "./_rules.js";
import { processScan } from "../lib/cirkel.js";
import { callWorkflow as callRoboflowWorkflow, stubResponse as roboflowStub } from "./roboflow-fallback.js";

// F1.11 — Supabase server-side klient (service-role; KUN server, aldrig VITE_).
// Lazy init for at undgå crash i mock/lokal hvor env ikke er sat.
let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// Parser numeriske tal ud af AI/rules-svaret (begge bruger samme 16-felts skema).
// Returnerer null hvis kritiske felter mangler → caller skipper persistering gracefully.
function parseNumeric(data: any, bodyWeightGrams?: number): { points: number; kroner: number; co2Kg: number; weightGrams: number; material: string } | null {
  if (!data) return null;
  const kroner = parseFloat(String(data.pantValue || "").replace(",", "."));
  const co2Match = String(data.co2Saved || "").match(/([\d.]+)\s*(g|kg)?/i);
  const co2Val = co2Match ? parseFloat(co2Match[1]) : NaN;
  const co2Kg = co2Match && /kg/i.test(co2Match[2] || "") ? co2Val : co2Val / 1000;
  const wMatch = String(data.packagingWeight || "").match(/([\d.]+)/);
  const weightGrams = Number(bodyWeightGrams) || (wMatch ? parseFloat(wMatch[1]) : 0);
  const material = String(data.materialType || data.materialShort || "Ukendt").split("·")[0].trim();
  if (!isFinite(kroner) || !isFinite(co2Kg) || weightGrams <= 0) return null;
  return { points: Math.round(kroner * 100), kroner, co2Kg, weightGrams, material };
}

// Gyldig Gemini-model (var "gemini-3.5-flash" — findes ikke). Kan overstyres via env.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { image, productName, municipality, weight_grams, firebaseUid, email, fullName, barcode } = req.body;
  const targetMunicipality = municipality || "Aarhus Kommune";

  if (!image && !productName) {
    return res.status(400).json({ error: "Enten billede eller produktnavn er påkrævet." });
  }

  // F1.11 v2: persistér via Firebase-bro hvis firebaseUid + Supabase-env tilgængelige.
  // DB's resolve_profile håndterer auto-opret/find — ingen frontend-mapping nødvendig.
  async function persistIfPossible(data: any) {
    if (!firebaseUid) {
      console.log(`[F1.11-diag] SKIP: firebaseUid missing`);
      return undefined;
    }
    const sb = getSupabase();
    if (!sb) {
      console.log(`[F1.11-diag] SKIP: getSupabase()=null (URL=${!!process.env.VITE_SUPABASE_URL}, KEY=${!!process.env.SUPABASE_SERVICE_ROLE_KEY})`);
      return undefined;
    }
    const n = parseNumeric(data, weight_grams);
    if (!n) {
      console.log(`[F1.11-diag] SKIP: parseNumeric returned null | pantValue=${data?.pantValue} co2Saved=${data?.co2Saved} packagingWeight=${data?.packagingWeight} weight_grams=${weight_grams}`);
      return undefined;
    }
    console.log(`[F1.11-diag] ATTEMPTING process_scan | material=${n.material} weight=${n.weightGrams} points=${n.points} kroner=${n.kroner} co2Kg=${n.co2Kg}`);
    try {
      const saved = await processScan(sb, {
        firebaseUid,
        email,
        fullName,
        material: n.material,
        weightGrams: n.weightGrams,
        points: n.points,
        kroner: n.kroner,
        co2Kg: n.co2Kg,
        barcode,
        municipality: targetMunicipality,
      });
      console.log(`[F1.11-diag] SUCCESS process_scan | user_id=${saved?.user_id} new_balance=${saved?.new_balance} ledger_hash=${String(saved?.ledger_hash).substring(0,16)}`);
      return {
        user_id: saved.user_id,
        new_balance: saved.new_balance,
        new_points: saved.new_points,
        streak_days: saved.streak_days,
        member_status: saved.member_status,
        level: saved.level,
        ledger_hash: saved.ledger_hash,
      };
    } catch (err: any) {
      console.error(`[F1.11-diag] process_scan THREW: ${err?.message} | code=${err?.code} | details=${err?.details}`);
      return undefined;
    }
  }

  async function respond(data: any) {
    const saved = await persistIfPossible(data);
    return res.json(saved ? { success: true, data, saved } : { success: true, data });
  }

  // Din eksisterende mock-fallback (uændret) — bruges hvis ingen motor er tilgængelig.
  const mock = {
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
    didYouKnow: "Vidste du, at polypropylen (PP5) er blandt de nemmeste og mest værdifulde plasttyper at genanvende? Hvis du muser bægeret fladt og skyller det kort for madrester, kan plasten omsmeltes og genbruges 100% til nye, slidstærke hverdagsredskaber!",
  };

  const systemInstruction = `Du er en ekspert i genanvendelse, cirkulær økonomi og det danske affaldssorteringssystem.
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

  const imageBase64 = image ? image.replace(/^data:image\/\w+;base64,/, "") : undefined;
  const userText = image
    ? `Analyser venligst denne emballage. Tilpas sorteringsråd til ${targetMunicipality}.`
    : `Analyser venligst følgende produkt eller type emballage: "${productName}". Tilpas sorteringsråd til ${targetMunicipality}.`;

  async function viaGemini() {
    const ai = getAI();
    if (!ai) throw new Error("gemini-unavailable");
    const contents: any[] = [];
    if (image) {
      contents.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
      contents.push({ text: userText });
    } else {
      contents.push({ text: userText });
    }
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
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
            "productName", "materialShort", "grade", "co2Saved", "waterSaved",
            "energySaved", "pantValue", "materialType", "recyclablePercent",
            "manufacturer", "packagingWeight", "circularScore", "eprStatus",
            "sortingType", "sortingInstructions", "didYouKnow",
          ],
        },
      },
    });
    return JSON.parse(response.text?.trim() || "{}");
  }

  async function viaClaude() {
    const c = getClaude();
    if (!c) throw new Error("claude-unavailable");
    return await claudeJSON(c, systemInstruction, userText, { imageBase64, maxTokens: 2048 });
  }

  async function viaRules() {
    return await runRules({ productName, weight_grams, municipality: targetMunicipality });
  }

  // Integration-Audit #4: hvis Gemini eller Claude leverede et svar med lav
  // signal (kritiske felter mangler eller "Ukendt" materiale), prøver vi
  // Michaels Roboflow-workflow som fallback INDEN vi falder til mock.
  function looksWeak(data: any): boolean {
    if (!data) return true;
    const mat = String(data.materialType ?? data.materialShort ?? '').toLowerCase();
    if (mat.includes('ukendt') || mat.length === 0) return true;
    const pantN = parseFloat(String(data.pantValue ?? '').replace(',', '.'));
    if (!isFinite(pantN) || pantN <= 0) return true;
    return false;
  }

  async function respondWithRoboflowRescueOrOriginal(originalData: any) {
    if (!image || !looksWeak(originalData)) {
      return await respond(originalData);
    }
    const apiKey = process.env.ROBOFLOW_API_KEY;
    if (!apiKey) return await respond(originalData);
    try {
      const rf = await callRoboflowWorkflow(image, apiKey);
      if (rf.material_confidence >= 0.70 && rf.material_type && rf.material_type !== 'UNKNOWN') {
        // Merge Roboflow-svar oven på original: behold felter Roboflow ikke leverer,
        // men opgrader materialeklassifikationen.
        const merged = {
          ...originalData,
          materialType: rf.material_type,
          materialShort: `${rf.material_type} · Roboflow-fallback`,
          circularScore: originalData?.circularScore ?? '90',
          _roboflow_fallback_used: true,
          _roboflow_confidence: rf.material_confidence,
        };
        return await respond(merged);
      }
    } catch (err: any) {
      console.error('[scan] Roboflow-fallback fejlede:', err?.message ?? err);
    }
    return await respond(originalData);
  }

  for (const p of providerOrder()) {
    try {
      if (p === "gemini") return await respondWithRoboflowRescueOrOriginal(await viaGemini());
      if (p === "claude") return await respondWithRoboflowRescueOrOriginal(await viaClaude());
      if (p === "rules") {
        const rules = await viaRules();
        if (rules) return await respond(rules);
        // rules kunne ikke detektere materiale → fortsæt til næste provider
      }
    } catch (error: any) {
      console.error(`Scan via ${p} fejlede:`, error?.message);
    }
  }

  // Ingen provider succes'ede → prøv Roboflow direkte hvis vi har billede
  if (image && process.env.ROBOFLOW_API_KEY) {
    try {
      const rf = await callRoboflowWorkflow(image, process.env.ROBOFLOW_API_KEY);
      if (rf.material_confidence >= 0.60 && rf.material_type !== 'UNKNOWN') {
        const rescued = {
          ...mock,
          materialType: rf.material_type,
          materialShort: `${rf.material_type} · Roboflow`,
          _roboflow_only: true,
          _roboflow_confidence: rf.material_confidence,
        };
        return await respond(rescued);
      }
    } catch (err: any) {
      console.error('[scan] Roboflow direct-fallback fejlede:', err?.message ?? err);
    }
  }

  // Ingen motor tilgængelig/lykkedes → din mock (bevarer offline-adfærd).
  return await respond(mock);
}

// Suppress unused-import warning: roboflowStub reserveres til Fase 2 där vi
// eksporterer stub-svar tilbage til klienten uden at gøre live-kald.
void roboflowStub;
