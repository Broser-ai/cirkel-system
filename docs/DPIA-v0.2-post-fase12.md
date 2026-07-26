# DPIA v0.2 — Cirkel Platform (Post Fase 1+2)

**Dokumenttype:** Data Protection Impact Assessment (Databeskyttelses-konsekvensanalyse)
**Version:** 0.2
**Status:** Draft — kræver DPO- og ledelsesgodkendelse før produktionsudrulning
**Dato:** 2026-07-21
**Erstatter:** DPIA v0.1 (2026-07-19)
**Ejer:** Cirkel Data Protection Office
**Reviewers:** CTO, CEO, ekstern DPO, sikkerhedsarkitekt
**Næste review:** Ved Fase 3 launch, eller senest 2027-01-21

---

## 1. Executive Summary

Denne DPIA v0.2 opdaterer v0.1 med de nye databehandlingsaktiviteter der er introduceret gennem Fase 1 (autentifikation, betaling, MitID broker) og Fase 2 (biometrisk verifikation, fraud-detection, wallet-split, CSRD-rapportering).

Cirkel er en dansk peer-to-peer marketplace for genbrug og gaveøkonomi. Platformen behandler personoplysninger for **~130.000 aktive brugere** (target Q4 2026) og indeholder følgende risici der udløser DPIA-krav under GDPR Art. 35(3):

- **Systematisk overvågning** af brugeradfærd (behavioral biometrics for fraud-detection)
- **Følsomme kategorier** (biometriske data via WebAuthn/passkeys, potentielt CPR via MitID broker)
- **Storskala behandling** (>100.000 registrerede)
- **Automatiseret beslutningstagning** (fraud-scoring der kan lukke konti)

**Overordnet risikoniveau efter Fase 1+2:** MEDIUM (nedjusteret fra HIGH i v0.1 pga. mitigering af CPR-eksponering og indførelse af append-only fraud-log).

**Nye krav siden v0.1:**
1. DIGST-godkendelse af MitID broker-integration (afventer, forventet Q3 2026)
2. Databehandleraftale med Stripe Payments Europe Ltd. (underskrevet 2026-07-15)
3. Standardkontraktbestemmelser med Firebase/Google Ireland Ltd. (opdateret til 2021/914)
4. Opdateret privatlivspolitik med de nye kategorier (deploys sammen med Fase 3)

---

## 2. Kontekst og formål

### 2.1 Behandlingsansvarlig
- **Juridisk enhed:** Cirkel ApS (CVR: [pending])
- **Adresse:** [Dansk adresse]
- **DPO-kontakt:** dpo@cirkel.dk
- **Repræsentant i EU:** N/A (etableret i DK)

### 2.2 Formål med behandlingen
Cirkel driver en digital marketplace hvor private brugere:
- Sælger, bytter og forærer brugte varer (Modul 1: Marketplace)
- Modtager betaling via Stripe Connect eller MobilePay Business
- Rapporterer CO2-besparelser (Modul 4: CSRD-compliance)
- Verificerer identitet via MitID for højværdi-transaktioner (Modul 3.4)
- Bruger biometrisk login (WebAuthn/passkeys) for hurtig og sikker adgang (Fase 1)
- Beskyttes mod svindel via risk-scoring (Modul 5.1: Fraud-detection, Fase 2)

### 2.3 Retsgrundlag (GDPR Art. 6)
| Behandlingsaktivitet | Retsgrundlag | Note |
|---|---|---|
| Kontooprettelse, login | Art. 6(1)(b) — kontrakt | Nødvendig for tjenesten |
| Betalinger via Stripe | Art. 6(1)(b) — kontrakt | Payment processing |
| MitID-verifikation | Art. 6(1)(c) — retlig forpligtelse | AMLD5 for højværdi-transaktioner |
| WebAuthn biometri | Art. 6(1)(a) — samtykke | Opt-in, alternativer tilbudt |
| Fraud-detection | Art. 6(1)(f) — legitim interesse | LIA gennemført, se afsnit 8.3 |
| CSRD-rapportering | Art. 6(1)(f) — legitim interesse | Aggregeret, kan opsiges |
| Marketing-emails | Art. 6(1)(a) — samtykke | Double opt-in via Modul 7 |

