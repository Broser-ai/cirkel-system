-- ====================================================================
-- CIRKEL SQL SETUP SCRIPT FOR SUPABASE BACKEND
-- Project: Cirkel Link - Durable Cryptographic Ledger System
-- Purpose: Schema definitions for profiles, scans, and ledger tables 
--          including cryptographic SHA-256 chains & RLS Policies.
-- ====================================================================

-- 0. EXTENSIONS SETUP
-- Enable pgcrypto for advanced cryptographic hash generation (SHA-256) and UUID generators
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ====================================================================
-- 1. PROFILES TABLE
-- ====================================================================
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    full_name text not null,
    email text not null unique,
    municipality text not null default 'Aarhus Kommune',
    balance numeric(10, 2) not null default 0.00 check (balance >= 0),
    points integer not null default 0 check (points >= 0),
    scans_count integer not null default 0 check (scans_count >= 0),
    co2_saved_kg numeric(10, 2) not null default 0.00 check (co2_saved_kg >= 0),
    streak_days integer not null default 0 check (streak_days >= 0),
    level integer not null default 1 check (level >= 1),
    member_status text not null default 'Standard-medlem' check (member_status in ('Standard-medlem', 'Sølv-medlem', 'Guld-medlem')),
    verification_tier text not null default 'standard' check (verification_tier in ('standard', 'cpr', 'mitid')),
    is_mitid_verified boolean not null default false,
    referral_code text unique,
    has_applied_referral boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ====================================================================
