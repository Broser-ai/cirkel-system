# CLAUDE.md — Cirkel (helt system)

> Læs denne fil først. Åbn denne mappe i Claude Code — **alt er her**: appen,
> backend-skemaet, deployment, investor-materialer som kode, hele AI-teamet
> (`.claude/agents/`), governance og masters-pipelinen.

---

## Systemkort
```
cirkel/
├── CLAUDE.md                  ← denne fil (indgang)
├── START_HER.md               ← hurtig oversigt
├── AI_TEAM_GOVERNANCE.md      ← de ufravigelige regler
├── GURUS.md                   ← guru-laget
├── TEAM.md                    ← teamets brug + hvordan gurus fra andre chats kobles ind
├── cirkel_team_console.html   ← hvem-er-hvem (åbn i browser)
│
├── .claude/agents/*.md        ← AKTIVE agenter (20) — loades af Claude Code
├── parked-agents/             ← parkerede agenter (passer ikke til Cirkel nu)
├── gen-agents.cjs             ← generator for teamet
├── tools/                     ← masters-pipeline (udtræk + indsæt MTC-masters)
│
├── investor/                  ← investor-materialer SOM KODE (pptx/xlsx/docx) + out/
├── Dockerfile · DEPLOY.md     ← kør på web (Docker/Coolify/Vercel)
├── .env.example               ← nøgler (GEMINI, Supabase)
│
└── src/ · server.ts · supabase_schema.sql · index.html · package.json …
                               ← DIN Gemini-app (UÆNDRET og kanonisk)
```

## Kør i Claude Code
```bash
# APPEN (demo-mode uden nøgler: mock-AI)
npm install
npm run dev                       # → http://localhost:3000

# INVESTOR-materialer (genererer alle fire dokumenter)
cd investor && npm install && node build-all.js   # → investor/out/

# DEPLOY (se DEPLOY.md): Docker/Coolify eller Vercel
docker build -t cirkel . && docker run -p 3000:3000 -e GEMINI_API_KEY=… cirkel

# TEAMET — genér/opdatér agenter
node gen-agents.cjs

# MASTERS fra dit MTC-univers → relevante agenter
npm i -D @babel/parser @babel/traverse
node tools/extract-masters-full.mjs <sti-til-MasterTeamConsole.jsx>
node tools/masters-to-agents.mjs masters-roster.json
```

## AI-teamet
`.claude/agents/` loades automatisk af Claude Code. Brug **orchestrator** som indgang
("brug orchestrator til at sætte X op"), eller kald en agent direkte
("spørg guru-supabase…"). Aktive Rocket-tilføjelser: adversarial-pilot,
guru-strategic-navigator, guru-memory-praxis. Parkeret: rocket-kernel,
guru-invention-chief, guru-architect-dataflow (se `parked-agents/`).
Gurus fra andre chats kobles ind via `<!-- INDSÆT … -->`-krogen i hver agentfil (se TEAM.md).

## Governance — de ufravigelige regler (gælder alle agenter)
1. Intet udføres før Michael har accepteret det.
2. Alt kan ændres — også design og funktioner — men intet uden hans accept.
3. Hver ændring fremlægges FØRST som forslag/plan (diff/preview). Vent på accept.
4. Én ændring ad gangen.
5. Gemini-appen og `supabase_schema.sql` er kanoniske; redesign foreslås, udføres aldrig uvarslet.
6. Cirkel har sit EGET Supabase-projekt — rør ALDRIG det delte MTC/NEXUS (`tbuluvvqhrbgfcpoifjl`).
7. Commit aldrig hemmeligheder. Dansk som standard; teknisk indhold på engelsk.

## Sikkerhed
`firebase-applet-config.json` indeholder din rigtige Firebase-nøgle (som i din original).
Den er eksponeret — overvej at rotere/begrænse den, før repoet pushes offentligt.
