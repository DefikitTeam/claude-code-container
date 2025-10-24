import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error';
import { validateInstallationId } from '../../shared/utils/validation.util';

export interface AuthContextVariables {
  requestId: string;
  installationId?: string;
  userId?: string;
}

export function requireInstallationHeaders(): MiddlewareHandler {
  return async (c, next) => {
    const installationId = c.req.header('x-installation-id');
    const userId = c.req.header('x-user-id');

    if (!installationId) {
      throw UnauthorizedError.missingToken();
    }

    validateInstallationId(installationId.trim());

    c.set('installationId', installationId.trim());

    if (userId) {
      c.set('userId', userId.trim());
    }

    await next();
  };
}
