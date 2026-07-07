---
description: Wire ét af de 23 Cirkel-moduler ind i appen (additivt).
argument-hint: <modulnavn, fx perception eller execution>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
Wire modulet **$ARGUMENTS** fra `modules/` ind i appen.

1. Læs `modules/modules/$ARGUMENTS.ts` og forstå dens ægte logik.
2. Foreslå hvor den kobles ind (typisk en `api/`-funktion eller et nyt `lib/`-kald) UDEN at ændre server.ts/src.
3. Vis diff/preview. STOP for accept.
4. Efter accept: implementér, kør `npm run build`, og test at intet eksisterende er brudt.
Modulerne er ægte, kørende kode (testet) — ikke stubs. Default er regelbaseret og virker uden AI-nøgle.
