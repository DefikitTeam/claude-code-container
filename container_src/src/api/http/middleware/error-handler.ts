import { jsonResponse } from '../utils/responses.js';
import { logWithContext } from '../utils/logger.js';
import type { Middleware } from '../types.js';

export const errorHandlingMiddleware: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    const statusCode =
      (error as { statusCode?: number })?.statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'unknown_error';
    const detail = (error as { detail?: unknown })?.detail;

    logWithContext('HTTP', 'Unhandled error', {
      requestId: ctx.requestId,
      statusCode,
      message,
      detail,
    });

    jsonResponse(ctx.res, statusCode, {
      success: false,
      message,
      error: detail ?? message,
    });
  }
};
