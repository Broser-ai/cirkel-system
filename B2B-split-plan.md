# B2BPartnerDashboard split-plan  [Fase 1 · Modul 10.1 / Portal-arkitektur]

**Status:** Plan-dokument. Faktisk split IKKE udført — kræver eksplicit
accept + review-cyklus fordi det rører `src/` (kanonisk zone).

**Kilde:** `src/components/B2BPartnerDashboard.tsx` — 419 KB, ~7.000 linjer.

**Master-spec:** docs/CIRKEL-EVERYTHING-v3.md · Modul 10.1 Portal-split.

---

## Målstruktur

```
src/components/b2b/
├── index.ts                     ← re-export barrel; B2BPartnerDashboard.tsx importerer herfra
├── B2BOverview.tsx              ← KPI-cards, headline-tal, hero-charts (~800 linjer forventet)
├── B2BCampaigns.tsx             ← Kampagne-simulator (voucher, RFID, target-segment) (~1500 linjer)
├── B2BReports.tsx               ← CSRD/EPR-rapport-generator + PDF-export via jspdf (~1400 linjer)
├── B2BSettings.tsx              ← Portal-features toggles, admin-only tab (~600 linjer)
├── B2BCompliance.tsx            ← EU PPWR + double-materiality-vurdering (~900 linjer)
├── B2BAnalytics.tsx             ← Deep-drill charts (Recharts) på scan-data (~1200 linjer)
└── shared/
    ├── types.ts                 ← alle B2B interfaces/types (delt)
    ├── constants.ts             ← DKK-satser, EPR-koder, kampagne-templates
    └── formatters.ts            ← DKK-format, procent, dansk dato
```

`B2BPartnerDashboard.tsx` reduceres til < 300 linjer (tab-navigation +
routing mellem de 6 sub-komponenter).

## Domæne-mapping (baseret på 419 KB analyse)

| Nuværende sektion i mono-fil | Ny komponent |
|---|---|
| KPI-hero-cards, headline-stats | B2BOverview.tsx |
| `suggestedCampaigns`, voucher-builder, RFID/QR-vælger | B2BCampaigns.tsx |
| `taxSavingsAnalyses`, ESG-report generator, PDF-export | B2BReports.tsx |
| Portal-features toggles, feature-flags | B2BSettings.tsx |
| `deepAnalyses.legalComplianceDetails`, PPWR-status | B2BCompliance.tsx |
| Recharts deep-charts, scan-aggregat | B2BAnalytics.tsx |

## Data-domæne alignment (kobles til backend-endpoints)

Splittet skal aligne med kommende backend-endpoints så komponenter kan
hente egne data uden gennem parent-props:

| Komponent | Backend-endpoint | Status |
|---|---|---|
| B2BOverview | `GET /api/b2b/overview` (aggregat KPI) | 🔴 endpoint mangler |
| B2BCampaigns | `POST /api/b2b-advisor` (findes) + `POST /api/b2b/campaigns` (mangler) | 🟡 |
| B2BReports | `POST /api/b2b-advisor` (findes) + `POST /api/b2b/report-pdf` (mangler) | 🟡 |
| B2BSettings | `GET/POST /api/portal-features` (findes) | ✅ |
| B2BCompliance | `GET /api/b2b/compliance` (mangler) | 🔴 |
| B2BAnalytics | `GET /api/kpi/co2` + `GET /api/kpi/scans` (mangler) | 🔴 |

**Rækkefølge**: byg manglende backend-endpoints FØRST (Modul 6.5), split
komponenten BAGEFTER. Ellers ender vi med samme mock-data i 6 filer i
stedet for 1.

## Estimat

- Backend-endpoints (5 nye): ~12 timer
- Faktisk komponent-split (find domæne-grænser i 7000 linjer): ~8 timer
- Test at ingen prop-drilling er brudt: ~4 timer
- **Total: ~24 timer / 3 dage**

Ikke small-ticket. Kræver dedikeret session med review efter hver af de
6 komponenter.

## Blokkerende beslutninger

1. **Genbrug shadcn/ui eller egne komponenter?** Nuværende bruger blanding.
2. **Data-hentning: React Query, SWR, eller fetch-in-useEffect?** Nuværende er useEffect. Ved 6 komponenter × egen data anbefaler jeg React Query — men det er ny dependency.
3. **Portal-features toggle: real-time (SSE) eller polling?** Modul 4.4 governance-team-console skal alignes.

---

## Historie / accept-log

- 2026-07-20 · Plan skrevet, ingen udførelse · afventer eksplicit "Accepteret Modul 10.1 split-start" + svar på 3 blokkerende beslutninger.
