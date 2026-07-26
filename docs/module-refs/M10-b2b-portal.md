# M10.1 — B2B-portal

**Modul:** M10.1 B2B-portal (multi-tenant web-portal for producenter og kommuner)
**Status:** Aktiv (grundlag deployed) — udvidelser i backlog
**Ejer:** Cirkel Core (portal-lag) + Cirkel Billing (Modul 10.2)
**Version:** 0.1 (draft)
**Sidst opdateret:** 2026-07-22
**Relaterede moduler:** M10.2 Billing/Stripe, M13 CSRD/EPR-rapportering, M17 Auth/RLS

---

## 1. Formål

Modul 10.1 leverer en **multi-tenant B2B web-portal** som giver producenter og kommuner selvbetjenings-adgang til Cirkel-platformens ESG-, kampagne- og compliance-funktioner.

Målgrupper:
- **Producenter** (`b2b_business`) — brands og fabrikanter der bruger Cirkel til EPR-registrering, take-back kampagner, materialesporing og CSRD-rapportering.
- **Kommuner** (`b2b_kommune`) — kommunale affaldsselskaber og myndigheder der bruger portalen til indsamlingsstatistik, borger-engagement og lovpligtig rapportering.

Portalen er **hard-multitenant**: hver bruger ser kun data tilknyttet deres `producer_id` / `kommune_id`, håndhævet på både API- og RLS-niveau.

---

## 2. Komponenter

Portalen består af seks primære komponenter, som loades dynamisk pr. tenant-type:

| Komponent        | Formål                                                   | Tenant-scope           |
|------------------|----------------------------------------------------------|------------------------|
| `B2BOverview`    | Landings-dashboard, KPI-cards, aktivitets-feed           | begge                  |
| `B2BCampaigns`   | Kampagne-styring (take-back, indsamling, incentives)     | begge (forskellig UX)  |
| `B2BReports`     | Rapport-generator: CSRD, EPR, ESRS, kommunale nøgletal   | begge                  |
| `B2BSettings`    | Tenant-konfiguration, brugere, brand-profil              | begge                  |
| `B2BCompliance`  | EU-PPWR, dansk affaldslovgivning, EPR-status             | primært `b2b_business` |
| `B2BAnalytics`   | Dybdegående analyse, kohorter, CO2-effekt, materialeflow | begge (forskellige datasæt) |

Alle komponenter er implementeret som React-moduler under `src/components/b2b/` og lazy-loades via portal-shell (`B2BPortalRoot`).

---

## 3. Data-flow

Hver komponent henter data via dedikerede API-endpoints. Ingen komponent tilgår Supabase direkte fra klienten — al adgang går gennem en autoriseret API-lag.

```
B2BOverview     ──> GET /api/kpi/overview?tenant_id=…
B2BCampaigns    ──> GET /api/kpi/campaigns
                   POST /api/portal-features/campaign
B2BReports      ──> POST /api/reports/csrd  (async job)
                   POST /api/reports/epr
                   GET  /api/reports/:job_id/status
B2BSettings     ──> GET/PATCH /api/portal-features/settings
B2BCompliance   ──> GET /api/kpi/compliance
                   POST /api/b2b-advisor  (LLM-drevet rådgiver)
B2BAnalytics    ──> GET /api/kpi/analytics
                   GET /api/kpi/materials-flow
```

**API-lagets ansvar:**
1. Verificér JWT (Supabase Auth)
2. Slå `user.user_type` og `producer_id` / `kommune_id` op via SECURITY DEFINER RPC
3. Route request til relevant tenant-scope
4. Filter alle DB-queries på tenant-id (redundant i forhold til RLS, men defense-in-depth)
5. Log request til `b2b_audit_log`

---

## 4. Portal-split (tenant-routing)

`user.user_type` styrer hvilke komponenter der loader ved portal-mount:

```ts
// src/components/b2b/B2BPortalRoot.tsx
function B2BPortalRoot({ user }: { user: User }) {
  const modules = getPortalModules(user.user_type);
  return (
    <PortalShell tenantType={user.user_type}>
      {modules.map(M => <M key={M.name} tenant={user} />)}
    </PortalShell>
  );
}

function getPortalModules(type: 'b2b_business' | 'b2b_kommune') {
  const shared = [B2BOverview, B2BCampaigns, B2BReports, B2BSettings, B2BAnalytics];
  if (type === 'b2b_business') return [...shared, B2BCompliance];
  if (type === 'b2b_kommune')  return [...shared, B2BKommuneInsights];
  throw new Error('unauthorized_tenant_type');
}
```

