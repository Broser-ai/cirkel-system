# Upstash Redis Setup — Cirkel Production Rate-Limit

Guide til at flytte Cirkel's rate-limit fra in-memory (per-instance, resettes ved cold-start) til Upstash Redis (globalt, serverless-venligt, EU-region).

**Status:** Skitse — kør refactor i `preview`-branch før merge til `main`.
**Ejer:** Michael / Cirkel backend team
**Sidst opdateret:** 2026-07-22

---

## 1. Opret Upstash-konto og Redis-database

### 1.1 Signup
1. Gå til <https://console.upstash.com/> og sign up med GitHub eller Google (brug `ma@keap.me` / arbejds-Google).
2. Aktivér 2FA under **Account Settings → Security** (obligatorisk for produktions-secrets).

### 1.2 Opret database
1. Klik **Create Database** i konsollen.
2. Udfyld:
   - **Name:** `cirkel-prod-ratelimit`
   - **Type:** `Regional` (billigere end Global; vi kører kun EU-preview + EU-prod på Vercel)
   - **Region:** `eu-west-1` (Ireland) — samme region som Vercel EU deployment for laveste round-trip
   - **TLS:** Enabled (default, lad stå)
   - **Eviction:** `allkeys-lru` (rate-limit keys må gerne evictes hvis vi rammer memory-loft)
3. Klik **Create**.

### 1.3 Opret separat database for `preview`
Gentag ovenstående med `Name: cirkel-preview-ratelimit`. Del ALDRIG én database mellem preview og prod — preview-trafik kan spike og udmatte prod-quota.

---

## 2. Env-vars

Upstash Redis rammes via **REST API** fra Vercel serverless functions (ikke TCP — TCP-connection-pooling er upålidelig i serverless).

### 2.1 Fra Upstash-konsollen
På din database-side, scroll til **REST API** sektionen og kopiér:
- `UPSTASH_REDIS_REST_URL` — fx `https://eu1-cirkel-prod-ratelimit-12345.upstash.io`
- `UPSTASH_REDIS_REST_TOKEN` — langt base64-lignende token (read+write)

### 2.2 Tilføj til Vercel
```bash
# Production
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production

# Preview
vercel env add UPSTASH_REDIS_REST_URL preview
vercel env add UPSTASH_REDIS_REST_TOKEN preview
```

Verificér:
```bash
vercel env ls
```

### 2.3 Local development
Tilføj til `.env.local` (som IKKE er i git):
```
UPSTASH_REDIS_REST_URL=https://eu1-cirkel-preview-ratelimit-XXXXX.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXXX...
```

Peg lokal dev mod `preview`-databasen — aldrig prod.

---

## 3. Refactor `api/_rate-limit.ts`

### 3.1 Installér SDK
```bash
npm install @upstash/redis @upstash/ratelimit
```

Begge er edge-runtime-kompatible og bruger `fetch()` under motorhjelmen.

### 3.2 Kode-skitse

**Før** (in-memory, per-instance):
```ts
// api/_rate-limit.ts (OLD)
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  if (bucket.count >= limit) return { allowed: false, remaining: 0 };
  bucket.count++;
  return { allowed: true, remaining: limit - bucket.count };
}
```

