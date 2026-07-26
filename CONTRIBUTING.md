# Contributing til Cirkel-system

Tak fordi du bidrager til Cirkel. Dette dokument beskriver arbejdsgangen, kravene og governance-processen for at få kode ind i repoet.

Kontakt for spørgsmål: **ma@keap.me**

---

## 1. Workflow

Du kan vælge mellem to modeller:

### Fork-workflow (eksterne bidragydere)

1. Fork repoet til din egen GitHub-konto.
2. Klon din fork lokalt.
3. Opret en feature-branch fra `main`.
4. Commit dine ændringer efter reglerne nedenfor.
5. Åbn en Pull Request mod `main` i hoved-repoet.

### Branch-workflow (interne bidragydere)

1. Klon repoet direkte.
2. Opret en feature-branch fra `main`:
   ```bash
   git checkout -b feat/<kort-beskrivelse>
   ```
3. Push branchen og åbn en Pull Request mod `main`.

Branch-navngivning:

- `feat/<beskrivelse>` — ny funktionalitet
- `fix/<beskrivelse>` — bugfix
- `docs/<beskrivelse>` — kun dokumentation
- `refactor/<beskrivelse>` — omstrukturering uden funktionel ændring
- `chore/<beskrivelse>` — build, config, tooling

---

## 2. Conventional Commits

Alle commits **skal** følge [Conventional Commits](https://www.conventionalcommits.org/).

Format:

```
<type>(<scope>): <kort beskrivelse>

<valgfri body>

<valgfri footer>
```

Tilladte types:

| Type       | Anvendes til                                           |
|------------|--------------------------------------------------------|
| `feat`     | Ny funktionalitet                                      |
| `fix`      | Bugfix                                                 |
| `docs`     | Kun dokumentation                                      |
| `style`    | Formatering, whitespace (ingen kode-ændring)           |
| `refactor` | Omskrivning uden funktionel ændring                    |
| `perf`     | Performance-forbedring                                 |
| `test`     | Tilføj eller ret tests                                 |
| `build`    | Build-system eller dependencies                        |
| `ci`       | CI-konfiguration                                       |
| `chore`    | Vedligeholdelse                                        |
| `revert`   | Revert af tidligere commit                             |

Eksempler:

```
feat(marketplace): tilføj give-away flow for P2P donationer
fix(auth): ret token-refresh race condition
docs(readme): opdater deploy-instruktioner for Vercel preview
```

Breaking changes markeres med `!` efter type/scope og forklares i footeren:

```
feat(api)!: fjern deprecated v1 endpoints

BREAKING CHANGE: /api/v1/* returnerer nu 410 Gone.
```

---

## 3. `[ACCEPTED-BY-MICHAEL]` — obligatorisk godkendelse

Visse ændringer må **kun** merges hvis PR-titel eller commit-message indeholder tokenen `[ACCEPTED-BY-MICHAEL]`.

Dette gælder for:

- **Kanoniske filer** — enhver ændring i:
  - `src/` (hele mappen)
  - `server.ts`
- **Destruktiv SQL** — migrations eller scripts der indeholder:
  - `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `DROP DATABASE`
  - `TRUNCATE`
  - `DELETE FROM ...` uden en snæver `WHERE`-klausul
- **Vercel prod-promote** — PR'er der resulterer i promotion til production-target (aldrig auto-promote; se `feedback_vercel_deploy.md`).

Eksempel på gyldig commit:

```
feat(src/wallet): tilføj kredit-split for donationer [ACCEPTED-BY-MICHAEL]
```

PR'er uden tokenen på disse områder afvises af governance-agenterne — også hvis alle tests er grønne.

---

## 4. `.cirkel-accept.md` skal opdateres

Ved enhver kanonisk ændring (se punkt 3) **skal** filen `.cirkel-accept.md` opdateres i samme PR med:

- Dato (`YYYY-MM-DD`)
- Kort beskrivelse af hvad der accepteres
- Reference til PR-nummer
- Initialer eller commit-SHA for godkendelse

Eksempel-linje:

```
- 2026-07-21 — Wallet-split for donationer (PR #142) — MA
```

PR'er der ændrer kanoniske filer uden en tilsvarende `.cirkel-accept.md`-opdatering afvises automatisk.

---

## 5. Pre-commit hook

Repoet bruger [Husky](https://typicode.github.io/husky/) til pre-commit hooks.

Krav:

- `.husky/pre-commit` **skal** køre og passere før commit accepteres.
- Ingen `--no-verify` — brug aldrig flagget til at omgå hooks.
- Hvis en hook fejler: løs årsagen (lint, format, type-check), stage ændringerne og commit på ny. Amend aldrig for at omgå en fejlet hook.

Installer hooks efter clone:

```bash
npm install
npm run prepare
```

---

## 6. Test suite

`npm run test:run` **skal** passere før PR kan merges.

- Kør lokalt før push:
  ```bash
  npm run test:run
  ```
- CI kører suiten på hver push. Røde tests blokerer merge.
- Nye features kræver tests der dækker den nye funktionalitet.
- Bugfixes bør inkludere en regressionstest der demonstrerer fejlen og bekræfter fixet.

---

## 7. Pull Request beskrivelse

Hver PR **skal** indeholde tre sektioner:

### What
Hvad ændres. Konkret, teknisk, punktopstilling.

### Why
Hvorfor ændringen er nødvendig. Reference til issue, spec, eller forretningsbehov.

### How tested
Hvordan ændringen er testet. List:
- Automatiske tests der er tilføjet/opdateret
- Manuelle test-scenarier med resultat
- Preview-URL (Vercel preview) hvis relevant

Template:

```markdown
## What
- ...

## Why
- ...

## How tested
- ...
```

PR'er uden alle tre sektioner afvises af `@qa-master` uden yderligere review.

---

## 8. Governance-agenter — review-krav

Følgende agenter **skal** godkende PR'er før merge:

| Agent               | Ansvarsområde                                             | Kræves ved                                      |
|---------------------|-----------------------------------------------------------|-------------------------------------------------|
| `@orchestrator`     | Overordnet arkitektur, sammenhæng, prioritering           | Alle PR'er der rører kanoniske filer            |
| `@qa-master`        | Test-dækning, PR-format, kvalitet                         | Alle PR'er                                      |
| `@security-master`  | Sikkerhed, secrets, auth, dependency-vulnerabilities      | PR'er der rører auth, env, dependencies, SQL    |

Anmod om review ved at tagge agenten i PR-kommentar, fx:

```
@security-master vil du reviewe den nye auth-flow?
```

Alle krævede agenter skal have givet grønt lys før merge.

---

## 9. Merge-krav — checklist

Før en PR kan merges skal **alle** følgende være opfyldt:

- [ ] Branch er up-to-date med `main`
- [ ] Conventional commit-messages
- [ ] `[ACCEPTED-BY-MICHAEL]` tilstede hvis kanonisk ændring
- [ ] `.cirkel-accept.md` opdateret hvis kanonisk ændring
- [ ] Pre-commit hooks passerer
- [ ] `npm run test:run` er grøn
- [ ] PR-beskrivelse indeholder What / Why / How tested
- [ ] Krævede governance-agenter har godkendt
- [ ] Ingen ubesvarede review-kommentarer

---

## 10. Spørgsmål

Er du i tvivl om noget — governance, workflow, om en ændring kræver `[ACCEPTED-BY-MICHAEL]`, eller hvordan en agent skal tagges — så kontakt:

**Michael Ambrosius — ma@keap.me**

Spørg hellere en gang for meget end at få en PR afvist.
