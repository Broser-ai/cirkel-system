# Parkerede agenter

Disse er stadig dine — de er bare ikke aktive i Cirkel, fordi de ikke forbedrer
*dette* projekt lige nu:

- **rocket-kernel** — den autonome 7-lags force. Konflikter med din regel
  (intet uden accept, én ad gangen); overhead uden gevinst for en CRUD-webapp.
- **guru-invention-chief** — scanner ny tech og foreslår features. I modstrid med
  "deploy én ting før nye features". Risiko for feature-creep i Cirkel.
- **guru-architect-dataflow** — M100 hardware-co-design / dataflow-latens. Cirkel har
  ikke det problem; den hører hjemme i et ML-/infrastruktur-projekt.
- **guru-security** — parkeret 2026-07-06, erstattet af **security-master** som
  eneste aktive sikkerhedsagent. 80% overlap i domæne og værktøjer; proaktiv
  håndhævelse (security-master) foretrukket over generel rådgivning.
- **guru-react-frontend** — parkeret 2026-07-06, erstattet af **frontend-guardian**
  som eneste aktive UI-vagt. 70% overlap i domæne og værktøjer; proaktiv vagt
  (frontend-guardian) foretrukket over rådgivende arkitektur-guru.

## Genaktivér en agent
Flyt dens fil ind i `.claude/agents/`:
```
mv parked-agents/<navn>.md .claude/agents/
```
(eller fjern `parked: true` i `gen-agents.cjs` og kør `node gen-agents.cjs`).
