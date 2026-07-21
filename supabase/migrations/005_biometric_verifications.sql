-- ====================================================================
-- Migration 005 · Biometric verifications  [Fase 2 · Modul 5.1 · Anti-Fraud]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 5.1
-- Formål: Log hver gang bruger biometrisk-verificeres (WebAuthn assertion,
--         MitID-genbekræftelse eller device-fingerprint match). Bruges af
--         fraud-engine (F3.5) til risk-scoring per scan/redeem.
-- Dato:   2026-07-20
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.biometric_verifications (
    verification_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_fingerprint      VARCHAR(255),
    webauthn_credential_id  VARCHAR(255) REFERENCES public.webauthn_credentials(credential_id) ON DELETE SET NULL,
    verification_method     VARCHAR(30) NOT NULL DEFAULT 'webauthn'
        CHECK (verification_method IN ('webauthn', 'mitid', 'device_fingerprint', 'passkey')),
    ip_address              INET,
    user_agent              TEXT,
    verification_result     VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (verification_result IN ('success', 'failed', 'timeout')),
    verified_at             TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS biometric_verifications_user_id_idx
    ON public.biometric_verifications(user_id);

CREATE INDEX IF NOT EXISTS biometric_verifications_time_idx
    ON public.biometric_verifications(verified_at DESC);

CREATE INDEX IF NOT EXISTS biometric_verifications_device_fp_idx
    ON public.biometric_verifications(device_fingerprint)
    WHERE device_fingerprint IS NOT NULL;

ALTER TABLE public.biometric_verifications ENABLE ROW LEVEL SECURITY;

-- SELECT: bruger ser egen verifikationshistorik
CREATE POLICY "Users see own verifications"
    ON public.biometric_verifications FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: bruger indsætter egen verifikations-log via WebAuthn-flow
CREATE POLICY "Users log own verifications"
    ON public.biometric_verifications FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- UPDATE/DELETE: forbudt — append-only log (fraud-audit integritet)
CREATE POLICY "Verifications immutable (deny update)"
    ON public.biometric_verifications FOR UPDATE
    USING (FALSE);

CREATE POLICY "Verifications immutable (deny delete)"
    ON public.biometric_verifications FOR DELETE
    USING (FALSE);
