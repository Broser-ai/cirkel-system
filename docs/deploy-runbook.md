# Cirkel — Deploy Runbook

Kanonisk driftsvejledning for deployment af Cirkel-systemet på Vercel med Supabase-backend.
Alle produktions-deploys kræver eksplicit `[ACCEPTED-BY-MICHAEL]` før udførelse (jf. SOVEREIGN ORCHESTRATOR V4).

**Last updated:** 2026-07-21
**Owner:** Michael (CEO)
**Repos:** `cirkel-system`, `cirkel-app-native`, `Cirkel`

---

## 1. Preview deploy

Preview-deploys er sikre — de rammer aldrig production-domænet og kræver ikke acceptance-gate.

### Prerequisites
- Vercel CLI installeret globalt: `npm i -g vercel@latest`
- Logget ind: `vercel whoami` skal returnere `broser-ai` scope
- Git working tree clean (`git status`)
- Node 20+ installeret lokalt

### Step-by-step

```bash
# 1. Sync latest changes
cd C:\Users\Ambro2\cirkel-system
git pull origin main
git status                          # skal være clean

# 2. Install dependencies
npm ci                              # ci, ikke install — lockfile-truth

# 3. Run typecheck + build lokalt FØR deploy
npm run typecheck
npm run build                       # fanger fejl før Vercel-runtime

# 4. Kør preview-deploy
vercel deploy --target=preview

# 5. Gem preview-URL fra output
# Format: https://cirkel-system-<hash>-broser-ai.vercel.app
```

### Vigtige regler
- **ALDRIG** `vercel --yes` eller `vercel --prod` uden gate
- **ALDRIG** `vercel deploy` uden `--target=preview` (kan auto-promote første deploy)
- Preview-URL er delbar internt — indeholder ingen production-secrets
- Preview-branch `preview` i Supabase bruges automatisk hvis `SUPABASE_ENV=preview`

---

## 2. Environment variables

Komplet liste over required environment variables. Sæt via Vercel Dashboard → Project → Settings → Environment Variables, eller via CLI: `vercel env add <NAME> preview`.

### AI / LLM providers

| Variable | Scope | Beskrivelse |
|---|---|---|
| `GEMINI_API_KEY` | Preview + Production | Google Gemini API (vision + text) |
| `GEMINI_MODEL` | Preview + Production | Default: `gemini-2.5-pro` |
| `ANTHROPIC_API_KEY` | Preview + Production | Claude API (fallback + agent-routing) |
| `ANTHROPIC_MODEL` | Preview + Production | Default: `claude-opus-4-7` |

### Supabase

| Variable | Scope | Beskrivelse |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Preview + Production | Project URL — public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Preview + Production | Anon key — public, RLS-protected |
| `SUPABASE_SERVICE_ROLE_KEY` | Production only | Server-side kun; NEVER expose client-side |
| `SUPABASE_ENV` | Preview + Production | `preview` eller `production` — router til branch |

### Firebase

| Variable | Scope | Beskrivelse |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Preview + Production | Web SDK config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Preview + Production | Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Preview + Production | Project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Preview + Production | Storage bucket |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Preview + Production | Web app ID |
| `FIREBASE_ADMIN_ENFORCE` | Production only | `true` = server verifies ID tokens; `false` = dev-only bypass |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Production only | Service account private key (base64-encoded) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Production only | Service account email |

### Computer vision / IoT

| Variable | Scope | Beskrivelse |
|---|---|---|
| `ROBOFLOW_API_KEY` | Preview + Production | Roboflow inference |
| `ROBOFLOW_WORKSPACE` | Preview + Production | Workspace-slug |
| `ROBOFLOW_MODEL_ID` | Preview + Production | Model-version pin |
| `IOT_MASTER_SECRET` | Production only | HMAC-signing af device-webhooks; rotate quarterly |

### Payments

