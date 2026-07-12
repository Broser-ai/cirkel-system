# PROJECT_STATUS.md — Cirkel

> Genereret 2026-07-12 fra automatisk lokal audit af `cirkel-system/`.
> Dette dokument er et modenhedskort baseret på faktisk filsystem-tilstand,
> ikke aspiration. Skal genlæses/opdateres når nye moduler tilføjes.

---

## Introduktion — hvad Cirkel ER lige nu

Cirkel er en **cirkulær-økonomi-app** til dansk emballagegenanvendelse.
Kerne-flow: bruger scanner emballage → AI (Gemini/Claude) eller regelbaseret motor
producerer materialepas → data persisteres i Supabase med hash-kædet ledger →
brugeren optjener point/kroner/CO₂ og kan indløse belønninger.

**Stack:** Vite 6 + React 19 + TypeScript, Vercel serverless (`api/*.ts`),
Supabase Postgres + RPC + RLS, Firebase-auth med demo-bypass.

**Repository:** ét lokalt git-repo (`cirkel-system/.git`) initialiseret **2026-07-07**.
Ingen remotes, ingen tags, én branch (`master`), én forfatter (Broser2712).
7 commits totalt. **Fuld udviklings-historik findes IKKE i git** — den skal
læses fra fil-mtimes fordi projektet er ældre end git-initialiseringen.

---

## Tidslinje (fra fil-mtimes, verificeret)

| Dato | Milepæl |
|---|---|
| 2026-06-23 | Baseline: `vite.config.ts`, første komponenter (AI Studio-eksport) |
| 2026-06-26 | Express `server.ts` (21 KB) + `supabase_schema.sql` |
| 2026-06-27 | Team-governance (`CLAUDE.md`, `AI_TEAM_GOVERNANCE.md`, `TEAM.md`, `GURUS.md`) |
| 2026-06-28 | Trin 1+2 API'er (Vercel-konvertering, `_ai.ts`, `_rules.ts`, `_dawa.ts`) |
| 2026-06-29 | F4.2 (DAWA + 15 kommuner), F1.11 v1 (dashboard/rewards/redeem/leaderboard), BACKLOG.md |
| 2026-07-05 | F1.11 v2 (Firebase-bro) — `api/scan.ts` finaliseret |
| 2026-07-06 | TRIN 2 rolle-gate (`user_type`) + showcase-ui komponenter |
| 2026-07-07 | TRIN 3 admin-panel + portal-struktur + `git init` + første commits |
| 2026-07-12 | Denne audit |

**Total aktivt udviklingsspænd: ~2 uger (23/6 → 12/7 2026).**

---

## Modenhedskort — hvad er faktisk implementeret

Status-koder: ✅ Implementeret · 🟡 Delvist implementeret · 🔴 Ikke fundet i kodebasen

### Kerne-domæner

| Domæne | Status | Bevis |
|---|---|---|
| **Scan → AI materialepas** | ✅ Implementeret | `api/scan.ts` (11 KB) med Gemini/Claude/rules-fallback + mock |
| **Regelbaseret scan-motor** | ✅ Implementeret | `modules/` (26 filer, 23 CirkelEngine-moduler) + `api/_rules.ts` |
| **DAWA + kommune-sortering** | ✅ Implementeret (15 kommuner) | `api/_dawa.ts`, `api/_sorting-rules-dk.ts`, `api/sorting-rules.ts` |
| **Firebase-bro auth** | ✅ Implementeret | `resolve_profile()`, `process_scan()` RPC'er + `p_firebase_uid`-parametre |
| **Ledger + hash-kæde** | ✅ Implementeret | `supabase_schema.sql`: `create table public.ledger` + `calculate_ledger_hash()` + write-once-policies |
| **Reward-lag v3** | ✅ Implementeret | `api/rewards.ts`, `api/redeem.ts`, `api/leaderboard.ts` + RPC'er `get_rewards`/`redeem_reward`/`get_leaderboard` |
| **Dashboard-widget** | ✅ Implementeret | `api/dashboard.ts` + `src/components/DashboardWidget.tsx` |
| **Portal-struktur (b2b_business/kommune)** | ✅ Implementeret | `src/App.tsx` splits + `B2BPartnerDashboard.tsx` portalType-prop |
| **Admin feature-flags** | ✅ Implementeret (mekanisme) | `api/portal-features.ts` + `set_portal_features()` RPC (admin-gated) + `AdminPanel.tsx` |
| **Rolle-gate (user_type)** | ✅ Implementeret | `profiles.user_type` kolonne + `availableModes` + `availableTabs`-derivering |

### Identitet & verifikation

