---
description: Byg + test + ærlig statusrapport. Kør efter enhver ændring.
allowed-tools: Read, Grep, Glob, Bash
---
Verificér den nuværende tilstand:
1. `npm run build` — rapportér fejl ærligt (ingen "det virker nok").
2. Tjek at `server.ts` og `src/` er uændrede (diff mod git).
3. Kør modul-demoen hvis relevant: `npm run demo` i `modules/`.
4. List hvad der er live vs. lokalt, og hvad næste accept-gate er.
Brug `adversarial-pilot` til at angribe ændringen og `qa-master` til regression.
