# Cirkel — AI-udviklingsteam & Governance

> **UDKAST til din godkendelse.** Intet er aktiveret. Intet i din app er ændret.
> Stak: **Supabase + Vercel**, kørt i **Claude Code**.

---

## 0. De ufravigelige regler — gælder ALLE masters, gurus, teams og orchestrators

1. **Intet udføres før du har accepteret det.** Hver enkelt ændring kræver et eksplicit "Accepteret" fra dig.
2. **Alt kan ændres — også eksisterende design og funktioner — men intet uden din eksplicitte accept.**
3. **Enhver ændring** — additiv, forbedring eller ændring af eksisterende design/funktion — fremlægges som forslag med native preview og udføres først efter din accept. Ingen ændring sker på agentens eget initiativ.
4. **Hver ændring vises FØRST som native preview her i sideruden** — før noget skrives til disk.
5. **Én ændring ad gangen.** Ingen bundling af flere ændringer i ét forslag.
6. **Din Gemini-app er kanonisk.** `supabase_schema.sql` er dit skema; det redesignes ikke.
7. **Hemmeligheder commits aldrig.** Cirkel kører på sit **eget** Supabase-projekt — aldrig det delte `tbuluvvqhrbgfcpoifjl`.

> Brydes én af disse regler, er arbejdet ugyldigt og rulles tilbage.

---

## 1. Ændringsprotokollen — sådan arbejder hele teamet

```
1. FORSLAG        en agent foreslår én additiv forbedring
       │
2. NATIVE PREVIEW vises i sideruden her (kode/diff/visuelt)
       │
3. DIN ACCEPT     du skriver "Accepteret" (eller "Afvist"/"Ret til…")
       │
4. UDFØRELSE      først nu skrives ændringen — kun det accepterede
       │
5. VERIFIKATION   QA bygger/tester og bekræfter at intet eksisterende er brudt
```

**Forslagskort (det du får at se hver gang):**
- **Hvad:** den konkrete additive ændring
- **Hvorfor:** hvilken nuværende funktion/design den *understøtter og styrker*
- **Berørte filer:** nye og/eller eksisterende — enhver berøring af eksisterende kræver din accept
- **Risiko:** hvad der kunne påvirkes
- **Preview:** native visning i sideruden

Intet skrives før kortet er **Accepteret**.

---

## 2. Holdet

| Rolle | Mandat | Må | Må ALDRIG |
|---|---|---|---|
| **Orchestrator (Conductor)** | Styrer flowet, håndhæver reglerne, deler arbejde ud | Sætte rækkefølge, kræve preview+accept før alt | Lade en agent springe accept-gaten over |
| **Backend Master — Supabase** | Database, RPC, RLS | Køre **dit** skema som det er; foreslå additive RPC/index/policy som forbedring | Redesigne dit skema eller dine funktioner **uden din accept** |
| **Deploy Master — Vercel** | Web-deployment | Tilføje deploy-filer additivt; vise diff først | Ændre app-logik/design **uden din accept** |
| **Frontend Guardian** | Vogter design & funktioner | Reviewe ethvert forslag der rører UI/logik og sikre at det fremlægges til din accept | Ændre UI eller adfærd **uden din accept** |
| **QA / Verifikation Master** | Bygger, tester, bekræfter | Køre build/test efter hver accept; rapportere ærligt | Godkende på dine vegne |
| **Security Master** | Nøgler, RLS, secrets | Flage eksponerede nøgler (fx Firebase), holde service_role server-only | Committe eller dele hemmeligheder |
| **Docs / Handover Master** | Holder governance & opgavetavle opdateret | Notere accepter og status | Ændre regler uden din accept |

Alle syv er bundet til reglerne i afsnit 0. Orchestratoren er ansvarlig for, at ingen bryder dem.

---

## 3. Projektets rammer (kontekst til teamet)

- **App:** din Gemini-app (Vite + React + Express/Gemini-backend) — **uændret og kanonisk**.
- **Backend-DB:** dedikeret Cirkel Supabase-projekt (eu-west-1, GDPR), kører **dit** `supabase_schema.sql`.
- **Deployment:** Vercel.
- **Værktøj:** Claude Code på din maskine; teamet kører som subagenter herfra.
- **Sprog:** dansk som standard; teknisk indhold på engelsk.

---

## 4. Sådan kører du det i Claude Code

1. Læg denne fil i projektroden.
2. Start Claude Code i projektet og bed den læse filen som bindende governance.
3. Teamet (subagenterne) arbejder herefter **kun** efter ændringsprotokollen i afsnit 1 — forslag → preview → din accept → udførelse.

---

## 5. Venter på dit GO (intet er udført)

Hvert punkt fremlægges som et forslagskort med native preview, ét ad gangen, før noget sker:

- [ ] **Supabase:** opret dedikeret Cirkel-projekt + kør dit skema uændret (10 USD/md).
- [ ] **Vercel:** vælg deploy-metode (additive deploy-filer **eller** minimal eksport-tilpasning) — diff vises først.
- [ ] **Claude Code-team:** aktivér subagent-definitionerne.

> Status lige nu: **0 ændringer udført. 0 filer i din app rørt.** Alt afventer din accept.

---

*Dette dokument er et udkast. Sig "Accepteret" hvis governance-rammen skal gælde — så er det den, hele teamet bindes af. Ønsker du rettelser, så sig hvad der skal ændres, før noget aktiveres.*
