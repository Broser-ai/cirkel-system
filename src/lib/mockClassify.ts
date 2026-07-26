/**
 * mockClassify — offline heuristik-fallback for AI Studio classification.
 *
 * Genindført fra commit de80394 (fjernet ved refactor).
 * Bruges når AI Studio / Gemini Vision ikke er tilgængelig, eller når
 * vi kører i test/preview-miljø uden network access.
 *
 * Ingen network calls. Deterministisk output baseret på productName-nøgleord.
 */

export interface MockClassificationResult {
  classification: string;
  confidence: number;
  materialType: string;
  sortingCategory: string;
  source: 'mock';
}

interface HeuristicRule {
  keywords: readonly string[];
  result: Omit<MockClassificationResult, 'source'>;
}

const HEURISTIC_RULES: readonly HeuristicRule[] = [
  {
    keywords: ['flaske', 'bottle', 'flasker', 'bottles'],
    result: {
      classification: 'plastik/glas',
      confidence: 0.75,
      materialType: 'plastic_or_glass',
      sortingCategory: 'plast_glas',
    },
  },
  {
    keywords: ['karton', 'box', 'kasse', 'pap', 'cardboard', 'boxes'],
    result: {
      classification: 'papir',
      confidence: 0.8,
      materialType: 'paper',
      sortingCategory: 'papir_pap',
    },
  },
  {
    keywords: ['dåse', 'can', 'daase', 'daaser', 'dåser', 'cans', 'alu', 'aluminium'],
    result: {
      classification: 'metal/alu',
      confidence: 0.8,
      materialType: 'metal',
      sortingCategory: 'metal',
    },
  },
];

const DEFAULT_RESULT: Omit<MockClassificationResult, 'source'> = {
  classification: 'plastik',
  confidence: 0.5,
  materialType: 'plastic',
  sortingCategory: 'plast',
};

/**
 * Klassificér et produkt-billede/-navn ved hjælp af simple nøgleord.
 *
 * @param imageBase64 - Base64-encoded billede (ubrugt i mock, men beholdt for API-paritet med rigtig classifier).
 * @param productName - Produkt-navn eller beskrivelse. Case-insensitive matching.
 * @returns Deterministisk classification-resultat. Falder tilbage til "plastik" @ 0.5 confidence hvis intet nøgleord matcher.
 */
export function mockClassify(
  imageBase64: string | null,
  productName: string | null
): MockClassificationResult {
  void imageBase64; // reserveret for fremtidig image-hash-heuristik

  const needle = (productName ?? '').toLowerCase().trim();

  if (needle.length > 0) {
    for (const rule of HEURISTIC_RULES) {
      const hit = rule.keywords.some((keyword) => needle.includes(keyword));
      if (hit) {
        return { ...rule.result, source: 'mock' };
      }
    }
  }

  return { ...DEFAULT_RESULT, source: 'mock' };
}