**Efter** (Upstash, distributed):
```ts
// api/_rate-limit.ts (NEW)
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Singleton — genbrug clienten på tværs af invocations i samme instans
let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[rate-limit] Upstash env vars missing — fallback active');
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

// Én ratelimiter per (limit, window) — cache på modulniveau
const limiters = new Map<string, Ratelimit>();
function getLimiter(limit: number, windowSec: number): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const key = `${limit}:${windowSec}`;
  let l = limiters.get(key);
  if (!l) {
    l = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      analytics: true,          // gratis dashboard i Upstash-konsollen
      prefix: 'cirkel:rl',
    });
    limiters.set(key, l);
  }
  return l;
}

export async function checkRateLimit(
  identifier: string,       // fx `ip:1.2.3.4` eller `user:uuid`
  limit: number,
  windowSec: number,
): Promise<{ allowed: boolean; remaining: number; reset: number; source: 'upstash' | 'fallback' }> {
  const limiter = getLimiter(limit, windowSec);

  // FALLBACK — se sektion 5
  if (!limiter) {
    console.warn('[rate-limit] fallback: allowing request', { identifier });
    return { allowed: true, remaining: limit, reset: Date.now() + windowSec * 1000, source: 'fallback' };
  }

  try {
    const { success, remaining, reset } = await limiter.limit(identifier);
    return { allowed: success, remaining, reset, source: 'upstash' };
  } catch (err) {
    console.error('[rate-limit] Upstash error, allowing request', err);
    // Sentry-alert her — se sektion 6
    return { allowed: true, remaining: limit, reset: Date.now() + windowSec * 1000, source: 'fallback' };
  }
}
```

### 3.3 Opdater call-sites
Alle `checkRateLimit(...)`-kald skal nu `await` returværdien. Grep repo:
```bash
grep -rn "checkRateLimit(" api/ src/
```
Wrap i `async` handlers og sæt response headers:
```ts
const rl = await checkRateLimit(`ip:${clientIp}`, 60, 60);
res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
res.setHeader('X-RateLimit-Reset', String(rl.reset));
if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
```

---

## 4. Cost-estimering

Upstash pricing (per 2026-07, verificér på <https://upstash.com/pricing>):

| Tier | Commands/day | Storage | Månedspris |
|---|---|---|---|
| **Free** | 10.000 | 256 MB | $0 |
| **Pay-as-you-go** | Ubegrænset | 1 GB inkl. | $0.20 per 100K commands + $0.25/GB storage |
| **Fixed 250K** | 250.000/dag | 1 GB | $10/md |
| **Fixed 1M** | 1.000.000/dag | 5 GB | $60/md |

### 4.1 Cirkel forbrug (estimeret)

Hver rate-limit-check = **2 Redis-commands** (INCR + EXPIRE via sliding-window algoritmen; faktisk 3-5 for sliding-window præcis).

**Antagelser:**
- 500 aktive brugere/dag
- 40 requests/bruger/dag der rammer rate-limited endpoints
- = 20.000 checks/dag × ~4 commands = **~80.000 commands/dag**

**Konklusion:**
- Free-tier (10K/dag) er ikke nok — vi rammer loftet efter ~1.250 brugere.
- **Pay-as-you-go**: 80K/dag × 30 = 2.4M commands/md × $0.20/100K = **~$4.80/md** ved nuværende volumen.
- Ved 10× vækst (5.000 brugere): ~$48/md — overvej **Fixed 1M** ($60/md) for forudsigelighed.

### 4.2 Anbefaling
- **Start:** Pay-as-you-go (skal-op-uden-friktion)
- **Migration threshold:** Skift til Fixed 1M når daglig burn > $2/dag (60M commands/md-projekteret)

---

## 5. Fallback-strategi (Upstash down)

Rate-limit må **aldrig** blokere Cirkel — det er en beskyttelses-mekanisme, ikke en business-critical path.

### 5.1 Politik: `fail-open with warning`
Hvis Upstash returnerer fejl eller timeout:
1. **Tillad requesten** (returnér `{ allowed: true, source: 'fallback' }`)
2. **Log som WARN** til stdout (Vercel logs)
3. **Send Sentry-alert** (se 6.2)
4. **Increment intern counter** for dashboard-visibility

### 5.2 Implementering
Allerede indbygget i skitsen i 3.2 — se `try/catch` og `getRedis() → null` grenene.

### 5.3 Timeout
Upstash SDK har ingen indbygget timeout — wrap manuelt hvis nødvendigt:
```ts
const timeoutMs = 500; // hurtig fail — bedre at fail-open end at holde requesten
const result = await Promise.race([
  limiter.limit(identifier),
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error('upstash_timeout')), timeoutMs)),
]);
```

### 5.4 Ikke fail-closed
Vi bruger **IKKE** fail-closed (afvis alle requests hvis Redis er nede) fordi:
- Upstash SLA er 99.99% men enkelte incidents rammer ~15-30 min
- Fail-closed = total outage af Cirkel under Upstash-nedbrud
- Rate-limit-bypass i 30 min er acceptabelt trade-off (worst case: nogle få brugere ser høj traffic; ingen data-integritetsrisiko)

---

## 6. Monitoring

### 6.1 Upstash-dashboard
Adgang: <https://console.upstash.com/> → vælg database → **Details** tab

Se:
- **Commands/sec** — realtime throughput
- **Latency (p50/p99)** — bør være <20ms fra Vercel EU
- **Analytics** — top identifiers (kræver `analytics: true` i Ratelimit-config, se 3.2)
- **Bandwidth** — storage-forbrug

Bookmark: opsæt browser-tab som "Cirkel Upstash" i teamets shared bookmarks.

### 6.2 Sentry-alerts
Vi bruger allerede Sentry (`@sentry/nextjs`). Tilføj:

**a) Fejl-tracking i rate-limit fallback:**
```ts
// api/_rate-limit.ts — i catch-blokken
import * as Sentry from '@sentry/nextjs';
// ...
} catch (err) {
  Sentry.captureException(err, {
    tags: { subsystem: 'rate-limit', fallback: 'triggered' },
    extra: { identifier, limit, windowSec },
  });
  console.error('[rate-limit] Upstash error, allowing request', err);
  return { allowed: true, remaining: limit, reset: Date.now() + windowSec * 1000, source: 'fallback' };
}
```

