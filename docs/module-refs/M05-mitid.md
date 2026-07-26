# M05.2 — MitID Broker Integration

Reference for Cirkel's DIGST-approved MitID identification module.
Component ID: `M05.2` (Identity & Verification → MitID broker).
Status: Spec / awaiting DIGST broker agreement.
Owner: Platform / Trust & Safety.

---

## 1. Formål

MitID broker levering af **stærk digital identifikation** til Cirkel-brugere via
Denmark's national eID scheme (DIGST). Brokeren fungerer som Cirkel's Identity
Provider (IdP) proxy mod MitID Core-infrastruktur.

**Business drivers**

- Elevate `profiles.verification_tier` from `email` → `mitid_verified`.
- Reduce peer-to-peer fraud in Give / Marketplace modules (ref. DK-fraud-epidemi
  131k victims 2024).
- Enable trust-gated features: high-value giveaways, escrow release, kommunal
  onboarding (Aarhus-udbud 2026-27).
- Legal prerequisite for KYC-lite flows on wallet payouts > 1.500 DKK.

**Non-goals**

- Not a signing service (MitID Erhverv signing lives in M05.4).
- No CPR-lookup — the broker returns pseudonymous PID, never raw CPR.
- Not a session manager — session cookies handled by M03 Auth.

---

## 2. Forudsætninger (Prerequisites)

Cirkel MUST hold an active **DIGST-approved broker agreement** before this
module can be enabled in production. Two viable paths:

| Path | Provider | Notes |
| --- | --- | --- |
| A | Signaturgruppen (Nets) | Fastest onboarding, ~4-6 weeks |
| B | Criipto | Nordic-wide, includes Norwegian BankID / Swedish BankID |
| C | Direct with DIGST | Only for regulated entities (banks, offentlige) — not applicable |

**Required legal / admin steps**

