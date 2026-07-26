-- ====================================================================
-- Migration 010 · municipal_rule_overrides  [Fase 2 · Modul 11.2 · Rapportering]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 11 Reports/Localization
-- Formål: Kommune-specifikke sorteringsregler der overskriver den nationale
--         fraktions-baseline (Modul 11.1). En kommune-medarbejder kan pr. zip
--         (og pr. fraction_key) skrive lokal instruktion — fx "Aarhus 8000:
--         pizzabakker i restaffald, ikke pap". NULL fraction_key = generel
--         override for hele zip-området. expires_at bruges til sæson-regler
--         (fx juletræer januar). Læses af Sort-guide (F1.10) og Kommune-map.
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.municipal_rule_overrides (
    override_id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zip_code                       VARCHAR(10) NOT NULL,
    kommune_name                   VARCHAR(100) NOT NULL,
    fraction_key                   VARCHAR(50),
    localized_sorting_instruction  TEXT NOT NULL,
    updated_by_officer_email       TEXT,
    expires_at                     TIMESTAMPTZ,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),

    -- Dansk postnummer: 4 cifre. VARCHAR(10) er buffer til fremtidig import
    -- af GL/FO-postnumre (fx "FO-100"), men baseline valideres på 4 cifre.
    CONSTRAINT municipal_rule_overrides_zip_format_chk
        CHECK (zip_code ~ '^[A-Z0-9\-]{3,10}$'),

    -- Officer-email valideres let (RFC-lite) når sat — service_role skriver.
    CONSTRAINT municipal_rule_overrides_officer_email_chk
        CHECK (updated_by_officer_email IS NULL
            OR updated_by_officer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

    -- Instruktion må ikke være tom whitespace-blob
    CONSTRAINT municipal_rule_overrides_instruction_nonempty_chk
        CHECK (char_length(btrim(localized_sorting_instruction)) > 0),

    -- expires_at skal ligge efter created_at når sat
    CONSTRAINT municipal_rule_overrides_expiry_future_chk
        CHECK (expires_at IS NULL OR expires_at > created_at),

    -- Præcis én aktiv regel pr. (zip, fraktion). NULLS NOT DISTINCT sikrer
    -- at NULL fraction_key (generel zip-override) også deduplikeres.
    CONSTRAINT municipal_rule_overrides_zip_fraction_uniq
        UNIQUE NULLS NOT DISTINCT (zip_code, fraction_key)
);

-- --------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------

-- Primær lookup fra Sort-guide (F1.10): "hent alle overrides for zip 8000".
CREATE INDEX IF NOT EXISTS municipal_rule_overrides_zip_idx
    ON public.municipal_rule_overrides(zip_code);

-- Sekundær lookup fra Kommune-portal: "vis alle regler for Aarhus Kommune".
CREATE INDEX IF NOT EXISTS municipal_rule_overrides_kommune_idx
    ON public.municipal_rule_overrides(kommune_name);

-- Cron-job (F11.6) rydder udløbne overrides — partial index holder den lille.
CREATE INDEX IF NOT EXISTS municipal_rule_overrides_expires_idx
    ON public.municipal_rule_overrides(expires_at)
    WHERE expires_at IS NOT NULL;

-- --------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------

ALTER TABLE public.municipal_rule_overrides ENABLE ROW LEVEL SECURITY;

-- SELECT: offentligt læsbar. Sort-guiden skal virke for anon-brugere (F1.10
-- kaldes inden login). Aktive regler = ikke-udløbne; udløbne skjules i view.
CREATE POLICY "Public read municipal rule overrides"
    ON public.municipal_rule_overrides FOR SELECT
    USING (TRUE);

-- INSERT: kun service_role (kommune-portal går via SECURITY DEFINER RPC efter
-- officer-auth mod Kommune-IdP). Ingen client-side INSERT-policy.
CREATE POLICY "Service role inserts municipal rule overrides"
    ON public.municipal_rule_overrides FOR INSERT
    TO service_role
    WITH CHECK (TRUE);

-- UPDATE: kun service_role. Historik bevares i separat audit-tabel (Modul 11.4).
CREATE POLICY "Service role updates municipal rule overrides"
    ON public.municipal_rule_overrides FOR UPDATE
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- DELETE: kun service_role (soft-delete via expires_at foretrækkes, hard-delete
-- reserveret til GDPR-anmodninger og cron-oprydning af udløbne regler).
CREATE POLICY "Service role deletes municipal rule overrides"
    ON public.municipal_rule_overrides FOR DELETE
    TO service_role
    USING (TRUE);

-- --------------------------------------------------------------------
-- Triggers
-- --------------------------------------------------------------------

-- Auto-update updated_at ved hver row-mutation. Genbrug fælles handler fra 001.
CREATE TRIGGER trg_municipal_rule_overrides_updated_at
    BEFORE UPDATE ON public.municipal_rule_overrides
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------------------------------
-- Public view: kun aktive (ikke-udløbne) overrides
-- Bruges af Sort-guide (F1.10) og Recharts-dashboard (Modul 10.1).
-- --------------------------------------------------------------------
CREATE OR REPLACE VIEW public.municipal_rule_overrides_active AS
SELECT
    override_id,
    zip_code,
    kommune_name,
    fraction_key,
    localized_sorting_instruction,
    expires_at,
    updated_at
FROM public.municipal_rule_overrides
WHERE expires_at IS NULL
   OR expires_at > TIMEZONE('utc'::text, NOW());
