# Modul 15.2 — IoT TLS 1.3 Gateway Setup Guide

**Modul:** 15.2 Secure IoT Gateway
**Status:** Draft v1.0
**Sidst opdateret:** 2026-07-22
**Ejer:** Cirkel Platform Team
**Relaterede moduler:** 15.1 Hardware Attestation, F1 Bin Ingest API, F3.8 Server-side Auth

---

## 1. Formål

Denne guide beskriver end-to-end opsætning af den sikre TLS 1.3-gateway mellem fysiske Cirkel-bins (IoT-enheder) og backend-API'et (`/api/bins/ingest`). Gateway'en håndterer:

- TLS 1.3 terminering med Let's Encrypt-certifikater (auto-provisioneret via Vercel Edge Network)
- Bearer-token rotation med 30-dages cyklus og HMAC-signering
- Signature verification via `crypto.timingSafeEqual` (konstant-tid sammenligning)
- Fleet management med unikke `IOT_MASTER_SECRET` pr. bin (hashed lagring i Supabase)
- Automatisk alarm og blokering ved gentagne autentifikationsfejl
- Compliance-integration med hardware-attestation (Modul 15.1)

---

## 2. Arkitektur-oversigt

```
+---------------------+       TLS 1.3         +----------------------+       +------------------+
|   Cirkel Bin (IoT)  |  ─────────────────▶   |  Vercel Edge (LE)    | ────▶ |  /api/bins/ingest|
|  - bin_id           |   Bearer + HMAC-sig   |  - Auto cert renewal |       |  - Verify sig    |
|  - IOT_MASTER_SECRET|                       |  - HTTP/2 + TLS 1.3  |       |  - Rate limit    |
|  - Attestation quote|                       |  - Perfect Forward   |       |  - Fleet lookup  |
+---------------------+                       |    Secrecy           |       +--------┬---------+
                                              +----------------------+                │
                                                                                       ▼
                                                                          +─────────────────────────+
                                                                          │  Supabase                │
                                                                          │  - iot_devices (hashed)  │
                                                                          │  - iot_auth_failures     │
                                                                          │  - iot_token_rotations   │
                                                                          +─────────────────────────+
```

---

## 3. Certificate Management (Let's Encrypt via Vercel)

### 3.1 Automatisk provisionering

Vercel håndterer Let's Encrypt-certifikater automatisk for alle custom domains (inkl. `iot.cirkel.dk`). Der kræves **ingen manuel handling** for udstedelse eller fornyelse.

**Konfiguration:**

1. Tilføj custom domain i Vercel-projekt: `iot.cirkel.dk`
2. Konfigurer DNS CNAME → `cname.vercel-dns.com`
3. Vercel udsteder automatisk LE-certifikat (RSA 2048 + ECDSA P-256 dual-cert)
4. Fornyelse sker automatisk 30 dage før udløb

**TLS-parametre (håndhævet af Vercel Edge):**

| Parameter | Værdi |
|-----------|-------|
| Min. TLS-version | TLS 1.3 (håndhævet via `vercel.json`) |
| Cipher suites | `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256` |
| Key exchange | X25519, secp384r1 |
| HSTS | `max-age=63072000; includeSubDomains; preload` |
| Certificate transparency | Aktiveret (SCT embedded) |

### 3.2 Håndhævelse af TLS 1.3 kun

Tilføj til `vercel.json` i cirkel-repo:

```json
{
  "headers": [
    {
      "source": "/api/bins/(.*)",
      "headers": [
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=63072000; includeSubDomains; preload"
        }
      ]
    }
  ]
}
```

TLS 1.0/1.1/1.2 er allerede deaktiveret som standard på Vercel Edge for nye projekter oprettet efter 2024.

### 3.3 Certificate pinning (bin-side)

Bins skal pinne Let's Encrypt ISRG Root X1 og X2 (backup):

```c
// bin-firmware/src/tls_pinning.c
static const char *LE_ROOT_ISRG_X1 = "-----BEGIN CERTIFICATE-----\nMIIFazCC..."; // ISRG Root X1
static const char *LE_ROOT_ISRG_X2 = "-----BEGIN CERTIFICATE-----\nMIICGzCC..."; // ISRG Root X2 (ECDSA backup)
```

Root-certifikatets fingerprint verificeres inden hver TLS-handshake. Bin nægter forbindelse hvis pinning fejler.

---

## 4. Bearer-token rotation policy

### 4.1 Rotation-cyklus

