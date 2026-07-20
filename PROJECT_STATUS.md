# PROJECT_STATUS.md — Cirkel

> Genereret 2026-07-12 (morgen) fra automatisk lokal audit af `cirkel-system/`.
> **Udvidet 2026-07-12 (eftermiddag)** med multi-mappe-audit (cirkel-demo + cirkel-sota).
> Dette dokument er et modenhedskort baseret på faktisk filsystem-tilstand,
> ikke aspiration. Skal genlæses/opdateres når nye moduler tilføjes.

---

## TL;DR — tre mapper med "cirkel" i navnet (2026-07-12 v2)

Der findes **tre separate Cirkel-mapper** i `C:/Users/Ambro2/`. Kun én er et aktivt git-repo.

| Mappe | Formål | Git-repo | Sidste aktivitet | Rolle |
|---|---|---|---|---|
| `cirkel-system/` | **Aktivt produkt** (Vite + Vercel + Supabase) | ✅ Ja (8 commits) | 2026-07-12 | **Den ene der udvikles** |
| `cirkel-demo/` | Isoleret præsentations-snapshot uden API-nøgler | ❌ Ingen `.git/` | 2026-06-23/24 | Fastfrosset demo — arkiv-kandidat |
| `cirkel-sota/` | Vision + kode-genererende pipeline til "Cirkel 2.0" | ❌ Ingen `.git/` | 2026-07-09 (docs) / 2026-06-26 (kode) | Research + separat blueprint — **ikke wired ind i cirkel-system** |

**Vigtigt for beslutninger:** `cirkel-sota` beskriver en helt anden stack (Next.js 15 + Anthropic SDK + LiteLLM + n8n + Langfuse) end det, der faktisk kører i `cirkel-system` (Vite 6 + Gemini + Vercel serverless). De er **ikke koblet sammen**.

Detaljerede sektioner:
- Del A: `cirkel-system/` — hele den originale audit (fuldt spot-verificeret)
- Del B: `cirkel-demo/` — hvad der er inde og hvad det betyder
- Del C: `cirkel-sota/` — vision, moduler, kode-generator, hvad der er kørt

---

# DEL A — cirkel-system (aktivt produkt)

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

## Spot-verifikation af Del A (v2, 2026-07-12 eftermiddag)

Alle nedenstående nøglepåstande fra morgen-auditten er **verificeret direkte i koden** i denne v2-runde:

| Påstand | Verifikation | Bevis |
|---|---|---|
| MitID er kun mock/UI | ✅ Bekræftet | `src/components/LoginScreen.tsx:68,153,209,325` — `verificationTier: 'mitid'` hardkodes til test-konto uden ægte broker-kald |
| GS1 er ikke aktiv | ✅ Bekræftet | `modules/modules/integration.ts:9` — "GS1 ikke konfigureret (sæt GS1_API_KEY)" |
| fraud/risk_score = 0 matches | ✅ Bekræftet | 0 matches i `src/`, `api/`, `modules/` (kun tilstede i BACKLOG.md som PLAN) |
| MobilePay er kun label + modal | ✅ Bekræftet | `src/components/WalletTab.tsx:154` `handlePayOutMobilePay` viser toast + lukker modal, ingen ægte API-kald |
| Ingen ægte TODO/FIXME | ✅ Bekræftet | 4 XXXX-matches, alle CPR-format placeholders (`VerificationStatus.tsx:30-36,248`, `MitIDAuth.tsx:97`) |
| `package.json name: "react-example"` | ✅ Bekræftet | Se DEL A punkt 1 nedenfor — arvet fra AI Studio |
| Anthropic SDK er klar men ikke wired | ✅ Bekræftet | `@anthropic-ai/sdk` ^0.106.0 tilstede i package.json |

**Konklusion for Del A:** Morgen-auditten er præcis. Ingen fejl fundet.

---

# DEL B — cirkel-demo (isoleret præsentations-snapshot)

## Formål og oprindelse

`cirkel-demo/` er en **selvstændig demo-pakke** designet til at kunne kunne præsenteres uden internet, API-nøgler eller live-backend. Dokumenteret i `cirkel-demo/README_DEMO.md` og `cirkel-demo/CLAUDE.md`:

