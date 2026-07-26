-- ====================================================================
-- Migration 013 · b2b_producers  [Fase 2 · Modul 10 · B2B-portal]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 10 B2B Producer Portal
-- Formål: Registrér virksomheder (producenter) der køber sig ind på Cirkel-
--         platformen for adgang til B2B-portalen (Modul 10.1 Recharts-dashboard,
--         Modul 10.2 EU-PPWR-rapport, Modul 10.3 materiale-matching). Én række
--         pr. juridisk enhed identificeret ved CVR. Abonnement (tier) og
--         månedlig fee opkræves via Stripe (stripe_customer_id kobler til
--         Stripe Billing); remaining_funds er prepaid saldo brugt til
--         pay-per-use afregning af scan-events og materiale-transaktioner.
--         Skrives af B2B-onboarding-flow (service_role via SECURITY DEFINER
--         RPC efter CVR-validering mod Virk.dk). Læses af producenten selv
--         på portalen via Supabase Auth-session matched på contact_email.
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.b2b_producers (
    producer_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name          VARCHAR(255) NOT NULL,
    cvr_number            VARCHAR(20) NOT NULL,
    contact_email         TEXT NOT NULL,
    stripe_customer_id    VARCHAR(255),
    subscription_tier     VARCHAR(20) NOT NULL DEFAULT 'standard'
        CHECK (subscription_tier IN ('standard', 'premium', 'enterprise')),
    monthly_fee_dkk       NUMERIC(8, 2) NOT NULL DEFAULT 0,
    remaining_funds       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    activated_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),

    -- Firmanavn må ikke være whitespace-blob.
    CONSTRAINT b2b_producers_company_name_nonempty_chk
        CHECK (char_length(btrim(company_name)) > 0),

    -- Dansk CVR: præcis 8 cifre. VARCHAR(20) er buffer til fremtidig EU-VAT
    -- (fx "DK12345678"), men baseline valideres på 8 cifre for DK-only launch.
    CONSTRAINT b2b_producers_cvr_format_chk
        CHECK (cvr_number ~ '^[0-9]{8}$'),

    -- Kontakt-email valideres let (RFC-lite) — bruges som portal-login-nøgle
    -- mod Supabase Auth-session (auth.jwt()->>'email').
    CONSTRAINT b2b_producers_contact_email_chk
        CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

    -- Stripe-customer-id formatet (cus_XXXX) valideres let når sat.
    CONSTRAINT b2b_producers_stripe_customer_format_chk
        CHECK (stripe_customer_id IS NULL
            OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),

    -- Månedlig fee kan ikke være negativ. Øvre bound realistisk pr. enterprise-
    -- kunde (999.999,99 DKK/md) — over det = data-fejl fra onboarding-flow.
    CONSTRAINT b2b_producers_monthly_fee_range_chk
        CHECK (monthly_fee_dkk >= 0 AND monthly_fee_dkk <= 999999.99),

    -- Prepaid saldo kan ikke være negativ (spec-krav). Overskredet balance
    -- håndteres ved at pause producenten (is_active = FALSE), ikke ved
    -- negative rows — audit-krav fra bogføringsloven.
    CONSTRAINT b2b_producers_remaining_funds_nonneg_chk
        CHECK (remaining_funds >= 0),

    -- activated_at kan ikke ligge før created_at når sat.
    CONSTRAINT b2b_producers_activated_after_created_chk
        CHECK (activated_at IS NULL OR activated_at >= created_at),

    -- Aktiv producent skal have et aktiverings-tidsstempel. Inaktive rows
    -- (draft/paused) kan have NULL activated_at.
    CONSTRAINT b2b_producers_active_requires_activation_chk
        CHECK (is_active = FALSE OR activated_at IS NOT NULL),

    -- Én producent pr. CVR. UNIQUE-constraint (bliver også backing-index for
    -- CVR-lookup fra onboarding-flow's "findes denne CVR allerede?"-check).
    CONSTRAINT b2b_producers_cvr_uniq
        UNIQUE (cvr_number),

    -- Én producent-portal-login pr. email. Bruges af RLS-policy til at
    -- matche auth.jwt()->>'email' mod contact_email.
    CONSTRAINT b2b_producers_contact_email_uniq
        UNIQUE (contact_email),

    -- Én Stripe-customer pr. producent. NULLS NOT DISTINCT er IKKE brugt her
    -- — flere producenter kan være i draft (NULL stripe_customer_id) samtidig,
    -- men når Stripe-customer først er oprettet skal den være unik.
    CONSTRAINT b2b_producers_stripe_customer_uniq
        UNIQUE (stripe_customer_id)
);

-- --------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------

-- CVR-lookup fra onboarding-flow ("er denne CVR allerede registreret?").
-- UNIQUE-constraint ovenfor giver backing-index; eksplicit index her for
-- læsbarhed og idempotent re-run af migrationen.
CREATE INDEX IF NOT EXISTS b2b_producers_cvr_number_idx
    ON public.b2b_producers(cvr_number);

-- Aktive producenter er den primære work-set for cron-jobs (Stripe-fee-cyklus,
-- remaining_funds-payload) og portal-dashboards. Partial index holder den
-- lille og hurtig når inaktive/paused-rows akkumulerer over tid.
CREATE INDEX IF NOT EXISTS b2b_producers_is_active_idx
    ON public.b2b_producers(is_active)
    WHERE is_active = TRUE;

-- --------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------

ALTER TABLE public.b2b_producers ENABLE ROW LEVEL SECURITY;

-- SELECT: producenten ser kun sin egen række via portalen. Portal-login går
-- via Supabase Auth, og session-JWT'ens email-claim matches mod contact_email.
-- Ingen cross-producent-adgang — hver B2B-kunde er isoleret jf. GDPR.
CREATE POLICY "Producers read own row"
    ON public.b2b_producers FOR SELECT
    USING (auth.jwt() ->> 'email' = contact_email);

-- INSERT: kun service_role. Onboarding-flow går via SECURITY DEFINER RPC
-- efter CVR-validering mod Virk.dk og Stripe-customer-oprettelse. Ingen
-- client-side INSERT — forhindrer at portal-brugere selv-onboarder.
CREATE POLICY "Service role inserts producers"
    ON public.b2b_producers FOR INSERT
    TO service_role
    WITH CHECK (TRUE);

-- UPDATE: kun service_role. Ændringer i tier, fee, remaining_funds og
-- is_active kommer fra Stripe-webhooks (fee-opkrævning, subscription-change)
-- og admin-portalen. Producenten selv redigerer via SECURITY DEFINER RPC
-- (opdater kontakt-email, forny abonnement) — aldrig direkte row-adgang.
CREATE POLICY "Service role updates producers"
    ON public.b2b_producers FOR UPDATE
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- DELETE: kun service_role. B2B-producenter er finansielle bilag og bevares
-- typisk 5 år (bogføringsloven); soft-delete via is_active = FALSE
-- foretrækkes. Hard-delete reserveret til GDPR-anmodninger.
CREATE POLICY "Service role deletes producers"
    ON public.b2b_producers FOR DELETE
    TO service_role
    USING (TRUE);

-- --------------------------------------------------------------------
-- Triggers
-- --------------------------------------------------------------------

-- Auto-update updated_at ved hver row-mutation. Genbrug fælles handler fra 001.
CREATE TRIGGER trg_b2b_producers_updated_at
    BEFORE UPDATE ON public.b2b_producers
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
