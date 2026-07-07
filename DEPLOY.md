# DEPLOY.md — kør Cirkel på web

Din app er **uændret**. Her er kun tilføjet en `Dockerfile`, så hele systemet
(frontend + Express/AI-backend) kan køres live. Verificeret: produktionsbuildet
serverer både appen og `/api/scan`.

## Hvad der skal til for at "alt spiller"
- **GEMINI_API_KEY** — gør AI-scanning ægte. Uden den kører appen videre med
  indbyggede danske mock-svar (sådan byggede du den).
- Supabase/Firebase er **valgfrie** — appen kører fint uden dem.

## Vej A — enhver Node-host (enklest)
```bash
npm install
npm run build
GEMINI_API_KEY=din-noegle NODE_ENV=production node dist/server.cjs
# kører på port 3000
```

## Vej B — Docker / Coolify (anbefalet, din stak)
```bash
docker build -t cirkel .
docker run -p 3000:3000 -e GEMINI_API_KEY=din-noegle cirkel
```
I Coolify: opret en ny ressource → peg på dette repo → Coolify finder `Dockerfile`
automatisk → sæt env-variablen `GEMINI_API_KEY` → deploy. Den eksponerer port 3000.

## Vej C — Vercel
Appen er en Express + Vite Node-server (ikke serverless). Den kører nemmest som en
container (Vej B) eller på en Node-host (Vej A). Vil du absolut på Vercel, kræver
det en serverless-tilpasning — sig til, så laver jeg den som separate deploy-filer
uden at røre din app.

## Note om port
Serveren lytter på port 3000 (som i din kode). Hosts der kræver en dynamisk port:
sig til, så tilføjer jeg en lille env-baseret port uden at ændre logikken.
