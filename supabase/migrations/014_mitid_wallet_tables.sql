-- ====================================================================
-- Migration 014 · MitID PKCE state + Wallet payout tables
-- [Fase 1 QA-fix · Adresserer runtime 42P01 for mitid_pkce_state, wallet_payouts, wallet_balances, wallet_pool_state]
-- Dato: 2026-07-22
-- ====================================================================

-- Sikr uuid-ossp extension for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- Helper: generisk updated_at trigger-funktion (idempotent)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- 1) public.mitid_pkce_state
--    PKCE flow state storage (bruges af api/auth/mitid-init + mitid-verify)
--    Adgang: kun service_role via SECURITY DEFINER RPC. Client-side DENY.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.mitid_pkce_state (
    state          VARCHAR(64)  PRIMARY KEY,
    code_verifier  VARCHAR(128) NOT NULL,
    nonce          VARCHAR(64),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    user_id        UUID         NULL REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Index til cleanup-jobs (slet expired states)
CREATE INDEX IF NOT EXISTS idx_mitid_pkce_state_expires_at
    ON public.mitid_pkce_state (expires_at);

-- RLS: enable + total DENY for anon/authenticated. Kun service_role må røre tabellen.
ALTER TABLE public.mitid_pkce_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mitid_pkce_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mitid_pkce_state_deny_all ON public.mitid_pkce_state;
CREATE POLICY mitid_pkce_state_deny_all
    ON public.mitid_pkce_state
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.mitid_pkce_state IS
    'PKCE state storage for MitID OIDC flow. Skrives af mitid-init edge function, læses+slettes af mitid-verify. Kun service_role.';


-- ====================================================================
-- 2) public.wallet_balances
--    Bruger-wallet balance (DKK).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wallet_balances (
    user_id         UUID          PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    available_dkk   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (available_dkk >= 0),
    pending_dkk     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (pending_dkk >= 0),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Trigger til updated_at
DROP TRIGGER IF EXISTS trg_wallet_balances_updated_at ON public.wallet_balances;
CREATE TRIGGER trg_wallet_balances_updated_at
    BEFORE UPDATE ON public.wallet_balances
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- RLS: bruger må læse egen balance; INSERT/UPDATE/DELETE kun service_role
ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_balances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_balances_select_own ON public.wallet_balances;
CREATE POLICY wallet_balances_select_own
    ON public.wallet_balances
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Blokér skrivning fra klienter (INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS wallet_balances_deny_writes ON public.wallet_balances;
CREATE POLICY wallet_balances_deny_writes
    ON public.wallet_balances
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (
        -- SELECT tillades af den permissive policy ovenfor; her låser vi kun writes.
        -- RESTRICTIVE FOR ALL kombineret med SELECT-check=true betyder: SELECT passerer,
        -- men INSERT/UPDATE/DELETE fejler fordi WITH CHECK = false.
        true
    )
    WITH CHECK (false);

COMMENT ON TABLE public.wallet_balances IS
    'Bruger-wallet balance i DKK. Læses af bruger (RLS), skrives kun af service_role via ledger-RPC.';


-- ====================================================================
-- 3) public.wallet_pool_state
--    B2B producer pulje-state (remaining_funds, reserved_dkk).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wallet_pool_state (
    producer_id          UUID          PRIMARY KEY REFERENCES public.b2b_producers(producer_id) ON DELETE CASCADE,
    remaining_funds      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (remaining_funds >= 0),
    reserved_dkk         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reserved_dkk >= 0),
    last_replenished_at  TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Trigger til updated_at
DROP TRIGGER IF EXISTS trg_wallet_pool_state_updated_at ON public.wallet_pool_state;
CREATE TRIGGER trg_wallet_pool_state_updated_at
    BEFORE UPDATE ON public.wallet_pool_state
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- RLS: læses via service_role RPC (producer-ownership check gøres i RPC).
-- Klienter (anon/authenticated) blokeres helt her.
ALTER TABLE public.wallet_pool_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pool_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_pool_state_deny_all ON public.wallet_pool_state;
CREATE POLICY wallet_pool_state_deny_all
    ON public.wallet_pool_state
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.wallet_pool_state IS
    'B2B producer pool-state. Læses af producer-owner via SECURITY DEFINER RPC. Skrives kun af service_role.';


-- ====================================================================
-- 4) public.wallet_payouts
--    Payout historik (MobilePay, Stripe, manual).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wallet_payouts (
    payout_id       UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount_dkk      NUMERIC(10,2) NOT NULL CHECK (amount_dkk > 0),
    psp_provider    VARCHAR(30)   NOT NULL CHECK (psp_provider IN ('mobilepay','stripe','manual')),
    psp_reference   VARCHAR(255),
    danish_phone    VARCHAR(20),
    status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed','cancelled')),
    failure_reason  TEXT,
    initiated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_payouts_user_initiated
    ON public.wallet_payouts (user_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_payouts_status_initiated
    ON public.wallet_payouts (status, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_payouts_psp_reference
    ON public.wallet_payouts (psp_reference)
    WHERE psp_reference IS NOT NULL;

-- RLS: bruger må læse egne payouts; INSERT/UPDATE/DELETE kun service_role
ALTER TABLE public.wallet_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_payouts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_payouts_select_own ON public.wallet_payouts;
CREATE POLICY wallet_payouts_select_own
    ON public.wallet_payouts
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS wallet_payouts_deny_writes ON public.wallet_payouts;
CREATE POLICY wallet_payouts_deny_writes
    ON public.wallet_payouts
    AS RESTRICTIVE
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (false);

COMMENT ON TABLE public.wallet_payouts IS
    'Payout-historik pr. bruger. Bruger læser egne (RLS). Skrives kun af service_role via payout-orkestrering.';


-- ====================================================================
-- Grants: service_role har alt; anon/authenticated arver kun via RLS-policies ovenfor.
-- ====================================================================
GRANT ALL ON public.mitid_pkce_state  TO service_role;
GRANT ALL ON public.wallet_balances   TO service_role;
GRANT ALL ON public.wallet_pool_state TO service_role;
GRANT ALL ON public.wallet_payouts    TO service_role;

GRANT SELECT ON public.wallet_balances TO authenticated;
GRANT SELECT ON public.wallet_payouts  TO authenticated;

-- ====================================================================
-- Slut migration 014
-- ====================================================================