### 2.4 Særlige kategorier (Art. 9)
| Kategori | Grundlag Art. 9 | Note |
|---|---|---|
| Biometriske data (WebAuthn) | Art. 9(2)(a) — udtrykkeligt samtykke | Hash lagres, ikke rå biometri |
| CPR (via MitID) | Art. 9(2)(g) — væsentlig samfundsinteresse | Kun ved AMLD5-trigger, opbevares maksimalt 5 år |

---

## 3. Beskrivelse af databehandlingsflow

### 3.1 Systemarkitektur (post Fase 1+2)

```
Bruger  →  Next.js frontend (Vercel EU)
             ↓
         Firebase Auth (Google Ireland)   ← Fase 1 nyt
             ↓
         Supabase Postgres (EU-central)  ← primær datalager, RLS aktivt
             ↓ ↑
         Stripe Connect (Ireland)         ← Fase 1 nyt: subscription + payout
         MobilePay Business (DK)          ← Fase 1 nyt: DK-payout
         MitID Broker (Signaturgruppen)   ← Fase 1 nyt: identitetsbekræftelse
         Fraud-service (intern edge fn)   ← Fase 2 nyt: risk-scoring
```

### 3.2 Datastrømme

1. **Registrering:** Bruger → Firebase Auth → Supabase `users` (RLS: kun ejer + admin)
2. **Passkey-registrering:** Bruger → WebAuthn (browser) → `webauthn_credentials` (public key + hash, aldrig privat nøgle)
3. **Betaling:** Bruger → Stripe Elements → Stripe (PCI DSS Level 1) → webhook → Supabase `payments`
4. **MitID-verifikation:** Bruger → MitID broker OAuth → callback → `mitid_verifications` (CPR-hash + timestamp, ikke plaintext CPR)
5. **Fraud-check:** Enhver kritisk handling → `/api/fraud/check` → append-only `fraud_events` → score returneret

---

## 4. Nye datategorier (introduceret i Fase 1+2)

### 4.1 `webauthn_credentials` (Fase 1)

**Formål:** Passkey-baseret login uden password.

| Felt | Type | Følsomhed | Note |
|---|---|---|---|
| `id` | uuid | Lav | Primærnøgle |
| `user_id` | uuid FK | Lav | Reference til `users` |
| `credential_id` | bytea | Medium | WebAuthn credential ID |
| `public_key` | bytea | Lav | COSE-formatteret public key |
| `attestation_hash` | text | **Høj (biometrisk)** | SHA-256 hash af attestation |
| `authenticator_aaguid` | uuid | Lav | Producent-identifier |
| `sign_count` | int | Lav | Replay-beskyttelse |
| `created_at` | timestamptz | Lav | Audit |
| `last_used_at` | timestamptz | Lav | Audit |

**Klassifikation:** Art. 9 særlige kategorier (biometriske data) — men KUN hash, ikke rå biometri.
**RLS-politik:** `user_id = auth.uid()` — bruger kan kun se egne credentials.
**Retention:** Slettes ved kontosletning (CASCADE) eller efter 24 måneders inaktivitet.

### 4.2 `biometric_verifications` (Fase 2)

**Formål:** Audit-log af biometriske login-forsøg (succes/fejl) for fraud-detection.

| Felt | Type | Følsomhed | Note |
|---|---|---|---|
| `id` | uuid | Lav | Primærnøgle |
| `user_id` | uuid FK | Lav | Reference til `users` |
| `credential_id` | uuid FK | Lav | Reference til `webauthn_credentials` |
| `success` | boolean | Lav | Resultat |
| `failure_reason` | text | Medium | ENUM: wrong_credential, replay, expired |
| `device_fingerprint_hash` | text | Medium | SHA-256 af enhedsprofil |
| `ip_address` | inet | **Medium (persondata)** | IPv4/IPv6 |
| `geo_lat`, `geo_lng` | numeric(9,6) | **Medium** | Approksimativ (byniveau, ~10 km) |
| `created_at` | timestamptz | Lav | |

**Retention:** 90 dage (behavioral biometrics) — herefter anonymiseres IP til /24 og geo droppes.

### 4.3 `device_fingerprints` (Fase 2)

**Formål:** Genkende returnerende enheder for fraud-scoring uden cookies.