| Domæne | Status | Bevis |
|---|---|---|
| **MitID-integration (broker-kald, sessions)** | 🔴 Ikke implementeret som ægte integration | `src/components/MitIDAuth.tsx` findes men indeholder simuleret flow ("[MitID Portal] Signature validated successfully for Dane-id: CPR-140683-XXXX." linje 97 — hardkodet mock). Ingen MitID SDK i `package.json` |
| **CPR-format-validering** | 🟡 Delvist | `src/components/VerificationStatus.tsx:30-36` (regex-check, ikke rigtig verifikation) |
| **Verification-tiers (standard/cpr/mitid)** | ✅ Implementeret (skema-lag) | `profiles.verification_tier` kolonne + brugt i cash-gate i `RewardsTab.tsx` |
| **Firebase demo-bypass** | ✅ Implementeret | `LoginScreen.tsx:312-329` (Morten-testkonto) |

### Betaling / økonomi

| Domæne | Status | Bevis |
|---|---|---|
| **Wallet (saldo, points)** | ✅ Implementeret | `src/components/WalletTab.tsx` (94 KB), `profiles.balance/points` |
| **PSP-integration (MobilePay, Stripe)** | 🔴 Ikke implementeret | Ingen `stripe`, `mobilepay` eller lignende SDK i `package.json`. Ingen `api/payments/`. Reward-katalog nævner MobilePay som label kun |
| **Payout / cash-udbetaling** | 🔴 Ikke implementeret | Cash-gate blokerer indløsning uden mitid; ingen faktisk payout-kode |

### Produkt & retning

| Domæne | Status | Bevis |
|---|---|---|
| **GS1/GTIN produktopslag** | 🔴 Ikke implementeret som ægte integration | Grep for "GTIN"/"GS1" giver kun placeholder-strings + backup-filer. Ingen GS1-API-klient |
| **EAN/barcode-scan (visuel)** | ✅ Implementeret (in-app) | `package.json` har `jsqr` (QR-scanner). `ScanTab.tsx` (154 KB) håndterer barcode-input |
| **Emissions-motor / materialepas** | ✅ Implementeret | `emission_factors`-tabel (8 rows) + AI genererer 16-felts materialepas |

### Retur / dropoff

| Domæne | Status | Bevis |
|---|---|---|
| **Return-point / smart-bin registry** | 🟡 UI-only, ingen DB | `src/components/WasteBinLocator.tsx`, `RecyclingCenterMap.tsx` findes; ingen `smart_bins`-tabel eller `api/bins`-endpoint fundet |
| **Return-orkestrering (scan → retur-flow)** | 🟡 Delvist (kun scan-siden) | Scan persisteres i `scans`+`ledger`, men ingen "returneret til X drop-point"-tracking |
| **Trust-tier for returpunkter** | 🔴 Ikke implementeret | BACKLOG.md F3.1 markeret PLAN. Ingen kode |

### Risk / fraud

| Domæne | Status | Bevis |
|---|---|---|
| **Risk/fraud-engine (regler, scoring)** | 🔴 Ikke implementeret | Grep for "fraud"/"risk_score"/"hold_pending" i `src/`, `api/`, `modules/` = 0 matches. BACKLOG.md F3.5 = PLAN |
| **Fraud-proof-ledger (append-only)** | 🟡 Delvist (write-once ledger findes) | `supabase_schema.sql`: "Ledger is write-once (deny updates/deletions)"-policies findes. Men ingen separat fraud_proof_ledger som BACKLOG F3.6 beskriver |
| **Delayed payout / hold-logic** | 🔴 Ikke implementeret | 0 matches |

### Case management / audit-evidence

| Domæne | Status | Bevis |
|---|---|---|
| **Case-management (manuel review)** | 🔴 Ikke implementeret | 0 matches for "case_management"/"review_queue"/"dispute" |
| **Kamera/foto-evidence** | 🟡 Delvist | `ScanTab.tsx` uploader billede til `/api/scan` som base64; ingen persistering af foto som evidence i DB |
| **Rutedata / geo-audit** | 🔴 Ikke implementeret | Ingen geo-tracking-code |

### Rapportering / dashboards

| Domæne | Status | Bevis |
|---|---|---|
| **Producent-/kommune-dashboard** | ✅ Implementeret som mock-UI | `B2BPartnerDashboard.tsx` (419 KB — kæmpe komponent). Data er hardkodet demo-data, ikke ægte queries |
| **CSRD-/EPR-rapportering** | 🟡 UI + PDF-export findes; kildedata er mock | Grep giver 8 komponenter der nævner CSRD/EPR. `jspdf`-dependency er tilgængelig |
| **Live KPI'er (fra egen DB)** | 🟡 Delvist | `/api/dashboard` returnerer rigtige tal for én bruger; ingen aggregeret KPI-endpoint til B2B |

