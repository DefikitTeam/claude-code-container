import { logWithContext } from '../utils/logger.js';
import type { Middleware } from '../types.js';

export const loggingMiddleware: Middleware = async (ctx, next) => {
  const { method, path, requestId } = ctx;
  logWithContext('HTTP', 'Request received', { method, path, requestId });
  const start = Date.now();

  try {
    await next();
    const duration = Date.now() - start;
    logWithContext('HTTP', 'Request completed', {
      method,
      path,
      requestId,
      statusCode: ctx.res.statusCode,
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - start;
    logWithContext('HTTP', 'Request failed', {
      method,
      path,
      requestId,
      durationMs: duration,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