**UX-forskelle pr. tenant-type:**

| Aspekt                | b2b_business                          | b2b_kommune                        |
|-----------------------|---------------------------------------|------------------------------------|
| Landing KPI-fokus     | Salgs-volumen, take-back-rate         | Indsamlingsvolumen, borger-deltagelse |
| Rapport-defaults      | CSRD, EPR-årsrapport                  | Kommunale nøgletal, EU-PPWR        |
| Kampagne-typer        | Producent-drevne (rabat, garanti)     | Kommunale (indsamlingsdage, events) |
| Compliance-modul      | EU-PPWR + EPR + national afgift       | Lovpligtig rapportering (skjult UI) |
| Branding              | Producentens eget logo (whitelabel)   | Kommune-våben + Cirkel co-brand    |

---

## 5. Subscription tiers

Portalen håndhæver funktionalitet baseret på tenant's Stripe-subscription (se Modul 10.2).

| Tier         | Pris (DKK/md) | Målgruppe                     | Nøglefunktioner                                  |
|--------------|---------------|-------------------------------|--------------------------------------------------|
| **Standard** | 4.900         | SMB-producenter, mindre kommuner | Overview + Campaigns + basic Reports, 3 users, 10k events/md |
| **Premium**  | 14.900        | Mid-market                    | Alt i Standard + Compliance + Analytics + CSRD-export, 15 users, 100k events/md |
| **Enterprise** | custom      | Store producenter, storkommuner | Alt i Premium + dedicated advisor + SLA 99.9% + custom integrations + unlimited users |

**Feature-gating** sker via `entitlements`-tabel i Supabase, opdateret af Stripe webhooks:

```sql
create table portal_entitlements (
  tenant_id uuid primary key,
  tier text not null check (tier in ('standard','premium','enterprise')),
  features text[] not null default '{}',
  max_users int not null,
  max_events_per_month int not null,
  valid_until timestamptz,
  stripe_subscription_id text
);
```

Alle API-endpoints tjekker `entitlements.features` inden request behandles (feature-flag pr. tier).

---

## 6. Stripe billing setup (link til Modul 10.2)

Modul 10.2 (Billing) ejer den fulde Stripe-integration. Modul 10.1 er **konsument**, ikke ejer:

- **Signup-flow:** Ny B2B-bruger → Stripe Checkout → webhook `checkout.session.completed` → provisionér `portal_entitlements` row → send velkomst-mail
- **Upgrade/downgrade:** UI i `B2BSettings > Subscription` linker til Stripe Customer Portal (`/api/billing/portal-link`)
- **Payment failures:** Webhook `invoice.payment_failed` → grace-periode 7 dage → downgrade til read-only mode
- **Cancellation:** Webhook `customer.subscription.deleted` → sæt `valid_until = now()` → efter 30 dage: soft-delete tenant-data

Se **`docs/module-refs/M10.2-billing-stripe.md`** for endpoints, webhook-håndtering, price IDs og prorate-logik.

---

## 7. CSRD / EPR export flow

Rapport-generering er den mest krævende bruger-facing feature i modulet. Kører som async job:

```
1. User klikker "Generér CSRD-rapport 2025" i B2BReports
       |
       v
2. POST /api/reports/csrd
     - Body: { tenant_id, year, standards: ['ESRS_E1','ESRS_E5'], format: 'xlsx' }
     - Response: { job_id, status: 'queued' }
       |
       v
3. Backend job (Vercel background function / Supabase edge function):
     a. Hent data: materialeflow, CO2, take-back, EPR-registreringer
     b. Kør igennem materiality-engine (dobbelt materialitetsvurdering)
     c. Format til ESRS XBRL / EPR CSV / EU-PPWR templates
     d. Upload til Supabase Storage (`reports/{tenant_id}/{job_id}.xlsx`)
     e. Insert i `report_jobs` med signed URL (24h expiry)
       |
       v
4. UI poller GET /api/reports/:job_id/status hvert 3. sekund
       |
       v
5. Status 'completed' → download-knap vises → signed URL åbnes i ny fane
```