- **Interval:** 30 dage (måned rullende)
- **Overlap:** 48 timers grace-periode hvor både gammel og ny token accepteres
- **Trigger:** Automatisk cron-job kl. 03:00 UTC, dag 1 hver måned
- **Notification:** Fleet-manager modtager Slack-alarm 7 dage før rotation

### 4.2 Token-struktur (HMAC-signed)

Hver Bearer-token er en JWS-lignende struktur:

```
<base64url(payload)>.<base64url(hmac_sha256(payload, IOT_MASTER_SECRET))>
```

Payload:

```json
{
  "bin_id": "bin_dk_aarhus_0142",
  "iat": 1721606400,
  "exp": 1724198400,
  "kid": "rot_2026_07",
  "scope": ["ingest:weight", "ingest:temp", "attest:submit"]
}
```

- `iat` = issued at (unix timestamp)
- `exp` = expiry (iat + 30 dage + 48h grace)
- `kid` = key rotation ID, matches `iot_token_rotations.rotation_id` i Supabase
- `scope` = tilladte API-endpoints

### 4.3 Rotation-procedure

1. **T-7 dage:** Slack-alarm til Fleet Ops
2. **T-0 (03:00 UTC):** Cron-job kalder `/api/iot/rotate-tokens`
   - Genererer ny `rotation_id` i `iot_token_rotations`
   - Genererer nye tokens for alle aktive bins
   - Signerer med hver bins `IOT_MASTER_SECRET`
   - Publisher nye tokens via MQTT `cirkel/fleet/{bin_id}/token-rotation`
3. **T+0 til T+48h:** Gammel + ny token accepteres begge
4. **T+48h:** Gammel `rotation_id` markeres `revoked=true`
5. **T+48h+1:** Bins der stadig sender gammel token → auth failure, alarm

### 4.4 Emergency rotation

Ved kompromitteret token kan operator udføre emergency rotation:

```bash
pnpm run iot:rotate --bin-id=bin_dk_aarhus_0142 --emergency
```

Dette:
- Revoker øjeblikkeligt gammel token (ingen grace)
- Genererer ny token
- Sender push notification til bin via MQTT
- Logger til `iot_security_incidents` tabel

---

## 5. Signature verification (constant-time)

### 5.1 Verifikation i `/api/bins/ingest`

Efter Fase 1 skal endpoint bruge `crypto.timingSafeEqual` for at forhindre timing-attacks:

```typescript
// app/api/bins/ingest/route.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = authHeader.slice(7);
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) {
    return new Response('Malformed token', { status: 401 });
  }

  // Decode payload for at hente bin_id
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  const { bin_id, kid, exp } = payload;

  // Expiry-check
  if (Date.now() / 1000 > exp) {
    await logAuthFailure(bin_id, 'token_expired');
    return new Response('Token expired', { status: 401 });
  }

  // Hent bin's master secret hash + verify rotation_id er aktiv
  const device = await supabase
    .from('iot_devices')
    .select('master_secret_hash, master_secret_enc, active')
    .eq('bin_id', bin_id)
    .single();

  if (!device.data?.active) {
    return new Response('Bin deactivated', { status: 403 });
  }

  // Decrypt master secret (KMS-envelope encryption)
  const masterSecret = await decryptWithKMS(device.data.master_secret_enc);

  // Compute expected signature
  const expectedSig = createHmac('sha256', masterSecret)
    .update(payloadB64)
    .digest();
  const providedSig = Buffer.from(sigB64, 'base64url');

  // Constant-time comparison
  if (
    expectedSig.length !== providedSig.length ||
    !timingSafeEqual(expectedSig, providedSig)
  ) {
    await logAuthFailure(bin_id, 'invalid_signature');
    return new Response('Invalid signature', { status: 401 });
  }

  // Verify rotation_id er aktiv (ikke revoked)
  const rotation = await supabase
    .from('iot_token_rotations')
    .select('revoked')
    .eq('rotation_id', kid)
    .single();

  if (rotation.data?.revoked) {
    return new Response('Token rotation revoked', { status: 401 });
  }

  // Success — process ingest payload
  return handleIngest(bin_id, await req.json());
}
```

### 5.2 Hvorfor `timingSafeEqual`?

Naiv sammenligning (`===` eller `Buffer.compare`) afslører hemmelig data via runtime-forskelle. `timingSafeEqual` udfører XOR over hele bufferen uanset match — konstant tid, immunt over for timing-attacks.

**Vigtigt:** Buffer-længder skal tjekkes FØR `timingSafeEqual` kaldes, ellers kaster funktionen exception (som selv er timing-observérbar). Se linje `expectedSig.length !== providedSig.length` ovenfor.

---

## 6. Fleet management

### 6.1 Supabase-skema

