// F4.2 — DAWA postnummer→kommune lookup.
// DAWA = Danmarks Adressers Web API (offentligt, intet API-key).
// https://dawa.aws.dk/dok/api/postnummer
//
// Cache in-memory pr. cold-start (Vercel serverless) — kommuner ændrer sig sjældent.
// Fail-soft: returnerer null hvis DAWA er nede; caller skal håndtere.

const cache = new Map<string, string | null>();

export async function kommuneFromPostnr(postnr: string): Promise<string | null> {
  const clean = String(postnr || "").trim();
  if (!/^\d{4}$/.test(clean)) return null;
  if (cache.has(clean)) return cache.get(clean) ?? null;

  try {
    const r = await fetch(`https://api.dataforsyningen.dk/postnumre/${clean}`, {
      headers: { "Accept": "application/json" },
    });
    if (!r.ok) {
      cache.set(clean, null);
      return null;
    }
    const data = await r.json();
    const navn = data?.kommuner?.[0]?.navn || null;
    cache.set(clean, navn);
    return navn;
  } catch {
    cache.set(clean, null);
    return null;
  }
}