### CI/CD, tests, infrastruktur

| Domæne | Status | Bevis |
|---|---|---|
| **GitHub Actions / CI-pipelines** | 🔴 Ikke implementeret | Ingen `.github/`-mappe |
| **Test-suite** | 🔴 Ikke implementeret | 0 test-filer (`find . -name "*.test.*"` = tom) |
| **Docker-compose / lokal orkestrering** | 🔴 Ikke implementeret | Kun basic `Dockerfile` (460 bytes). Ingen compose |
| **IaC (Terraform/Pulumi/CDK)** | 🔴 Ikke implementeret | Ingen `.tf` / IaC-filer |
| **Deploy-automatik** | 🟡 Manuel via Vercel CLI | `vercel deploy --target=preview` manuelt fra terminal |

---

## Database-skema

**To divergerende schema-filer** — vigtig teknisk skyld:

| Fil | Linjer | Indhold | Anvendt? |
|---|---|---|---|
| `supabase_schema.sql` (rod) | 200 | `create table` (lowercase) — profiles, scans, ledger + `calculate_ledger_hash()` + RLS-policies med "cryptographic ledger chain"-navngivning | Sandsynligvis den **oprindelige kanoniske** som CLAUDE.md refererer til |
| `supabase/schema.sql` | 119 | `CREATE TABLE IF NOT EXISTS` (uppercase) — profiles, scans, ledger, **wallets** (unik her) | Uklart hvad status er |

**Live DB (verificeret via Supabase MCP tidligere):** 8 tabeller i `public`:
`profiles, scans, ledger, rewards, redemptions, achievements, user_achievements, emission_factors` — plus `portal_features` (tilføjet 2026-07-07).

**`wallets`-tabel eksisterer IKKE live** — kun i `supabase/schema.sql`.

**Migrations** anvendes via Supabase MCP `apply_migration`-tool, ikke gemt i repo:
- `add_user_type_to_profiles` (TRIN 2)
- `add_portal_features_admin_flags` (TRIN 3)
- `restrict_set_portal_features_to_service_role` (TRIN 3 hotfix)

---

## API-endpoints (fuld liste)

| Endpoint | Method(s) | Formål | Status |
|---|---|---|---|
| `/api/scan` | POST | Materialepas via Gemini/Claude/rules + persist via `process_scan` | ✅ |
| `/api/chat` | POST | Sorterings-chatbot | ✅ |
| `/api/b2b-advisor` | POST | Strategisk B2B-rapport | ✅ |
| `/api/dashboard` | GET | Bruger-profil + scans + KPI'er | ✅ |
| `/api/rewards` | GET | Reward-katalog (4 seedede) | ✅ |
| `/api/redeem` | POST | Indløs reward (admin-check via RPC) | ✅ |
| `/api/leaderboard` | GET | Top-N brugere | ✅ |
| `/api/sorting-rules` | GET | Kommune-sortering (postnr→kommune) | ✅ |
| `/api/portal-features` | GET, POST | Admin feature-flags (POST admin-gated) | ✅ |

**Private helpers (ikke endpoints):** `api/_ai.ts`, `_claude.ts`, `_gemini.ts`, `_rules.ts`, `_dawa.ts`, `_sorting-rules-dk.ts`.

---

## Frontend-tabs (i cirkel-system/src/components/)

| Komponent | Størrelse | Status |
|---|---|---|
| `ScanTab.tsx` | 154 KB | ✅ Fuldt implementeret (AI + preset + QR + kamera) |
| `WalletTab.tsx` | 94 KB | ✅ Implementeret (mest UI) |
| `ProfilTab.tsx` | 129 KB | ✅ Implementeret |
| `SystemsTab.tsx` | 113 KB | ✅ Implementeret |
| `AdminPanel.tsx` | 8 KB | ✅ Implementeret (TRIN 3, portal-features toggles) |
| `RewardsTab.tsx` | 14 KB | ✅ Implementeret |
| `LeaderboardTab.tsx` | 11 KB | ✅ Implementeret |
| `DashboardWidget.tsx` | 10 KB | ✅ Implementeret |
| `B2BPartnerDashboard.tsx` | **419 KB** | ✅ Implementeret (7000+ linjer — kandidat til refactor) |

