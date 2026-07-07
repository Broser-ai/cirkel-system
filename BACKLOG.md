# Cirkel — KOMPLET BACKLOG (intet udeladt)

Alle funktioner og forbedringer fra alle pakker, samlet. Intet er droppet —
alt står her, så du kan acceptere det stykke for stykke. Claude Code bygger
ovenfra og ned med `/build-feature <id>`, altid med din accept og preview først.

**Status:** ✅ LIVE (i appen nu) · 🟢 REAL (bygget+testet, klar til at wire) · 🟡 PLAN (designet, skal bygges) · 🔴 SCAFFOLD (var stub/spec, bygges ægte)

---

## EPIC 0 — Fundament (LIVE)
| ID | Funktion | Status | Kilde |
|----|----------|--------|-------|
| F0.1 | Scan → AI materialepas (Gemini/Claude) | ✅ LIVE | Gemini-app |
| F0.2 | B2B/Kommune ESG-advisor | ✅ LIVE | Gemini-app |
| F0.3 | AI sorteringsassistent (chat) | ✅ LIVE | Gemini-app |
| F0.4 | Profiles + scans + append-only SHA-256 ledger + RLS | ✅ LIVE | supabase_schema.sql |
| F0.5 | Supabase (rjincywpvgaloydgsnmh) + Vercel (cirkel-system) | ✅ LIVE | Trin 1 |
| F0.6 | Gyldig model gemini-2.5-flash + Claude-fallback (AI_PROVIDER) | 🟢 REAL | Trin 2 (preview) |

## EPIC 1 — De 23 moduler (REAL, klar til at wire)
| ID | Modul | Hvad den gør | Status |
|----|-------|--------------|--------|
| F1.1 | perception | Genkender PP5/PET/HDPE/alu/karton/glas | 🟢 REAL |
| F1.2 | knowledge | Genanvendelses-faktabase pr. materiale | 🟢 REAL |
| F1.3 | reasoning_engine | Karakter (A+..D) + sorteringsråd | 🟢 REAL |
| F1.4 | execution | Beregner point/kr/CO₂ (ægte formel) | 🟢 REAL |
| F1.5 | analytics | KPI-aggregering til dashboard | 🟢 REAL |
| F1.6 | security | Rate-limit + redaktion af nøgler | 🟢 REAL |
| F1.7 | memory | Episodisk hukommelse pr. bruger | 🟢 REAL |
| F1.8 | orchestration | Gemini/Claude provider-router | 🟢 REAL |
| F1.9 | data·context·planning·action·creativity·ethics·communication·integration·collaboration·monitoring·learning·adaptation·optimization·evolution | Resterende moduler | 🟢 REAL |
| F1.10 | **Wire perception→knowledge→reasoning→execution som regelbaseret scan-vej** (virker uden AI-nøgle) | 🟢 REAL → wire | anbefalet næste |

## EPIC 2 — Loyalitet & engagement (fra loyalty_system.html)
| ID | Funktion | Status |
|----|----------|--------|
| F2.1 | Tiers (Standard/Sølv/Guld) — auto via process_scan + lifetime_points | 🟢 REAL (wired) |
| F2.2 | Streaks (dage i træk) — streak_days i process_scan | 🟢 REAL (wired) |
| F2.3 | Points + rewards-katalog — rewards/redemptions + /api/rewards + /api/redeem | 🟢 REAL (wired) |
| F2.4 | Leaderboard — get_leaderboard + /api/leaderboard | 🟢 REAL (wired) |
| F2.5 | Badges/achievements — achievements/user_achievements + check_achievements | 🟢 REAL (wired) |
| F2.6 | Brand-kampagne-builder | 🟡 PLAN |

## EPIC 3 — Anti-fraud (fra blueprint + ANTI_FRAUD_SYNTESE + v3)
| ID | Funktion | Status |
|----|----------|--------|
| F3.1 | Trust-tier-stige for returpunkter | 🟡 PLAN |
| F3.2 | Graderet identitet: SMS → MitID low → MitID full | 🟡 PLAN |
| F3.3 | WebAuthn biometriske passkeys | 🟡 PLAN |
| F3.4 | Device fingerprinting + behavioral biometrics + canvas-signatur | 🟡 PLAN |
| F3.5 | Multi-signal fraud-scoring + delayed payout | 🟡 PLAN |
| F3.6 | fraud_proof_ledger (append-only) + DPIA | 🟡 PLAN |
| F3.7 | IoT smart-container: ESP32/NB-IoT load cells + ultralyd → n8n webhook | 🔴 SCAFFOLD |
| F3.8 | Verificér Firebase ID-token server-side (forhindrer uid-spoofing i /api/scan body) | 🟡 PLAN |

