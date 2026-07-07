import { getAI } from "./_gemini.js";
import { getClaude, claudeText } from "./_claude.js";
import { providerOrder } from "./_ai.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required." });
  }

  // Din eksisterende mock-chatbot (uændret) — bruges hvis ingen motor er tilgængelig.
  function mockReply(): string {
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
    return reply;
  }

  const systemInstruction = `Du er en venlig, hjælpsom og ekspert "Cirkel AI Sorteringsassistent". Din opgave er at besvare brugernes spørgsmål om komplekse materialer, sortering og genanvendelse i Danmark (som fx plastiktyper [PP5, PET, HDPE, LDPE], kompositkartoner, biologisk nedbrydeligt plast, aluminium, glas samt specifikke sorteringsregler i danske kommuner).
Svar på et klart, pædagogisk, moderne og venligt dansk. Hold svarene relativt korte, overskuelige og motiverende (max 3-4 korthandlingselementer, gerne med emojis), så de passer til at blive læst på en mobilskærm. Hvis brugeren spørger om noget uden for affaldssortering, skal du høfligt lede dem tilbage til emnet genbrug og bæredygtighed.`;

  async function viaGemini() {
    const ai = getAI();
    if (!ai) throw new Error("gemini-unavailable");
    const formattedContents = messages.map((msg: any) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: formattedContents,
      config: { systemInstruction, temperature: 0.7 },
    });
    return response.text;
  }

  async function viaClaude() {
    const c = getClaude();
    if (!c) throw new Error("claude-unavailable");
    return await claudeText(c, systemInstruction, messages);
  }

  for (const p of providerOrder()) {
    try {
      if (p === "gemini") return res.json({ success: true, reply: await viaGemini() });
      if (p === "claude") return res.json({ success: true, reply: await viaClaude() });
    } catch (error: any) {
      console.error(`Chat via ${p} fejlede:`, error?.message);
    }
  }
  return res.json({ success: true, reply: mockReply() });
}
