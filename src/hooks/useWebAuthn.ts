// cirkel-system/src/hooks/useWebAuthn.ts
//
// JUDGE-01 React hook — wraps registerCredential/authenticateCredential
// og håndterer server-round-trip.

import { useState, useCallback } from 'react';
import {
  isWebAuthnAvailable,
  isPlatformAuthenticatorAvailable,
  registerCredential,
  authenticateCredential,
} from '../lib/webauthn-client';

export type WebAuthnStatus = 'idle' | 'checking' | 'unavailable' | 'ready' | 'in_progress' | 'success' | 'error';

export interface WebAuthnState {
  status: WebAuthnStatus;
  error: string | null;
  sub_hash: string | null;
  platform_available: boolean;
}

export function useWebAuthn() {
  const [state, setState] = useState<WebAuthnState>({
    status: 'idle',
    error: null,
    sub_hash: null,
    platform_available: false,
  });

  const checkAvailability = useCallback(async () => {
    setState(s => ({ ...s, status: 'checking' }));
    if (!isWebAuthnAvailable()) {
      setState({ status: 'unavailable', error: 'WebAuthn ikke understøttet af browseren', sub_hash: null, platform_available: false });
      return;
    }
    const platform = await isPlatformAuthenticatorAvailable();
    setState(s => ({ ...s, status: 'ready', platform_available: platform, error: null }));
  }, []);

  const register = useCallback(async () => {
    setState(s => ({ ...s, status: 'in_progress', error: null }));
    try {
      const challengeRes = await fetch('/api/webauthn/challenge?intent=register', { credentials: 'include' });
      if (!challengeRes.ok) throw new Error('challenge endpoint fejlede');
      const challenge = await challengeRes.json();

      const cred = await registerCredential(challenge);

      const registerRes = await fetch('/api/webauthn/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cred),
      });
      if (!registerRes.ok) {
        const err = await registerRes.json().catch(() => ({ error: 'unknown' }));
        throw new Error(`register endpoint fejlede: ${err.error}`);
      }
      const body = await registerRes.json();
      setState({ status: 'success', error: null, sub_hash: body.sub_hash, platform_available: true });
      return body;
    } catch (err: any) {
      setState(s => ({ ...s, status: 'error', error: String(err?.message ?? err) }));
      throw err;
    }
  }, []);

  const authenticate = useCallback(async (allowCredentialIds?: string[]) => {
    setState(s => ({ ...s, status: 'in_progress', error: null }));
    try {
      const challengeRes = await fetch('/api/webauthn/challenge?intent=authenticate', { credentials: 'include' });
      if (!challengeRes.ok) throw new Error('challenge endpoint fejlede');
      const challenge = await challengeRes.json();
      challenge.allow_credentials = allowCredentialIds ?? [];

      const auth = await authenticateCredential(challenge);
      const authRes = await fetch('/api/webauthn/authenticate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auth),
      });
      if (!authRes.ok) {
        const err = await authRes.json().catch(() => ({ error: 'unknown' }));
        throw new Error(`authenticate endpoint fejlede: ${err.error}`);
      }
      const body = await authRes.json();
      setState({ status: 'success', error: null, sub_hash: body.sub_hash, platform_available: true });
      return body;
    } catch (err: any) {
      setState(s => ({ ...s, status: 'error', error: String(err?.message ?? err) }));
      throw err;
    }
  }, []);

  return { state, checkAvailability, register, authenticate };
}
