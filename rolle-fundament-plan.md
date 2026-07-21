# Cirkel — Rolle-fundament: beslutninger + Fase 2-plan

**Formaliserer Michaels svar på arkitekt-agentens 5 blocking-spørgsmål.**
Dette er beslutnings-grundlaget architect-orchestrator kører Fase 2 ud fra.

> ⚠️ **GENBESØGES-NOTE:** Rolle-model og især kampagne/QR-retningen er en
> RETNING, ikke en endelig låst arkitektur. Vi vender tilbage til
> forretningsforståelsen og finpudser dette, når vi kører de endelige tests.
> Byg Fase 2 additivt og reversibelt, så vi kan justere uden at rive ned.

---

## Besluttede rammer (Michael, 2026-07-06)

1. **viewMode beholdes** som admin-impersonation. Rigtige brugere er låst til
   deres rolle; kun admin ser toggle mellem verdener.
2. **Kommune og B2B-erhverv = SEPARATE portaler.** Ikke ét komponent med intern
   toggle. Hver har sit eget setup, sin egen navigation, sit eget indhold.
3. **Admin ser alt — men OPDELT og let at navigere.** Ikke ét rodet fælles view;
   admin skifter rent mellem de tre verdener og kan arbejde i hver.
4. **Rolle-tildeling skal virke fra start.** Der bygges et admin-UI til at
   oprette og styre B2B-/kommune-konti og sætte user_type — ikke manuelt
   Supabase-fumleri når kunderne kommer. "Vi skal ikke gå baglæns."
5. **B2B/kommune ser resultater/impact + deres EGNE kampagner** — aldrig
   forbruger-gamification (rewards/leaderboard). De ser kampagne-resultater når
   de selv laver kampagner/reklame.

## Rolle-model (Fase 2)

```sql
ALTER TABLE profiles ADD COLUMN user_type text NOT NULL DEFAULT 'consumer'
  CHECK (user_type IN ('consumer','b2b_business','b2b_kommune','admin'));
CREATE INDEX profiles_user_type_idx ON profiles(user_type);
```

| user_type | Portal | Ser | Ser aldrig |
|---|---|---|---|
| `consumer` | Borger-mobil-app | scan/wallet/profil/rewards/leaderboard | B2B/kommune-portaler |
| `b2b_business` | Erhverv-portal (separat) | impact/resultater, egne kampagner (opt-in) | kommune-data, konsument-persondata |
| `b2b_kommune` | Kommune-portal (separat) | impact/resultater, egne kampagner (opt-in) | erhvervs-brand-data, konsument-persondata |
| `admin` | Alle tre, opdelt | alt via ren mode-switch | intet |

## Fase 2 — konkret rækkefølge (additivt, reversibelt)

1. **DB:** tilføj `user_type` (default `consumer`), backfill eksisterende
   profiler til `consumer` (Morten passer). Sæt Mortens testkonto til `admin`.
2. **App.tsx-gate:** `availableModes` afledes af `user.user_type`. Consumer
   låst til borger-app; b2b_business til erhverv-portal; b2b_kommune til
   kommune-portal; admin ser toggle mellem alle tre. **RØD** — vis diff.
3. **Separate portaler:** adskil kommune- og erhverv-portal (i dag delt i
   B2BPartnerDashboard's sidebar). Hver bliver sin egen gren.
4. **Admin-UI (rolle-styring):** en admin-only skærm til at oprette B2B-/
   kommune-konti og sætte user_type. Additivt, egen komponent.
5. **Backend-gate:** koordinér med qa-security — RLS på scans/ledger/
   redemptions + F3.8 (server-side token-verify) lukker de kendte huller
   (`/api/dashboard` enumerering, `/api/redeem` spoofing).

## Guardrails

- Cirkels EGET Supabase `rjincywpvgaloydgsnmh`. Aldrig `<MTC_ID_FORBIDDEN>`.
- Alt additivt/reversibelt. Ændringer i App.tsx/auth = RØD, vis diff.
- Preview først, aldrig promote. Ingen service-role i frontend.

## Efter Fase 2

showcase-ui genoptages: Rewards/Leaderboard wires KUN ind i consumer-grenen
(+ admin via impersonation). De rammer aldrig b2b/kommune.

Kampagne/QR-modulet (opt-in) er et SEPARAT senere spor — se
`campaign-qr.md`. Bygges ikke nu; fundamentet skal bare kunne rumme det.
