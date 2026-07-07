---
description: Byg en feature fra BACKLOG.md — plan + diff først, accept, så implementér og test.
argument-hint: <feature-id eller beskrivelse>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
Du skal bygge: **$ARGUMENTS**

Følg ALTID denne sekvens (Michaels regler):
1. Slå feature op i `BACKLOG.md`. Bekræft hvad den dækker, og hvilke filer den rører.
2. Læg en kort PLAN: mål, berørte filer, hvad der tilføjes (additivt), risiko.
3. Vis en DIFF/preview af ændringerne. **Rør ikke noget endnu.**
4. STOP og bed Michael om "Accepteret".
5. Først efter accept: implementér ét stykke ad gangen, byg + test, og rapportér ærligt.
6. Rør ALDRIG `server.ts`, `src/` eller eksisterende design/funktioner uden eksplicit accept.
Brug de relevante subagenter (fx `backend-master-supabase`, `frontend-guardian`, `adversarial-pilot`).