| Variable | Scope | Beskrivelse |
|---|---|---|
| `STRIPE_SECRET_KEY` | Production only | `sk_live_*` — server-side kun |
| `STRIPE_PUBLISHABLE_KEY` | Preview + Production | `pk_live_*` — client-safe |
| `STRIPE_WEBHOOK_SECRET` | Production only | Verify webhook signatures |

### Admin / ops

| Variable | Scope | Beskrivelse |
|---|---|---|
| `ADMIN_TOKEN` | Production only | Bearer-token for `/api/admin/*` endpoints |
| `SENTRY_DSN` | Preview + Production | Error tracking |
| `SENTRY_ENVIRONMENT` | Preview + Production | `preview` eller `production` |

### Verification

```bash
# List all env vars for preview
vercel env ls preview

# Pull to local .env.local (aldrig commit denne!)
vercel env pull .env.local --environment=preview
```

**Kritisk:** Hvis `IOT_MASTER_SECRET`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` eller `FIREBASE_ADMIN_PRIVATE_KEY` mangler, vil production-build fejle i runtime, ikke ved build-tid. Verifiér ALTID via `/api/health` post-deploy.

---

## 3. Supabase migrations

Migrations køres **sekventielt** fra `007` til `013`. Hver migration er idempotent (`IF NOT EXISTS`) men kør dem i rækkefølge for at undgå FK-fejl.

### Migration files

Placering: `supabase/migrations/`

| Nr. | Filnavn | Beskrivelse |
|---|---|---|
| 007 | `007_wallet_split.sql` | Split wallet-tabel i `wallet_accounts` + `wallet_transactions` |
| 008 | `008_co2_calculator.sql` | Tilføjer `co2_events` + `co2_baseline` tabeller |
| 009 | `009_give_marketplace.sql` | P2P give-away: `give_listings`, `give_claims`, `give_ratings` |
| 010 | `010_dawa_replacement.sql` | Ny addresses-tabel til post-DAWA-lukning (17 aug 2026) |
| 011 | `011_fraud_signals.sql` | `fraud_signals` + `device_fingerprints` (DK-fraud-epidemi response) |
| 012 | `012_rls_hardening.sql` | Tighter RLS policies på `wallet_*` og `give_*` |
| 013 | `013_iot_devices.sql` | `iot_devices` + `iot_events` med HMAC-verifikation |

### Kør migrations (preview branch først)

```bash
cd C:\Users\Ambro2\cirkel-system

# 1. Link til preview-branch
supabase link --project-ref <preview-branch-ref>

# 2. Kør migrations
supabase db push

# 3. Verificér
supabase db diff --linked        # skal returnere "No differences found"

# 4. Test med seed data
supabase db reset --linked       # KUN på preview — ALDRIG production
psql $DATABASE_URL -f supabase/seed.sql
```

### Production migration

**Kræver `[ACCEPTED-BY-MICHAEL]` før udførelse.**

```bash
# 1. Backup FØRST
supabase db dump --linked > backup-$(date +%Y%m%d-%H%M).sql

# 2. Link til production
supabase link --project-ref sycmpguhdudyejmxxaic

# 3. Dry-run
supabase db push --dry-run

# 4. Efter godkendelse
supabase db push
```

**RØDT:** `sycmpguhdudyejmxxaic` er LIVE læringshukommelse. Ingen destruktive statements (`DROP`, `TRUNCATE`, `DELETE FROM` uden WHERE) uden eksplicit acceptance.

---

## 4. Production deploy

**Kræver `[ACCEPTED-BY-MICHAEL]` inline i orkestreringstråden før kommandoen udføres.**

### Pre-flight checklist

- [ ] Preview-deploy verificeret og manuelt testet
- [ ] `/api/health` returnerer 200 på preview
- [ ] Supabase migrations kørt på production-branch
- [ ] Alle env vars sat i production-scope (`vercel env ls production`)
- [ ] Rollback-plan noteret (seneste stable deployment-URL)
- [ ] Sentry-alerts armed
- [ ] `[ACCEPTED-BY-MICHAEL]` givet

### Deploy

```bash
cd C:\Users\Ambro2\cirkel-system

