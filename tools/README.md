# tools/ — indsæt dine MTC-masters som agenter

To trin. Det første er DIT eksisterende script; det andet filtrerer til de
Cirkel-relevante og laver dem til agenter.

```bash
# 1) Udtræk alle masters fra din MTC-fil (kræver @babel/parser @babel/traverse)
npm i -D @babel/parser @babel/traverse
node tools/extract-masters-full.mjs <sti-til-MasterTeamConsole.jsx>
#   → laver masters-roster.json + masters-roster.md

# 2) Indsæt KUN de Cirkel-relevante som agenter (resten parkeres)
node tools/masters-to-agents.mjs masters-roster.json
#   → .claude/agents/master-*.md  (relevante)
#   → parked-agents/master-*.md   (ikke relevante nu)
```

**Relevans** afgøres af nøgleordene i toppen af `masters-to-agents.mjs` (backend,
supabase, security, frontend, deploy, qa, ai, gdpr/epr, data, m.fl.). Justér listen,
hvis du vil have flere/færre med. Hver indsat master bliver rådgivende (read-only)
som udgangspunkt og er bundet til din accept-regel.
