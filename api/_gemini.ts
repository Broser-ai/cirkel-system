import { GoogleGenAI } from "@google/genai";

// Identisk med getGeminiClient() i server.ts.
export function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not defined. Using mock Gemini responses.");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}
