# Security Policy

Cirkel tager sikkerhed alvorligt. Denne politik beskriver, hvordan du rapporterer sårbarheder, hvad der er in scope, og hvad du kan forvente af os.

---

## Reporting a Vulnerability

**Send din rapport til:** [ma@keap.me](mailto:ma@keap.me)

**Response SLA:** Vi bekræfter modtagelse af din rapport inden for **72 timer**.

> **Do NOT open a public GitHub issue for security vulnerabilities.** Offentlige issues eksponerer sårbarheden, før den kan patches, og udsætter brugere for unødig risiko.

### Sådan skriver du en god rapport

For at vi hurtigst muligt kan validere og reproducere problemet, medtag venligst:

- **Beskrivelse:** Hvad er sårbarheden, og hvorfor er den et problem?
- **Impact:** Hvad kan en angriber opnå? (fx data-læk, RCE, privilege escalation, DoS)
- **Steps to reproduce:** Præcise trin, request/response-eksempler, evt. proof-of-concept
- **Affected component:** URL, endpoint, commit-hash, eller filsti
- **Suggested mitigation:** (valgfrit) Forslag til fix
- **Din kontaktinfo:** Så vi kan følge op og evt. anerkende dig

Rapporter må gerne være på dansk eller engelsk.

### Kryptering (valgfrit)

Hvis din rapport indeholder følsomme detaljer, kan du kryptere den. Bed om vores PGP-nøgle i første mail, så sender vi den retur.

---

## Scope

### In scope

Følgende systemer er dækket af denne policy:

- **Repository:** `cirkel-system` (dette repo)
- **Production domain:** `cirkel.dk`
- **Subdomains:** `*.cirkel.dk` (alle subdomæner under cirkel.dk, inklusiv preview- og staging-miljøer)
- **API endpoints:** Alle offentligt eksponerede endpoints under ovenstående domæner
- **Auth flows:** Login, session-håndtering, token-udstedelse
- **Data-håndtering:** GDPR-relaterede sårbarheder i persondata-behandling

### Out of scope

Følgende er **ikke** dækket — rapportér ikke problemer her via denne kanal:

- **`cirkel-demo`** — deprecated, vedligeholdes ikke længere. Rapporter ignoreres.
- **`cirkel-app-native`** — under aktiv udvikling (in dev). Ikke produktion. Rapportér i stedet direkte til udviklingsteamet, hvis du finder noget.
- **Third-party services** vi bruger (Vercel, Supabase, Stripe, DAWA m.fl.) — rapportér direkte til leverandøren via deres eget bug-bounty-program.
- **Social engineering** af Cirkel-medarbejdere eller -brugere.
- **Physical attacks** mod kontorer eller hardware.
- **DoS/DDoS uden proof-of-concept** — rapportér kun, hvis du kan demonstrere en reel amplification eller resource exhaustion via kode-baseret sårbarhed.
- **Rapporter genereret udelukkende af automatiske scannere** uden manuel verifikation.
- **Missing security headers** uden demonstreret exploit-vej.
- **Rate-limiting på ikke-følsomme endpoints** uden konkret misbrugsscenarie.
- **Self-XSS** som kræver, at offeret selv indsætter payload i egen browser-konsol.
- **Outdated browsers/OS'er** — vi supporterer kun evergreen-versioner.

---

## Bug Bounty

**Der er p.t. ingen formel bug-bounty-ordning** hos Cirkel. Vi kompenserer altså ikke økonomisk for rapporter på nuværende tidspunkt.

Hvis vi indfører et bounty-program i fremtiden, vil vi opdatere denne fil og notificere tidligere rapportører via den kontaktadresse, de brugte.

Selv om der ikke er økonomisk kompensation, vil vi:

- Anerkende dit bidrag i vores Hall of Fame (se nedenfor), hvis du ønsker det
- Give dig kredit ved den efterfølgende disclosure
- Være tilgængelige for spørgsmål og opfølgning under hele processen

---

## Coordinated Disclosure

Vi følger **coordinated disclosure** efter industri-standard:

| Fase | Timeline | Hvad sker der |
|------|----------|---------------|
| **T+0** | Rapport modtaget | Vi bekræfter inden for 72 timer |
| **T+72t** | Triage | Vi validerer, klassificerer severity (Critical/High/Medium/Low) og estimerer patch-tid |
| **T+7d** | Progress update | Vi giver dig status: bekræftet/afvist/duplikat, og en foreløbig fix-timeline |
| **T+30d** | Fix development | Vi udvikler og tester patch. Kritiske sårbarheder prioriteres højere |
| **T+90d** | Public disclosure | Standard-frist. Efter patch er deployeret og verificeret, offentliggør vi detaljer sammen med credit til dig |

**Typisk frist: 90 dage** fra rapport til public disclosure.

- **Kritiske sårbarheder** (RCE, auth-bypass, PII-læk) patches typisk inden for 7-14 dage.
- **Hvis vi ikke kan overholde 90 dage**, kontakter vi dig for at aftale en forlængelse.
- **Hvis du ikke er enig i timelinen**, kan vi forhandle. Vi beder dig ikke offentliggøre før patch er live.
- **Aktivt udnyttet sårbarhed:** Hvis vi opdager, at en sårbarhed udnyttes in the wild, kan vi fremrykke disclosure.

### Hvad vi forventer af dig

- **Ingen offentliggørelse** før patch er deployeret og verificeret, medmindre andet er aftalt
- **Ingen data-exfiltration** ud over hvad der er nødvendigt for proof-of-concept
- **Ingen degradering af service** for andre brugere under din test
- **Ingen adgang til, ændring af eller sletning af andres data** — brug egen testkonto
- **Overhold GDPR** — hvis du støder på persondata, stop og rapportér straks

Så længe du følger disse regler, betragter vi din research som authorized security research og går ikke rettens vej.

---

## Hall of Fame

Vi anerkender security researchers, der har hjulpet med at holde Cirkel sikker. Med dit samtykke vil vi liste dig her efter succesfuld disclosure.

| Researcher | Sårbarhed | Dato | Severity |
|------------|-----------|------|----------|
| _Din plads kunne stå her_ | — | — | — |

**Ønsker du at være anonym?** Sig til i din rapport, så holder vi dig ude af listen — vi anerkender stadig internt.

---

## Kontakt

- **Security email:** [ma@keap.me](mailto:ma@keap.me)
- **Response SLA:** 72 timer
- **Sprog:** Dansk eller engelsk

Tak fordi du hjælper med at holde Cirkel og vores brugere sikre.

---

_Senest opdateret: 2026-07-21_
