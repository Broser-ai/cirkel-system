-- ====================================================================
-- Migration 009 · bulky_waste_marketplace  [Fase 2 · Modul 19 · Storskrald]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 19 IKEA-like give-away
-- Formål: P2P give-away marketplace for storskrald (møbler, hvidevarer,
--         legetøj, byggematerialer). Ejeren opretter et opslag med foto,
--         volumetrisk profil (m3) og placering; en kollektor kan reservere
--         og hente inden claim_deadline. Tre håndteringsspor:
--           - free_giveaway    → borger-til-borger, gratis
--           - municipal_pickup → kommunal storskrald-afhentning (Modul 6)
--           - paid_collection  → tredjepart mod betaling (Modul 12)
--         Kortvisning og filtre på F1.19 læser fra dette table; write kun
--         af ejer (INSERT/UPDATE eget opslag) eller service_role (state-
--         maskine og claim-timeouts fra sovereign-runtime).
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.bulky_waste_marketplace (
    item_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL
                        REFERENCES public.profiles(id) ON DELETE CASCADE,
    item_title          TEXT NOT NULL
                        CHECK (char_length(item_title) BETWEEN 3 AND 200),
    description         TEXT
                        CHECK (description IS NULL OR char_length(description) <= 4000),
    volumetric_profile  JSONB NOT NULL DEFAULT '{}'::jsonb,
    handling_type       VARCHAR(30) NOT NULL DEFAULT 'free_giveaway'
                        CHECK (handling_type IN (
                            'free_giveaway',
                            'municipal_pickup',
                            'paid_collection'
                        )),
    latitude            NUMERIC(10, 7) NOT NULL
                        CHECK (latitude BETWEEN -90 AND 90),
    longitude           NUMERIC(10, 7) NOT NULL
                        CHECK (longitude BETWEEN -180 AND 180),
    current_status      VARCHAR(20) NOT NULL DEFAULT 'available'
                        CHECK (current_status IN (
                            'available',
                            'reserved',
                            'claimed',
                            'collected',
                            'expired'
                        )),
    claim_deadline      TIMESTAMPTZ,
    collector_user_id   UUID
                        REFERENCES public.profiles(id) ON DELETE SET NULL,
    image_urls          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
                        CHECK (array_length(image_urls, 1) IS NULL
                            OR array_length(image_urls, 1) <= 10),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),

    -- Ejeren kan ikke være egen kollektor (undgår self-claim fraud)
    CONSTRAINT bulky_waste_no_self_claim
        CHECK (collector_user_id IS NULL OR collector_user_id <> user_id),

    -- reserved/claimed/collected kræver kollektor; available/expired må ikke have en
    CONSTRAINT bulky_waste_collector_status_consistency
        CHECK (
            (current_status IN ('reserved', 'claimed', 'collected')
                AND collector_user_id IS NOT NULL)
            OR
            (current_status IN ('available', 'expired')
                AND collector_user_id IS NULL)
        )
);

-- Primær kort-query: aktive opslag i geografisk box (F1.19 map viewport).
CREATE INDEX IF NOT EXISTS bulky_waste_status_geo_idx
    ON public.bulky_waste_marketplace(current_status, latitude, longitude);

-- Ejerens egne opslag (dashboard "Mine opslag").
CREATE INDEX IF NOT EXISTS bulky_waste_user_id_idx
    ON public.bulky_waste_marketplace(user_id);

-- Kollektorens reservationer (dashboard "Mine afhentninger").
CREATE INDEX IF NOT EXISTS bulky_waste_collector_idx
    ON public.bulky_waste_marketplace(collector_user_id)
    WHERE collector_user_id IS NOT NULL;

-- Claim-deadline sweep (sovereign-runtime expire-job kører hvert 15. min).
CREATE INDEX IF NOT EXISTS bulky_waste_deadline_idx
    ON public.bulky_waste_marketplace(claim_deadline)
    WHERE claim_deadline IS NOT NULL
      AND current_status IN ('reserved', 'claimed');

ALTER TABLE public.bulky_waste_marketplace ENABLE ROW LEVEL SECURITY;

-- SELECT: aktive opslag er offentlige (kortet skal virke pre-login), mens
-- reserved/claimed/collected kun ses af ejer og valgt kollektor.
CREATE POLICY "Public read available bulky items"
    ON public.bulky_waste_marketplace FOR SELECT
    USING (current_status = 'available');

CREATE POLICY "Owner and collector read own bulky items"
    ON public.bulky_waste_marketplace FOR SELECT
    USING (
        auth.uid() = user_id
        OR auth.uid() = collector_user_id
    );

-- INSERT: bruger opretter kun opslag i eget navn og altid med status
-- 'available' + ingen kollektor (state-maskinen håndterer resten).
CREATE POLICY "Users create own bulky items"
    ON public.bulky_waste_marketplace FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND current_status = 'available'
        AND collector_user_id IS NULL
    );

-- UPDATE: kun ejer må redigere; user_id kan aldrig ændres. State-transitions
-- der involverer kollektor (reserved/claimed/collected) foregår via
-- SECURITY DEFINER RPC under service_role — ikke via denne policy.
CREATE POLICY "Owner updates own bulky items"
    ON public.bulky_waste_marketplace FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE: kun ejer, og kun mens opslaget stadig er ledigt eller udløbet
-- (afsluttede afhentninger bevares som audit-log).
CREATE POLICY "Owner deletes own available bulky items"
    ON public.bulky_waste_marketplace FOR DELETE
    USING (
        auth.uid() = user_id
        AND current_status IN ('available', 'expired')
    );

-- Auto-update timestamp trigger (bruger fælles handle_updated_at fra 001).
CREATE TRIGGER trg_bulky_waste_marketplace_updated_at
    BEFORE UPDATE ON public.bulky_waste_marketplace
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