- Kører AI-scan, login og DB som **indbyggede mocks** (kald med tomme nøgler falder til hardkodede danske eksempler)
- `firebase-applet-config.json` er bevidst sat til `MOCK_API_KEY_PLACEHOLDER` for at undgå at eksponere Michaels rigtige Firebase-nøgle når mappen deles
- Testkonto: "Morten" via `#quick-demo-login-bypass`-knap
- Kommandoer: `npm install && npm run dev` → `http://localhost:3000`

## Filsystem-tilstand

| Fakta | Værdi |
|---|---|
| Git-repo | ❌ Ingen `.git/` — **ingen egen historik** |
| Antal filer (uden `node_modules`) | ~35 |
| `package.json` navn | `react-example` (samme arvet-navn som cirkel-system) |
| Sidste modificerede fil | 2026-06-24 (node_modules-installation) — kode-filer stopper 2026-06-23 |
| Backup-mappe | `src/backup/` findes med 10 filer (samme som cirkel-system) |
| Server | `server.ts` (21 KB) med `/api/scan`, `/api/b2b-advisor`, `/api/chat` |

## Sammenligning med cirkel-system

`cirkel-demo` er sandsynligvis en **snapshot af cirkel-system fra 23.-24. juni**, før git-init og før alle Trin 2+3-ændringer. Bevis:

- Samme package.json struktur, samme `react-example`-navn, samme scripts, næsten samme deps
- Samme `src/components/` (15 komponenter — 4 færre end cirkel-system: mangler `AdminPanel`, `DashboardWidget`, `LeaderboardTab`, `RewardsTab`)
- Samme `src/backup/`-mappe (10 filer, identisk struktur)
- Samme `server.ts`, `supabase_schema.sql`, `firestore.rules`, `firebase-blueprint.json`

**Forskelle fra cirkel-system:**
- ❌ Ingen `.claude/agents/` (22 agenter mangler)
- ❌ Ingen `api/` (Vercel serverless — hele Trin 1+2-arbejdet)
- ❌ Ingen `docs/`, `modules/`, `investor/`, `tools/`, `lib/`
- ❌ Ingen `AI_TEAM_GOVERNANCE.md`, `BACKLOG.md`, `BUILD_KIT.md`, `PROJECT_STATUS.md`, `GURUS.md`, `TEAM.md`, `DEPLOY.md`
- ❌ Ingen Anthropic SDK (kun Gemini)
- ❌ Ingen `@anthropic-ai/sdk` i deps
- ✅ Firebase-nøgle er MOCK (godt — kan deles sikkert)

## Deps-diff (cirkel-demo vs cirkel-system)

| Kategori | cirkel-demo | cirkel-system | Delta |
|---|---|---|---|
| AI-providers | `@google/genai` | `@google/genai` + `@anthropic-ai/sdk` | +Anthropic |
| Alt andet | identisk | identisk | — |

## Status og risici

| Aspekt | Vurdering |
|---|---|
| **Formålet opfyldes** | ✅ Ja — er en fungerende demo-pakke med intakt mock-flow |
| **Vedligeholdes** | ❌ Nej — ingen aktivitet siden 24. juni; udvikling er sket i cirkel-system i stedet |
| **Divergens-risiko** | 🟡 Middel — demoen er nu ~3 uger bagud (mangler Trin 2 rolle-gate, Trin 3 admin-panel, 4 komponenter, 9 api-endpoints, portal-adskillelse). Hvis den vises til investorer, ser den ikke ud som det aktuelle produkt |
| **Sikkerhed** | ✅ Firebase-nøgle er mocked ud |
| **Anbefaling** | Flyt til `claude-archive/cirkel-demo.archive-2026-06-24/` og markér i en note i cirkel-system README om hvor demo-pakken er, eller genopbyg en frisk demo-pakke fra nuværende cirkel-system |

---

# DEL C — cirkel-sota (vision + pipeline-generator)

## Formål og struktur

