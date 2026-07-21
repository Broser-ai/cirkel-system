---
name: campaign-qr
description: >
  Bygger Cirkels OPT-IN kampagne- og QR-modul for B2B/kommune-brugere:
  selvbetjent kampagne-styring (upload logoer/grafik/filer, opret kampagner,
  cross-target mod kommune/erhverv/forbruger) og et QR/barcode-system der kan
  trykkes på emballage og føre til dynamisk indhold. Dette er en MULIGHED
  brugeren selv tilføjer — ikke en tvungen del af portalen. Bygges som et
  senere, separat spor OVEN PÅ rolle-fundamentet. Kører IKKE før rolle-model
  (user_type) og separate portaler er på plads.
model: inherit
---

# Agent — Kampagne + QR (OPT-IN modul, senere spor)

Du bygger Cirkels selvbetjente kampagne- og QR-modul. Det er et **tilvalg**:
en B2B/kommune-bruger vælger selv at aktivere det. Mange vil ikke — så det må
aldrig påtvinges eller fylde i basis-portalen (som er impact/resultater).

> ⚠️ **GENBESØGES-NOTE:** Kampagne-flowet, cross-targeting og QR-kriterierne er
> en RETNING sat sammen med Michael, ikke en endelig arkitektur. Vi vender
> tilbage til forretningsforståelsen og finpudser dette, når vi kører de
> endelige tests. Byg additivt og reversibelt. Ved tvivl om forretningsregler:
> STOP og spørg Michael, byg ikke på antagelser.

## Forudsætning (må ikke brydes)

Kør IKKE før rolle-fundamentet står: `user_type` findes, separate portaler for
b2b_business og b2b_kommune er på plads (se `rolle-fundament-plan.md`). Dette
modul hænger på den struktur.

## Kerneprincip: opt-in

- Basis for alle B2B/kommune = impact/resultater. Rent, enkelt.
- Kampagne/QR = en funktion brugeren selv **aktiverer**. Ligger klar, men ude af
  vejen for dem der ikke vil bruge den. Ingen tvungen onboarding.
- Et `campaigns_enabled`-flag (eller lignende) pr. konto styrer synligheden.

## QR-design — den kritiske beslutning (læs først)

En QR trykt på emballage kan ALDRIG ændres bagefter. Derfor:

- QR'en indeholder KUN en **stabil identifikator**, fx `cirkel.dk/s/{kode}`.
  Aldrig kampagne-data direkte (kampagner ændrer sig; emballage ligger i årevis).
- `{kode}` slår op i databasen og henter det **aktuelle** indhold. B2B/kommune
  kan ændre kampagnen bag koden uden at røre emballagen.
- De kriterier systemet skal bruge (materiale, producent, kommune, kampagne-id,
  ejer-konto, mål-målgruppe) lever i databasen knyttet til `{kode}` — ikke i
  QR'en. Det er forskellen på et system der skalerer og et man fortryder.
- Understøt både dynamisk redirect (kampagne kan skiftes) og en fallback
  (hvis ingen aktiv kampagne: vis materialepas/sorteringsinfo — Cirkels kerne).

## Leverancer (additivt, når sporet aktiveres)

1. **Kampagne-datamodel:** `campaigns`-tabel (ejer-konto, type, mål-målgruppe
   [kommune/erhverv/forbruger], aktiv-periode, indhold-ref, status), med RLS så
   en konto kun ser/ændrer egne kampagner.
2. **Fil-upload/-download:** logoer, grafik, filer pr. kampagne (Supabase
   Storage el.lign., med RLS). Op- og nedload.
3. **QR/barcode-generering:** stabil `{kode}` pr. kampagne/produkt; QR peger på
   `cirkel.dk/s/{kode}`; kriterier gemmes i DB bag koden.
4. **Scan-redirect-endpoint:** `/s/{kode}` → slår op → viser aktuelt
   kampagne-indhold, eller falder tilbage til materialepas hvis ingen aktiv.
5. **Cross-targeting:** en kampagne kan rettes mod kommune, erhverv ELLER
   forbruger (B2B→kommune, kommune→B2B/forbruger osv.). Regler afklares med
   Michael før implementering — se genbesøges-note.
6. **Opt-in UI:** aktivér/deaktivér kampagne-modul pr. konto; kun synligt når
   aktiveret.

## Guardrails (ufravigelige)

- Cirkels EGET Supabase `rjincywpvgaloydgsnmh`. Aldrig `<MTC_ID_FORBIDDEN>`.
- QR trykt på emballage = stabil identifikator KUN. Aldrig kampagne-data i koden.
- RLS på alle kampagne-/fil-tabeller: en konto ser kun egne data.
- Ingen service-role i frontend; uploads/downloads via sikre endpoints.
- Opt-in: modulet må aldrig påtvinges brugere der ikke aktiverer det.
- Additivt/reversibelt. Alt der rører kanon eller auth = RØD, vis diff.
- Preview først, aldrig promote.
- Ved forretningsregel-tvivl (cross-targeting, hvem-må-hvad): STOP, spørg Michael.

## Acceptance-tjek

- [ ] Kampagne oprettes af en b2b/kommune-testkonto; RLS bekræftet (kan ikke se
      andres kampagner).
- [ ] Fil op-/nedload virker pr. kampagne, RLS-beskyttet.
- [ ] QR genereres med stabil `{kode}`; ændring af kampagne bag koden ændrer
      IKKE koden.
- [ ] `/s/{kode}` viser aktuelt indhold; fallback til materialepas når ingen
      aktiv kampagne.
- [ ] Opt-in: en konto uden modul aktiveret ser INTET kampagne-UI.
- [ ] Genbesøges-punkter noteret til den endelige test-runde.

## Efter dette

Genbesøg forretningsforståelsen med Michael i den endelige test-fase: cross-
targeting-regler, QR-kriterier, og hvordan Cirkel-i-emballage-flowet skal føles
for slutbrugeren.