**Supported formater:**
- CSRD/ESRS: XBRL (XML), XLSX-rapport til revisor
- EPR: nationale skemaer (DK: Dansk Producentansvar; EU: national variants pr. land)
- EU-PPWR: standard-templates (skabelon fra Modul Sweep Intelligence)
- Kommunale nøgletal: CSV + PDF-summary

**Audit trail:** Hver eksport logges i `sovereign_audit_trail` med input-hash, generator-version, revisor-token — jf. audit-engine i Sweep Intelligence.

---

## 8. Adgangsstyring

To lag beskytter tenant-data:

### 8.1 API-lag: `producer_id` + admin_check

Alle B2B-endpoints kalder en SECURITY DEFINER RPC ved request-start:

```sql
create or replace function public.get_b2b_context(p_user_id uuid)
returns table(tenant_id uuid, tenant_type text, is_admin boolean, features text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    coalesce(u.producer_id, u.kommune_id) as tenant_id,
    u.user_type,
    exists(select 1 from tenant_admins where user_id = p_user_id) as is_admin,
    coalesce(e.features, '{}') as features
  from users u
  left join portal_entitlements e on e.tenant_id = coalesce(u.producer_id, u.kommune_id)
  where u.id = p_user_id;
end;
$$;
```

Hvorfor SECURITY DEFINER: klienten må aldrig kunne skrive `producer_id` selv i request-body — det skal altid hentes fra serversidens session-kontekst.

### 8.2 DB-lag: RLS-politikker

Alle tenant-scoped tabeller har RLS aktiveret. Standard-mønster:

```sql
alter table campaigns enable row level security;

create policy campaigns_tenant_read on campaigns
  for select using (
    tenant_id = (select coalesce(producer_id, kommune_id) from users where id = auth.uid())
  );

create policy campaigns_tenant_write on campaigns
  for all using (
    tenant_id = (select coalesce(producer_id, kommune_id) from users where id = auth.uid())
    and exists (select 1 from tenant_admins where user_id = auth.uid())
  );
```

**Admin-check:** Kun brugere i `tenant_admins` kan skrive. Almindelige brugere er read-only. Enterprise-tier kan definere granulær rolle-model (`viewer`, `editor`, `finance`, `compliance_officer`).

### 8.3 Auditlog

Alle write-operationer skriver til `b2b_audit_log`:

```
b2b_audit_log(id, tenant_id, user_id, action, resource_type, resource_id, before_json, after_json, ip, user_agent, ts)
```

Retention: 7 år (CSRD-krav for finansielt-relaterede handlinger, ellers 3 år).

---

## 9. Åbne spørgsmål / backlog

1. **SSO for Enterprise-tier** — SAML/OIDC integration mangler (Okta, Azure AD). Skal på plads inden første Enterprise-kunde onboardes.
2. **API-adgang for kunder** — nogle Enterprise-kunder efterspørger read-only REST/GraphQL API. Kræver rate-limiting og API-key-management. Ikke prioriteret Q3 2026.
3. **White-label domæner** — Premium+ ønsker `portal.brand.dk` i stedet for `brand.cirkel.dk`. Kræver DNS-verifikation + cert-provisioning (Cloudflare for SaaS).
4. **Kommune-only funktioner** — borgerhenvendelses-inbox og indsamlings-ruteoptimering er efterspurgt, men ligger uden for kernescope. Overvej som separat modul M10.3.
5. **Datalokation** — Nogle kommuner kræver DK-only data-processing. Nuværende Supabase-region er `eu-central-1` (Frankfurt) — acceptabelt jf. GDPR, men skal dokumenteres eksplicit i DPA.

---

## 10. Referencer

- Cirkel Master Architecture — `docs/module-refs/M00-master-architecture.md` (planlagt)
- Modul 10.2 Billing/Stripe — `docs/module-refs/M10.2-billing-stripe.md` (planlagt)
- Sweep Intelligence Layer — `sovereign/models/` (materiality-engine, audit-engine, data-fabric)
- Supabase RLS-mønster — `supabase_schema.sql` + `supabase/sovereign-migration.sql`
- CSRD/ESRS reference: https://www.efrag.org/lab6
- EU-PPWR (Packaging & Packaging Waste Regulation): forordning 2025/40
- Dansk EPR-regelværk: Miljøstyrelsen, producentansvar for emballage 2025+

---

*Denne fil er en levende reference. Opdatér når subscription-priser, feature-matrix eller tenant-model ændres.*