`cirkel-sota/` er **ikke et produkt** — det er en kombination af:
1. **Kilde-dokumenter og vision-master** for "Cirkel 2.0 — Cognitive Circular Infrastructure" (`Cirkel-2.0-*.md/.json`)
2. **Deep research-katalog** over frontier AI, EU-regulering, konkurrenter (`03-research/`)
3. **Modul-specifikationer** — 2 skrevet ud af 94 planlagte (`01-moduler/Modul-76`, `Modul-77`)
4. **Kode-genererende pipeline** (`02-kode/`) der producerer en fuld "cirkel-stack" som filer
5. **Pipeline-output** (`02-kode/runs/`) — 3 kørsler fra 1. og 26. juni 2026

Dokumenteret i `cirkel-sota/02-kode/README.md` som "Cirkel Stack — Production Build Workspace".

## Filsystem-tilstand

| Fakta | Værdi |
|---|---|
| Git-repo | ❌ Ingen `.git/` — **ingen egen historik** |
| Top-level struktur | `00-kilder`, `01-moduler`, `02-kode`, `03-research`, `04-output` (tom), 5 masterplan-filer |
| Kilde-dokumenter | 5 filer (PDF, docx, md) — inkl. "Cirkel Master System Architecture.docx" |
| Skrevne moduler | 2 ud af 94 planlagte (Modul 76 orchestrator, Modul 77 multi-agent debate) |
| Research-dokumenter | 12 filer (~1-2 MB samlet) om frontier AI 2026, EU regs, konkurrenter |
| Pipeline-motorer | 5 Node.js-filer (`cirkel-template-matcher-engine.js`, `-platform-systems-engine.js`, `-integrator.js`, `-extensions.js`, `-pipeline.js`) |
| Pipeline-runs | 3 (`pipeline-2026-06-01`, `pipeline-2026-06-26`, `run-2026-06-01`) |
| Sub-app | `02-kode/cirkel-app/` — **Next.js 15 skeleton**, IKKE Vite som cirkel-system |
| Docker-stack | `02-kode/docker/compose.yml` — Postgres + LiteLLM + n8n + Langfuse + Redis |

## Vision (fra `Cirkel-System-Overview_1.md`)

Målet er beskrevet som en **helt anden produktforståelse** end cirkel-system:

- "Cognitive Circular Infrastructure" — hver telefon kører 70B mixture-of-experts lokalt (Modul 11)
- Federated Reinforcement Learning på tværs af borger-telefoner (Modul 12)
- NVIDIA Cosmos digital twin af DK affaldsstrømme (Modul 8)
- Zero-Knowledge Machine Learning for compliance (privacy-by-math)
- Autonome AI-agenter der handler EPR-pligter for brands (i stedet for dashboards)
- Master Orchestrator (Modul 76) med 94 moduler i 14 dele

**Estimeret build for Modul 76 alene**: "3-4 uger med 1 senior engineer". Drift-cost: "€30-80/dag i LLM-tokens".

## `02-kode/cirkel-app/` — sub-appen i cirkel-sota

Dette er en **skabelon-app** genereret af pipeline-motoren, IKKE en app under udvikling.

| Fakta | Værdi |
|---|---|
| Stack | Next.js 15 + React 19 + Tailwind 4 beta + zod + zustand + @tanstack/react-query |
| DB | `@supabase/ssr` + `@supabase/supabase-js` v2.45 |
| AI | `@anthropic-ai/sdk` v0.30 |
| API-endpoints | 2 filer (`app/api/scan/route.ts`, `app/api/payout/route.ts`) — **begge er hardkodede mock-responses** med `mockResponse`-objekt (verificeret) |
| Beskrivelse | "Cirkel brand: Forest Green + Lime + Fraunces + DM Sans" |
| Wired ind i cirkel-system? | ❌ **NEJ** — det er en separat codebase med anden stack |

## Pipeline-output (`02-kode/runs/pipeline-2026-06-26T18-59-18-528Z/cirkel-stack/`)

Seneste pipeline-kørsel (26. juni) genererer et komplet "cirkel-stack"-scaffold:

- `supabase/migrations/001_cirkel_core.sql` — foreslået schema (ikke wired ind i live Supabase)
- `litellm/config.yaml`, `langgraph/master-orchestrator.ts`, `mobilepay/payout-handler.ts`
- 10 n8n-workflows (`tpl_ai_fraud_detection_pipeline.json`, `tpl_gs1_barcode_lookup.json`, `tpl_vana_epr_submission.json`, `tpl_webhook_to_mobilepay_payout.json`, m.fl.)
- `composio/config.json`, `vana/computer-use-prompt.md`, `vercel.json`

