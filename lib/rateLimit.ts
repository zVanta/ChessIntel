/**
 * Minimal in-memory rate limiter for authentication endpoints.
 *
 * Keys are strings (e.g. "login:user@example.com"). Entries reset after the
 * window elapses. This is per-process, which is fine for the single-instance
 * Docker deployment; put a real limiter (e.g. Redis) in front if you scale out.
 */

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

export function rateLimited(
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (entry.count >= max) return true;
  entry.count += 1;
  return false;
}

// Best-effort cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 1000 * 60 * 10);