| Felt | Type | Følsomhed |
|---|---|---|
| `fingerprint_hash` | text (PK) | Medium — pseudonym |
| `user_agent_family` | text | Lav |
| `platform` | text | Lav |
| `screen_resolution` | text | Lav |
| `timezone` | text | Lav |
| `first_seen_at`, `last_seen_at` | timestamptz | Lav |
| `associated_user_count` | int | Lav — antal brugere |

**Note:** Fingerprint er en envejs-hash; komponenterne lagres separat for at forhindre re-identifikation på tværs af sessioner uden authoriseret adgang.
**Retention:** 180 dage rullende vindue.

### 4.4 `mitid_verifications` (Fase 1)

**Formål:** Dokumentere AMLD5-compliant identitetsbekræftelse.

| Felt | Type | Følsomhed |
|---|---|---|
| `id` | uuid | Lav |
| `user_id` | uuid FK | Lav |
| `cpr_hash` | text | **Meget høj (Art. 9)** — SHA-256 med pepper |
| `verification_level` | text | Lav — ENUM: substantial, high |
| `broker_transaction_id` | text | Medium — audit-reference |
| `verified_at` | timestamptz | Lav |
| `expires_at` | timestamptz | Lav — 12 måneder |

**Regel:** Plaintext CPR forlader ALDRIG MitID-brokerens session; kun hash med server-side pepper lagres.
**Retention:** 5 år efter kundeforhold ophører (jf. hvidvasklov § 30).

### 4.5 Udvidelser af eksisterende tabeller

`users`-tabellen har fået:
- `phone_number_e164` (text, medium — E.164 format for MobilePay)
- `preferred_language` (text, lav)
- `webauthn_registered_at` (timestamptz, lav)

`transactions`-tabellen har fået:
- `fraud_score` (numeric(3,2), medium — 0.00-1.00)
- `fraud_reason_codes` (text[], medium — array af regelkoder)
- `stripe_payment_intent_id` (text, lav)
- `mobilepay_transaction_id` (text, lav)

---

## 5. Nye databehandlere og sub-processorer

### 5.1 Sub-processor-oversigt (post Fase 1+2)

| Behandler | Formål | Placering | DPA-status | Sikringsniveau |
|---|---|---|---|---|
| Vercel Inc. | Frontend hosting | EU (Frankfurt) | ✅ 2026-05-01 | SCC + supplementary measures |
| Supabase Inc. | Database, auth, storage | EU-central (Frankfurt) | ✅ 2026-05-01 | SCC + EU-hostet |
| Firebase (Google Ireland) | Auth SDK (fase-1 nyt) | Ireland | ✅ 2026-07-10 | Google Ireland som controller-of-record |
| Stripe Payments Europe Ltd. | Betalinger, payout (nyt) | Ireland | ✅ 2026-07-15 | PCI DSS L1, Stripe som selvstændig behandler |
| MobilePay Business (Vipps MobilePay) | DK-payout (nyt) | Danmark/Norge | ✅ 2026-07-12 | Reguleret af FSA |
| Signaturgruppen A/S | MitID broker (nyt) | Danmark | ⚠️ Afventer DIGST-godkendelse | ISAE 3402 |
| Sentry.io | Error tracking | EU (Frankfurt) | ✅ 2026-05-01 | Data scrubbing aktiveret |
| Resend | Transaktionelle emails | EU (Ireland) | ✅ 2026-05-01 | Ingen indhold logges |
| Cloudflare | CDN, DDoS | EU-edge | ✅ 2026-05-01 | Ingen persistering af PII |

### 5.2 Nye behandlere — kritiske noter

**Stripe:**
- Rolle: Selvstændig dataansvarlig for KYC/AML på Stripe Connect-partnere, databehandler for øvrig transaktionsdata.
- Overførsler: EU-hostet, men Stripe Inc. (US) kan have adgang til metadata. Standard-SCC 2021/914 aktiveret + supplementary measures (kryptering in-transit + at-rest).
- Data delt: Betalingsmetadata, ikke betalings-instrumenter (håndteres af Stripe Elements direkte).

**Firebase Auth:**
- Rolle: Databehandler for auth-tokens; Google som selvstændig for aggregerede metrics.
- Data delt: Email, hashet password (hvis fallback bruges), sign-in metode, telefon (ved SMS-OTP).
- Server-side token verify via Firebase Admin SDK: kun public key-hentning fra Google, ingen udgående brugerdata.