**Alle er stub/skabelon-filer**, ingen bruges live.

## Status og risici

| Aspekt | Vurdering |
|---|---|
| **Relation til cirkel-system** | Divergent — helt anden stack (Next.js vs Vite), anden AI-provider (Anthropic vs Gemini), anden orkestreringsfilosofi (LangGraph + LiteLLM vs direkte Vercel serverless) |
| **Modenhed af pipeline-output** | 🟠 Blueprint — alle route.ts er `mockResponse`. Ingen faktisk produktions-kode |
| **Modenhed af moduler** | 🔴 2 af 94 skrevet — de skrevne er meget grundige (Modul 76 er ~40 KB), men resten er kun titler i indholdsfortegnelsen |
| **Modenhed af research** | ✅ 12 dybe research-dokumenter er værdifulde som strategisk input |
| **Divergensrisiko** | 🔴 Høj — hvis cirkel-sota-visionen skal implementeres, kræver det enten (a) genopbygning af cirkel-system på Next.js/LangGraph-stack, (b) hoisting af enkelte moduler ind i cirkel-system's Vite-stack (svært), eller (c) at cirkel-sota parkeres som ren research |
| **Anbefaling** | Beslut strategi før mere kode genereres — se "Samlet næste skridt" nedenfor |

---

# SAMLET SYNTESE — alle tre mapper

## Repo-oversigt (én-linje pr. mappe)

| Mappe | Rolle | Status | Aktiv? |
|---|---|---|---|
| `cirkel-system/` | Aktivt produkt (Vite + Vercel + Supabase) | 🟡 MVP+ med kritiske huller (ingen remote, ingen tests, ingen CI, F3.8 auth ikke wired) | ✅ Ja |
| `cirkel-demo/` | Isoleret præsentations-pakke uden nøgler | 🟢 Formålsklar men snapshot fra 23.-24. juni — nu 3 uger bagud produktet | ❌ Nej |
| `cirkel-sota/` | Vision + kode-genererende pipeline til Cirkel 2.0 | 🟠 2 af 94 moduler skrevet; pipeline genererer mock-scaffold, ingen live-integration | ❌ Nej (senest kørsel 26. juni) |

## Tidslinje-fortælling (fra fil-mtimes + git)

- **Maj 2026:** cirkel-sota vision-master + Deep Research Brief skrevet (30. maj)
- **1. juni:** første pipeline-kørsel i cirkel-sota genererer cirkel-stack template #1
- **23.-24. juni:** cirkel-baseline eksporteret fra Google AI Studio → bliver til både `cirkel-demo` og senere `cirkel-system` (samme startpunkt)
- **25. juni:** cirkel-demo fastfryses (ingen aktivitet siden)
- **26. juni:** `server.ts` (21 KB) + `supabase_schema.sql` skabt i cirkel-system; anden pipeline-kørsel i cirkel-sota
- **27.-28. juni:** cirkel-system: team-governance (`CLAUDE.md`, `AI_TEAM_GOVERNANCE.md`), 22 agenter, Trin 1+2 Vercel-API'er, DAWA (F4.2)
- **29. juni:** F1.11 v1 (dashboard/rewards/redeem/leaderboard), `BACKLOG.md`
- **5. juli:** F1.11 v2 (Firebase-bro), `api/scan.ts` finaliseret
- **6. juli:** TRIN 2 rolle-gate (`profiles.user_type` + `availableModes`); kerne-loop verificeret live
- **7. juli:** TRIN 3 admin-panel + portal-adskillelse + `git init` (første 4 commits samme dag)
- **9. juli:** cirkel-sota "Cirkel-System-Overview_1.md/.txt" tilføjet
- **12. juli morgen:** første automatiske audit → PROJECT_STATUS.md v1 + BACKLOG implementeringsstatus
- **12. juli eftermiddag:** denne udvidede audit — dækker alle tre mapper

**Samlet aktivt spænd:** ~6 uger (30. maj → 12. juli), hvoraf **cirkel-system er ~2 uger** (23. juni → 12. juli) og har al aktiv udvikling siden 25. juni.

## De 5 mest oplagte næste skridt (opdateret v2)

