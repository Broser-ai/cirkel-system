// cirkel-system/tests/attestation.test.ts
//
// Vitest-suite for verifyDeviceHardwareAttestation (api/_attestation.ts).
//
// Fokus:
//   - Happy-path         : Apple Secure Enclave attestation -> valid + deviceType='apple'
//   - Happy-path         : Android Keystore attestation     -> valid + deviceType='android'
//   - Reject             : unknown/generic attestation uden Secure Enclave-indikator
//   - Reject             : software-emulator, goldfish, ranchu, debug-context
//   - Edge/error-cases   : base64 decode-fejl, JSON-parse-fejl, forkert ceremonitype,
//                          manglende/tom challenge, tom attestationObject, base64url
//                          uden padding, forkert type-felt (constant-time).
//   - Determinism        : Ingen live network-calls. Ingen Date.now-brug i input.
//                          console.warn spione­res så testoutput er rent.
//
// Modulet er en ren funktion (ingen HTTP-handler), så supertest er ikke relevant her.
// Supabase/Firebase-mocks fra ./tests/setup indlæses globalt via vitest.config.ts,
// men bruges ikke direkte af denne suite.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  verifyDeviceHardwareAttestation,
  type AttestationResult,
  type DeviceType,
} from '../api/_attestation.js';

// ---------------------------------------------------------------------------
// Helpers — deterministiske base64 / base64url-encoders og payload-buildere
// ---------------------------------------------------------------------------

function toBase64(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64');
}

function toBase64Url(input: string | Buffer): string {
  return toBase64(input)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

interface ClientDataOverrides {
  type?: string;
  challenge?: string;
  origin?: string;
  crossOrigin?: boolean;
  extra?: Record<string, unknown>;
  omit?: ReadonlyArray<'type' | 'challenge'>;
}

const DEFAULT_CHALLENGE_B64URL = toBase64Url('challenge-bytes-deterministic-01');

/**
 * Bygger et gyldigt (eller kontrolleret ugyldigt) clientDataJSON — utf8 JSON
 * encodet til base64. Overrides kan tvinge felter til at mangle eller ændres.
 */
function makeClientDataJSON(overrides: ClientDataOverrides = {}): string {
  const base: Record<string, unknown> = {
    type: overrides.type ?? 'webauthn.create',
    challenge: overrides.challenge ?? DEFAULT_CHALLENGE_B64URL,
    origin: overrides.origin ?? 'https://cirkel.dk',
    crossOrigin: overrides.crossOrigin ?? false,
    ...(overrides.extra ?? {}),
  };
  if (overrides.omit) {
    for (const key of overrides.omit) delete base[key];
  }
  return toBase64(JSON.stringify(base));
}

/**
 * Bygger en base64-encoded attestationObject-payload der indeholder de
 * givne raw byte-mønstre. Vi laver ikke rigtig CBOR — modulet scanner blot
 * bytene for kendte markører, så en råstreng er tilstrækkelig og korrekt.
 */
function makeAttestationObject(markers: ReadonlyArray<string>): string {
  const prefix = Buffer.from([0xa3, 0x63, 0x66, 0x6d, 0x74]); // ligner CBOR-header
  const suffix = Buffer.from([0x00, 0xff, 0x11, 0x22]);
  const middle = Buffer.from(markers.join('|'), 'utf8');
  return toBase64(Buffer.concat([prefix, middle, suffix]));
}

// ---------------------------------------------------------------------------
// Fælles setup — dæmp console.warn så software-emulator-test ikke støjer
// ---------------------------------------------------------------------------

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
    // no-op — modulet logger advarsler ved emulator-detektion; vi verificerer
    // dem eksplicit i den relevante test i stedet for at printe dem.
  });
});

// ---------------------------------------------------------------------------
// Sanity — hjælpernes egen kontrakt (så tests ikke er falsk-grønne)
// ---------------------------------------------------------------------------

describe('test-hjælpere', () => {
  it('toBase64 og makeClientDataJSON producerer decodebar UTF-8 JSON', () => {
    const encoded = makeClientDataJSON();
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as {
      type: string;
      challenge: string;
      origin: string;
    };
    expect(parsed.type).toBe('webauthn.create');
    expect(parsed.challenge).toBe(DEFAULT_CHALLENGE_B64URL);
    expect(parsed.origin).toBe('https://cirkel.dk');
  });

  it('makeAttestationObject indlejrer angivne markører i base64-payload', () => {
    const encoded = makeAttestationObject(['apple']);
    const raw = Buffer.from(encoded, 'base64').toString('utf8');
    expect(raw).toContain('apple');
  });
});

// ---------------------------------------------------------------------------
// Happy-path — Apple og Android hardware attestation accepteres
// ---------------------------------------------------------------------------

