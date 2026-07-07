/**
 * DAWA (Danmarks Adresseregister) Reverse Geocoding Services
 * Queries public coordinate lookups in Denmark to find the correct local municipality.
 */

export interface DawaMunicipality {
  kode: string;
  navn: string;
}

/**
 * Perform a coordinate lookup against the public DAWA API.
 * Returns the municipality name (e.g. "Aarhus Kommune") or null.
 * 
 * Note: DAWA expects x=longitude and y=latitude.
 */
export async function getKommuneFromCoords(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://api.dataforsyningen.dk/kommuner/reverse?x=${lon}&y=${lat}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`DAWA API response status is ${response.status}`);
    }
    const data: DawaMunicipality = await response.json();
    if (data && data.navn) {
      // Append "Kommune" suffix for consistency in Danish displays if not already present
      return data.navn.endsWith('Kommune') ? data.navn : `${data.navn} Kommune`;
    }
    return null;
  } catch (err) {
    console.warn("DAWA reversal coordinates lookup failed:", err);
    return null;
  }
}
