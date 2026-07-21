-- ====================================================================
-- Migration 003 · WebAuthn credentials  [Fase 2 · Modul 5.1 / Anti-Fraud]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 5.1 Biometric verify
-- Formål: Persister WebAuthn public-keys per bruger for phishing-resistent
--         2FA på scan/redeem-mutations. Kobles til api/webauthn/*.
-- Dato:   2026-07-20
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
    credential_id     VARCHAR(255) PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    public_key        BYTEA NOT NULL,
    attestation_type  VARCHAR(50),
    device_name       VARCHAR(255),
    sign_count        INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
    transports        TEXT[] DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    last_used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_id_idx
    ON public.webauthn_credentials(user_id);

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

-- SELECT: bruger ser kun sine egne credentials
CREATE POLICY "Users see own credentials"
    ON public.webauthn_credentials FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: bruger registrerer credential på egen konto
CREATE POLICY "Users register own credentials"
    ON public.webauthn_credentials FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- DELETE: bruger fjerner egen credential (device-tab)
CREATE POLICY "Users delete own credentials"
    ON public.webauthn_credentials FOR DELETE
    USING (auth.uid() = user_id);

-- UPDATE: kun sign_count og last_used_at må opdateres af service (via SECURITY DEFINER RPC).
-- Ingen client-side UPDATE policy — bevidst valg (replay-attack protection).