**Andre komponenter fundet men uklart wired:** `AdministrativeHeatmap.tsx`, `GlobalLeaderboard.tsx`, `WasteBinLocator.tsx`, `EnterpriseCrmCirkelModal.tsx`, `RecyclingCenterMap.tsx`, `MitIDAuth.tsx`, `BiometricPrompt.tsx`, `VerificationStatus.tsx`, `RecyclingGuides.tsx`.

**Backup-mappe (potentiel dead code):** `src/backup/` indeholder tidligere versioner af komponenter (App.tsx, ProfilTab, ScanTab, WalletTab, LoginScreen, ImpactDashboard, RecyclingCenterMap, AnimatedCount, server.ts, types.ts).

---

## Eksterne afhængigheder (fra `package.json`)

### Ægte forbundet til live/sandbox-tjenester

| Kategori | Pakke | Status |
|---|---|---|
| AI | `@google/genai` (^1.29.0) | ✅ Live (Gemini API-nøgle sat i Vercel) |
| AI | `@anthropic-ai/sdk` (^0.106.0) | 🟡 Klar til brug (kræver `ANTHROPIC_API_KEY`) |
| Auth | `firebase` (^12.12.0) | 🟡 Delvist (demo-bypass virker, ægte Firebase-Web-Auth i `src/lib/firebase.ts`) |
| DB | `@supabase/supabase-js` (^2.108.1) | ✅ Live (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY sat) |

### Rene mock/stub-integrationer

| Kategori | Status |
|---|---|
| MitID | 🔴 Kun UI-mock (`MitIDAuth.tsx`), ingen SDK |
| MobilePay | 🔴 Kun label i rewards, ingen integration |
| Stripe / PSP | 🔴 Ikke integreret |
| GS1/GTIN | 🔴 Kun labels, ingen API-klient |
| DAWA | ✅ Live (fetch mod `api.dataforsyningen.dk` — offentligt API, ingen nøgle nødvendig) |

### Ubrugte / oversete deps
- `express` (server.ts bruges kun til lokal dev, produktion er serverless — kan flyttes til devDependencies)
- `dotenv` (Vercel bygger sit eget env-lag; kun nyttig i lokal dev)

---

## Repo-oversigt

**Ét repo, én branch.** Ingen multi-repo/mono-repo-struktur.

```
cirkel-system/
├── src/            (frontend + components)
├── api/            (Vercel serverless endpoints)
├── lib/            (delt kode: cirkel.ts = Supabase RPC-wrappers)
├── modules/        (23 CirkelEngine-moduler til rules-motor)
├── supabase/       (schema-baseline)
├── tools/          (masters-pipeline til agent-generering)
├── investor/       (materialer som kode — deck.js, captable.js, pilot.js, safe.js)
├── docs/           (F3.8-plan, rotation-guides, CIRKEL-EVERYTHING-v3)
├── .claude/agents/ (22 aktive agent-specs)
├── parked-agents/  (5 parkerede)
└── (root)          (server.ts, schema, konfig, 11 top-level .md-docs)
```

---

## Teknisk skyld — observationer

1. **Package.json `name: "react-example"`** — arvet fra Google AI Studio-eksport, aldrig omdøbt til "cirkel".
2. **`src/backup/`** — dead code fra tidligere versioner (10 filer). Kan slettes efter verifikation.
3. **2 divergerende schema-filer** (`supabase_schema.sql` vs `supabase/schema.sql`) — én skal vælges som kanonisk, den anden slettes.
4. **`B2BPartnerDashboard.tsx` = 419 KB, ~7000 linjer** — kandidat til opdeling i sub-komponenter pr. sektion.
5. **`ScanTab.tsx` = 154 KB** — også kompleks, kunne opdeles.
6. **0 test-filer** — ingen unit, integration eller e2e-tests.
7. **Ingen CI/CD** — deploy sker manuelt via Vercel CLI.
8. **Firebase-uid spoofing** kendt hul (F3.8 i BACKLOG) — server-side token-verifikation ikke implementeret endnu; se `docs/F3.8-server-side-auth.md`.
9. **Vercel bundle 2.6 MB** — chunk-warnings i build-log, ingen code-splitting.
10. **Firebase-nøgle i `firebase-applet-config.json`** — korrekt gitignored, men bør roteres jf. `docs/rotation-firebase-apikey.md`.
11. **Ingen egentlige TODO/FIXME/HACK/XXX-markører** i kildekoden (0 rigtige matches — alle 5 "XXXX"-matches er CPR-format-placeholders).

---

## De 5 mest oplagte næste skridt

Prioriteret baseret på **hvad der faktisk findes nu**:

