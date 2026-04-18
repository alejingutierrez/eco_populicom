// Simple token-bucket rate limiter keyed by client IP for API routes.
// In-memory; acceptable for single-task ECS service + short windows. For
// multi-task horizontal scaling switch to Redis (Upstash/ElastiCache).

interface Bucket { tokens: number; updated: number }

const buckets = new Map<string, Bucket>();

interface Options { limit: number; windowMs: number }

export function consume(key: string, opts: Options): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  const refillRate = opts.limit / opts.windowMs; // tokens per ms
  if (!b) {
    buckets.set(key, { tokens: opts.limit - 1, updated: now });
    return { ok: true, retryAfter: 0 };
  }
  const elapsed = now - b.updated;
  b.tokens = Math.min(opts.limit, b.tokens + elapsed * refillRate);
  b.updated = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, retryAfter: 0 };
  }
  const retryAfter = Math.ceil((1 - b.tokens) / refillRate);
  return { ok: false, retryAfter };
}

export function clientKey(request: Request): string {
  // Trust ALB-forwarded IP when present; fall back to remote connection.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
