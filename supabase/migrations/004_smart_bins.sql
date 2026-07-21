-- ====================================================================
-- Migration 004 · Smart bins registry  [Fase 2 · Modul 6/12 · IoT retur]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 6 Data · Modul 12 Return
-- Formål: Registry af fysiske "smarte spande" (IoT-udstyrede returpunkter).
--         Data offentlig-læselig (map + fill-level), skrivning kun via
--         service_role fra IoT-ingest-endpoint.
-- Dato:   2026-07-20
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.smart_bins (
    bin_id                 VARCHAR(50) PRIMARY KEY,
    kommune_navn           VARCHAR(100) NOT NULL,
    latitude               NUMERIC(10, 7) NOT NULL,
    longitude              NUMERIC(10, 7) NOT NULL,
    current_weight_kg      NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (current_weight_kg >= 0),
    fill_level_percentage  INTEGER NOT NULL DEFAULT 0 CHECK (fill_level_percentage BETWEEN 0 AND 100),
    operating_status       VARCHAR(20) NOT NULL DEFAULT 'Operational'
        CHECK (operating_status IN ('Operational', 'Maintenance', 'Offline', 'Full')),
    last_iot_ping          TIMESTAMPTZ,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS smart_bins_kommune_active_idx
    ON public.smart_bins(kommune_navn, is_active);

CREATE INDEX IF NOT EXISTS smart_bins_geo_idx
    ON public.smart_bins(latitude, longitude);

CREATE INDEX IF NOT EXISTS smart_bins_ping_idx
    ON public.smart_bins(last_iot_ping DESC);

ALTER TABLE public.smart_bins ENABLE ROW LEVEL SECURITY;

-- SELECT: alle authenticated + anon kan se aktive bins (til map-display)
CREATE POLICY "Public read active bins"
    ON public.smart_bins FOR SELECT
    USING (is_active = TRUE);

-- INSERT/UPDATE/DELETE: kun service_role (IoT-ingest via SECURITY DEFINER RPC).
-- Ingen client-side write-policy — bins ejes af Cirkel-drift, ikke slutbrugere.

-- Auto-update timestamp trigger
CREATE TRIGGER trg_smart_bins_updated_at
    BEFORE UPDATE ON public.smart_bins
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