**MitID broker (Signaturgruppen):**
- **KRITISK:** Ved DIGST-godkendelse tildeles evt. `cpr_number` scope. Uden godkendelse: kun `identity_assurance` scope (bekræfter identitet, uden at levere CPR).
- Data delt: OAuth-token og callback-parameter; CPR opsamles ephemerally, hashes med server-pepper, plaintext kasseres inden for samme request.

---

## 6. Retentionsperioder pr. tabel

| Tabel | Retention | Sletningsmekanisme | Legal basis |
|---|---|---|---|
| `users` | Konto-levetid + 30 dages soft-delete | User-triggered eller inaktivitet 36 mdr | Kontrakt |
| `webauthn_credentials` | Konto-levetid ELLER 24 mdr inaktivitet | CASCADE fra `users` | Samtykke |
| `biometric_verifications` | 90 dage | Nightly `pg_cron` job | Legitim interesse |
| `device_fingerprints` | 180 dage rullende | Nightly `pg_cron` job | Legitim interesse |
| `mitid_verifications` | 5 år efter kundeforhold ophører | Årlig batch-sletning | Hvidvaskloven § 30 |
| `transactions` | 7 år (financial ledger) | Aldrig fysisk slettet, kun anonymiseret efter 7 år | Bogføringsloven § 10 |
| `fraud_events` (append-only) | 3 år | Aldrig UPDATE/DELETE — årlig arkivering til cold storage | Legitim interesse |
| `csrd_reports` | 10 år | Selskabsvedtægter | CSRD compliance |
| `cases` (klage-modul) | 5 år efter afslutning | Batch efter afslutningsdato | Forbrugerret |
| `messages` (chat) | 12 mdr | Nightly `pg_cron` | Kontrakt |
| `wallet_ledger` (Fase 2 nyt) | 7 år | Append-only, matcher `transactions` | Bogføringsloven |
| `notifications_log` | 30 dage | Nightly | Kontrakt |
| `session_tokens` | Session-varighed + 7 dage | Firebase auto-expiry | Kontrakt |

**Vigtig regel:** Financial ledger-tabeller (`transactions`, `wallet_ledger`, `payments`) er append-only med kryptografisk hash-chain (Modul 5.1) — ingen UPDATE eller DELETE er tilladt selv med admin-rolle. Anonymisering efter 7 år erstatter `user_id` med `NULL`, `email` med `deleted@cirkel.dk`, men beløb og hash-chain bevares.

---

## 7. Data Subject Rights — implementering

### 7.1 Ret til indsigt (Art. 15) — Subject Access Request (SAR)

**Endpoint:** `GET /api/gdpr/sar`
**Autentifikation:** Kræver frisk MitID-verifikation ELLER passkey-signering af udfordring
**Leverance:** ZIP med JSON-eksporter fra alle tabeller hvor `user_id = <requester>`

**Tabeller inkluderet:**
- `users`, `profiles`, `webauthn_credentials` (public keys, ikke hashes), `mitid_verifications` (hashes, ikke CPR)
- `transactions`, `wallet_ledger`, `payments`, `payouts`
- `listings`, `messages`, `reviews`, `favorites`
- `biometric_verifications`, `device_fingerprints` (associeret med bruger)
- `csrd_events` (aggregeret CO2)

**SLA:** 30 dage (Art. 12(3)).
**Testet:** ja, Cypress e2e i `test/gdpr/sar.spec.ts`.

### 7.2 Ret til sletning (Art. 17) — "right to be forgotten"

**Endpoint:** `POST /api/gdpr/erasure`
**Mekanisme:**
1. Soft-delete: `users.deleted_at = now()` — konto låses, data skjules
2. Grace period: 30 dage (mulighed for at fortryde)
3. Hard-delete: CASCADE nedstrøms via foreign keys hvor legitimt
4. Anonymisering: financial ledger beholdes men `user_id → NULL`

**Undtagelser:**
- `transactions`, `wallet_ledger`, `payments` bevares 7 år (bogføringsloven — Art. 17(3)(b))
- `mitid_verifications` bevares 5 år (hvidvaskloven — Art. 17(3)(b))
- `fraud_events` med aktiv efterforskning holdes til afsluttet (Art. 17(3)(e))

**CASCADE-verifikation:** SQL-test `test/gdpr/cascade.sql` verificerer at ingen orphaned rows efter erasure.

