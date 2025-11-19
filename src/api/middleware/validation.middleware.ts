import type { MiddlewareHandler } from 'hono';
import { ValidationError } from '../../shared/errors/validation.error';

export function requireJsonBody(): MiddlewareHandler {
  return async (c, next) => {
    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new ValidationError('Content-Type must be application/json');
    }

    await next();
  };
}

export function requireInstallationHeaders(): MiddlewareHandler {
  return async (c, next) => {
    const installationId = c.req.header('x-installation-id');
    if (!installationId) {
      throw new ValidationError('x-installation-id header is required');
    }

    await next();
  };
}

export function attachRequestContext(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = safeRandomId();
    c.set('requestId', requestId);
    await next();
  };
}

function safeRandomId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
