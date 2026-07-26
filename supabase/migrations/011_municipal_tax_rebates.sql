-- ====================================================================
-- Migration 011 · municipal_tax_rebates  [Fase 2 · Modul 11.3 · Afgiftsrabat]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 11 Reports/Localization
-- Formål: Kvartalsvis afgiftsrabat (DKK) baseret på borgerens dokumenterede
--         CO2-besparelse fra korrekt sortering. Rabatten beregnes af sovereign-
--         runtime (Modul 11.6 cron) ud fra total_weight_sorted_kg × zonens
--         rabat-rate; loft 500 DKK pr. kvartal jf. EU-PPWR statsstøtte-cap.
--         Én rebate-række pr. (user_id, kvartal). Udbetaling markeres af
--         kommune-portalen når banken har bekræftet transferen; paid_at
--         er kilde-af-sandhed for accounting-eksport (Modul 10.1).
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.municipal_tax_rebates (
    rebate_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                  UUID NOT NULL
                             REFERENCES public.profiles(id) ON DELETE CASCADE,
    municipal_zone           VARCHAR(100) NOT NULL,
    quarterly_period         VARCHAR(10) NOT NULL,
    total_weight_sorted_kg   NUMERIC(10, 3) NOT NULL DEFAULT 0,
    calculated_rebate_dkk    NUMERIC(8, 2) NOT NULL DEFAULT 0,
    paid_out                 BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at                  TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),

    -- Kvartals-periode på formen YYYY-QN, fx "2026-Q3". Fast længde 7,
    -- men VARCHAR(10) er buffer til fremtidig sub-periode (fx "2026-Q3a").
    CONSTRAINT municipal_tax_rebates_period_format_chk
        CHECK (quarterly_period ~ '^[0-9]{4}-Q[1-4]$'),

    -- Kommunezone må ikke være whitespace-blob.
    CONSTRAINT municipal_tax_rebates_zone_nonempty_chk
        CHECK (char_length(btrim(municipal_zone)) > 0),

    -- Vægten kan ikke være negativ. Øvre bound realistisk pr. borger pr.
    -- kvartal (10.000 kg = 10 tons) — over det = data-fejl fra smart-bin.
    CONSTRAINT municipal_tax_rebates_weight_range_chk
        CHECK (total_weight_sorted_kg >= 0 AND total_weight_sorted_kg <= 10000),

    -- Rabat capped 0-500 DKK jf. EU-PPWR statsstøtte-cap pr. borger/kvartal.
    CONSTRAINT municipal_tax_rebates_rebate_range_chk
        CHECK (calculated_rebate_dkk >= 0 AND calculated_rebate_dkk <= 500),

    -- paid_at skal være sat når paid_out = TRUE (og omvendt: NULL når FALSE).
    CONSTRAINT municipal_tax_rebates_paid_consistency_chk
        CHECK (
            (paid_out = FALSE AND paid_at IS NULL)
         OR (paid_out = TRUE  AND paid_at IS NOT NULL)
        ),

    -- paid_at kan ikke ligge før created_at når sat.
    CONSTRAINT municipal_tax_rebates_paid_after_created_chk
        CHECK (paid_at IS NULL OR paid_at >= created_at),

    -- Præcis én rebate-række pr. borger pr. kvartal — cron opdaterer in-place.
    CONSTRAINT municipal_tax_rebates_user_period_uniq
        UNIQUE (user_id, quarterly_period)
);

-- --------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------

-- Primær lookup fra borger-dashboard (F11.3): "vis mine seneste kvartaler".
-- DESC på period matcher UI-visning nyeste-øverst uden ekstra sort.
CREATE INDEX IF NOT EXISTS municipal_tax_rebates_user_period_idx
    ON public.municipal_tax_rebates(user_id, quarterly_period DESC);

-- Sekundær lookup fra kommune-portal + cron (F11.6): "hent alle ikke-udbetalte
-- rebates for zone X i periode Y" — partial index holder den lille og hurtig.
CREATE INDEX IF NOT EXISTS municipal_tax_rebates_zone_unpaid_idx
    ON public.municipal_tax_rebates(municipal_zone, quarterly_period)
    WHERE paid_out = FALSE;

-- --------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------

ALTER TABLE public.municipal_tax_rebates ENABLE ROW LEVEL SECURITY;

-- SELECT: borger ser kun sine egne rebates. Kommune-officerer får aggregeret
-- data via SECURITY DEFINER RPC (aldrig direkte row-adgang på tværs af CPR).
CREATE POLICY "Users read own tax rebates"
    ON public.municipal_tax_rebates FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: kun service_role (sovereign-runtime cron beregner og opretter
-- rebate-rækker ved kvartalsafslutning). Ingen client-side INSERT.
CREATE POLICY "Service role inserts tax rebates"
    ON public.municipal_tax_rebates FOR INSERT
    TO service_role
    WITH CHECK (TRUE);

-- UPDATE: kun service_role (markering af paid_out/paid_at fra bank-webhook,
-- samt genberegning ved sen-ankommet vægt-data).
CREATE POLICY "Service role updates tax rebates"
    ON public.municipal_tax_rebates FOR UPDATE
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- DELETE: kun service_role. Rebates er finansielle bilag og bevares typisk
-- 5 år (bogføringsloven); hard-delete reserveret til GDPR-anmodninger.
CREATE POLICY "Service role deletes tax rebates"
    ON public.municipal_tax_rebates FOR DELETE
    TO service_role
    USING (TRUE);

-- --------------------------------------------------------------------
-- Triggers
-- --------------------------------------------------------------------

-- Auto-update updated_at ved hver row-mutation. Genbrug fælles handler fra 001.
CREATE TRIGGER trg_municipal_tax_rebates_updated_at
    BEFORE UPDATE ON public.municipal_tax_rebates
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