1. Register Cirkel as *databehandler* on [virk.dk](https://virk.dk).
2. Sign *Brugeraftale MitID-broker* with chosen provider (path A or B).
3. Publish DPA covering PID processing (append to M05 DPIA v0.1).
4. Whitelist redirect URIs and JWKS endpoints with the broker.
5. Provision one dedicated OIDC client per environment (test, staging, prod).

DIGST reference: <https://digst.dk/it-loesninger/mitid/> — broker rulebook v3.

---

## 3. Environment variables

All five variables are **required**. Missing any of them MUST cause the module
to fail-closed on boot (throw at import time, do not lazy-fail on first
request).

| Name | Example | Description |
| --- | --- | --- |
| `MITID_BROKER_ISSUER` | `https://broker.signaturgruppen.dk/op` | OIDC issuer URL — root for `.well-known/openid-configuration` |
| `MITID_CLIENT_ID` | `urn:cirkel:prod:web` | OIDC client identifier issued by broker |
| `MITID_CLIENT_SECRET` | `sk_live_...` | Client secret (server-side only, never in client bundle) |
| `MITID_REDIRECT_URI` | `https://app.cirkel.dk/api/auth/mitid-verify` | Absolute HTTPS callback, must match broker whitelist byte-for-byte |
| `MITID_SCOPES` | `openid mitid ssn` | Space-separated scopes. `ssn` requires DIGST justification |

**Storage**

- Production: Vercel Encrypted Env Vars (project `cirkel-web`, env `production`).
- Local dev: `.env.local` — never committed. Add to `.gitignore`.
- CI: GitHub Actions repository secrets, mirrored per environment.

---

## 4. OIDC flow diagram

Authorization Code + PKCE. No implicit / hybrid.

```
   Browser (User)          Cirkel API              MitID Broker           MitID Core
        |                       |                        |                     |
        |  1. POST /mitid-init  |                        |                     |
        |---------------------->|                        |                     |
        |                       | 2. gen state + code_verifier                 |
        |                       |    store {state -> verifier} (TTL 10 min)    |
        |  3. 302 auth_url      |                        |                     |
        |<----------------------|                        |                     |
        |                                                |                     |
        |  4. GET /authorize?client_id=&code_challenge=  |                     |
        |----------------------------------------------->|                     |
        |                                                |  5. delegate auth   |
        |                                                |-------------------->|
        |                                                |                     |
        |     6. User approves in MitID app                                    |
        |<-------------------- MitID Core UI --------------------------------->|
        |                                                |                     |
        |                                                |  7. auth result     |
        |                                                |<--------------------|
        |  8. 302 redirect_uri?code=&state=              |                     |
        |<-----------------------------------------------|                     |
        |                                                                      |
        |  9. GET /mitid-verify?code=&state=             |                     |
        |---------------------->|                                              |
        |                       | 10. lookup verifier by state                 |
        |                       | 11. POST /token (code + verifier + secret)   |
        |                       |------------------------>|                    |
        |                       | 12. id_token + userinfo                      |
        |                       |<------------------------|                    |
        |                       | 13. validate JWT (iss, aud, exp, nonce)      |
        |                       | 14. UPDATE profiles.verification_tier        |
        |  15. 302 /profile     |                                              |
        |<----------------------|                                              |
```

**Cryptographic requirements**

- `code_challenge_method = S256` (SHA-256 hash of `code_verifier`).
- `code_verifier`: 43-128 chars, base64url, cryptographically random.
- `state`: 32 bytes random, base64url. Bound 1:1 to session.
- `nonce`: 32 bytes random, echoed in `id_token`, validated on return.
- `id_token` signature verified against broker JWKS (cached 24h, respect
  `Cache-Control`).

---

## 5. API endpoints

### 5.1 `POST /api/auth/mitid-init`

Initiates a MitID authentication attempt.

**Request**

```http
POST /api/auth/mitid-init HTTP/1.1
Content-Type: application/json
Cookie: session=<anon-session>

{
  "return_to": "/profile/verify",
  "flow": "signup" | "step-up" | "reverify"
}
```

**Response**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "authorize_url": "https://broker.signaturgruppen.dk/op/authorize?...",
  "state": "b64url-state",
  "expires_at": "2026-07-22T10:15:00Z"
}
```

**Server-side actions**

1. Generate `state`, `nonce`, `code_verifier`, `code_challenge`.
2. Persist `{state, verifier, nonce, return_to, session_id, flow}` in
   `mitid_flow_state` table with `expires_at = now() + 10 min`.
3. Build `authorize_url` with scopes from `MITID_SCOPES`.
4. Return URL — client performs `window.location.assign(authorize_url)`.

**Errors**

| Status | Reason |
| --- | --- |
| 401 | No active session cookie |
| 429 | > 5 init calls per session per hour |
| 503 | Broker JWKS/discovery unreachable |

---

### 5.2 `GET /api/auth/mitid-verify`

Broker callback. Consumes the authorization code and finalizes verification.

**Request** (from broker redirect)

```
GET /api/auth/mitid-verify?code=<code>&state=<state> HTTP/1.1
```

**Server-side actions**

1. Load and DELETE `mitid_flow_state` row by `state`. Reject if missing/expired.
2. Exchange code at `/token` endpoint with `code_verifier` and client secret.
3. Validate `id_token`:
   - `iss` === `MITID_BROKER_ISSUER`
   - `aud` === `MITID_CLIENT_ID`
   - `exp` > now, `iat` within 5 min skew
   - `nonce` matches stored value
   - Signature verified against JWKS
4. Extract claims → transform → update Supabase.
5. Emit `mitid.verified` event to audit log.
6. Redirect to `return_to` with success flag.

**Response**

```http
HTTP/1.1 302 Found
Location: /profile/verify?status=ok
Set-Cookie: session=<upgraded-session>; HttpOnly; Secure; SameSite=Lax
```

**Errors**

| Status | Reason | User-facing action |
| --- | --- | --- |
| 302 → `?status=denied` | User cancelled in MitID app | Retry allowed |
| 302 → `?status=expired` | State TTL exceeded | Restart flow |
| 302 → `?status=mismatch` | State/nonce validation failed | Log security event |
| 500 | Broker `/token` returned 5xx | Fail-safe, do not upgrade tier |

---

## 6. Data-flow → `profiles.verification_tier`

### 6.1 Claim mapping

Broker `userinfo` payload:

```json
{
  "sub": "urn:mitid:pid:9208-2002-2-514816247615",
  "mitid.uuid": "e1e6a4c2-3b8f-4d2b-9f7c-8a1c2d3b4e5f",
  "mitid.age": "23_plus",
  "mitid.name": "Anders And",
  "mitid.assurance_level": "SUBSTANTIAL"
}
```

### 6.2 Transformation

```
pid_hash        = sha256(sub + PID_SALT)         -- salt from Vault, rotated yearly
display_name    = mitid.name                     -- store only with user consent
age_band        = mitid.age                      -- '18_plus' | '23_plus' | ...
assurance       = mitid.assurance_level          -- 'LOW' | 'SUBSTANTIAL' | 'HIGH'
```

### 6.3 SQL update

```sql
UPDATE profiles
SET
  verification_tier    = 'mitid_verified',
  mitid_pid_hash       = $1,
  mitid_age_band       = $2,
  mitid_assurance      = $3,
  mitid_verified_at    = now(),
  display_name         = COALESCE(display_name, $4)