### 1. **Push repo til remote + tilføj CI-safety-net (kritisk)**
- Nuværende: 100% lokalt repo, ingen backup, ingen CI
- Handling: opret GitHub/GitLab-repo, push, tilføj minimum GitHub Action der kører `npm run lint` + build ved hver push
- Effekt: Rulle-tilbage-mulighed + tidlig fejldetektion
- Effort: 1-2 timer

### 2. **F3.8 server-side Firebase-token-verifikation (sikkerhed)**
- Nuværende: `firebaseUid` fra body accepteres uden verifikation → spoofing muligt
- Plan findes allerede: `docs/F3.8-server-side-auth.md`
- Berører: `api/scan.ts`, `api/redeem.ts`, `api/portal-features.ts`
- Effekt: Låser hovedvektor for user-impersonation
- Effort: 1-2 dage (Firebase-Admin SDK + token-verify-middleware)

### 3. **Konsolidér DB-skema — vælg ét canonical skema-fil**
- Nuværende: 2 divergerende SQL-filer + live DB har flere tabeller end nogen af dem
- Handling: dump live-schema, sammenlign, arkivér den ene fil, marker den anden som "generated from live"
- Effekt: Nye udviklere ved hvor sandheden er
- Effort: 2-4 timer

### 4. **Refactor `B2BPartnerDashboard.tsx` (419 KB → 5-8 mindre komponenter)**
- Nuværende: 419 KB, ~7000 linjer — svært at navigere, langsom compile
- Handling: opdel efter sektion (KPI-overblik, EPR-register, Smart-bin, Kampagner, Integrations osv.)
- Effekt: Halveret bundle for b2b-flow, hurtigere iteration
- Effort: 2-3 dage (større refactor)

### 5. **Første integrationstest for kerne-loop** (bevis at scan→persist→saldo virker fra e2e)
- Nuværende: 0 test-filer. Verifikation sker manuelt via curl + DB-query
- Handling: én `tests/scan-flow.spec.ts` med Playwright eller Vitest der ramme et preview og bekræfter kernescenariet
- Effekt: Regressions-beskyttelse når vi tilføjer F3.8, TRIN 4, etc.
- Effort: 4-6 timer

**Ikke inkluderet i top-5 men også vigtige:**
TRIN 4 (Admin-UI til rolle-tildeling per BACKLOG), refactor af CPR-verifikation til rigtig MitID-integration, tilføj Stripe/MobilePay-sandbox for cash-payout-flow.

---

## Åbne spørgsmål der kræver Michaels beslutning

1. **Hvilket schema-fil er canonical?** `supabase_schema.sql` eller `supabase/schema.sql`?
2. **Skal `wallets`-tabellen implementeres**, eller er `profiles.balance` nok?
3. **Er `src/backup/` sikkert at slette?** (10 filer, ~50-100 KB)
4. **Skal projektet omdøbes fra "react-example"** i `package.json` til "cirkel" eller "cirkel-system"?
5. **Er MitID-mock acceptabel til demo**, eller skal ægte MitID-broker (Signaturgruppen/Nets) integreres nu?
6. **Skal ledger-hash-kæden re-valideres periodisk** (fx cron-job)? I dag beregnes den ved insert, aldrig re-verificeres.
7. **Skal we push til offentligt vs privat GitHub-repo?** (påvirker CI-choice)

---

## Ikke-fund (i god stand)

Balance-observation: ikke alt er broken.

- ✅ **Kerne-loopet er verificeret live** (2026-07-06) — Morten's testscan skabte profil + scan-række + ledger-hash + achievement, alt konsistent i DB
- ✅ **Rolle-gate virker** (TRIN 2 verificeret) — consumer/admin/b2b_business/b2b_kommune har korrekte availableModes
- ✅ **Portal-adskillelse implementeret** (TRIN 3) — b2b_business og b2b_kommune har hver deres viewMode + badge
- ✅ **Admin feature-flag mekanisme er sikret** (TRIN 3 hotfix) — grant-lag revoked fra `PUBLIC`/`anon`/`authenticated`, kun `service_role` kan skrive, plus SECURITY DEFINER admin-check i RPC
- ✅ **`.gitignore` er stram** — `firebase-applet-config.json` + alle `.env*` er ignored, kun `.env.example` tracked
- ✅ **Ingen udfyldte `.env`-filer på disk** — alle secrets ligger i Vercel dashboard
- ✅ **22 aktive agenter + 5 parkerede** i `.claude/agents/` — team-lag er organiseret
- ✅ **BACKLOG.md er detaljeret og opdateret** — 60 status-indikatorer på tværs af 9 epics

---

*Dokument genereret via automatisk lokal audit — 2026-07-12. Genopdater ved næste større milepæl.*
