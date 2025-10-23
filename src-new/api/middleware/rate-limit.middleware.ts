import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error';

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

interface RateLimitState {
  count: number;
  expiresAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 120;

export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const store = new Map<string, RateLimitState>();

  return async (c, next) => {
    const key = getClientKey(c);
    const now = Date.now();
    const state = store.get(key);

    if (state && state.expiresAt > now) {
      if (state.count >= maxRequests) {
        const retryAfter = Math.ceil((state.expiresAt - now) / 1000);
        throw UnauthorizedError.forbidden(`Rate limit exceeded. Retry after ${retryAfter}s`);
      }
      state.count += 1;
    } else {
      store.set(key, { count: 1, expiresAt: now + windowMs });
    }

    await next();
  };
}

function getClientKey(c: Parameters<MiddlewareHandler>[0]): string {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for');
  if (ip) {
    return ip;
  }

  // Fallback to user-agent to avoid unbounded growth
  return c.req.header('user-agent') ?? 'anonymous';
}
