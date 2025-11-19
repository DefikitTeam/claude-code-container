/**
 * UnauthorizedError - Error thrown when authentication/authorization fails
 * HTTP Status: 401 Unauthorized or 403 Forbidden
 */

import { BaseError } from './base.error';

export type UnauthorizedErrorType =
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'TOKEN_EXPIRED';

export class UnauthorizedError extends BaseError {
  public readonly errorType: UnauthorizedErrorType;
  public readonly requiredPermission?: string;

  constructor(
    message: string,
    errorType: UnauthorizedErrorType = 'AUTHENTICATION',
    requiredPermission?: string,
    statusCode: number = 401,
    details?: Record<string, unknown>,
  ) {
    super(
      message,
      'UNAUTHORIZED_ERROR',
      statusCode,
      { errorType, requiredPermission, ...details },
      true, // operational error - safe to expose
    );

    this.errorType = errorType;
    this.requiredPermission = requiredPermission;
  }

  /**
   * Factory methods for common authorization errors
   */
  static authentication(message?: string): UnauthorizedError {
    return new UnauthorizedError(
      message || 'Authentication failed. Please provide valid credentials.',
      'AUTHENTICATION',
    );
  }

  static missingToken(): UnauthorizedError {
    return new UnauthorizedError(
      'Missing or invalid authentication token',
      'AUTHENTICATION',
    );
  }

  static tokenExpired(): UnauthorizedError {
    return new UnauthorizedError(
      'Authentication token has expired',
      'TOKEN_EXPIRED',
    );
  }

  static insufficientPermissions(
    permission: string,
    resource?: string,
  ): UnauthorizedError {
    const message = resource
      ? `Insufficient permissions to access ${resource}. Required: ${permission}`
      : `Insufficient permissions. Required: ${permission}`;

    return new UnauthorizedError(message, 'AUTHORIZATION', permission, 403);
  }

  static forbidden(message?: string): UnauthorizedError {
    return new UnauthorizedError(
      message || 'Access denied',
      'AUTHORIZATION',
      undefined,
      403,
    );
  }

  static invalidApiKey(): UnauthorizedError {
    return new UnauthorizedError('Invalid API key provided', 'AUTHENTICATION');
  }
}