## EPIC 4 — Materialepas & nationale koblinger (Modul 4 + v3)
| ID | Funktion | Status |
|----|----------|--------|
| F4.1 | GS1 Denmark digitalt materialepas (GTIN) | 🟡 PLAN |
| F4.2 | DAWA: sorteringsregler pr. 98 kommuner | 🟡 PLAN |
| F4.3 | EU Digital Product Passport (ESPR) | 🟡 PLAN |
| F4.4 | material_passports-tabel + schema | 🟡 PLAN |

## EPIC 5 — Edge AI / vision (Modul 2-3)
| ID | Funktion | Status |
|----|----------|--------|
| F5.1 | Edge CV i browser (WebNN + Gemini Nano) | 🔴 SCAFFOLD |
| F5.2 | SAM 2 + YOLO-World + LW-DETR materialeanalyse | 🔴 SCAFFOLD |
| F5.3 | LLM Swarm-routing (DeepSeek/Mistral/Claude/GPT-4o pr. opgave) | 🟡 PLAN |
| F5.4 | NeMo Guardrails (prompt-injection-forsvar) | 🟡 PLAN |

## EPIC 6 — B2B-platform & EPR/CSRD (Modul 10 + v3)
| ID | Funktion | Status |
|----|----------|--------|
| F6.1 | Multi-tenant B2B-portal (allerede delvist i app) | 🟡 PLAN |
| F6.2 | Stripe billing-webhook (Bronze/Sølv/Guld/Diamant) | 🟡 PLAN |
| F6.3 | CSRD Scope 3-rapportering | 🟡 PLAN |
| F6.4 | EPR/PPWR eco-modulation-beregner | 🟡 PLAN |
| F6.5 | Brand-CMS til kampagner | 🟡 PLAN |

## EPIC 7 — Automatisering & community (Modul 7-9, 11-12)
| ID | Funktion | Status |
|----|----------|--------|
| F7.1 | n8n master-workflow (one-click JSON) | 🟡 PLAN |
| F7.2 | Discord.js v14 bot (/scan-stats, /min-impact) + FAQ | 🟡 PLAN |
| F7.3 | React Native mobil-app | 🟡 PLAN |
| F7.4 | Kommunalt styringscenter | 🟡 PLAN |
| F7.5 | IoT fleet manager | 🟡 PLAN |

## EPIC 8 — Autonomt AI-org "MONSTER" (fra complete_package_v2/07-backend)
| ID | Funktion | Status |
|----|----------|--------|
| F8.1 | HJERNEN orchestrator (LangGraph, Opus) | 🟡 PLAN |
| F8.2 | Governance (forbrugslofter, circuit breaker, audit) | 🟢 REAL* (Python findes) |
| F8.3 | Goal agents (Lighthouse, Lead Hunter, Bilag-vogter, Cashflow Sentinel) | 🟢 REAL* |
| F8.4 | Event bus (Redis Streams) | 🟢 REAL* |
| F8.5 | Engines: LEX/EARN/FUND/BIZ/TUTOR | 🟡 PLAN |
| F8.6 | Crews (Bogføring→Billy, Leads, Årsregnskab) | 🟡 PLAN |
| F8.7 | MCP-værktøjer (Billy, code_sandbox, deploy) | 🟡 PLAN |
> *Kører som separat self-hosted Python-system (Docker), ikke i webappen. Holdes adskilt.

## EPIC 9 — AI-team (REAL, i .claude/agents/)
| ID | Funktion | Status |
|----|----------|--------|
| F9.1 | Orchestrator + 6 masters + 10 gurus | 🟢 REAL |
| F9.2 | Rocket: Adversarial Pilot, Strategic Navigator, Memory/PRAXIS | 🟢 REAL |
| F9.3 | Parkeret: rocket-kernel, Invention Chief, Architect/M100 | 🟢 REAL (parkeret) |
| F9.4 | Indsæt 134 MTC-masters via tools/ (kræver MasterTeamConsole.jsx) | 🟡 PLAN |

---

## Sikkerhed/oprydning (bør tages tidligt)
- 🔴 Fjern reference til delt projekt `tbuluvvqhrbgfcpoifjl` + eksponeret anon-nøgle i `CIRKEL-EVERYTHING-v3.md`.
- 🔴 Rotér/begræns den live Firebase-nøgle i `firebase-applet-config.json`.

## Arbejdsregler (gælder alt herover)
Additivt · intet uden din accept · preview/diff først · én ændring ad gangen ·
design og funktioner i Gemini-appen er kanoniske · Cirkel bruger sit eget Supabase-projekt.
