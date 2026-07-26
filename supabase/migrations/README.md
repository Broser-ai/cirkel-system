# Cirkel · Supabase Migrations

Kanonisk kilde-af-sandhed for skema-udvidelser oven på `supabase_schema.sql`
(baseline: `profiles`, `scans`, `ledger` + KPI-views).

Sidste opdatering: 2026-07-26

---

## Apply-ordre

Migrations skal køres i numerisk rækkefølge. Nummerering er sparse — 002
er reserveret til retro-dokumentation af undokumenterede live-migrations.

| # | Fil | Formål | Tabeller / views | Afhænger af |
|---|---|---|---|---|
| 001 | `001_consolidate.sql` | No-op — repo-hygiejne (slettede duplikeret `supabase/schema.sql`). Etablerer `supabase_schema.sql` som eneste sandhedskilde. | — | baseline schema |
| 002 | *(reserveret)* | Retro-dok af undokumenterede live-migrations: `add_user_type_to_profiles`, `add_portal_features_admin_flags`, `restrict_set_portal_features_to_service_role`. | (extends profiles) | baseline schema |
| 003 | `003_webauthn_credentials.sql` | WebAuthn public-keys for phishing-resistent 2FA. | `webauthn_credentials` | baseline (profiles) |
| 004 | `004_smart_bins.sql` | IoT smart-bins registry + fill-level. | `smart_bins` | baseline (bruger `handle_updated_at()`) |
| 005 | `005_biometric_verifications.sql` | Append-only log af biometriske verifikationer. | `biometric_verifications` | 003 (webauthn_credentials) |
| 006 | `006_kommune_waste_stats.sql` | Per-bin timeseries af affalds-delta + dagligt view. | `kommune_waste_stats`, view `kommune_waste_daily` | 004 (smart_bins) |
| 007 | `007_cases.sql` | Fraud-review + dispute case-management. | `cases` | baseline (profiles, scans) |
| 008 | `008_material_passports.sql` | GS1/GTIN materialepas-registry. | `material_passports` | baseline · **soft-ref til 013** (producer_id nullable, FK ikke enforced) |
| 009 | `009_bulky_waste_marketplace.sql` | P2P give-away marketplace for storskrald. | `bulky_waste_marketplace` | baseline (profiles) |
| 010 | `010_municipal_rule_overrides.sql` | Kommune-specifikke sorteringsregel-overrides + aktivt view. | `municipal_rule_overrides`, view `municipal_rule_overrides_active` | baseline (bruger `handle_updated_at()`) |
| 011 | `011_municipal_tax_rebates.sql` | Kvartalsvis afgiftsrabat pr. borger (EU-PPWR cap 500 DKK). | `municipal_tax_rebates` | baseline (profiles) |
| 012 | `012_logistics_bounties.sql` | Bounty-marked for registrerede kollektorer. | `logistics_bounties` | 009 (bulky_waste_marketplace) · profiles.user_type (fra live-mig 002) |
| 013 | `013_b2b_producers.sql` | B2B-producent-registry (CVR + Stripe billing). | `b2b_producers` | baseline |
| 014 | `014_mitid_wallet_tables.sql` | MitID PKCE state + wallet balance/pool/payouts. | `mitid_pkce_state`, `wallet_balances`, `wallet_pool_state`, `wallet_payouts` | baseline (profiles) · 013 (b2b_producers) |
| 015 | `015_push_subscriptions.sql` | WebPush subscription registrering (VAPID) — server-only RLS. | `push_subscriptions` | baseline (ingen FK; logisk ejer = `firebase_uid`) |

### Kør lokalt

```bash
# Alle migrations idempotent i orden (Supabase CLI)
supabase db push

# Eller manuel PSQL mod local dev
for f in supabase/migrations/0*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Alle migrations bruger `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
/ `CREATE OR REPLACE` og kan køres flere gange uden fejl.

---

## FK-graf

