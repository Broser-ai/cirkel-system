# M02 — Face-Rec Hybrid Roadmap

**Modul:** M02 Face Recognition / Object Detection
**Status:** Planlagt (nuværende: Gemini-only)
**Ejer:** Cirkel Core
**Version:** 0.1 (draft)
**Sidst opdateret:** 2026-07-22
**Kilde:** Cirkel deep-research 2026-07-19 (artifact + 6 agent-rapporter)

---

## 1. Baggrund og formål

Cirkel deep-research (2026-07-19) anbefaler en **hybrid arkitektur** for face/object recognition frem for den nuværende Gemini-only pipeline. Målet er:

- **Reducere latency** fra ~1.2s (Gemini) til <300ms server / <100ms client
- **Sænke stykpris** pr. scan med ~85% i typiske flows
- **GDPR-first**: billeder forlader ikke enheden når client-side kan løse opgaven
- **Robust fallback**: aldrig hård fejl når én kilde er nede

Nuværende situation:
- `/api/scan` router alt til Gemini Vision
- `/api/roboflow-fallback` er delvist wired op (LW-DETR endpoint eksisterer, ikke aktiveret som primær)
- Ingen client-side inferens
- Ingen fallback-orkestrering

---

## 2. Målarkitektur (hybrid, 3 lag)

```
[User device]
      |
      v
  Fase B: WebNN quick-check (Chrome/Edge)  ---> [match] --> done (offline)
      |  no-match / unsupported browser
      v
  Fase C: YOLO-World open-vocab (client)   ---> [match] --> done
      |  low confidence
      v
  Fase A: Roboflow server-side (LW-DETR + SAM 2)  ---> [match] --> done
      |  fail / timeout
      v
  Legacy: Gemini Vision fallback           ---> altid svar
```

Router-logik i `/api/scan` beslutter pr. request baseret på:
- Browser capability (`navigator.ml` for WebNN)
- Objekt-type (open-vocab kræver YOLO-World)
- Confidence-tærskler (client 0.85+, server 0.75+)
- Timeout (200ms client, 500ms server)

---

## 3. Faseplan

### Fase A — Server-side Roboflow (2 uger)

**Mål:** Gør Roboflow (LW-DETR + SAM 2) til primær server-side path i stedet for Gemini.

**Deliverables:**
- Færdiggør `/api/roboflow-fallback` → omdøb til `/api/scan/server`
- Model-registry i Supabase (`fr_models` tabel: model_id, version, threshold, active)
- SAM 2 segmentation for bounding-box tuning
- Latency-budget: p50 <300ms, p95 <500ms
- Struktureret logging til `fr_scan_events` (input_hash, model_id, confidence, latency_ms)
- Feature-flag `M02_SERVER_PRIMARY` (default off → on efter shadow-mode-uge)

**Migration:**
1. Uge 1: Shadow mode — kør Roboflow parallelt med Gemini, log diff
2. Uge 2: Flip flag hvis diff <5% på gyldne testsæt (n=500)

**Afhængigheder:** Roboflow API-key i Vercel env, Supabase migration `20260722_fr_models.sql`

---

### Fase B — Client-side WebNN quick-check (4 uger)

**Mål:** Chrome/Edge-brugere får inferens direkte i browseren; billedet forlader aldrig enheden.

**Deliverables:**
- Bundle: `packages/fr-webnn` med kompakt kompatibilitets-check + model-loader
- Model: distilleret face-detector (MobileFaceNet, ~5MB WASM/WebGPU)
- Lazy-load: kun hvis `navigator.ml` findes og bruger opt-in i settings
- Threshold: confidence ≥0.85 → afslut lokalt, ellers eskalér til Fase C/A
- Metrics: `fr_client_events` (browser, device_class, latency_ms, escalated_to)
- A/B: 10% → 50% → 100% rollout

**Latency-target:** p50 <100ms på M1/mid-tier Android; fallback hvis >200ms

**Privacy-gevinst:** GDPR Art. 25 (data minimisation) — kun hash + confidence sendes til server, aldrig pixels

**Afhængigheder:** WebNN polyfill for Firefox/Safari (returnerer `unsupported` → server-path), model-CDN på Cloudflare R2

---

### Fase C — Client-side YOLO-World open-vocabulary (6 uger)

**Mål:** Åben-ordforråds detektion (fx "Sony NEX-5", "vintage Louis Vuitton Speedy 30") uden pre-trained klasser.

**Deliverables:**
- Ultralytics YOLO-World v2 kompileret til ONNX + WebGPU
- Prompt-encoder på klient (CLIP tekst-embeddings, cached)
- UX: bruger kan skrive fri-tekst-query ved genstands-registrering
- Guardrails: max 3 samtidige klasser, prompt-liste hvid-listet server-side
- Fallback ved GPU-mangel: down-sample til WebNN quick-check

**Bundle-size:** ~28MB total (aggressive quantization); split-load pr. use-case

**Afhængigheder:** Fase B skal være i produktion, WebGPU adoption ≥60% i target-segment

---

## 4. Latency-targets (SLA)

| Path                        | p50    | p95    | Timeout |
|-----------------------------|--------|--------|---------|
| Client WebNN (Fase B)       | 60ms   | 100ms  | 200ms   |
| Client YOLO-World (Fase C)  | 180ms  | 320ms  | 500ms   |
| Server Roboflow (Fase A)    | 240ms  | 500ms  | 800ms   |
| Gemini fallback (legacy)    | 900ms  | 1400ms | 2000ms  |

End-user perceived latency (worst-case fuld fallback-kaskade): <2.5s hard-cap.

---

## 5. Cost-analyse (indikativ, DKK pr. 1000 scans)

