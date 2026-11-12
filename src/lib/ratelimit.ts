/** Fixed-window in-memory limiter, keyed by e.g. client IP. Fine for a single-process personal site. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    /** Returns true if the request is allowed. */
    allow(key: string): boolean {
      const t = now();
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
  };
}

/**
 * Counts only FAILURES per key. After `max` failures the key is locked until the window that started at the first
 * failure ends; a success clears the count. (Unlike createRateLimiter, a correct login never uses up attempts.)
 */
export function createFailureLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  const live = (key: string) => {
    const e = entries.get(key);
    if (e && e.resetAt <= now()) { entries.delete(key); return undefined; }
    return e;
  };
  return {
    isLocked: (key: string): boolean => (live(key)?.count ?? 0) >= max,
    /** Seconds until the lock ends (0 if not locked). */
    retryAfter: (key: string): number => {
      const e = live(key);
      return e && e.count >= max ? Math.ceil((e.resetAt - now()) / 1000) : 0;
    },
    /** Returns true if this failure just triggered the lock. */
    recordFailure(key: string): boolean {
      if (entries.size > 5000) for (const k of [...entries.keys()]) live(k);
      const e = live(key);
      if (e) { e.count += 1; return e.count === max; }
      entries.set(key, { count: 1, resetAt: now() + windowMs });
      return max === 1;
    },
    reset: (key: string): void => { entries.delete(key); },
  };
}

export const linkLimiter = createRateLimiter(60, 60_000);
/** 5 wrong tokens from one address locks login for that address for 15 minutes. */
export const loginFailures = createFailureLimiter(5, 15 * 60_000);
/** 10 wrong /metrics tokens from one address locks that address out of /metrics for 15 minutes. */
export const metricsFailures = createFailureLimiter(10, 15 * 60_000);

/** Client key for rate limiting. Only trusts X-Forwarded-For when TRUST_PROXY=1 (i.e. behind your own reverse proxy). */
export function clientKey(request: Request, fallback: string): string {
  if (process.env.TRUST_PROXY === '1') {
    const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
  }
  return fallback;
}
