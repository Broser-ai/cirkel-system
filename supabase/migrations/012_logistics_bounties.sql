-- ====================================================================
-- Migration 012 · logistics_bounties  [Fase 2 · Modul 12.2 · Collector-marked]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 12 Return / Collector Bounty
-- Formål: Bounty-marked for registrerede kollektorer. Sovereign-runtime
--         (Modul 12.2 collector-tildeling) opretter en bounty når en asset
--         kræver kollektor-handling:
--           - bulky_pickup     → henter et opslag fra bulky_waste_marketplace
--                                (asset_id peger på item_id i modul 19)
--           - full_bin_empty   → tømmer en overfuld smart_bins-station
--           - maintenance      → service/reparation på smart_bin eller udstyr
--         Bounty er offentligt læsbar for alle kollektorer (user_type =
--         'collector'), så de kan browse markedet. Claim, complete, expire
--         og cancel foregår kun via SECURITY DEFINER RPC under service_role
--         (sovereign-runtime holder state-maskinen konsistent med asset).
--         Indexes tuned til de to primære queries: "list ledige bounties af
--         type X" og "vis mine tildelte bounties".
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.logistics_bounties (
    bounty_id         VARCHAR(50) PRIMARY KEY,
    asset_id          UUID
                      REFERENCES public.bulky_waste_marketplace(item_id)
                      ON DELETE SET NULL,
    event_type        VARCHAR(30) NOT NULL
                      CHECK (event_type IN (
                          'bulky_pickup',
                          'full_bin_empty',
                          'maintenance'
                      )),
    payout_dkk        NUMERIC(8, 2) NOT NULL
                      CHECK (payout_dkk > 0),
    latitude          NUMERIC(10, 7) NOT NULL
                      CHECK (latitude BETWEEN -90 AND 90),
    longitude         NUMERIC(10, 7) NOT NULL
                      CHECK (longitude BETWEEN -180 AND 180),
    status            VARCHAR(20) NOT NULL DEFAULT 'pending_claim'
                      CHECK (status IN (
                          'pending_claim',
                          'claimed',
                          'completed',
                          'expired',
                          'cancelled'
                      )),
    claimed_by        UUID
                      REFERENCES public.profiles(id) ON DELETE SET NULL,
    claim_deadline    TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),

    -- bulky_pickup KRÆVER en asset (skal pege på et opslag i modul 19).
    -- full_bin_empty / maintenance kan være asset-løse (fx planlagt runde).
    CONSTRAINT logistics_bounties_bulky_requires_asset_chk
        CHECK (
            event_type <> 'bulky_pickup'
            OR asset_id IS NOT NULL
        ),

    -- claimed/completed KRÆVER en kollektor på flaget.
    -- pending_claim / expired / cancelled må ikke have en claimer.
    CONSTRAINT logistics_bounties_claim_status_consistency_chk
        CHECK (
            (status IN ('claimed', 'completed')
                AND claimed_by IS NOT NULL)
            OR
            (status IN ('pending_claim', 'expired', 'cancelled')
                AND claimed_by IS NULL)
        ),

    -- completed_at KUN når status = 'completed'.
    CONSTRAINT logistics_bounties_completed_at_consistency_chk
        CHECK (
            (status = 'completed' AND completed_at IS NOT NULL)
            OR
            (status <> 'completed' AND completed_at IS NULL)
        ),

    -- claim_deadline skal ligge efter created_at når sat.
    CONSTRAINT logistics_bounties_deadline_future_chk
        CHECK (
            claim_deadline IS NULL
            OR claim_deadline > created_at
        ),

    -- completed_at kan ikke ligge før created_at (sanity check).
    CONSTRAINT logistics_bounties_completed_after_created_chk
        CHECK (
            completed_at IS NULL
            OR completed_at >= created_at
        )
);

-- --------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------

-- Primær marked-query: "vis alle pending_claim af type bulky_pickup".
-- Kombineret (status, event_type) rammer både filter og facet-count.
CREATE INDEX IF NOT EXISTS logistics_bounties_status_event_type_idx
    ON public.logistics_bounties(status, event_type);

-- Kollektor-dashboard: "vis mine tildelte og gennemførte bounties".
-- Partial index holder den lille — kun rækker med claimer.
CREATE INDEX IF NOT EXISTS logistics_bounties_claimed_by_idx
    ON public.logistics_bounties(claimed_by)
    WHERE claimed_by IS NOT NULL;

-- --------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------

ALTER TABLE public.logistics_bounties ENABLE ROW LEVEL SECURITY;

-- SELECT: kun registrerede kollektorer (profiles.user_type = 'collector').
-- Almindelige borgere ser aldrig bounty-markedet — det er et B2B-lag.
-- Sovereign-runtime læser via service_role (bypasser RLS pr. definition).
CREATE POLICY "Registered collectors read bounties"
    ON public.logistics_bounties FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.user_type = 'collector'
        )
    );

-- INSERT: kun service_role. Bounties oprettes af sovereign-runtime når en
-- asset skifter til en tilstand der kræver kollektor (fx bulky item
-- reserveret, smart_bin >= 90% fill, planlagt maintenance). Ingen client
-- må oprette bounties direkte — payout_dkk skal signeres af runtime.
CREATE POLICY "Service role inserts bounties"
    ON public.logistics_bounties FOR INSERT
    TO service_role
    WITH CHECK (TRUE);

-- UPDATE: kun service_role. Claim / complete / expire / cancel foregår via
-- SECURITY DEFINER RPC (claim_bounty, complete_bounty) der validerer
-- state-transitions og holder asset (bulky_waste_marketplace / smart_bins)
-- synkroniseret med bounty-status.
CREATE POLICY "Service role updates bounties"
    ON public.logistics_bounties FOR UPDATE
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- DELETE: kun service_role. Afsluttede bounties bevares som audit-log
-- (sovereign-ledger-koblet payout-historik) — hard-delete reserveret til
-- GDPR-anmodninger via runtime.
CREATE POLICY "Service role deletes bounties"
    ON public.logistics_bounties FOR DELETE
    TO service_role
    USING (TRUE);

-- --------------------------------------------------------------------
-- Triggers
-- --------------------------------------------------------------------

-- Auto-update updated_at ved hver row-mutation. Genbrug fælles handler fra 001.
CREATE TRIGGER trg_logistics_bounties_updated_at
    BEFORE UPDATE ON public.logistics_bounties
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
