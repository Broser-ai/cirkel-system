---
description: Sikker preview-deploy til Vercel (ingen auto-promote).
allowed-tools: Bash
---
Deploy til PREVIEW — aldrig direkte prod.

1. Kør: `vercel deploy --target=preview`  (ALDRIG `--yes` der auto-promoter).
2. Giv Michael preview-URL'en + inspector-link.
3. Bed ham teste (loader, login, scan, chat, b2b) og bekræfte env er sat for Preview-scope.
4. Først når han siger "promote": `vercel promote <deployment-url>` (samme build, ingen ny build).
Rapportér target eksplicit, så vi aldrig rammer prod ved en fejl igen.