# 1. Confirm on main branch
git checkout main
git pull origin main
git log -1                         # noter commit SHA

# 2. Note current production deployment (for rollback)
vercel ls --prod | head -3

# 3. Deploy
vercel deploy --prod

# 4. Vent på "Ready" status
# Format: https://cirkel.dk
```

### Post-deploy verification

Se sektion 6.

---

## 5. Rollback

To metoder — vælg efter situation.

### Metode A: Vercel promote-history (hurtigst — <30 sek)

Brug når problemet er isoleret til seneste deploy og forrige deploy var stable.

```bash
# 1. List seneste deploys
vercel ls --prod

# 2. Find forrige stable deployment-URL (target: cirkel.dk)
# Format: cirkel-system-<hash>-broser-ai.vercel.app

# 3. Promote forrige deploy
vercel promote <deployment-url>

# 4. Verificér
curl -I https://cirkel.dk
curl https://cirkel.dk/api/health
```

### Metode B: Git revert + re-deploy (safer — 3-5 min)

Brug når problemet involverer schema-changes, env-vars, eller flere commits.

```bash
# 1. Find problematisk commit
git log --oneline -10

# 2. Revert
git revert <commit-sha>            # skaber ny commit, ikke rewrite
git push origin main

# 3. Re-deploy
vercel deploy --prod

# 4. Hvis migration skal rulles tilbage:
supabase db reset --linked --version <previous-migration-nr>
# (KUN hvis migration er reversibel — 007-013 er IKKE alle reversible)
```

### Efter rollback

- Log i Sentry med tag `rollback=true`
- Post i #ops-alerts Slack med årsag
- Skab post-mortem i `docs/incidents/YYYY-MM-DD.md`

---

## 6. Post-deploy verification

Køres på **hvert** deploy (preview og production).

### 6.1 Health endpoint

```bash
# Preview
curl -i https://cirkel-system-<hash>-broser-ai.vercel.app/api/health

# Production
curl -i https://cirkel.dk/api/health
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-21T...",
  "services": {
    "supabase": "ok",
    "gemini": "ok",
    "firebase": "ok",
    "stripe": "ok"
  },
  "version": "<git-sha>"
}
```

Skal returnere `200 OK`. Hvis nogen service er `"degraded"` eller `"error"` — **stop deploy, undersøg**.

### 6.2 Manuel scan-test

1. Åbn preview-URL i browser (mobil viewport)
2. Login med test-bruger (`test@cirkel.dk` / password i 1Password)
3. Trigger CO2-scan flow:
   - Tag foto af test-object
   - Verificér Gemini-response indenfor 3 sek
   - Verificér `co2_events` række skabt i Supabase
4. Test wallet:
   - Åbn wallet-view
   - Verificér `wallet_accounts` + `wallet_transactions` renderer
5. Test give-marketplace:
   - Opret test-listing
   - Verificér RLS: anden test-bruger kan se listing
6. Logout og verificér session cleared

### 6.3 Logs & error tracking

```bash
# Vercel runtime logs (seneste 15 min)
vercel logs --since 15m

# Filter til errors
vercel logs --since 15m | grep -i "error\|exception\|failed"

# Supabase logs (via MCP tool eller dashboard)
# https://supabase.com/dashboard/project/sycmpguhdudyejmxxaic/logs
```

Sentry:
- Åbn https://sentry.io/organizations/broser-ai/issues/
- Filter: `environment:production` + tidsvindue seneste 30 min
- Ingen nye `unresolved` issues acceptabelt for GO

---

## 7. Nødstop procedures

Når noget er alvorligt galt i production.

### 7.1 Full production shutdown (nuclear option)

Bruges kun ved sikkerhedsbrud, data-lækage, eller live-fraud.

```bash
# 1. Pause Vercel deployment (behold DNS men returner 503)
vercel domains inspect cirkel.dk
# I dashboard: Settings → Domains → Redirect til statisk maintenance-side

