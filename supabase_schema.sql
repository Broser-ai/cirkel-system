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
