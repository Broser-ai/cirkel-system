-- ====================================================================
-- Migration 007 · cases  [Fase 2 · Modul 5.2 · Case Management]
-- Master-spec: docs/CIRKEL-EVERYTHING-v3.md · Modul 5.2 Fraud + Disputes
-- Formål: Case-management for fraud-review + disputes. Kobler brugere
--         (og evt. den udløsende scan) til en behandlingssag med status,
--         prioritet og tildelt sagsbehandler. Skrives af fraud-engine
--         (F3.5) og B2B-admin-portal; læses af bruger (egne sager) og
--         admin-flader via service_role.
-- Dato:   2026-07-21
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.cases (
    case_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scan_id       UUID REFERENCES public.scans(id) ON DELETE SET NULL,
    case_type     VARCHAR(20) NOT NULL
        CHECK (case_type IN ('fraud_review', 'dispute', 'refund', 'complaint')),
    status        VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_review', 'resolved', 'rejected')),
    assigned_to   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    priority      INTEGER NOT NULL DEFAULT 3
        CHECK (priority BETWEEN 1 AND 5),
    description   TEXT NOT NULL,
    resolution    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Primær work-queue index: åbne/høj-prioritets-sager først i admin-dashboard.
CREATE INDEX IF NOT EXISTS cases_status_priority_idx
    ON public.cases(status, priority DESC);

-- Bruger-scoped lookup: "Mine sager"-visning på brugerprofilen.
CREATE INDEX IF NOT EXISTS cases_user_id_idx
    ON public.cases(user_id);

-- Sagsbehandler-scoped lookup: admin-medarbejderens egen arbejdsliste.
CREATE INDEX IF NOT EXISTS cases_assigned_to_idx
    ON public.cases(assigned_to)
    WHERE assigned_to IS NOT NULL;

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

-- SELECT: bruger ser kun sine egne sager (både som ejer og som tildelt sagsbehandler).
CREATE POLICY "Users see own cases"
    ON public.cases FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = assigned_to);

-- INSERT: kun service_role opretter sager (fraud-engine / admin-portal via
-- SECURITY DEFINER RPC). Ingen client-side INSERT — forhindrer at brugere
-- sender falske disputes uden om fraud-engine.
CREATE POLICY "Service role inserts cases"
    ON public.cases FOR INSERT
    WITH CHECK (FALSE);

-- UPDATE: kun service_role opdaterer status, resolution og assigned_to.
-- Brugeren kan ikke selv markere en case som "resolved" — kun admin-flow.
CREATE POLICY "Service role updates cases"
    ON public.cases FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

-- DELETE: forbudt for alle roller på client-siden — sager er audit-trail
-- (fraud-history skal bevares). Hard-delete kræver direkte DB-adgang.
CREATE POLICY "Cases immutable (deny delete)"
    ON public.cases FOR DELETE
    USING (FALSE);

-- Auto-update timestamp trigger (bruger fælles handle_updated_at fra 001).
CREATE TRIGGER trg_cases_updated_at
    BEFORE UPDATE ON public.cases
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