-- 2. SCANS TABLE
-- ====================================================================
create table public.scans (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references public.profiles(id) on delete cascade not null,
    barcode text not null,
    material text not null,
    weight_grams numeric(10, 2) not null check (weight_grams > 0),
    sorting_compliance numeric(5, 2) not null default 100.00 check (sorting_compliance >= 0.00 and sorting_compliance <= 100.00),
    points_earned integer not null check (points_earned >= 0),
    kroner_earned numeric(10, 2) not null check (kroner_earned >= 0),
    is_processed boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for speedy queries on user's history
create index scans_user_id_idx on public.scans(user_id);
create index scans_created_at_idx on public.scans(created_at desc);

-- ====================================================================
-- 3. CRYPTO LEDGER TABLE (Append-only Cryptographic Chain)
-- ====================================================================
create table public.ledger (
    id bigserial primary key,
    scan_id uuid references public.scans(id) on delete restrict not null,
    user_id uuid references public.profiles(id) on delete restrict not null,
    points integer not null,
    balance numeric(10, 2) not null,
    prev_hash text not null,
    hash text not null,
    is_valid boolean not null default true,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index to query ledger chain order
create index ledger_id_idx on public.ledger(id asc);
create index ledger_user_id_idx on public.ledger(user_id);

-- ====================================================================
-- 4. CRYPTOGRAPHIC INTEGRITY GENERATION (AUTOMATIC SHA-256 CHAINS)
-- ====================================================================

-- Function to compute secure block hashes using SHA-256 and salt parameters
create or replace function public.calculate_ledger_hash()
returns trigger as $$
declare
    v_prev_hash text;
    v_combined_payload text;
begin
    -- Seek the previous block associated with this chain
    select hash into v_prev_hash 
    from public.ledger 
    order by id desc 
    limit 1;
    
    if v_prev_hash is null then
        -- Genesis block fallback hash signature
        new.prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
    else
        new.prev_hash := v_prev_hash;
    end if;

    -- Concatenate payloads: prev_hash + scan_id + points + balance + user_id
    v_combined_payload := concat(
        new.prev_hash, 
        new.scan_id::text, 
        new.points::text, 
        new.balance::text, 
        new.user_id::text
    );

    -- Compute SHA-256 hex digest
    new.hash := encode(digest(v_combined_payload, 'sha256'), 'hex');
    
    return new;
end;
$$ language plpgsql;

-- Trigger to automate hash allocation on block insertions
create trigger trg_calculate_ledger_hash
    before insert on public.ledger
    for each row
    execute function public.calculate_ledger_hash();

-- ====================================================================
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS on all tables to prevent cross-tenant data leaks
alter table public.profiles enable row level security;
alter table public.scans enable row level security;
alter table public.ledger enable row level security;

-- A. PROFILES POLICIES
create policy "Users can read their own profile details"
    on public.profiles for select
    using (auth.uid() = id);

create policy "Users can modify their own profile assets"
    on public.profiles for update
    using (auth.uid() = id);

-- B. SCANS POLICIES
create policy "Users can read their own scans list"
    on public.scans for select
    using (auth.uid() = user_id);

create policy "Users can record new scans"
    on public.scans for insert
    with check (auth.uid() = user_id);

-- C. LEDGER POLICIES (Strict Append-only restrictions)
create policy "Users can view their cryptographic ledger chain"
    on public.ledger for select
    using (auth.uid() = user_id);

create policy "Users can append new ledger block verification entries"
    on public.ledger for insert
    with check (auth.uid() = user_id);

-- Explicitly ban update and delete queries on the ledger table to ensure tamper-proofing
create policy "Ledger is write-once (deny updates)"
    on public.ledger for update
    using (false);

create policy "Ledger is write-once (deny deletions)"
    on public.ledger for delete
    using (false);

-- ====================================================================
-- 6. AUTOMATOR TRIGGERS (Real-time updates)
-- ====================================================================

-- Sync updated_at on profile schema edits
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
    before update on public.profiles
    for each row
    execute function public.handle_updated_at();

-- Automatically provision an empty profile upon Supabase auth registration
create or replace function public.handle_new_user_signup()
returns trigger as $$
begin
    insert into public.profiles (id, full_name, email)
    values (
        new.id, 
        coalesce(new.raw_user_meta_data->>'full_name', 'Mads Hansen'), 
        new.email
    );
    return new;
end;
$$ language plpgsql security definer;

create trigger trg_on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user_signup();

-- ====================================================================
-- FUTURE (fra tidligere supabase/schema.sql — slettet 2026-07-20)
-- wallets-tabel var defineret der men aldrig deployet til live DB.
-- Kør som migration 002 EFTER [ACCEPTED-BY-MICHAEL] hvis wallet-deposits
-- skal spores separat fra profiles.balance:
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
-- ====================================================================

-- ====================================================================
-- 7. KPI AGGREGATION VIEWS
-- Purpose: Read-only aggregation views for dashboard KPIs (CO2, materials, engagement)
-- ====================================================================

-- A. Daglig CO2-besparelse og scan-antal
create or replace view public.kpi_co2_daily as
select
    date_trunc('day', created_at) as day,
    sum(co2_grams) / 1000.0 as total_co2_kg,
    count(*) as scan_count
from public.scans
group by 1;

-- B. Materiale-fordeling (vægt + CO2 pr. materialetype)
create or replace view public.kpi_material_breakdown as
select
    material,
    count(*) as scan_count,
    sum(weight_grams) / 1000.0 as total_kg,
    sum(co2_grams) / 1000.0 as total_co2_kg
from public.scans
group by material;

-- C. Ugentligt bruger-engagement (unikke brugere, scans, gns. vægt)
create or replace view public.kpi_user_engagement as
select
    date_trunc('week', s.created_at) as week,
    count(distinct s.user_id) as unique_users,
    count(*) as total_scans,
    avg(s.weight_grams) as avg_weight_grams
from public.scans s
group by 1;

-- ====================================================================
-- 8. MIGRATIONS APPLIED ON TOP OF THIS BASELINE
-- ====================================================================
-- Denne fil (supabase_schema.sql) er baseline-skemaet (profiles, scans,
-- ledger, KPI-views). Live-DB har yderligere tabeller tilføjet via
-- migrations under supabase/migrations/. Se supabase/migrations/README.md
-- for fuld apply-ordre, FK-graf og cascade-tabel.
--
-- Kanonisk migrations-rækkefølge (verificeret 2026-07-26):
--   001_consolidate.sql               ← no-op (repo-hygiejne; etablerer
--                                       supabase_schema.sql som eneste
--                                       kanoniske skema-kilde)
--   [002 mangler bevidst — reserveret til retro-dok af udokumenterede
--    live-migrations: add_user_type_to_profiles,
--    add_portal_features_admin_flags,
--    restrict_set_portal_features_to_service_role]
--   003_webauthn_credentials.sql      → public.webauthn_credentials
--                                       (FK → profiles)
--   004_smart_bins.sql                → public.smart_bins
--                                       (bruger baseline handle_updated_at)
--   005_biometric_verifications.sql   → public.biometric_verifications
--                                       (FK → profiles CASCADE,
--                                        webauthn_credentials fra 003
--                                        SET NULL; append-only log)
--   006_kommune_waste_stats.sql       → public.kommune_waste_stats
--                                       + view kommune_waste_daily
--                                       (FK → smart_bins fra 004 CASCADE)
--   007_cases.sql                     → public.cases
--                                       (FK → profiles CASCADE,
--                                        scans SET NULL,
--                                        assigned_to→profiles SET NULL)
--   008_material_passports.sql        → public.material_passports
--                                       (producer_id nullable UUID — soft
--                                        reference til b2b_producers fra 013,
--                                        FK ikke enforced pga. seed-order)
--   009_bulky_waste_marketplace.sql   → public.bulky_waste_marketplace
--                                       (FK → profiles CASCADE,
--                                        collector_user_id→profiles SET NULL)
--   010_municipal_rule_overrides.sql  → public.municipal_rule_overrides
--                                       + view municipal_rule_overrides_active
--   011_municipal_tax_rebates.sql     → public.municipal_tax_rebates
--                                       (FK → profiles CASCADE)
--   012_logistics_bounties.sql        → public.logistics_bounties
--                                       (FK → bulky_waste_marketplace fra 009
--                                        SET NULL, claimed_by→profiles
--                                        SET NULL; RLS-policy læser
--                                        profiles.user_type — sat af
--                                        udokumenteret live-migration
--                                        add_user_type_to_profiles TRIN 2)
--   013_b2b_producers.sql             → public.b2b_producers
--                                       (ingen FK; UNIQUE på cvr_number,
--                                        contact_email, stripe_customer_id)
--   014_mitid_wallet_tables.sql       → public.mitid_pkce_state,
--                                       wallet_balances, wallet_pool_state,
--                                       wallet_payouts
--                                       (FK → profiles CASCADE ×2,
--                                        b2b_producers fra 013 CASCADE,
--                                        wallet_payouts.user_id RESTRICT;
--                                        definerer EGEN set_updated_at()
--                                        i stedet for baseline
--                                        handle_updated_at — kendt drift)
--   015_push_subscriptions.sql        → public.push_subscriptions
--                                       (ingen FK; server-only RLS,
--                                        firebase_uid som logisk ejer)
--
-- KENDTE UDOKUMENTEREDE LIVE-MIGRATIONS (ikke gemt som .sql-filer):
--   add_user_type_to_profiles                    (TRIN 2, ~2026-07-06)
--   add_portal_features_admin_flags              (TRIN 3, ~2026-07-07)
--   restrict_set_portal_features_to_service_role (TRIN 3 hotfix)
-- Disse bør retro-dokumenteres som migrations 002/002a/002b når prioriteret.
--
-- KNOWN SCHEMA-DRIFT (bevidst ikke rettet her — kræver [ACCEPTED-BY-MICHAEL]):
--   * kpi_co2_daily + kpi_material_breakdown refererer scans.co2_grams,
--     men public.scans har ikke den kolonne (kun weight_grams). Views vil
--     fejle med 42703 hvis kaldt før scans udvides. Rettes ved enten:
--       (a) ALTER TABLE public.scans ADD COLUMN co2_grams NUMERIC(12,2);
--       (b) omskriv views til at bruge weight_grams × emission_factors-lookup.
--   * migration 008.producer_id har ingen hard FK til b2b_producers (013).
--     Tilføj efter behov:
--       ALTER TABLE public.material_passports
--         ADD CONSTRAINT material_passports_producer_fk
--         FOREIGN KEY (producer_id) REFERENCES public.b2b_producers(producer_id)
--         ON DELETE SET NULL;
--   * migration 014 definerer public.set_updated_at() i stedet for at genbruge
--     baseline public.handle_updated_at(). To parallelle funktioner med samme
--     effekt. Konsolider til handle_updated_at() ved næste refactor.
--   * migration 012.logistics_bounties RLS-policy læser profiles.user_type
--     som ikke er defineret i baseline (kun live via TRIN 2). Ny RLS-check
--     vil fejle på et clean-slate lokalt setup indtil migration 002 skrives.
-- ====================================================================
