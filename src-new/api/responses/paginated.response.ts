import type { Context } from 'hono';
import type { PaginatedResponse } from '../../shared/types/common.types';
import { successResponse } from './success.response';

export function paginatedResponse<T>(
  c: Context,
  items: T[],
  total: number,
  page: number,
  limit: number,
): Response {
  const payload: PaginatedResponse<T> = {
    items,
    total,
    page,
    limit,
    hasMore: total > page * limit,
  };

  return successResponse(c, payload);
}
