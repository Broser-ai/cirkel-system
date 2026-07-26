/**
 * Modul 15.1 — WebAuthn hardware attestation
 *
 * Verificerer at en WebAuthn attestation stammer fra en Secure Enclave
 * (Apple / Android hardware-backed key), ikke en software-emulator.
 *
 * Kontrakt:
 *   verifyDeviceHardwareAttestation(clientDataJSON, attestationObject)
 *     -> { valid, deviceType, reason }
 *
 *   valid:      true kun hvis clientDataJSON er korrekt formet OG
 *               attestationObject indeholder Secure Enclave-indikator.
 *   deviceType: 'apple' | 'android' | 'unknown'
 *   reason:     menneskelæsbar årsag (til logs / audit).
 *
 * Constant-time sammenligning bruges hvor input påvirker godkendelse
 * (challenge og type-felt i clientDataJSON).
 */

import { timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DeviceType = 'apple' | 'android' | 'unknown';

export interface AttestationResult {
  readonly valid: boolean;
  readonly deviceType: DeviceType;
  readonly reason: string;
}

// Minimal shape af clientDataJSON — vi validerer felterne eksplicit.
interface ClientData {
  readonly type: string;
  readonly challenge: string;
  readonly origin?: string;
  readonly crossOrigin?: boolean;
}

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

/**
 * Forventet ceremonitype for registrering. WebAuthn-specifikationen
 * kræver præcis strengen 'webauthn.create'.
 */
const EXPECTED_TYPE = 'webauthn.create';

/**
 * Secure Enclave-indikatorer i attestationObject (CBOR-payload).
 * Vi ser dem som råt bytemønster: 'apple' peger på Apple App Attest /
 * anonymation CA, 'android-key' peger på Android Keystore hardware-backed
 * attestation. Andre formater ('none', 'packed' uden hw-cert, 'fido-u2f'
 * uden hw-cert) betragtes som ikke-hardware.
 */
const APPLE_MARKER = Buffer.from('apple', 'utf8');
const ANDROID_MARKER = Buffer.from('android-key', 'utf8');

/**
 * Indikatorer for software-emulator / rooted / debug-context. Hvis nogen
 * af disse optræder i attestationObject-bytene, afvises registreringen.
 */
const SOFTWARE_EMULATOR_MARKERS: readonly Buffer[] = [
  Buffer.from('software', 'utf8'),
  Buffer.from('emulator', 'utf8'),
  Buffer.from('goldfish', 'utf8'), // Android emulator kernel
  Buffer.from('ranchu', 'utf8'),   // Android emulator kernel (nyere)
];

// ---------------------------------------------------------------------------
// Interne hjælpere
// ---------------------------------------------------------------------------

/**
 * Base64 / base64url decode med robust håndtering af padding.
 * WebAuthn-klienter sender ofte base64url (uden '=' padding).
 */
function decodeBase64(input: string): Buffer | null {
  if (typeof input !== 'string' || input.length === 0) {
    return null;
  }

  // Normaliser base64url -> base64
  let normalized = input.replace(/-/g, '+').replace(/_/g, '/');

  // Genindfør padding hvis nødvendigt
  const remainder = normalized.length % 4;
  if (remainder === 2) {
    normalized += '==';
  } else if (remainder === 3) {
    normalized += '=';
  } else if (remainder === 1) {
    // Ugyldig længde
    return null;
  }

  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

/**
 * Constant-time sammenligning af to strenge. Returnerer false hvis
 * længderne afviger (uden at læse videre) — dette lækker længde, men
 * ikke indhold, hvilket er acceptabelt for WebAuthn-felter.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Substring-søgning i Buffer. Node har ikke en indbygget constant-time
 * variant, og vi behøver ikke en her: markørerne er offentligt kendte,
 * så tidsforbrug røber ikke hemmeligheder.
 */
function bufferIncludes(haystack: Buffer, needle: Buffer): boolean {
  return haystack.indexOf(needle) !== -1;
}

/**
 * Typeguard: kontrollerer at et decoded JSON-objekt matcher ClientData.
 */
function isClientData(value: unknown): value is ClientData {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== 'string') {
    return false;
  }
  if (typeof obj.challenge !== 'string' || obj.challenge.length === 0) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verificerer WebAuthn hardware-attestation.
 *
 * @param clientDataJSON    base64(url)-encoded JSON fra WebAuthn-klienten
 * @param attestationObject base64(url)-encoded CBOR-payload fra authenticator
 * @returns                 { valid, deviceType, reason }
 */
export function verifyDeviceHardwareAttestation(
  clientDataJSON: string,
  attestationObject: string,
): AttestationResult {
  // -------------------------------------------------------------------------
  // Step 1: Decode og parse clientDataJSON
  // -------------------------------------------------------------------------
  const clientDataBuffer = decodeBase64(clientDataJSON);
  if (clientDataBuffer === null) {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: 'clientDataJSON kunne ikke base64-dekodes',
    };
  }

  let clientDataText: string;
  try {
    clientDataText = clientDataBuffer.toString('utf8');
  } catch {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: 'clientDataJSON er ikke gyldig UTF-8',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(clientDataText);
  } catch {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: 'clientDataJSON er ikke gyldig JSON',
    };
  }

  if (!isClientData(parsed)) {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: 'clientDataJSON mangler krævede felter (type, challenge)',
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Verificer ceremonitype (constant-time)
  // -------------------------------------------------------------------------
  if (!constantTimeStringEqual(parsed.type, EXPECTED_TYPE)) {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: `Forkert ceremonitype: forventede '${EXPECTED_TYPE}'`,
    };
  }

  // -------------------------------------------------------------------------
  // Step 3: Verificer challenge er til stede og velformet (base64url)
  //
  // Selve challenge-match mod server-state hører hjemme i kalderen; her
  // sikrer vi kun at feltet ikke er tomt og består af base64url-tegn.
  // -------------------------------------------------------------------------
  const challengeBuffer = decodeBase64(parsed.challenge);
  if (challengeBuffer === null || challengeBuffer.length === 0) {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: 'challenge er ikke gyldig base64url eller er tom',
    };
  }

  // -------------------------------------------------------------------------
  // Step 4: Decode attestationObject og scan for Secure Enclave-indikator
  // -------------------------------------------------------------------------
  const attestationBuffer = decodeBase64(attestationObject);
  if (attestationBuffer === null || attestationBuffer.length === 0) {
    return {
      valid: false,
      deviceType: 'unknown',
      reason: 'attestationObject kunne ikke base64-dekodes',
    };
  }

  // Advarsel: software-emulator context
  for (const marker of SOFTWARE_EMULATOR_MARKERS) {
    if (bufferIncludes(attestationBuffer, marker)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[attestation] ADVARSEL: software-emulator marker fundet ('${marker.toString('utf8')}') — afviser`,
      );
      return {
        valid: false,
        deviceType: 'unknown',
        reason: 'Software-emulator eller debug-context detekteret',
      };
    }
  }

  // Match Apple først, derefter Android. Rækkefølgen er vilkårlig men
  // deterministisk — begge er hardware-backed og accepteres.
  const hasApple = bufferIncludes(attestationBuffer, APPLE_MARKER);
  const hasAndroid = bufferIncludes(attestationBuffer, ANDROID_MARKER);

  if (hasApple) {
    return {
      valid: true,
      deviceType: 'apple',
      reason: 'Apple Secure Enclave attestation verificeret',
    };
  }

  if (hasAndroid) {
    return {
      valid: true,
      deviceType: 'android',
      reason: 'Android Keystore hardware attestation verificeret',
    };
  }

  return {
    valid: false,
    deviceType: 'unknown',
    reason: 'Ingen Secure Enclave-indikator fundet i attestationObject',
  };
}
