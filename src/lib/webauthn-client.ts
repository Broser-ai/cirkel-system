// cirkel-system/src/lib/webauthn-client.ts
//
// JUDGE-01 opgradering: ægte WebAuthn (Modul 5.1).
// Passkey/FaceID/Fingerprint på borgerens telefon danner grundlag for
// Anontome-hash. Ingen CPR, ingen MitID i klient-siden.
//
// Flow:
//   1. Registrer: navigator.credentials.create({publicKey}) med server-genereret challenge
//   2. Server upserter profiles med mitid_uuid_hash = sha256(salt + '|webauthn|' + credentialId)
//   3. Login: navigator.credentials.get({publicKey}) mod eksisterende credentialId
//   4. Server verificerer signatur + issuer session-JWT

const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const RP_NAME = 'Cirkel';

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

export interface WebAuthnRegistrationChallenge {
  challenge: string;         // base64url
  user_handle: string;       // base64url (16 random bytes)
  user_name: string;         // display name (fx "borger@cirkel")
}

export interface WebAuthnAuthChallenge {
  challenge: string;         // base64url
  allow_credentials?: string[]; // base64url credential IDs
}

export function isWebAuthnAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;
  return true;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Register en ny WebAuthn credential (FaceID/Fingerprint/Windows Hello). */
export async function registerCredential(challenge: WebAuthnRegistrationChallenge): Promise<{
  credential_id: string;
  attestation_object: string;
  client_data_json: string;
}> {
  if (!isWebAuthnAvailable()) throw new Error('WebAuthn ikke tilgængelig i denne browser');

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToBuffer(challenge.challenge),
    rp: { id: RP_ID, name: RP_NAME },
    user: {
      id: base64UrlToBuffer(challenge.user_handle),
      name: challenge.user_name,
      displayName: challenge.user_name,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256 (nøjagtig hvad Apple/Google understøtter)
      { type: 'public-key', alg: -257 }, // RS256 (fallback for ældre autentifikatorer)
    ],
    timeout: 60_000,
    attestation: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
  };

  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
  if (!credential) throw new Error('WebAuthn registration returnerede null');

  const attestation = credential.response as AuthenticatorAttestationResponse;
  return {
    credential_id: bufferToBase64Url(credential.rawId),
    attestation_object: bufferToBase64Url(attestation.attestationObject),
    client_data_json: bufferToBase64Url(attestation.clientDataJSON),
  };
}

/** Login med eksisterende WebAuthn credential. */
export async function authenticateCredential(challenge: WebAuthnAuthChallenge): Promise<{
  credential_id: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
  user_handle: string | null;
}> {
  if (!isWebAuthnAvailable()) throw new Error('WebAuthn ikke tilgængelig i denne browser');

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToBuffer(challenge.challenge),
    rpId: RP_ID,
    timeout: 60_000,
    userVerification: 'required',
    allowCredentials: (challenge.allow_credentials ?? []).map(id => ({
      id: base64UrlToBuffer(id),
      type: 'public-key',
      transports: ['internal', 'hybrid'] as AuthenticatorTransport[],
    })),
  };

  const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
  if (!credential) throw new Error('WebAuthn authentication returnerede null');

  const assertion = credential.response as AuthenticatorAssertionResponse;
  return {
    credential_id: bufferToBase64Url(credential.rawId),
    authenticator_data: bufferToBase64Url(assertion.authenticatorData),
    client_data_json: bufferToBase64Url(assertion.clientDataJSON),
    signature: bufferToBase64Url(assertion.signature),
    user_handle: assertion.userHandle ? bufferToBase64Url(assertion.userHandle) : null,
  };
}

export const _webauthnInternal = { bufferToBase64Url, base64UrlToBuffer };