describe('verifyDeviceHardwareAttestation — happy-path', () => {
  it('accepterer Apple Secure Enclave-attestation (valid + deviceType=apple)', () => {
    const clientDataJSON = makeClientDataJSON();
    const attestationObject = makeAttestationObject(['apple']);

    const result: AttestationResult = verifyDeviceHardwareAttestation(
      clientDataJSON,
      attestationObject,
    );

    expect(result).toEqual<AttestationResult>({
      valid: true,
      deviceType: 'apple',
      reason: 'Apple Secure Enclave attestation verificeret',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepterer Android Keystore hardware-attestation (valid + deviceType=android)', () => {
    const clientDataJSON = makeClientDataJSON();
    const attestationObject = makeAttestationObject(['android-key']);

    const result = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(result.valid).toBe(true);
    expect(result.deviceType).toBe<DeviceType>('android');
    expect(result.reason).toBe('Android Keystore hardware attestation verificeret');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('foretrækker Apple-branch når begge markører optræder (deterministisk rækkefølge)', () => {
    const clientDataJSON = makeClientDataJSON();
    // Bemærk: modulet søger Apple først, derefter Android. Vi verificerer at
    // rækkefølgen er deterministisk uanset hvor markørerne står i payload.
    const attestationObject = makeAttestationObject(['android-key', 'apple']);

    const result = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(result.valid).toBe(true);
    expect(result.deviceType).toBe<DeviceType>('apple');
    expect(result.reason).toBe('Apple Secure Enclave attestation verificeret');
  });

  it('accepterer base64url-encoded clientDataJSON uden padding', () => {
    // Encode clientDataJSON med base64url (uden '=' padding) og verificer at
    // modulets decodeBase64 normaliserer korrekt.
    const rawJson = JSON.stringify({
      type: 'webauthn.create',
      challenge: DEFAULT_CHALLENGE_B64URL,
      origin: 'https://cirkel.dk',
    });
    const clientDataJSON = toBase64Url(rawJson);
    const attestationObject = makeAttestationObject(['apple']);

    const result = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(result.valid).toBe(true);
    expect(result.deviceType).toBe<DeviceType>('apple');
  });
});

// ---------------------------------------------------------------------------
// Reject — ikke-Secure-Enclave-attestation
// ---------------------------------------------------------------------------

describe('verifyDeviceHardwareAttestation — afviser ikke-hardware attestation', () => {
  it('afviser attestation uden nogen Secure Enclave-markør (deviceType=unknown)', () => {
    const clientDataJSON = makeClientDataJSON();
    const attestationObject = makeAttestationObject(['generic-authenticator']);

    const result = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(result).toEqual<AttestationResult>({
      valid: false,
      deviceType: 'unknown',
      reason: 'Ingen Secure Enclave-indikator fundet i attestationObject',
    });
  });

  it('afviser fido-u2f attestation (indeholder ingen hardware-markør)', () => {
    const clientDataJSON = makeClientDataJSON();
    // Realistisk-lignende "none/packed" indhold — hverken 'apple' eller 'android-key'.
    const attestationObject = makeAttestationObject(['fido-u2f', 'packed']);

    const result = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      'Ingen Secure Enclave-indikator fundet i attestationObject',
    );
  });
});

// ---------------------------------------------------------------------------
// Reject — software-emulator og debug-context
// ---------------------------------------------------------------------------

describe('verifyDeviceHardwareAttestation — afviser software-emulator', () => {
  it.each([
    ['software', 'software'],
    ['emulator', 'emulator'],
    ['goldfish', 'Android emulator (goldfish kernel)'],
    ['ranchu', 'Android emulator (ranchu kernel)'],
  ] as const)(
    "afviser når attestationObject indeholder '%s' markør (%s)",
    (marker) => {
      const clientDataJSON = makeClientDataJSON();
      // Emulator-markør vinder over ellers gyldig apple-markør.
      const attestationObject = makeAttestationObject([marker, 'apple']);

      const result = verifyDeviceHardwareAttestation(
        clientDataJSON,
        attestationObject,
      );

      expect(result).toEqual<AttestationResult>({
        valid: false,
        deviceType: 'unknown',
        reason: 'Software-emulator eller debug-context detekteret',
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[attestation] ADVARSEL'),
      );
      expect(warnSpy.mock.calls[0][0]).toContain(marker);
    },
  );
});

// ---------------------------------------------------------------------------
// Edge/error — clientDataJSON-validering
// ---------------------------------------------------------------------------

describe('verifyDeviceHardwareAttestation — clientDataJSON-fejl', () => {
  it('afviser tomt clientDataJSON-input', () => {
    const result = verifyDeviceHardwareAttestation(
      '',
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe('clientDataJSON kunne ikke base64-dekodes');
  });

  it('afviser clientDataJSON med ugyldig base64-længde (remainder=1)', () => {
    // Længde % 4 === 1 er ugyldig base64 — decodeBase64 skal returnere null.
    const invalid = 'abcde'; // len=5 -> 5 % 4 = 1
    const result = verifyDeviceHardwareAttestation(
      invalid,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe('clientDataJSON kunne ikke base64-dekodes');
  });

  it('afviser når decoded clientDataJSON ikke er gyldig JSON', () => {
    const clientDataJSON = toBase64('this is not json {{{');
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe('clientDataJSON er ikke gyldig JSON');
  });

  it('afviser når clientDataJSON parser til et array (ikke et objekt)', () => {
    const clientDataJSON = toBase64(JSON.stringify(['not', 'an', 'object']));
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    // isClientData afviser arrays fordi typeof arr === 'object' men obj.type
    // ikke er en string.
    expect(result.reason).toBe(
      'clientDataJSON mangler krævede felter (type, challenge)',
    );
  });

  it("afviser når clientDataJSON parser til 'null'", () => {
    const clientDataJSON = toBase64('null');
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      'clientDataJSON mangler krævede felter (type, challenge)',
    );
  });

  it("afviser når type-feltet mangler", () => {
    const clientDataJSON = makeClientDataJSON({ omit: ['type'] });
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      'clientDataJSON mangler krævede felter (type, challenge)',
    );
  });

  it("afviser når challenge-feltet mangler", () => {
    const clientDataJSON = makeClientDataJSON({ omit: ['challenge'] });
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      'clientDataJSON mangler krævede felter (type, challenge)',
    );
  });

  it("afviser når challenge er en tom streng", () => {
    const clientDataJSON = makeClientDataJSON({ challenge: '' });
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    // Tom challenge fanges allerede af isClientData (kræver length > 0).
    expect(result.reason).toBe(
      'clientDataJSON mangler krævede felter (type, challenge)',
    );
  });

  it("afviser når challenge har ugyldig base64-længde", () => {
    // Ikke-tom string der passerer isClientData, men decodeBase64 fejler.
    const clientDataJSON = makeClientDataJSON({ challenge: 'x' });
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      'challenge er ikke gyldig base64url eller er tom',
    );
  });

  it("afviser forkert ceremonitype 'webauthn.get' (kun 'webauthn.create' accepteres)", () => {
    const clientDataJSON = makeClientDataJSON({ type: 'webauthn.get' });
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      "Forkert ceremonitype: forventede 'webauthn.create'",
    );
  });

  it("afviser type der er 'webauthn.create ' (constant-time længde-mismatch)", () => {
    // Ekstra whitespace — bufA.length !== bufB.length -> false, uden false-negative.
    const clientDataJSON = makeClientDataJSON({ type: 'webauthn.create ' });
    const result = verifyDeviceHardwareAttestation(
      clientDataJSON,
      makeAttestationObject(['apple']),
    );

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      "Forkert ceremonitype: forventede 'webauthn.create'",
    );
  });
});

