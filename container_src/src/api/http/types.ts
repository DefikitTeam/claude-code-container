import type * as http from 'http';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';

export interface HttpContext {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly method: HttpMethod;
  readonly url: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly requestId: string;
  readonly startTime: number;
}

export type NextFunction = () => Promise<void>;

export type Middleware = (
  ctx: HttpContext,
  next: NextFunction,
) => Promise<void>;

export type RouteHandler = (ctx: HttpContext) => Promise<void>;
