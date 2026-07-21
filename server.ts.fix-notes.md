# server.ts fix-notes  [Fase 1 · Modul 3.4 / Backend · Modul 4.1 / AI-router]

**Kanonisk fil — kræver `.cirkel-accept.md` for hver ændring.**  
**Sidst opdateret:** 2026-07-20.

---

## FIX 1 — Model-navn opdateret (udført denne runde)

| Linje | Før | Efter |
|---|---|---|
| 111 | `model: "gemini-3.5-flash"` | `model: "gemini-2.5-flash"` |
| 276 | `model: "gemini-3.5-flash"` | `model: "gemini-2.5-flash"` |
| 379 | `model: "gemini-3.5-flash"` | `model: "gemini-2.5-flash"` |

**⚠ Verificer mod @google/genai 1.29.0**: `gemini-2.5-flash` skal være
supporteret model-ID i den installerede SDK-version. Hvis SDK returnerer
`model not found`, prøv i denne rækkefølge:
1. `gemini-2.0-flash-exp`
2. `gemini-2.0-flash-001`
3. `gemini-1.5-flash-002` (fallback til stabil ældre)

Test-kommando: `curl -X POST localhost:3000/api/scan -H "Content-Type: application/json" -d '{"productName":"Arla Skyr 450g","municipality":"Aarhus Kommune"}'`

## FIX 2 — Felt-drift server↔DB (IKKE udført; kræver plan)

`server.ts` producerer 16-felts materialepas (productName, materialShort,
grade, co2Saved, waterSaved, energySaved, pantValue, materialType,
recyclablePercent, manufacturer, packagingWeight, circularScore, eprStatus,
sortingType, sortingInstructions, didYouKnow).

Live `scans`-tabellen har 8 kolonner (barcode, material, weight_grams,
sorting_compliance, points_earned, kroner_earned, is_processed).

**8 af 16 felter går tabt** ved persist. Løsning:
- **Option A** — Trim server-output til 8 felter (mister rig UI-data).
- **Option B** — Migration 005: `ALTER TABLE scans ADD COLUMN materialepas JSONB` — persist hele objektet. [ACCEPTED-BY-MICHAEL] required.
- **Option C** — Ny tabel `materialepas` (1:1 til scans), foreign key. Mere normaliseret men flere queries.

**Anbefaling**: Option B (JSONB) — hurtigst, GDPR-neutral, understøtter query via `->>'grade'` mm. Kræver 1 migration + minor update til `process_scan()` RPC.

## FIX 3 — F3.8 Firebase-token-verify wire-in (IKKE udført)

`api/_firebase-admin.ts` + `api/_verify-firebase-token.ts` findes (untracked
i git, klar til brug). Skal wires ind i:
1. `api/scan.ts` (POST) — kald `resolveTrustedUid(req)` før `process_scan()` RPC.
2. `api/dashboard.ts` (GET) — samme.
3. `api/redeem.ts` (POST) — samme, kritisk for reward-integritet.
4. `api/portal-features.ts` (POST) — samme, admin-mutations.

**Deploy-krav**: `npm install firebase-admin` + Vercel env-vars:
- `FIREBASE_SERVICE_ACCOUNT_JSON` (single JSON string) ELLER
- `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
- `FIREBASE_ADMIN_ENFORCE=warn_only` (start med observation) → `enforce` (efter 48t clean).

**Note**: `server.ts` (Express dev) skal IKKE wires — den bruges kun lokalt.

## FIX 4 — 20 MB body-limit (opdateret afklaring, ingen ændring)

`server.ts:33-34` sætter `express.json({ limit: "20mb" })`. Bør revideres
mod Vercel-serverless-max-body-limit (5 MB på Hobby, 50 MB på Enterprise).
For base64-billeder skal frontend komprimere til < 4 MB før upload eller
skifte til multipart/form-data + signed URL til storage-bucket (Modul 3.5).

---

## Historie / accept-log

- 2026-07-20 · Modul 3.4 · sed `gemini-3.5-flash` → `gemini-2.5-flash` (accept implicit via "Kør ..." fra Michael)
- 2026-07-20 · Fix 2, 3, 4 dokumenteret som ikke-udført · afventer eksplicit plan-accept.
