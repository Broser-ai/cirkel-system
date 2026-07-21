-- ====================================================================
-- Migration 006 · Kommune waste stats  [Fase 2 · Modul 6/11 · Rapportering]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 6 Data · Modul 11 Reports
-- Formål: Per-bin, per-kommune timeseries af affalds-delta. Kilde til
--         B2B-portalens Recharts-dashboards og kommune-benchmarks.
--         Skrives via IoT-ingest når smart_bins.current_weight_kg ændres.
-- Dato:   2026-07-20
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.kommune_waste_stats (
    stat_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bin_id           VARCHAR(50) NOT NULL REFERENCES public.smart_bins(bin_id) ON DELETE CASCADE,
    kommune_navn     VARCHAR(100) NOT NULL,
    material_type    VARCHAR(50),
    weight_delta_kg  NUMERIC(10, 3) NOT NULL,
    co2_offset_g     NUMERIC(12, 2),
    recorded_at      TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS kommune_waste_stats_kommune_time_idx
    ON public.kommune_waste_stats(kommune_navn, recorded_at DESC);

CREATE INDEX IF NOT EXISTS kommune_waste_stats_bin_idx
    ON public.kommune_waste_stats(bin_id);

CREATE INDEX IF NOT EXISTS kommune_waste_stats_material_time_idx
    ON public.kommune_waste_stats(material_type, recorded_at DESC)
    WHERE material_type IS NOT NULL;

ALTER TABLE public.kommune_waste_stats ENABLE ROW LEVEL SECURITY;

-- SELECT: public (kommune-statistik er offentlig; brugt til map + reports)
CREATE POLICY "Public read waste stats"
    ON public.kommune_waste_stats FOR SELECT
    USING (TRUE);

-- INSERT/UPDATE/DELETE: kun service_role (IoT-ingest via SECURITY DEFINER RPC).
-- Ingen client-side write-policy — statistik ejes af Cirkel-drift.

-- ====================================================================
-- Aggregeret view for B2B-dashboard KPI-cards (Modul 10.1)
-- ====================================================================
CREATE OR REPLACE VIEW public.kommune_waste_daily AS
SELECT
    kommune_navn,
    material_type,
    DATE_TRUNC('day', recorded_at) AS day,
    SUM(weight_delta_kg) AS total_weight_kg,
    SUM(co2_offset_g) / 1000.0 AS total_co2_kg,
    COUNT(*) AS event_count
FROM public.kommune_waste_stats
GROUP BY kommune_navn, material_type, DATE_TRUNC('day', recorded_at);
