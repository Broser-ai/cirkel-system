# Cirkel — Investor-materialer (kode)

Genererer alle fire investor-dokumenter med ren Node. Kør fra projektroden:

```bash
npm run investor          # install + byg alt
# eller:
npm run investor:build    # byg alt (deps skal være installeret)
node investor/captable.js # byg ét enkelt dokument
```

Output havner i `investor/out/`:
- `Cirkel_Investoroplaeg.pptx` — 14-slide pitch deck (deck.js)
- `Cirkel_CapTable_SAFE.xlsx` — cap table + SAFE-model, formeldrevet (captable.js)
- `Cirkel_SAFE_Konvertibelt_Gaeldsbrev.docx` — konvertibelt gældsbrev (safe.js)
- `Cirkel_Pilot_Onepager.docx` — pilot-tilbud (pilot.js)

Vil du ændre tal eller tekst: rediger den relevante `.js` og kør den igen.
Nøgletal for SAFE/cap table ligger øverst i `captable.js`.