# 2. Rotate ALL secrets
# - Stripe: dashboard.stripe.com → API keys → Roll
# - Supabase service_role: dashboard.supabase.com → Settings → API → Reset
# - Firebase admin: console.firebase.google.com → Project Settings → Service accounts → Generate new key
# - IOT_MASTER_SECRET: manuel rotation, opdater alle devices

# 3. Alert stakeholders
# - Michael (SMS)
# - Legal counsel (email)
# - Datatilsynet hvis persondata er kompromitteret (72-timer GDPR-vindue)
```

### 7.2 Selective feature-flag disable

Foretrækkes over full shutdown ved isolerede problemer.

```bash
# I Vercel dashboard eller via CLI:
vercel env add FEATURE_CO2_SCAN_ENABLED production
# Value: "false"

vercel env add FEATURE_GIVE_MARKETPLACE_ENABLED production
# Value: "false"

# Trigger re-deploy uden kode-ændringer
vercel deploy --prod --force
```

### 7.3 Database read-only mode

Ved suspicion om data-corruption eller ongoing attack.

```sql
-- Kør på production Supabase (kræver [ACCEPTED-BY-MICHAEL])
ALTER DATABASE postgres SET default_transaction_read_only = on;

-- Revert når safe
ALTER DATABASE postgres SET default_transaction_read_only = off;
```

### 7.4 Kill Stripe webhook processing

```bash
# Sæt STRIPE_WEBHOOK_SECRET til invalid værdi — alle webhooks fejler signature-check
vercel env rm STRIPE_WEBHOOK_SECRET production
vercel env add STRIPE_WEBHOOK_SECRET production
# Value: "DISABLED-<timestamp>"

vercel deploy --prod --force
```

---

## 8. Contact-liste

### Primary escalation

| Rolle | Navn | Kontakt | Domæne |
|---|---|---|---|
| CEO / Owner | Michael | ma@keap.me | Alle acceptance-gates, strategiske beslutninger |
| On-call engineer | Michael (solo) | SMS via 1Password | Alle nødstop |

### External providers

| Service | Support-kanal | Response-tid | Account-ID |
|---|---|---|---|
| Vercel | support@vercel.com / dashboard chat | Enterprise: <1h | broser-ai |
| Supabase | support@supabase.com | Pro: <24h | sycmpguhdudyejmxxaic |
| Stripe | dashboard.stripe.com/support | Live: <2h | acct_* i 1Password |
| Firebase | firebase-support@google.com | Blaze: <24h | cirkel-prod |
| Anthropic | support@anthropic.com | <48h | Console |
| Google Gemini | Cloud Console → Support | Basic: <48h | cirkel-gcp |
| Roboflow | support@roboflow.com | <24h | broser-ai |
| Sentry | dashboard chat | Business: <4h | broser-ai |

### Regulatory (DK)

| Instans | Kontakt | Hvornår |
|---|---|---|
| Datatilsynet | dt@datatilsynet.dk / +45 33 19 32 00 | Persondata-brud (72t GDPR) |
| DBA (Digitaliseringsstyrelsen) | info@digst.dk | NIS2-relaterede incidents |
| SKAT | Via TastSelv Erhverv | Transaction-fraud detection (give-marketplace) |

### Documentation cross-refs

- Vercel-deploy regler: `feedback_vercel_deploy.md` i memory
- Fuld adgang scope: `feedback_full_access_vercel_supabase.md`
- SOVEREIGN ORCHESTRATOR V4: `feedback_sovereign_orchestrator_v4.md`
- Kritisk DPN-infra (relateret setup): `project_dpn_critical_infra.md`
- Cirkel Master Architecture: `project_cirkel_master_architecture.md`

---

**End of runbook.** Opdater denne fil ved hver arkitektur-ændring der påvirker deploy-flow eller nødprocedurer.