### 7.3 Ret til portabilitet (Art. 20)

**Endpoint:** `GET /api/reports/csrd-user?format=csv|json`
**Formater:** CSV (Excel-kompatibel) og JSON (maskinlæsbar)
**Indhold:** Bruger-genererede data (listings, transaktioner, CSRD-events).
**IKKE inkluderet:** Afledte data (fraud-scores, aggregerede metrics) — disse falder uden for Art. 20.

### 7.4 Ret til indsigelse (Art. 21) — særligt mod automatiseret behandling

**Fraud-scoring:** Bruger kan anfægte automatiseret beslutning via `POST /api/gdpr/contest` — udløser menneskelig gennemgang inden 72 timer.
**Marketing:** Unsubscribe-link i alle emails; sletter samtykke i `marketing_consents`.

### 7.5 Ret til berigtigelse (Art. 16)

**Endpoint:** Self-service via profil-side (`/settings/profile`).
**MitID-data:** Kan IKKE selv-berigtiges — kræver ny MitID-verifikation.

---

## 8. Nye risici og mitigering

### 8.1 Restrisici efter Fase 1+2

| # | Risiko | Sandsynlighed | Konsekvens | Restrisiko |
|---|---|---|---|---|
| R1 | Image-hash lækage via `/api/upload` (metadata i EXIF) | Medium | Medium | **MEDIUM** |
| R2 | Passkey-hash re-identifikation ved cross-service angreb | Lav | Høj | **MEDIUM** |
| R3 | Stripe-webhook replay hvis signaturverifikation fejler | Lav | Høj | **LAV** (mitigeret) |
| R4 | MitID-broker misbrug (session-hijacking) | Lav | Meget høj | **MEDIUM** |
| R5 | Fraud-score-bias mod nye brugere / bestemte demografier | Medium | Medium | **MEDIUM** |
| R6 | IP-adresser i `biometric_verifications` afslører placering | Høj | Lav | **LAV** (90d retention) |
| R7 | Firebase Admin SDK-nøglelækage → total token-kompromittering | Lav | Meget høj | **LAV** (mitigeret) |
| R8 | Sub-processor (Stripe) US-adgang til metadata | Medium | Lav | **LAV** (SCC + supplementary) |
| R9 | Insufficient RLS på nye tabeller | Lav | Meget høj | **LAV** (verificeret) |
| R10 | Backup-restore genopliver slettede brugerkonti | Medium | Medium | **MEDIUM** |

### 8.2 Mitigation-plan pr. restrisiko

**R1 — Image-hash lækage:**
- Nuværende: Sharp-baseret EXIF-strip i `/api/upload/route.ts` (linje 47)
- Yderligere: Content-Disposition header sætter `filename=<uuid>.jpg` i stedet for original
- Åben: Verificer at Supabase Storage ikke gemmer EXIF i metadata-JSON
- **Ejer:** Backend-team, deadline: 2026-08-15

**R2 — Passkey-hash re-identifikation:**
- Nuværende: SHA-256 med domain-specifik salt (RP ID = cirkel.dk)
- Yderligere: Rotér salt årligt; gamle credentials skal re-registreres
- **Ejer:** Auth-team, deadline: årlig rotation, næste 2027-01

**R3 — Stripe-webhook replay:**
- Mitigeret: `stripe.webhooks.constructEvent()` med `STRIPE_WEBHOOK_SECRET` + 300s tolerance
- Idempotens via `payment_intent.id` i `payments`-tabellen (UNIQUE constraint)

**R4 — MitID-broker session-hijacking:**
- Nuværende: PKCE + state-parameter + nonce
- Yderligere: Kort session-lifetime (10 min) på broker-callback
- Åben: DIGST-godkendelse af broker-flow (afventer)
- **Ejer:** Compliance, deadline: Q3 2026

**R5 — Fraud-score-bias:**
- Nuværende: Regelbaseret scoring, ingen ML-model
- Yderligere: Månedlig fairness-audit (statistik pr. demografi)
- Menneskelig review-mulighed via `/api/gdpr/contest` (jf. 7.4)
- **Ejer:** Product + Data Science, kvartalsvis review

**R6 — IP-placering:**
- Mitigeret: 90-dages retention, herefter anonymisering til /24
- Yderligere: Deaktivér geo-logging hvis bruger opsætter VPN-samtykke

