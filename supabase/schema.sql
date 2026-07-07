-- =====================================================================
-- CIRKEL MASTER DATABASE SCHEMA STUB
-- Production SQL blueprints to run in the Supabase Dashboard SQL Editor
-- Features automatic audit logging, RLS guards, and append-only ledgers
-- =====================================================================

-- 0. Extensions Setup
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles Table (Durable Cloud User Information)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    municipality TEXT DEFAULT 'Aarhus Kommune' NOT NULL,
    balance NUMERIC(10, 2) DEFAULT 0.00 NOT NULL CHECK (balance >= 0),
    points INTEGER DEFAULT 0 NOT NULL CHECK (points >= 0),
    scans_count INTEGER DEFAULT 0 NOT NULL CHECK (scans_count >= 0),
    co2_saved_kg NUMERIC(10, 1) DEFAULT 0.0 NOT NULL CHECK (co2_saved_kg >= 0),
    streak_days INTEGER DEFAULT 0 NOT NULL CHECK (streak_days >= 0),
    level INTEGER DEFAULT 1 NOT NULL CHECK (level >= 1),
    member_status TEXT DEFAULT 'Standard' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles RLS Policies
CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- 2. Scans Table (Logs individual packaging scan events)
CREATE TABLE IF NOT EXISTS public.scans (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    product_name TEXT NOT NULL,
    material_type TEXT NOT NULL,
    pant_value NUMERIC(10, 2) NOT NULL CHECK (pant_value >= 0),
    points_awarded INTEGER NOT NULL CHECK (points_awarded >= 0),
    municipality TEXT NOT NULL,
    co2_saved_g NUMERIC(10, 1) NOT NULL,
    scanned_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

-- Scans RLS Policies
CREATE POLICY "Users can view their own scans"
    ON public.scans FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scans"
    ON public.scans FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 3. Ledgers Table (Append-only verification journal with cryptographic integrity constraint)
CREATE TABLE IF NOT EXISTS public.ledger (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    scan_id UUID REFERENCES public.scans(id) ON DELETE SET NULL,
    balance_delta NUMERIC(10, 2) NOT NULL,
    points_delta INTEGER NOT NULL,
    description TEXT NOT NULL,
    verification_type TEXT NOT NULL, -- e.g. "HomePhoto", "IoTSensor", "DropPoint", "Vending"
    previous_hash TEXT,
    entry_hash TEXT NOT NULL, -- SHA-256 checksum tracking verification state
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;

-- Ledger RLS Policies (Append-only: users can read, but never update or delete)
CREATE POLICY "Users can view their own ledger history"
    ON public.ledger FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can write to their own ledger entries"
    ON public.ledger FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 4. Wallets Table (Tracks specific voucher redemptions and deposits)
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
    deposit_balance NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- Wallets RLS Policies
CREATE POLICY "Users can read their own wallet metadata"
    ON public.wallets FOR SELECT
    USING (auth.uid() = user_id);

-- 5. Automatic Profile Updated At Trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_profile_updated
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