```
                      auth.users
                          │
                          │ (id, on delete cascade)
                          ▼
                    ┌──────────┐
                    │ profiles │◄────────────────────────────────┐
                    │  (base)  │                                 │
                    └────┬─────┘                                 │
                         │                                       │
       ┌─────────────────┼───────────────────┬───────────┬───────┼────────────┐
       │                 │                   │           │       │            │
       ▼                 ▼                   ▼           ▼       ▼            ▼
   ┌───────┐      ┌──────────────┐     ┌─────────┐  ┌──────┐ ┌─────────┐ ┌──────────────┐
   │ scans │      │   ledger     │     │ webauthn│  │cases │ │  bulky_ │ │  municipal_  │
   │(base) │◄──┐  │   (base)     │     │_credenti│  │(007) │ │  waste_ │ │  tax_rebates │
   └───┬───┘   │  └──────────────┘     │  als    │  └──┬───┘ │ marketp.│ │    (011)     │
       │       │      ▲                │  (003)  │     │     │  (009)  │ └──────────────┘
       │       │      │                └────┬────┘     │     └────┬────┘        (011.user_id → profiles)
       │       │      │                     │          │          │
       │       │  scans.id                  │          │          │
       │       │  (scan_id + user_id        │          │          │
       │       │   on delete restrict)      │          │          │
       │       │                            ▼          ▼          ▼
       │       │                    ┌────────────┐  cases.scan_id     bulky.collector_user_id
       │       │                    │ biometric_ │  → scans           bulky.user_id
       │       │                    │verifications│  cases.user_id    → profiles ×2
       │       │                    │   (005)    │  cases.assigned_to
       │       │                    └────────────┘  → profiles ×2
       │       │                     (user_id → profiles,
       │       │                      webauthn_credential_id
       │       │                      → webauthn_credentials
       │       │                      on delete set null)
       │       │
       │       └── ledger.user_id / scan_id (on delete restrict — append-only chain)
       │
       └── scans.user_id → profiles (on delete cascade)


   ┌────────────┐        ┌──────────────────┐        ┌─────────────────┐
   │ smart_bins │◄───────│  kommune_waste_  │        │ municipal_rule_ │
   │   (004)    │        │     stats        │        │   overrides     │
   └────────────┘        │     (006)        │        │     (010)       │
   (bin_id PK — no FK)   └──────────────────┘        └─────────────────┘
                          (bin_id → smart_bins        (no FK — standalone)
                           on delete cascade)


   ┌──────────────────┐         ┌──────────────────────┐
   │ b2b_producers    │◄────────│  wallet_pool_state   │
   │     (013)        │         │        (014)         │
   └──────────────────┘         └──────────────────────┘
        ▲                        (producer_id → b2b_producers
        │                         on delete cascade)
        │ (soft-ref, ikke enforced)
        │
   ┌───────────────────┐
   │ material_passports│
   │      (008)        │
   │  producer_id UUID │ ← nullable, ingen hard FK i migration 013
   └───────────────────┘


   ┌───────────────────────────┐          ┌─────────────────────┐
   │ bulky_waste_marketplace   │◄─────────│ logistics_bounties  │
   │        (009)              │          │       (012)         │
   └───────────────────────────┘          └─────────────────────┘
                                           (asset_id → bulky_waste_marketplace.item_id
                                            on delete set null;
                                            claimed_by → profiles
                                            on delete set null;
                                            RLS-check: profiles.user_type = 'collector')


   ┌──────────┐         ┌──────────────────────────────────────────┐
   │ profiles │◄────────│ mitid_pkce_state / wallet_balances /     │
   │  (base)  │         │ wallet_payouts             (014)         │
   └──────────┘         └──────────────────────────────────────────┘
                          (user_id → profiles;
                           mitid_pkce_state on delete cascade,
                           wallet_balances on delete cascade,
                           wallet_payouts on delete restrict — payout-audit)


   ┌────────────────────────┐
   │  push_subscriptions    │   (015)
   │  (server-only RLS)     │   Ingen hard FK. Logisk ejer = firebase_uid
   └────────────────────────┘   (text). UNIQUE (firebase_uid, endpoint).
                                Skrives af /api/notifications/subscribe.
```