// ---------------------------------------------------------------------------
// Edge/error — attestationObject-validering
// ---------------------------------------------------------------------------

describe('verifyDeviceHardwareAttestation — attestationObject-fejl', () => {
  it('afviser tomt attestationObject', () => {
    const clientDataJSON = makeClientDataJSON();
    const result = verifyDeviceHardwareAttestation(clientDataJSON, '');

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe('attestationObject kunne ikke base64-dekodes');
  });

  it('afviser attestationObject med ugyldig base64-længde', () => {
    const clientDataJSON = makeClientDataJSON();
    const result = verifyDeviceHardwareAttestation(clientDataJSON, 'z'); // len=1

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe('attestationObject kunne ikke base64-dekodes');
  });

  it('afviser attestationObject der decoder til tomme bytes', () => {
    // Base64 for tom Buffer er tom streng -> null, som fanges ovenfor.
    // Her tester vi at et opad-korrekt base64-input der decoder til 0 bytes
    // ikke findes: '' er allerede dækket, så vi bruger et attestationObject
    // som ellers ville passere men ingen kendte markører har.
    const clientDataJSON = makeClientDataJSON();
    // Rent whitespace/kontrol-bytes uden nogen af de kendte markører.
    const attestationObject = toBase64(Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(result.valid).toBe(false);
    expect(result.deviceType).toBe<DeviceType>('unknown');
    expect(result.reason).toBe(
      'Ingen Secure Enclave-indikator fundet i attestationObject',
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism — samme input giver samme output, ingen sideeffekter
// ---------------------------------------------------------------------------

describe('verifyDeviceHardwareAttestation — determinisme', () => {
  it('er ren funktion: samme input giver identisk output ved gentagne kald', () => {
    const clientDataJSON = makeClientDataJSON();
    const attestationObject = makeAttestationObject(['apple']);

    const first = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);
    const second = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);
    const third = verifyDeviceHardwareAttestation(clientDataJSON, attestationObject);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first).toEqual<AttestationResult>({
      valid: true,
      deviceType: 'apple',
      reason: 'Apple Secure Enclave attestation verificeret',
    });
  });
});
