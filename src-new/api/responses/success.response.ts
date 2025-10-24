import type { Context } from 'hono';
import type { ApiResponse } from '../../shared/types/common.types';

export function successResponse<T>(
  c: Context,
  data: T,
  status: number = 200,
): Response {
  const payload: ApiResponse<T> = {
    success: true,
    data,
    timestamp: Date.now(),
    requestId: safeGetRequestId(c),
  };

  return c.json(payload, status as any);
}

export function createdResponse<T>(c: Context, data: T): Response {
  return successResponse(c, data, 201);
}

function safeGetRequestId(c: Context): string | undefined {
  try {
    return c.get('requestId');
  } catch {
    return undefined;
  }
}
