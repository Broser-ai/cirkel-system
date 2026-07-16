// cirkel-system/src/lib/anontome.ts
//
// Integration-Audit forslag #3 (accepteret 2026-07-16).
// Client-safe port af cirkel-harness/bridge/AnontomeIdentity.ts.
//
// Bruger Web Crypto API (SubtleCrypto) — virker i moderne browsere, Node 18+
// og React Native (via expo-crypto polyfill hvis nødvendigt).
//
// FORMÅL: konvertér MitID-sub (eller CVR) til uigenkendelig hash. Ingen plaintext
// PII forlader denne fil.
//
// USAGE:
//   const hash = await AnontomeIdentity.generateHash('mitid-sub-value');
//   const bytea = await AnontomeIdentity.generateByteaLiteral('mitid-sub-value');

const DEFAULT_DOMAIN = 'cirkel-2026-anontome-domain';
const HASH_HEX_LENGTH = 64;

function getSalt(): string {
  // Vite/Next miljøvariabler: prefix VITE_ hhv NEXT_PUBLIC_ eksponerer til klient.
  // Server-side (Node): process.env.ANONTOME_SALT.
  if (typeof process !== 'undefined' && process.env?.ANONTOME_SALT) {
    return process.env.ANONTOME_SALT;
  }
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ANONTOME_SALT) {
    return (import.meta as any).env.VITE_ANONTOME_SALT;
  }
  if (typeof window !== 'undefined' && (window as any).__CIRKEL_ANONTOME_SALT) {
    return (window as any).__CIRKEL_ANONTOME_SALT;
  }
  return DEFAULT_DOMAIN;
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

let warnedNoSalt = false;

export class AnontomeIdentity {
  /**
   * Hasher input (MitID-sub / CVR / user-id) til 64-hex SHA-256.
   */
  public static async generateHash(input: string): Promise<string> {
    if (!input || typeof input !== 'string' || input.length === 0) {
      throw new Error('AnontomeIdentity.generateHash: input påkrævet (ikke-tom string)');
    }
    const salt = getSalt();
    if (salt === DEFAULT_DOMAIN && !warnedNoSalt) {
      // eslint-disable-next-line no-console
      console.warn('[Anontome] ANONTOME_SALT ikke sat. Bruger default-domain — SKAL erstattes i produktion.');
      warnedNoSalt = true;
    }
    const data = new TextEncoder().encode(`${salt}|${input}`);

    const subtle = typeof crypto !== 'undefined' && (crypto as any).subtle
      ? (crypto as any).subtle
      : typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle
        ? (globalThis as any).crypto.subtle
        : null;
    if (!subtle) {
      throw new Error('AnontomeIdentity: Web Crypto API ikke tilgængelig. På React Native: installer expo-crypto.');
    }

    const digest = await subtle.digest('SHA-256', data);
    return bytesToHex(digest);
  }

  /**
   * PostgREST BYTEA JSON-format: "\x<hex>".
   */
  public static async generateByteaLiteral(input: string): Promise<string> {
    return `\\x${await this.generateHash(input)}`;
  }

  public static isValidHash(hash: string): boolean {
    return typeof hash === 'string' && hash.length === HASH_HEX_LENGTH && /^[a-f0-9]+$/.test(hash);
  }
}
