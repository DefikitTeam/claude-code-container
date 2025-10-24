import type { Context } from 'hono';
import { BaseError } from '../../shared/errors/base.error';
import { ValidationError } from '../../shared/errors/validation.error';
import { NotFoundError } from '../../shared/errors/not-found.error';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error';
import type { ApiResponse } from '../../shared/types/common.types';

const DEFAULT_STATUS = 500;

export function errorResponse(
  c: Context,
  error: unknown,
  statusOverride?: number,
): Response {
  const normalized = normalizeError(error);
  const status = statusOverride ?? normalized.statusCode ?? DEFAULT_STATUS;

  const payload: ApiResponse<null> = {
    success: false,
    error: {
      code: normalized.code ?? 'INTERNAL_ERROR',
      message: normalized.message ?? 'Unexpected error',
      details: normalized.details,
    },
    timestamp: Date.now(),
    requestId: safeGetRequestId(c),
  };

  return c.json(payload, status as any);
}

function normalizeError(error: unknown): BaseError {
  if (error instanceof BaseError) {
    return error;
  }

  if (error instanceof ValidationError) {
    return error;
  }

  if (error instanceof NotFoundError) {
    return error;
  }

  if (error instanceof UnauthorizedError) {
    return error;
  }

  const fallback = new BaseError(
    error instanceof Error ? error.message : 'Unknown error',
    'INTERNAL_ERROR',
    DEFAULT_STATUS,
  );

  return fallback;
}

function safeGetRequestId(c: Context): string | undefined {
  try {
    return c.get('requestId');
  } catch {
    return undefined;
  }
}
