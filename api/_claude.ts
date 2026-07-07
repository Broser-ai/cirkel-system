import Anthropic from "@anthropic-ai/sdk";

// Claude-klient — aktiveres kun hvis ANTHROPIC_API_KEY er sat.
export function getClaude() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: ANTHROPIC_API_KEY mangler. Claude-laget er inaktivt (Gemini bruges).");
    return null;
  }
  return new Anthropic({ apiKey });
}

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// Henter ren JSON fra Claude (samme felt-form som Gemini leverer).
// Understøtter valgfrit billede (base64 jpeg, uden data:-prefix).
export async function claudeJSON(
  client: any,
  system: string,
  userText: string,
  opts: { imageBase64?: string; maxTokens?: number } = {}
): Promise<any> {
  const content: any[] = [];
  if (opts.imageBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: opts.imageBase64 },
    });
  }
  content.push({
    type: "text",
    text: userText + "\n\nSvar UDELUKKENDE med gyldig JSON. Ingen forklaring, ingen markdown-backticks.",
  });

  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens || 2048,
    system,
    messages: [{ role: "user", content }],
  });

  const text = (msg.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  const clean = text.replace(/```json\s*|\s*```/g, "").trim();
  return JSON.parse(clean || "{}");
}

// Henter ren tekst fra Claude (chat).
export async function claudeText(client: any, system: string, messages: any[]): Promise<string> {
  const msgs = messages.map((m: any) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: m.text,
  }));
  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages: msgs,
  });
  return (msg.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
}
