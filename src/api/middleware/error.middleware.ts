import type { Hono } from 'hono';
import { BaseError } from '../../shared/errors/base.error';
import { errorResponse } from '../responses/error.response';

export function registerErrorMiddleware(app: Hono): void {
  app.onError((err, c) => {
    if (err instanceof BaseError) {
      return errorResponse(c, err, err.statusCode);
    }

    console.error('Unhandled error', err);
    return errorResponse(c, err);
  });

  app.notFound((c) => errorResponse(c, new BaseError('Route not found', 'NOT_FOUND', 404)));
}