WHERE id = $5
  AND verification_tier IN ('email', 'phone');
```

### 6.4 Downstream side-effects (fire event, do not couple)

- `M06 Wallet` — unlocks payouts > 1.500 DKK.
- `M09 Give` — enables "verified giver" badge.
- `M11 Marketplace` — required for seller onboarding.
- `M14 Trust` — recalculates trust score.

**Never store raw CPR.** If `ssn` scope is granted, hash-and-discard within the
same request. Log the discard event for audit.

---

## 7. Test-mode setup (DIGST test-broker)

DIGST provides a public test broker for integration development. **No real
MitID users** — only synthetic test identities.

### 7.1 Environment

```bash
MITID_BROKER_ISSUER=https://pp.mitid.dk/mitid-broker/v2.0
MITID_CLIENT_ID=urn:cirkel:test:web
MITID_CLIENT_SECRET=<from-signaturgruppen-portal>
MITID_REDIRECT_URI=http://localhost:3000/api/auth/mitid-verify
MITID_SCOPES=openid mitid
```

### 7.2 Test identities

Provided by broker portal — typical set:

| Test user | PID | Scenario |
| --- | --- | --- |
| Anders Test | `9208-2002-2-514816247615` | Happy path, age 30 |
| Boern Test | `9208-2002-2-100000000001` | Age < 18, verification denied |
| Cancel Test | `9208-2002-2-999999999999` | Always cancels in app |
| Expired Test | `9208-2002-2-000000000001` | Certificate revoked |

### 7.3 Local development

```bash
# 1. Start Cirkel with test env
pnpm dev

# 2. Trigger flow
open http://localhost:3000/profile/verify