**R7 — Firebase Admin SDK-lækage:**
- Mitigeret: Nøgle i Vercel env-vars, ikke commited, rotation dokumenteret i `docs/rotation-firebase-apikey.md`
- Yderligere: Firebase App Check aktiveret for at forhindre uautoriseret klient-adgang

**R8 — Stripe US-adgang:**
- Mitigeret: SCC 2021/914 (Module 2), kryptering ved kilde, minimering af delt metadata
- Restrisiko: TIA (Transfer Impact Assessment) gennemført 2026-07-01, ingen indikation af US-myndighedskrav

**R9 — RLS-verifikation:**
- Mitigeret: Alle nye tabeller har eksplicit RLS-politik testet i `test/rls/*.spec.ts`
- Test coverage: 100% på nye tabeller (verificeret 2026-07-20)
- Automatiseret: CI-job blokerer PR hvis ny tabel mangler RLS-politik

**R10 — Backup-restore af slettede brugere:**
- Nuværende: PITR-backups op til 30 dage
- Åben: Efter erasure-request, marker `user_id` i "tombstone"-tabel; restore-scripts genoprydder
- **Ejer:** DevOps, deadline: 2026-09-01

### 8.3 Legitim interesse assessment (LIA) — fraud-detection

**Formål:** Beskytte platform mod svindel og pengevaskning.
**Nødvendighed:** Uden fraud-detection er platformen ikke levedygtig for højværdi-transaktioner (>DKK 15.000 udløser MitID-krav; alt derunder skal risk-scores).
**Balance-test:**
- Brugerens interesser: Ret til ikke at være subjekt for automatisk beslutning, ret til privatliv
- Cirkels interesser: Beskyttelse mod svindel, overholdelse af AMLD5, forretningskontinuitet
- Mitigering: Kun regelbaseret (ikke ML), menneskelig review-mulighed, gennemsigtighed via privatlivspolitik
- **Konklusion:** Legitim interesse dominerer, forudsat mitigeringer holdes ved lige.

---

## 9. Compliance-check post-Fase 1+2

### 9.1 RLS-verifikation på nye tabeller

| Tabel | RLS-politik | Test-coverage | Status |
|---|---|---|---|
| `webauthn_credentials` | `user_id = auth.uid()` | ✅ | OK |
| `biometric_verifications` | `user_id = auth.uid()` + admin bypass | ✅ | OK |
| `device_fingerprints` | Ingen bruger-adgang, kun service-role | ✅ | OK |
| `mitid_verifications` | `user_id = auth.uid()` + strict-admin | ✅ | OK |
| `fraud_events` | Ingen bruger-adgang | ✅ | OK |
| `wallet_ledger` | `user_id = auth.uid()` (kun læsning) | ✅ | OK |
| `csrd_events` | `user_id = auth.uid()` (kun læsning) | ✅ | OK |

### 9.2 Append-only fraud-log (Modul 5.1)

Verificeret via følgende PostgreSQL-mekanismer:
- Trigger `prevent_fraud_events_mutation` på UPDATE/DELETE — RAISE EXCEPTION
- Row-level hash-chain: `fraud_events.hash_prev` = SHA-256(forrige række)
- Månedlig ekstern anchoring: hash af sidste række publiceres i offentligt log (planlagt Fase 3)

### 9.3 Kryptering

| Data-i-hvile | Metode |
|---|---|
| Supabase Postgres | AES-256 (managed by Supabase) |
| Supabase Storage (uploads) | AES-256, per-bucket encryption keys |
| Vercel env-vars | AES-256, encrypted-at-rest |
| Firebase-tokens | JWT, RS256 signeret |

| Data-i-transit | Metode |
|---|---|
| Alle endpoints | TLS 1.3, HSTS max-age=63072000 |
| Interne API-kald | mTLS mellem edge functions (planlagt Fase 3) |
| Stripe webhooks | HMAC-SHA256 signaturverifikation |
| MitID broker | Signeret JWT + PKCE OAuth |

### 9.4 Logging og monitoring

- **Sentry:** Fejllogging med automatisk PII-scrubbing (før-hook fjerner `email`, `phone`, `ip`)
- **Vercel Analytics:** Aggregerede metrics, ingen individuelle IP
- **Supabase Audit Log:** DML-hændelser på følsomme tabeller (auth.users, mitid_verifications) — retention 90 dage

