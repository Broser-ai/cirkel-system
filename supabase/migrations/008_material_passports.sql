-- ====================================================================
-- Migration 008 · material_passports  [Fase 2 · Modul 8 · Materialepas]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 8 GS1/GTIN Materialepas
-- Formål: Public materialepas-registry indekseret på GS1/GTIN-stregkode.
--         Kobler stregkode -> produkt -> primær fraktion + kompositter,
--         base-reward-points for retur og EPR-afgift-mitigering (Modul 11).
--         Skrives af B2B-producenter (migration 013) via service_role;
--         læses af scanner-flow (F1.10) og retur-flow (Modul 12).
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.material_passports (
    barcode_id            VARCHAR(100) PRIMARY KEY,
    -- producer_id: FK til public.b2b_producers tilføjes i migration 013
    -- (b2b_producers-tabellen findes endnu ikke; nullable indtil da).
    producer_id           UUID,
    product_name          TEXT NOT NULL,
    primary_material      VARCHAR(100),
    composite_materials   JSONB NOT NULL DEFAULT '{}'::jsonb,
    danish_fraction       VARCHAR(50)
        CHECK (danish_fraction IN (
            'Restaffald',
            'Madaffald',
            'Plast',
            'Papir',
            'Pap',
            'Glas',
            'Metal',
            'Mad- og drikkekartoner',
            'Tekstil',
            'Farligt affald',
            'Elektronik',
            'Batterier'
        )),
    base_reward_points    INTEGER NOT NULL DEFAULT 1
        CHECK (base_reward_points >= 0),
    epr_penalty_dkk       NUMERIC(6, 2)
        CHECK (epr_penalty_dkk IS NULL OR epr_penalty_dkk >= 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS material_passports_primary_material_idx
    ON public.material_passports(primary_material)
    WHERE primary_material IS NOT NULL;

CREATE INDEX IF NOT EXISTS material_passports_producer_idx
    ON public.material_passports(producer_id)
    WHERE producer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS material_passports_fraction_idx
    ON public.material_passports(danish_fraction)
    WHERE danish_fraction IS NOT NULL;

ALTER TABLE public.material_passports ENABLE ROW LEVEL SECURITY;

-- SELECT: public (materialepas er offentlig information; scanner-flow
-- kalder tabellen anonymt før login, og B2B-portal viser konkurrent-pas).
CREATE POLICY "Public read material passports"
    ON public.material_passports FOR SELECT
    USING (TRUE);

-- INSERT: kun service_role (B2B-producent-portal skriver via SECURITY
-- DEFINER RPC; ingen client-side write).
CREATE POLICY "Service role inserts passports"
    ON public.material_passports FOR INSERT
    WITH CHECK (FALSE);

-- UPDATE: kun service_role.
CREATE POLICY "Service role updates passports"
    ON public.material_passports FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

-- DELETE: kun service_role (materialepas bør normalt aldrig slettes;
-- deprecate via producer-flag i migration 013).
CREATE POLICY "Service role deletes passports"
    ON public.material_passports FOR DELETE
    USING (FALSE);

-- Auto-update timestamp trigger (bruger fælles handle_updated_at fra 001).
CREATE TRIGGER trg_material_passports_updated_at
    BEFORE UPDATE ON public.material_passports
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