**b) Alert-regel i Sentry (Settings → Alerts → Create Alert):**
- **Trigger:** `event.tags.subsystem == "rate-limit"` AND `event.count > 10 in 5 minutes`
- **Notify:** Slack `#cirkel-alerts` + email `ma@keap.me`
- **Beskrivelse:** "Upstash Redis rate-limit fallback engaged >10 gange på 5 min — undersøg Upstash status"

**c) Upstash status page:**
Følg <https://status.upstash.com/> — abonnér via email eller Slack-integration.

### 6.3 Custom metrics (optional)
Hvis Cirkel senere får Prometheus / Grafana, expose:
- `cirkel_ratelimit_checks_total{result="allowed|blocked|fallback"}`
- `cirkel_ratelimit_latency_seconds` (histogram)

Foreløbig er Vercel-logs + Sentry + Upstash-dashboard tilstrækkeligt.

---

## 7. Rollout-plan

1. **Uge 1:** Opret Upstash `preview`-database + refactor kode i feature branch `chore/upstash-ratelimit`
2. **Uge 1:** Deploy til Vercel preview, kør load-test (200 rps i 5 min mod `/api/*`)
3. **Uge 2:** Opret Upstash `prod`-database, tilføj prod env-vars
4. **Uge 2:** Merge til `main`, verificér Sentry er ren de første 24 timer
5. **Uge 3:** Fjern gammel in-memory kode + tilhørende tests
6. **Uge 4:** Første cost-review — beslut om vi skifter tier

---

## 8. Rollback

Hvis Upstash-integration fejler i prod:

```bash
# 1. Revert commit
git revert <upstash-refactor-sha>
git push origin main

# 2. Vercel auto-deployer — ~2 min til rollback er live

# 3. Fjern env-vars først når rollback er verificeret (behold dem i case vi retryer)
```

In-memory-varianten (gamle kode) fungerer fint som fallback — den mangler bare global koordinering på tværs af Vercel-regioner/instanser.

---

## Referencer

- Upstash Redis docs: <https://upstash.com/docs/redis/overall/getstarted>
- `@upstash/ratelimit` SDK: <https://github.com/upstash/ratelimit-js>
- Vercel + Upstash guide: <https://vercel.com/integrations/upstash>
- Cirkel rate-limit policy: se `docs/CIRKEL-EVERYTHING-v3.md` sektion "Security → API throttling"