---

## 10. Overførsel til tredjelande

| Modtager | Land | Overførselsgrundlag |
|---|---|---|
| Stripe Inc. (moderfirma) | US | SCC 2021/914 Module 2 + supplementary measures (TIA gennemført) |
| Google/Firebase | Ireland (data), US (support) | Google som Controller-of-Record i EU; SCC for support-scenarier |
| Sentry | EU (Frankfurt) | Ingen tredjelandsoverførsel |
| Cloudflare | EU-edge | Ingen persistering, TIA gennemført |

**TIA (Transfer Impact Assessment)** for US-modtagere er dokumenteret separat i `docs/legal/TIA-2026-07.md` og opdateres årligt.

---

## 11. Konsultation med tilsynsmyndighed

Under GDPR Art. 36 kræver forudgående høring med Datatilsynet hvis restrisici forbliver **HØJE** efter mitigering.

**Vurdering post-Fase 1+2:** Alle restrisici er nedbragt til MEDIUM eller LAV. **Ingen forudgående høring nødvendig.**

**Trigger for genvurdering:**
- Introduktion af ML-baseret fraud-scoring (planlagt Fase 4)
- Ekspansion til brugere under 15 år
- Overførsel af yderligere data til non-EEA-modtagere
- Betydelig ændring i sub-processor-landskabet

---

## 12. Data Breach Response

### 12.1 Definition
Enhver uautoriseret adgang, tab, ændring eller offentliggørelse af persondata behandlet i Cirkel-platformen.

### 12.2 Detektionsmekanismer
- Sentry-alerts på 5xx-spikes
- Supabase Auth-anomali (rate limiting, geografisk usædvanlig login)
- Månedlig penetrationstest (Modul 5.1)
- Automatiseret secret-scanning i CI (GitHub Advanced Security)

### 12.3 Respons-timeline (Art. 33)
| Timing | Aktion | Ejer |
|---|---|---|
| T+0 | Incident detekteres | On-call engineer |
| T+2h | Containment (rollback, revoke tokens) | DevOps + DPO |
| T+8h | Impact-vurdering (antal brugere, følsomhed) | DPO + CTO |
| T+24h | Beslutning: melde til Datatilsynet? | DPO + CEO |
| T+72h (max) | Anmeldelse til Datatilsynet | DPO |
| T+72h+ | Bruger-notifikation hvis høj risiko | Product + Legal |

### 12.4 Playbook-reference
Se `docs/incident-response.md` for detaljerede runbooks pr. scenario.

---

## 13. Godkendelser

| Rolle | Navn | Underskrift | Dato |
|---|---|---|---|
| DPO | [Navn] | ⬜ | ⬜ |
| CTO | [Navn] | ⬜ | ⬜ |
| CEO (Michael Ambrosius) | Michael Ambrosius | ⬜ | ⬜ |
| Ekstern juridisk rådgiver | [Firma] | ⬜ | ⬜ |

---

## Bilag

- **Bilag A:** Dataflow-diagram (se `docs/architecture/dataflow-v0.2.svg`)
- **Bilag B:** RLS-politikker som SQL (`supabase/policies/`)
- **Bilag C:** Sub-processor DPA-arkiv (`docs/legal/dpa/`)
- **Bilag D:** Retention-cron-jobs (`supabase/migrations/2026_07_retention.sql`)
- **Bilag E:** LIA fraud-detection fuldt dokument (`docs/legal/LIA-fraud-2026-07.md`)
- **Bilag F:** Transfer Impact Assessment (`docs/legal/TIA-2026-07.md`)
- **Bilag G:** Incident Response Playbook (`docs/incident-response.md`)

---

## Ændringslog

| Version | Dato | Ændringer |
|---|---|---|
| 0.1 | 2026-07-19 | Initial DPIA — dækkede Fase 0 (grundlæggende marketplace + Supabase auth) |
| 0.2 | 2026-07-21 | Tilføjet WebAuthn, MitID broker, Stripe/MobilePay, fraud-detection, biometric-log, device fingerprint, opdaterede retention-perioder, ny sub-processor-liste, restrisici R1-R10 med mitigation-plan |

---

*Dette dokument er klassificeret som INTERNT og indeholder juridisk følsomme detaljer. Distribution kun til godkendte reviewers.*
