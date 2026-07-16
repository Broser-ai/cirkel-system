// cirkel-system/src/lib/anontome-server.ts
//
// Integration-Audit forslag #3 (server-side twin til src/lib/anontome.ts).
// Kaldes KUN fra api/*.ts server-side kode. Bruger Node's crypto module.
//
// SIKKERHED: ANONTOME_SALT MUST være sat i Vercel env. Uden salt fungerer
// koden, men warner ved opstart — brug ikke i produktion.

import { createHash, timingSafeEqual } from 'crypto';

const DEFAULT_DOMAIN = 'cirkel-2026-anontome-domain';
const HASH_HEX_LENGTH = 64;

function getSalt(): string {
  return process.env.ANONTOME_SALT || DEFAULT_DOMAIN;
}

let warned = false;

export function anontomeHash(input: string): string {
  if (!input) throw new Error('anontomeHash: input påkrævet');
  const salt = getSalt();
  if (salt === DEFAULT_DOMAIN && !warned) {
    console.warn('[Anontome-Server] ANONTOME_SALT ikke sat. Bruger default — SKAL erstattes i produktion.');
    warned = true;
  }
  return createHash('sha256').update(`${salt}|${input}`).digest('hex');
}

export function anontomeBytea(input: string): string {
  return `\\x${anontomeHash(input)}`;
}

export function anontomeBuffer(input: string): Buffer {
  return Buffer.from(anontomeHash(input), 'hex');
}

export function isValidHash(hash: string): boolean {
  return typeof hash === 'string' && hash.length === HASH_HEX_LENGTH && /^[a-f0-9]+$/.test(hash);
}

/** Constant-time hash-sammenligning. Undgår timing side-channel. */
export function hashEquals(a: string, b: string): boolean {
  if (!isValidHash(a) || !isValidHash(b)) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
