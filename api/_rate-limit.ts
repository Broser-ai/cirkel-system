/**
 * In-memory rate-limiter for Vercel serverless functions.
 *
 * Sliding-window algorithm backed by an LRU map capped at MAX_ENTRIES.
 * Zero external dependencies. Fully typed.
 *
 * NOTE: State is per-instance. Vercel may run multiple concurrent lambda
 * instances, so effective limits are `max_requests * instanceCount`.
 * For strict global limits, back this with Redis/Upstash.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal request shape we need. Compatible with VercelRequest, Next.js
 * NextApiRequest, and node http.IncomingMessage without importing them.
 */
export interface RateLimitRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  url?: string;
  method?: string;
}

export interface RateLimitOpts {
  /** Extract a stable identity for the caller (user id, ip, api-key, ...). */
  key_extractor: (req: RateLimitRequest) => string;
  /** Rolling window length in milliseconds. */
  window_ms: number;
  /** Maximum number of requests allowed within the window. */
  max_requests: number;
}

export interface RateLimitResult {
  /** True if the request is within the limit. */
  allow: boolean;
  /** Remaining requests in the current window (never negative). */
  remaining: number;
  /**
   * Epoch milliseconds at which the oldest request in the window will drop
   * off, freeing capacity. When `allow === true` this is when the window
   * fully resets (i.e. `now + window_ms`).
   */
  reset_at: number;
}

export interface RateLimiter {
  /** Evaluate a request against the limiter. */
  check: (req: RateLimitRequest) => Promise<RateLimitResult>;
  /** Build HTTP headers describing the result. */
  headers: (result: RateLimitResult) => Record<string, string>;
  /** Config snapshot (mainly for tests/introspection). */
  readonly limit: number;
  readonly window_ms: number;
}

// ---------------------------------------------------------------------------
// Internal LRU map
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10_000;

/**
 * Very small LRU built on the insertion-order guarantee of `Map`.
 * On get/set, the key is re-inserted so it becomes "most recently used".
 * When size exceeds `max`, the oldest key is evicted.
 */
class LRU<K, V> {
  private readonly store: Map<K, V> = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    // Re-insert to mark as recently used.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // Evict oldest entry (first key in insertion order).
      const oldest: K | undefined = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, value);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a rate-limiter with a private in-memory store.
 * Returns an object exposing `.check(req)` (the async evaluator) and
 * `.headers(result)` (X-RateLimit-* headers builder).
 *
 * Despite being synchronous internally, `check` is Promise-returning so
 * callers can swap in a Redis-backed implementation without API changes.
 */
export function createRateLimiter(opts: RateLimitOpts): RateLimiter {
  const { key_extractor, window_ms, max_requests } = opts;

  if (window_ms <= 0) {
    throw new Error("createRateLimiter: window_ms must be > 0");
  }
  if (max_requests <= 0) {
    throw new Error("createRateLimiter: max_requests must be > 0");
  }

  // For each key we store the timestamps (ms) of recent requests, oldest
  // first. Timestamps outside the current window are pruned on access.
  const buckets: LRU<string, number[]> = new LRU<string, number[]>(MAX_ENTRIES);

  const check = async (req: RateLimitRequest): Promise<RateLimitResult> => {
    const now: number = Date.now();
    const key: string = key_extractor(req);
    const window_start: number = now - window_ms;

    const previous: number[] = buckets.get(key) ?? [];

    // Drop stale timestamps (sliding window).
    let firstFresh = 0;
    while (firstFresh < previous.length && previous[firstFresh] <= window_start) {
      firstFresh++;
    }
    const fresh: number[] =
      firstFresh === 0 ? previous : previous.slice(firstFresh);

    if (fresh.length >= max_requests) {
      // Blocked. `reset_at` is when the oldest fresh request expires.
      const oldest: number = fresh[0];
      const reset_at: number = oldest + window_ms;
      // Persist the pruned bucket back so we don't re-scan next time.
      buckets.set(key, fresh);
      return {
        allow: false,
        remaining: 0,
        reset_at,
      };
    }

    // Allowed. Record this hit.
    fresh.push(now);
    buckets.set(key, fresh);

    const remaining: number = max_requests - fresh.length;
    const reset_at: number = now + window_ms;

    return {
      allow: true,
      remaining,
      reset_at,
    };
  };

  const headers = (result: RateLimitResult): Record<string, string> => {
    const built: Record<string, string> = {
      "X-RateLimit-Limit": String(max_requests),
      "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
      "X-RateLimit-Reset": String(Math.ceil(result.reset_at / 1000)),
    };
    if (!result.allow) {
      const retryAfterSec: number = Math.max(
        1,
        Math.ceil((result.reset_at - Date.now()) / 1000),
      );
      built["Retry-After"] = String(retryAfterSec);
    }
    return built;
  };

  return {
    check,
    headers,
    limit: max_requests,
    window_ms,
  };
}

// ---------------------------------------------------------------------------
// Key extractors
// ---------------------------------------------------------------------------

/** Read the first value of a possibly-multi-valued header. */
function firstHeader(
  headers: RateLimitRequest["headers"],
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Extract the client IP, preferring `x-forwarded-for` (Vercel edge), then
 * `x-real-ip`, then the socket. Falls back to `"unknown"` when nothing is
 * available so we still bucket rather than throw.
 */
export function extractIp(req: RateLimitRequest): string {
  const forwarded = firstHeader(req.headers, "x-forwarded-for");
  if (forwarded !== undefined && forwarded.length > 0) {
    // The forwarded header can be a comma-separated list; use the first.
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }

  const realIp = firstHeader(req.headers, "x-real-ip");
  if (realIp !== undefined && realIp.length > 0) return realIp;

  const socketIp = req.socket?.remoteAddress ?? req.connection?.remoteAddress;
  if (socketIp !== undefined && socketIp.length > 0) return socketIp;

  return "unknown";
}

/**
 * Extract a user id from a decoded auth header. Uses the `x-user-id`
 * header if present (set by the token verifier), otherwise falls back to
 * the IP so unauthenticated calls still get rate-limited.
 */
export function extractUserOrIp(req: RateLimitRequest): string {
  const userId = firstHeader(req.headers, "x-user-id");
  if (userId !== undefined && userId.length > 0) return `u:${userId}`;
  return `ip:${extractIp(req)}`;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const ONE_MINUTE_MS = 60_000;

/** Vision scans: 10 requests per minute per user. */
export const SCAN_LIMITER: RateLimiter = createRateLimiter({
  key_extractor: extractUserOrIp,
  window_ms: ONE_MINUTE_MS,
  max_requests: 10,
});

/** Chat / LLM calls: 30 requests per minute per user. */
export const CHAT_LIMITER: RateLimiter = createRateLimiter({
  key_extractor: extractUserOrIp,
  window_ms: ONE_MINUTE_MS,
  max_requests: 30,
});

/** Uploads: 5 requests per minute per user. */
export const UPLOAD_LIMITER: RateLimiter = createRateLimiter({
  key_extractor: extractUserOrIp,
  window_ms: ONE_MINUTE_MS,
  max_requests: 5,
});

/** Public / unauthenticated API: 100 requests per minute per IP. */
export const PUBLIC_API_LIMITER: RateLimiter = createRateLimiter({
  key_extractor: (req) => `ip:${extractIp(req)}`,
  window_ms: ONE_MINUTE_MS,
  max_requests: 100,
});
