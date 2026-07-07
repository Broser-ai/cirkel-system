# Cirkel — guru- & master-team til Claude Code

17 agenter i `.claude/agents/`. Når mappen ligger i projektroden, er hele teamet
koblet ind i projektet og kan kaldes direkte i Claude Code.

## Installer
Kopiér `.claude/`-mappen ind i din projektrod:
```
C:\Users\Ambro2\cirkel-demo\.claude\agents\*.md
```

## Brug i Claude Code
- Lad **orchestrator** styre: "Brug orchestrator til at sætte EPR-rapporten op."
  Den kobler den rette master + guru på og venter på din accept.
- Eller kald én direkte: "Spørg guru-supabase om dette skema er robust."

## Sådan kobles en guru fra en ANDEN Claude-chat ind
1. Åbn guruens agentfil, fx `.claude/agents/guru-ledger.md`.
2. Find linjen `<!-- INDSÆT GURU-PROMPT FRA ANDEN CHAT HER -->`.
3. Indsæt prompten/viden fra din anden chat dér. Færdig — guruen er nu en del af projektet.

Vil du tilføje en helt ny guru: kopiér en eksisterende `guru-*.md`, ret `name`,
`description` og indholdet, og læg din prompt ind. Eller tilføj den i `gen-agents.cjs`
og kør `node gen-agents.cjs`.

## Regler (indbygget i alle agenter)
Alt kan ændres — men intet uden din accept. Hver ændring fremlægges som plan/diff først.
Gurus rådgiver (read-only); masters udfører, men kun efter dit "Accepteret".

## Rocket-tilføjelser (status)
Aktive i Cirkel (forbedrer projektet):
- **adversarial-pilot** (master) — red-team/verifikation af RLS, ledger og deploy.
- **guru-strategic-navigator** — kontrakt + invarianter før der bygges.
- **guru-memory-praxis** — konsistens med din stil (Humanized-Bias).

Parkeret i `parked-agents/` (passer ikke til Cirkel nu): rocket-kernel,
guru-invention-chief, guru-architect-dataflow. Se `parked-agents/README.md`.