| Kilde                | Enhedspris    | 1k scans | Note                                 |
|----------------------|---------------|----------|--------------------------------------|
| Gemini Vision 1.5    | ~$0.0025/img  | ~17 DKK  | Nuværende baseline                   |
| Roboflow serverless  | ~$0.0004/inf  | ~2.8 DKK | LW-DETR hosted                       |
| WebNN (klient)       | $0            | 0 DKK    | Kun CDN-egress for model (~$0.001)   |
| YOLO-World (klient)  | $0            | 0 DKK    | Kun CDN-egress for model             |

**Projekteret månedlig besparelse ved 500k scans:** ~7.100 DKK/md (fra ~8.500 → ~1.400 DKK).
**ROI break-even for Fase B+C udvikling:** ~7-9 måneder ved current volumen.

*Priser skal opdateres inden GA — Roboflow-tier og Gemini SKU kan ændre sig.*

---

## 6. Fallback-order i `/api/scan`

```ts
async function scan(req) {
  // 1. Client har allerede kørt WebNN/YOLO hvis muligt — request indeholder da
  //    en 'client_result' med confidence. Hop direkte til logging.
  if (req.client_result?.confidence >= 0.85) return log(req.client_result);

  // 2. Server-side Roboflow
  try {
    const r = await roboflow.infer(req.image, { timeoutMs: 800 });
    if (r.confidence >= 0.75) return log(r);
  } catch (e) { logWarn('roboflow_fail', e); }

  // 3. Gemini legacy fallback (aldrig fejler synligt)
  try {
    const g = await gemini.vision(req.image, { timeoutMs: 2000 });
    return log(g);
  } catch (e) { logError('gemini_fail', e); }

  // 4. Hård fallback: return "unknown" med retry-hint
  return { status: 'unknown', retry_hint: 'manual_tag' };
}
```

Alle 4 lag logges til `fr_scan_events` med `path_taken` for observability.

---

## 7. GDPR og privacy

- **Fase B/C (client-side)** er GDPR-foretrukket: billedet forlader aldrig enheden. Kun `{hash, confidence, class}` sendes til serveren.
- **Fase A (server-side)** behandler billedet i Roboflow's EU-region (Frankfurt). DPA underskrevet 2026-06 (se DPIA v0.1 §4.3).
- **Gemini fallback** kræver eksplicit consent-flag pr. bruger (`consent_cloud_vision=true`); default off. Google DPA verificeret.
- **Retention:** Ingen billed-persistens nogen af stederne. Kun events (7 dages retention i `fr_scan_events`, aggregeret metrics beholdes anonymt).
- **Opt-out:** Bruger kan i settings tvinge "client-only" — så deaktiveres server-fallback og scans der ikke løses lokalt returnerer `manual_tag`.

Reference: DPIA v0.1 (Cirkel deep-research 2026-07-19), sektion 4 (biometriske data), sektion 6 (leverandør-vurdering).

---

## 8. Migration path (nuværende → target)

| Uge   | Handling                                                          | Rollback         |
|-------|-------------------------------------------------------------------|------------------|
| W1    | Deploy Fase A i shadow-mode (dual-call, log-only)                 | Slå feature-flag |
| W2    | Flip `M02_SERVER_PRIMARY=true` (Roboflow bliver primær)           | Flip tilbage     |
| W3-6  | Byg + tester Fase B (WebNN); intern dogfood                       | -                |
| W7    | Fase B rollout 10% Chrome/Edge                                    | Sænk til 0%      |
| W8    | Fase B 50%, hvis metrics grønne                                   | -                |
| W9    | Fase B 100% + retire "Gemini for face-only" path                  | -                |
| W10-15| Byg Fase C (YOLO-World) i feature-branch                          | -                |
| W16   | Fase C bag `M02_OPEN_VOCAB` flag; internal beta                   | -                |
| W17-18| Fase C GA for opted-in brugere                                    | Flag off         |

Total effort estimeret: **12 person-uger** (2 dev + 0.5 ML + 0.25 SRE).

---

## 9. Åbne spørgsmål / risici

1. **WebNN spec-modenhed** — API'et er stadig CR i W3C. Risiko: breaking changes. Mitigation: pin til stable subset, monitor Chrome status.
2. **Model-drift** — LW-DETR kan afvige fra Gemini på edge-cases (fx dårlig belysning). Mitigation: shadow-mode-uge + gyldent testsæt.
3. **Bundle-size (Fase C)** — 28MB kan være showstopper på 3G. Mitigation: gate på Network Information API + `saveData`.
4. **Roboflow SLA** — 99.5% (deres SLO). Kaskade til Gemini skjuler det, men vi mangler formel opsigelses-klausul med <30d exit.
5. **iOS Safari** — ingen WebNN, ingen WebGPU stable. Betyder ~40% af DK-trafik havner på server-path. Acceptabelt for nu.

---

## 10. Referencer

- Cirkel deep-research 2026-07-19 (artifact-URL i memory `project_cirkel_deep_research_2026_07_19.md`)
- DPIA v0.1 §4 (biometri) og §6 (leverandører)
- `/api/roboflow-fallback` — nuværende partial wiring
- Roboflow LW-DETR docs: https://docs.roboflow.com/deploy/hosted-api
- WebNN W3C draft: https://www.w3.org/TR/webnn/
- Ultralytics YOLO-World: https://docs.ultralytics.com/models/yolo-world/
- Master Architecture: `docs/module-refs/M00-master-architecture.md` (planlagt)

---

*Denne fil er en levende roadmap. Opdatér med faktiske tal (latency, cost) efter Fase A shadow-mode-uge.*
