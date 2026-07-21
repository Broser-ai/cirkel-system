-- ====================================================================
-- Migration 001 · Schema consolidation  [Fase 1 · Modul 6.1 / Schema]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 6.1
-- Formål: Etablér supabase_schema.sql (rod) som eneste kanoniske skema.
--         Fjern duplikeret supabase/schema.sql. Bevar wallets-idé som
--         fremtidig migration i stedet for divergerende sandhedskilde.
-- Dato:   2026-07-20
-- Status: Ingen DB-ændring — dette er en repo-hygiejne-migration.
-- ====================================================================

-- Denne migration udfører INGEN SQL på live-DB.
-- Alle live-tabeller (profiles, scans, ledger, rewards, redemptions,
-- achievements, user_achievements, emission_factors, portal_features)
-- forbliver uændrede.

-- === HVAD DER ER SKET UDEN FOR DENNE FIL ===
-- 1. supabase/schema.sql slettet (var 119-linje divergens med wallets-tabel
--    der aldrig blev deployet til live).
-- 2. supabase_schema.sql (rod) er nu ENESTE kanoniske skema-fil.
--    Reference: 200 linjer, definerer profiles + scans + ledger med
--    calculate_ledger_hash() SHA-256 chain + write-once policies.

-- === WALLETS-TABEL (bevaret som fremtidig option) ===
-- Den slettede supabase/schema.sql definerede en wallets-tabel der ikke er
-- live. Hvis wallet-deposits skal spores separat fra profiles.balance,
-- kør denne som migration 002 EFTER Michael's [ACCEPTED-BY-MICHAEL]:
--
-- CREATE TABLE IF NOT EXISTS public.wallets (
--     user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
--     deposit_balance NUMERIC(10, 2) DEFAULT 0.00 NOT NULL CHECK (deposit_balance >= 0),
--     created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
--     updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
-- );
-- ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users read own wallet"
--     ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- === KENDTE ANDRE MIGRATIONS ANVENDT LIVE (ikke gemt før nu) ===
-- add_user_type_to_profiles           (TRIN 2, ~2026-07-06)
-- add_portal_features_admin_flags     (TRIN 3, ~2026-07-07)
-- restrict_set_portal_features_to_service_role  (TRIN 3 hotfix, ~2026-07-07)
-- Disse bør retro-dokumenteres som migrations 002-004.

SELECT 'Consolidation migration executed (no-op on live DB)' AS status;
