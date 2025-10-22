/**
 * Common utility types
 */

/**
 * Generic paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: number;
}

/**
 * Generic request/response metadata
 */
export interface RequestMetadata {
  requestId: string;
  timestamp: number;
  userId?: string;
  installationId?: string;
  userAgent?: string;
}

/**
 * Result type for operations that might fail
 */
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Async result helper
 */
export async function ok<T>(value: T): Promise<Result<T>> {
  return { success: true, value };
}

export async function err<E>(error: E): Promise<Result<never, E>> {
  return { success: false, error };
}
