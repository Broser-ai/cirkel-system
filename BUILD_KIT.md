# CLAUDE.md — Cirkel Build Kit (giv Claude Code maksimal løftestang)

Læs denne først. Dette kit gør, at vi kan bygge **mere, hurtigere, bedre** — uden at
miste noget og uden at bryde den kørende app.

## Hvad er her
- **BACKLOG.md** — KOMPLET funktionsliste fra alle pakker. Intet er udeladt. Vi bygger ovenfra og ned.
- **.claude/agents/** — 20 agenter (orchestrator, masters, gurus, Rocket). Loades automatisk.
- **.claude/commands/** — slash-kommandoer: `/build-feature`, `/add-module`, `/deploy-preview`, `/verify`, `/status`.
- **modules/** — de 23 ÆGTE moduler (testet, kørende). `cd modules && npm i -D tsx && npm run demo`.
- **parked-agents/** — agenter der ikke passer til Cirkel nu.

## Sådan arbejder vi (ufravigeligt)
1. Intet udføres uden Michaels accept.
2. Hver ændring vises som plan/diff FØRST. Vent på "Accepteret".
3. Én ændring ad gangen. Additivt — aldrig erstatte design/funktioner.
4. `server.ts` og `src/` (Gemini-appen) er kanoniske og røres ikke uden eksplicit accept.
5. Deploy via `/deploy-preview` — ALDRIG auto-promote til prod.
6. Cirkel bruger sit eget Supabase-projekt (`rjincywpvgaloydgsnmh`), aldrig det delte MTC/NEXUS.

## Det store ryk — sådan bygger vi hurtigt
- `/status` → se hvad der er live, bygget, og næste op.
- `/build-feature F2.3` → Claude Code slår feature op i BACKLOG, lægger plan + diff, venter på accept, bygger, tester.
- `/add-module perception` → wirer et af de 23 moduler ind additivt.
- `/verify` → build + test + ærlig rapport efter hver ændring.
- `/deploy-preview` → sikker preview, du tester, så "promote".

Orchestratoren kobler den rette master + guru på hver opgave. Adversarial Pilot angriber
resultatet før det shippes. Sådan kan vi tage store stykker ad gangen — fast og sikkert.

## Aktuel tilstand
- Live: Supabase + Vercel (cirkel-system). Trin 2 i preview (gyldig model + Claude).
- Klar til at wire: de 23 moduler (regelbaseret scan-vej virker uden AI-nøgle).
- Næste anbefaling: F1.10 — wire perception→knowledge→reasoning→execution ind i `api/scan.ts` additivt.
