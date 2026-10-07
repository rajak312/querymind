/**
 * Simple in-memory sliding-window rate limiter, keyed by client IP.
 *
 * Good enough for a single-region demo: each serverless instance keeps its
 * own window, so the effective limit is per instance. For a multi-instance
 * production deployment swap this for a shared store (e.g. Upstash Redis).
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Hard cap on tracked keys so memory stays bounded. */
  maxKeys?: number;
}

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return function check(key: string, now = Date.now()): RateLimitResult {
    const windowStart = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

    if (recent.length >= limit) {
      hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }

    recent.push(now);
    hits.delete(key); // re-insert to keep Map order = least recently used first
    hits.set(key, recent);
    if (hits.size > maxKeys) {
      const oldestKey = hits.keys().next().value;
      if (oldestKey !== undefined) hits.delete(oldestKey);
    }
    return { ok: true, remaining: limit - recent.length, retryAfterSeconds: 0 };
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
