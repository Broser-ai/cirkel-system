<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Cirkel — cirkulær-økonomi platform til dansk emballagegenanvendelse (95% udenom pant-monopolet)

Cirkel er et fuldt system (frontend + API + Supabase-backend + Sovereign ESG-runtime) der belønner
forbrugere, kommuner og virksomheder for at genanvende emballage uden om det etablerede pant-monopol.
Platformen dækker scanning, dashboards, rewards, indløsning, leaderboards, CO2-KPI'er, bin-registrering
og case-håndtering — og kører autonome ESG-orchestrators 24/7 (compliance, marketplace, supply chain).

Se AI Studio-preview af app-laget: https://ai.studio/apps/68195e9a-5d09-4c39-8451-d0bdb3e6b15e

---

## Quick start

**Forudsætninger:** Node.js 20+

```bash
# 1. Installér afhængigheder
npm install

# 2. Kopiér env-skabelon og udfyld nøgler (GEMINI_API_KEY, Supabase URL/keys)
cp .env.example .env.local

# 3. Kør appen lokalt
npm run dev            # → http://localhost:3000
```

Uden nøgler starter appen i demo-mode med mock-AI. Sovereign-runtime startes separat:

```bash
npm run sovereign          # 24/7 autonom ESG-runtime
npm run sovereign:status   # systemstatus
```

---

## Endpoints-oversigt

| Endpoint             | Formål                                                                 |
|----------------------|------------------------------------------------------------------------|
| `/api/scan`          | Scan af emballage — klassifikation, materiale-ID, CO2-vægtning         |
| `/api/dashboard`     | Bruger- og virksomheds-dashboard (aggregater, tidsserier)              |
| `/api/rewards`       | Optjente og disponible rewards for aktør                               |
| `/api/redeem`        | Indløsning af rewards (wallet-split til udbetaling/donation)           |
| `/api/leaderboard`   | Rangliste (kommune / virksomhed / individ) med anti-fraud filtre       |
| `/api/kpi/co2`       | CO2-KPI: sparet emission pr. scan/aktør/periode                        |
| `/api/bins`          | Registrering og opslag af genanvendelses-bins (DAWA-koblet)            |
| `/api/case`          | Case-håndtering: dispute, kvalitetsflag, kommunal opfølgning           |
| `/api/health`        | Liveness/readiness (build-id, Supabase-ping, sovereign-runtime status) |

---

## Migrations

Kanonisk skema: `supabase_schema.sql`. Sovereign-lagets tabeller: `supabase/sovereign-migration.sql`
(`sovereign_ledger`, `sovereign_events`, `sovereign_worktrees`, `sovereign_agent_registry`).

Kør migrations mod Cirkels eget Supabase-projekt (ALDRIG mod det delte MTC/NEXUS):

```bash
# Via Supabase CLI (anbefalet)
supabase link --project-ref <cirkel-project-ref>
supabase db push

# Eller direkte via psql
psql "$SUPABASE_DB_URL" -f supabase_schema.sql
psql "$SUPABASE_DB_URL" -f supabase/sovereign-migration.sql
```

Se `docs/deploy-runbook.md` for fuld migrations-checkliste og rollback-procedure.

---

## Governance

Cirkel har ufravigelige regler for hvordan ændringer foreslås og udføres. Læs FØR du bidrager:

- [CLAUDE.md](CLAUDE.md) — systemkort, AI-team, kanoniske filer, governance-regler
- [.cirkel-accept.md](.cirkel-accept.md) — accept-protokol (intet udføres uden Michaels ja)
- [SECURITY.md](SECURITY.md) — sårbarhedsrapportering, hemmelighedshåndtering, key-rotation
- [CONTRIBUTING.md](CONTRIBUTING.md) — bidrags-workflow, PR-krav, review-gates

Kort udgave: forslag først → accept → én ændring ad gangen → aldrig commit af hemmeligheder →
Cirkels eget Supabase-projekt kun (rør ALDRIG delt MTC/NEXUS).

---

## Deploy

Se [docs/deploy-runbook.md](docs/deploy-runbook.md) for den fulde runbook (Docker/Coolify/Vercel,
env-vars, migrations-orden, sovereign-runtime, health-check, rollback).

Kort:

```bash
docker build -t cirkel .
docker run -p 3000:3000 -e GEMINI_API_KEY=… -e SUPABASE_URL=… -e SUPABASE_ANON_KEY=… cirkel
```

---

## License

Proprietary © Keap Me ApS. Alle rettigheder forbeholdes. Ingen brug, kopiering, distribution
eller afledte værker uden skriftlig tilladelse.

- **CVR:** 43947079