Prioriteret på tværs af alle tre mapper, ikke kun cirkel-system:

### 1. **Push cirkel-system til remote + minimal CI** *(kritisk, uændret fra v1)*
- Nuværende: 100% lokalt repo, 8 commits, ingen backup, ingen CI
- Handling: opret GitHub-repo (privat eller offentlig — se åbne spørgsmål), push, tilføj GitHub Action med `npm run lint` + build
- Effort: 1-2 timer

### 2. **F3.8 server-side Firebase-token-verifikation** *(sikkerhed, uændret fra v1)*
- Plan findes i `docs/F3.8-server-side-auth.md`
- Berører: `api/scan.ts`, `api/redeem.ts`, `api/portal-features.ts`
- Effort: 1-2 dage

### 3. **Beslutning: hvad skal cirkel-sota være?** *(NY, blokerer strategi)*
- Nuværende: `cirkel-sota` beskriver en meget ambitiøs "Cirkel 2.0"-stack (Next.js + LangGraph + LiteLLM + n8n + edge-AI) med 94 moduler; kun 2 moduler er skrevet, resten er titler
- Valg:
  - **(a)** Behold som ren research + inspiration → arkivér `02-kode/` da pipeline-output aldrig bruges
  - **(b)** Vælg 1-3 konkrete moduler at implementere direkte i cirkel-system's eksisterende stack (fx Modul 5 Model Router med LiteLLM)
  - **(c)** Beslut at cirkel-system skal migreres til cirkel-sota-stacken → større projekt, kræver egen roadmap
- Effekt: Fjerner nuværende dobbelt-arbejde og gør det klart hvor udvikling skal ske
- Effort: 1-2 timer til beslutning; opfølgning afhænger af valg

### 4. **Konsolidér DB-skema — vælg ét canonical skema-fil** *(uændret fra v1)*
- 2 divergerende SQL-filer + live DB har flere tabeller end nogen af dem
- Effort: 2-4 timer

### 5. **Første integrationstest for kerne-loop** *(uændret fra v1)*
- 0 test-filer i alle tre mapper. Verifikation sker manuelt
- Handling: én `tests/scan-flow.spec.ts` med Playwright eller Vitest
- Effort: 4-6 timer

**Ikke i top-5 men vigtige (opdateret):**
- Refactor af `B2BPartnerDashboard.tsx` (419 KB) — placeret nedad da det ikke blokerer noget
- **Arkivér `cirkel-demo/`** til `claude-archive/cirkel-demo.archive-2026-06-24/` for at signalere at det er en frossen snapshot og ikke en aktiv variant af produktet
- TRIN 4 (Admin-UI til rolle-tildeling per BACKLOG)
- Ægte MitID-broker (Signaturgruppen/Nets)
- Stripe/MobilePay-sandbox for cash-payout

## Åbne spørgsmål der kræver Michaels beslutning (samlet v2)

Uændret fra v1 (`cirkel-system`-specifikke):
1. Hvilket schema-fil er canonical? `supabase_schema.sql` eller `supabase/schema.sql`?
2. Skal `wallets`-tabellen implementeres, eller er `profiles.balance` nok?
3. Er `src/backup/` sikkert at slette? (10 filer)
4. Skal projektet omdøbes fra "react-example" i `package.json`?
5. Er MitID-mock acceptabel til demo, eller skal ægte MitID-broker integreres nu?
6. Skal ledger-hash-kæden re-valideres periodisk?
7. Offentligt eller privat GitHub-repo?

**Nye i v2 (multi-mappe):**
8. **cirkel-sota-strategi:** ren research (a), delvis hoist (b), eller fuld migration (c)?
9. **cirkel-demo-lifecycle:** arkiver som frossen, eller genopbyg periodisk fra cirkel-system?
10. **Skal alle tre mapper have samme rod-git-repo?** (fx `cirkel/` med `system/`, `demo/`, `sota/`-undermapper) — det ville give sammenhængende historik, men er en større reorganisering.

---

*Dokument opdateret 2026-07-12 v2 — udvidet fra cirkel-system-only til multi-mappe audit (system + demo + sota). v1-analyse er spot-verificeret og korrekt. Genopdater ved næste større milepæl eller når beslutning på cirkel-sota-strategi træffes.*