```sql
-- Fleet registry
create table iot_devices (
  bin_id                 text primary key,
  master_secret_hash     text not null,           -- SHA-256 til lookup-verifikation
  master_secret_enc      bytea not null,          -- KMS-envelope encrypted secret
  hardware_attestation   jsonb,                   -- Modul 15.1 payload
  region                 text not null,           -- fx 'dk_aarhus'
  active                 boolean default true,
  provisioned_at         timestamptz default now(),
  last_seen              timestamptz,
  firmware_version       text
);

-- Token rotation-registry
create table iot_token_rotations (
  rotation_id            text primary key,        -- fx 'rot_2026_07'
  created_at             timestamptz default now(),
  valid_until            timestamptz not null,
  revoked                boolean default false,
  revoked_at             timestamptz,
  revoked_reason         text
);

-- Auth failure log (for alarm-flow)
create table iot_auth_failures (
  id                     bigserial primary key,
  bin_id                 text,                    -- kan være null hvis payload umuligt at parse
  reason                 text not null,           -- 'token_expired' | 'invalid_signature' | 'unknown_bin' | 'malformed'
  ip_hash                text,                    -- SHA-256(remote_ip + salt) — GDPR
  user_agent             text,
  occurred_at            timestamptz default now()
);

create index iot_auth_failures_bin_time on iot_auth_failures(bin_id, occurred_at desc);

-- Security incident-log
create table iot_security_incidents (
  id                     bigserial primary key,
  bin_id                 text,
  incident_type          text not null,           -- 'blocked_5x' | 'emergency_rotation' | 'attestation_failure'
  severity               text not null,           -- 'low' | 'medium' | 'high' | 'critical'
  details                jsonb,
  created_at             timestamptz default now(),
  resolved_at            timestamptz
);
```

### 6.2 Provisionering af ny bin

```bash
pnpm run iot:provision \
  --region=dk_aarhus \
  --hardware-serial=CIRKEL-2026-A0142 \
  --attestation-quote=./attestation-quotes/A0142.bin
```

Scriptet:
1. Genererer 256-bit `IOT_MASTER_SECRET` via `crypto.randomBytes(32)`
2. Verificerer hardware attestation-quote mod TPM-root (Modul 15.1)
3. Krypterer secret med Supabase Vault KMS-nøgle
4. Indsætter række i `iot_devices` med `master_secret_hash` + `master_secret_enc`
5. Genererer initial token for aktuel `rotation_id`
6. Flasher bin firmware med secret + initial token via secure USB-provisioning-fixture
7. Master secret nulstilles fra provisioning-host memory efter flash

**Master secret findes ALDRIG i klartekst i Supabase eller nogen log.**

---

## 7. Alarm-flow ved autentifikationsfejl

### 7.1 5-fejl regel

Efter **5 fejlede autentifikationsforsøg indenfor 15 minutter** blokeres bin_id automatisk:

```typescript
// app/api/bins/ingest/lib/failure-guard.ts
async function logAuthFailure(bin_id: string, reason: string) {
  await supabase.from('iot_auth_failures').insert({ bin_id, reason });

  const { data: recent } = await supabase
    .from('iot_auth_failures')
    .select('id')
    .eq('bin_id', bin_id)
    .gte('occurred_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());

  if ((recent?.length ?? 0) >= 5) {
    // Bloker bin
    await supabase
      .from('iot_devices')
      .update({ active: false })
      .eq('bin_id', bin_id);

    // Log incident
    await supabase.from('iot_security_incidents').insert({
      bin_id,
      incident_type: 'blocked_5x',
      severity: 'high',
      details: { failures: recent, blocked_at: new Date().toISOString() },
    });

    // Notify Fleet Ops
    await notifySlack('#cirkel-iot-security', {
      text: `IoT ALARM: bin ${bin_id} blokeret efter 5 auth-fejl på 15 min`,
      severity: 'high',
    });
  }
}
```

### 7.2 Unblock-procedure

Manuel operator-handling påkrævet (ingen auto-unblock):

1. Fleet Ops verificerer bin-tilstand fysisk eller via attestation-check
2. Kør: `pnpm run iot:unblock --bin-id=bin_dk_aarhus_0142 --incident-id=1234`
3. Hvis kompromitteret: emergency rotation (afsnit 4.4) + fysisk audit
4. Log unblock-årsag i `iot_security_incidents.resolved_at`

### 7.3 Global fleet-anomalidetektion

Dagligt cron-job (`iot:anomaly-scan`) tjekker:

- Bins med >20 auth-fejl over 24 timer → medium-severity alarm
- Bins der ikke har rapporteret på 48+ timer → offline-alarm
- Bins med attestation-drift (firmware-hash ændret uden signeret update) → critical

---

## 8. Compliance-integration (Modul 15.1)

### 8.1 Hardware attestation-krav

Hver bin skal fremvise gyldig hardware attestation ved:

- **Provisionering:** TPM/secure-element quote verificeres mod fabriks-CA
- **Token-rotation:** Ny token udstedes kun hvis seneste attestation er <90 dage gammel
- **Firmware-update:** Ny firmware-hash signeres af Cirkel Root CA og verificeres af bin før flash

### 8.2 Attestation-quote format

```json
{
  "bin_id": "bin_dk_aarhus_0142",
  "tpm_version": "2.0",
  "firmware_hash": "sha256:abc123...",
  "pcr_values": {
    "0": "hex...",
    "7": "hex..."
  },
  "quote": "base64_signed_by_tpm_ek",
  "ek_cert_chain": ["cert1_b64", "cert2_b64"],
  "timestamp": 1721606400
}
```

### 8.3 Verifikations-pipeline

1. Verify EK-certifikatkæde slutter i Cirkel Root CA (embedded i backend)
2. Verify quote-signatur med EK public key
3. Verify PCR-værdier matcher forventet firmware-hash for bin's release-channel
4. Log attestation-resultat i `iot_devices.hardware_attestation` (append-only via trigger)

Bin nægtes ingest hvis attestation er:
- Ældre end 90 dage (kræver re-attestation via lokal admin)
- Signeret af ukendt EK
- PCR-mismatch (potentielt kompromitteret firmware)

### 8.4 GDPR / NIS2 compliance-noter

- IP-adresser i `iot_auth_failures` er SHA-256 hashed med rotating salt (30-dages TTL)
- Master secrets er KMS-envelope encrypted (Supabase Vault)
- Alle security incidents rapporteres til CISO Slack-kanal indenfor 5 minutter
- NIS2-artikel 21 hændelsesrapporter genereres automatisk fra `iot_security_incidents` ved `severity='critical'`
- DPIA-reference: `docs/DPIA-v0.2-post-fase12.md` §7 (IoT-behandling)

---

## 9. Operational checklist

### 9.1 Ved rollout af Modul 15.2

- [ ] Custom domain `iot.cirkel.dk` konfigureret i Vercel
- [ ] LE-certifikat udstedt og verificeret (`curl -vI https://iot.cirkel.dk`)
- [ ] TLS 1.3-only bekræftet via `nmap --script ssl-enum-ciphers -p 443 iot.cirkel.dk`
- [ ] Supabase-tabeller oprettet (afsnit 6.1)
- [ ] KMS-nøgle provisioneret i Supabase Vault
- [ ] Cron-job for token-rotation deployet (Vercel Cron: `0 3 1 * *`)
- [ ] Cron-job for anomaly-scan deployet (`0 6 * * *`)
- [ ] Slack-webhook konfigureret for `#cirkel-iot-security`
- [ ] Provisioning-fixture testet på pilotbin (3 stk. i Aarhus)
- [ ] Emergency rotation-procedure testet i staging
- [ ] Runbook opdateret i `docs/deploy-runbook.md`

### 9.2 Månedlig health-check

- [ ] Antal aktive rotation_ids ≤ 2 (aktuel + grace)
- [ ] Auth-failure-rate <0.5% af total ingest-requests
- [ ] Ingen bins med attestation ældre end 60 dage
- [ ] Certifikat-udløb >30 dage (Vercel viser i dashboard)
- [ ] Ingen `iot_security_incidents` med `resolved_at IS NULL` og `severity='critical'` >24h

---

## 10. Referencer

- Modul 15.1: Hardware Attestation (TPM 2.0 + secure element)
- Fase 1: `/api/bins/ingest` implementation (`app/api/bins/ingest/route.ts`)
- F3.8: Server-side auth pattern (`docs/F3.8-server-side-auth.md`)
- DPIA v0.2: `docs/DPIA-v0.2-post-fase12.md` §7
- Deploy runbook: `docs/deploy-runbook.md`
- OWASP ASVS 4.0.3 §V9 (Communications Security)
- NIS2-direktivet artikel 21 (Cybersecurity risk-management measures)
- Let's Encrypt CP/CPS: https://letsencrypt.org/repository/
- Vercel Edge Network TLS-dokumentation

---

**Change log**

| Version | Dato | Ændring | Ejer |
|---------|------|---------|------|
| 1.0     | 2026-07-22 | Første udgave — komplet setup guide | Platform Team |