# 3. Simulate MitID app in browser
#    Broker test UI shows "Approve" button — no phone required
```

### 7.4 Automated E2E tests

Playwright fixtures in `tests/e2e/mitid.spec.ts` use the DIGST test broker.
CI-safe: no real PII, deterministic PIDs, no rate limits.

---

## 8. Compliance-noter

### 8.1 GDPR — legal basis

- **Art. 6(1)(b)** — necessary for performance of Cirkel Terms (verified
  identity for peer transactions).
- **Art. 6(1)(f)** — legitimate interest in fraud prevention.
- **Art. 9** does NOT apply — PID is not a special category if properly
  pseudonymized before storage.

Publish notice in `/privacy` covering: what is collected, why, retention,
rights, DPO contact.

### 8.2 CPR-håndtering

- **Never persist raw CPR.** Not in DB, not in logs, not in metrics.
- If `ssn` scope is granted (only when strictly necessary and DIGST-approved),
  hash CPR with a HSM-backed salt and discard the plaintext inside the same
  request handler.
- Broker's `sub` (PID) is the stable identifier — safe to store hashed.
- Do NOT include PID or PID-hash in URL query strings, referer headers, or
  client-side telemetry.

### 8.3 Retention

| Field | Retention | Reason |
| --- | --- | --- |
| `mitid_pid_hash` | Lifetime of account + 5 yrs | Fraud audit trail (Hvidvasklovens § 30) |
| `mitid_verified_at` | Same | Audit |
| `mitid_flow_state` | 10 min (TTL) | Ephemeral OIDC state |
| Access logs | 90 days | Security, then rotated |
| Failed verification attempts | 12 months | Fraud pattern detection |

### 8.4 DPIA

Extend M05 DPIA v0.1 with:

- Necessity & proportionality assessment for `ssn` scope.
- Sub-processor listing (broker, hosting, log aggregation).
- Data subject rights flow (Art. 15 access, Art. 17 erasure limited by
  Hvidvaskloven).
- Breach notification runbook — 72h to Datatilsynet.

### 8.5 Broker rulebook compliance

- Log all `sub` values accessed, retention 5 years (broker requirement).
- Do NOT display MitID logo without approval from DIGST design guide.
- Session upgrade after MitID MUST be visually distinct in the UI
  ("Verificeret med MitID" badge).

---

## 9. Common errors + fix

### 9.1 `invalid_grant` on token exchange

**Cause:** `code_verifier` doesn't match stored `code_challenge`, or code
already redeemed.

**Fix:**

1. Confirm `mitid_flow_state` row is deleted only AFTER successful token
   exchange, not before.
2. Verify no duplicate `/mitid-verify` calls (double-submit from browser
   back-button).
3. Check that `code_verifier` is URL-safe base64 without padding.

### 9.2 `redirect_uri_mismatch`

**Cause:** Whitelisted URI in broker portal differs from `MITID_REDIRECT_URI`.

**Fix:**

- Compare byte-for-byte. Trailing slash matters. `http` vs `https` matters.
- Localhost dev URIs must be whitelisted separately in test broker.

### 9.3 `id_token` signature verification fails

**Cause:** JWKS cache stale after broker key rotation.

**Fix:**

- Force JWKS refresh by clearing the `mitid:jwks` Redis key.
- Ensure JWKS client respects `Cache-Control: max-age`.
- Verify `kid` in `id_token` header exists in fetched JWKS.

### 9.4 `nonce_mismatch`

**Cause:** Nonce not persisted or session cookie changed between init and
verify.

**Fix:**

- Check `SameSite=Lax` on session cookie (not `Strict`, breaks cross-site
  redirect from broker).
- Ensure init and verify share the same `session_id`.

### 9.5 State expired (302 → `?status=expired`)

**Cause:** User took > 10 min to complete MitID authentication.

**Fix:**

- User-facing: restart flow.
- Do NOT extend TTL beyond 15 min — violates OWASP OIDC guidance.

### 9.6 Broker returns `access_denied`

**Cause:** User cancelled in MitID app, or age check failed.

**Fix:**

- Redirect to `/profile/verify?status=denied&reason=<broker_error>`.
- Do NOT upgrade `verification_tier`.
- Rate-limit retries to 3 per hour per session.

### 9.7 `PID collision` on UPDATE

**Cause:** Same `mitid_pid_hash` already bound to a different `profiles.id`
(user has two Cirkel accounts).

**Fix:**

- Reject with 409 Conflict.
- Prompt user via M07 Support flow to merge accounts.
- Log security event — could indicate account takeover attempt.

### 9.8 `no_active_broker_agreement`

**Cause:** DIGST agreement expired or suspended.

**Fix:**

- Module MUST fail-closed. Set feature flag `mitid.enabled = false`.
- Alert on-call via PagerDuty.
- All in-flight verifications complete but no new ones start.

---

## 10. Referencer

- DIGST broker rulebook v3 — <https://digst.dk/it-loesninger/mitid/>
- OIDC Core 1.0 — <https://openid.net/specs/openid-connect-core-1_0.html>
- RFC 7636 (PKCE) — <https://datatracker.ietf.org/doc/html/rfc7636>
- Signaturgruppen developer docs — internal Confluence `INFRA/MitID`
- M05 DPIA v0.1 — `docs/dpia/M05-identity.md`
- M03 Auth session model — `docs/module-refs/M03-auth.md`
- Hvidvaskloven § 30 — retention for identity records

---

_Last updated: 2026-07-22 — Owner: Platform / Trust & Safety_