### FK-cascades resumé

| Referrer | Kolonne | Reference | Delete-adfærd |
|---|---|---|---|
| `profiles.id` | id | `auth.users.id` | CASCADE |
| `scans.user_id` | user_id | `profiles.id` | CASCADE |
| `ledger.scan_id` | scan_id | `scans.id` | **RESTRICT** (append-only chain) |
| `ledger.user_id` | user_id | `profiles.id` | **RESTRICT** (append-only chain) |
| `webauthn_credentials.user_id` | user_id | `profiles.id` | CASCADE |
| `biometric_verifications.user_id` | user_id | `profiles.id` | CASCADE |
| `biometric_verifications.webauthn_credential_id` | webauthn_credential_id | `webauthn_credentials.credential_id` | SET NULL |
| `kommune_waste_stats.bin_id` | bin_id | `smart_bins.bin_id` | CASCADE |
| `cases.user_id` | user_id | `profiles.id` | CASCADE |
| `cases.scan_id` | scan_id | `scans.id` | SET NULL |
| `cases.assigned_to` | assigned_to | `profiles.id` | SET NULL |
| `bulky_waste_marketplace.user_id` | user_id | `profiles.id` | CASCADE |
| `bulky_waste_marketplace.collector_user_id` | collector_user_id | `profiles.id` | SET NULL |
| `municipal_tax_rebates.user_id` | user_id | `profiles.id` | CASCADE |
| `logistics_bounties.asset_id` | asset_id | `bulky_waste_marketplace.item_id` | SET NULL |
| `logistics_bounties.claimed_by` | claimed_by | `profiles.id` | SET NULL |
| `mitid_pkce_state.user_id` | user_id | `profiles.id` | CASCADE |
| `wallet_balances.user_id` | user_id | `profiles.id` | CASCADE |
| `wallet_pool_state.producer_id` | producer_id | `b2b_producers.producer_id` | CASCADE |
| `wallet_payouts.user_id` | user_id | `profiles.id` | **RESTRICT** (payout-audit) |
| `material_passports.producer_id` | producer_id | `b2b_producers.producer_id` | **SOFT — FK ikke enforced** |

---

## Kendte drift-issues (ikke rettet — kræver `[ACCEPTED-BY-MICHAEL]`)

1. **`kpi_co2_daily` / `kpi_material_breakdown` refererer `scans.co2_grams`** som ikke findes.
   Views vil fejle med 42703 ved kald. Fix-forslag i baseline `supabase_schema.sql`
   sektion 8.
2. **`material_passports.producer_id` er ikke enforced FK** til `b2b_producers`.
   Migration 008 skrev denne som "tilføjes i migration 013", men 013 tilføjer
   den ikke. Fix-forslag i baseline `supabase_schema.sql` sektion 8.
3. **`logistics_bounties` RLS-policy læser `profiles.user_type`** som ikke er
   defineret i baseline-skemaet. Kolonnen findes live pga. undokumenteret
   migration `add_user_type_to_profiles` (TRIN 2, ~2026-07-06). Skal
   retro-dokumenteres som migration 002.
4. **Migration-nr. 002 er sparse** (bevidst reserveret) — se punkt 3.
5. **Migration 014 definerer `public.set_updated_at()`** i stedet for at
   genbruge baseline `public.handle_updated_at()`. To parallelle funktioner
   med samme effekt. Konsolider til `handle_updated_at()` ved næste refactor.

---

## Nye migrations — konvention

- Filnavn: `NNN_kort_snake_case_navn.sql` (fx `016_carbon_offset_ledger.sql`).
- Header-kommentar med Fase · Modul · Formål · Dato (se 007-014 for template).
- Kun `CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE` (idempotent).
- Enable RLS på alle nye tabeller. Skriv-policies default `service_role`
  medmindre brugeren skal have direkte adgang.
- FK-cascade-valg dokumenteres i migration-headeren (CASCADE / RESTRICT / SET NULL).
- Opdatér denne README's tabel + FK-graf i samme PR som migrationen.
