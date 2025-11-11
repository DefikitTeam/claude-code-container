import type { RouteHandler, HttpMethod, HttpContext } from './types.js';

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

export class Router {
  private readonly routes: RouteDefinition[] = [];

  register(method: HttpMethod, path: string, handler: RouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  async dispatch(ctx: HttpContext): Promise<void> {
    const route = this.routes.find(
      (candidate) =>
        candidate.method === ctx.method && normalize(candidate.path) === ctx.path,
    );

    if (!route) {
      throw Object.assign(new Error('route_not_found'), {
        statusCode: 404,
        detail: { method: ctx.method, path: ctx.path },
      });
    }

    await route.handler(ctx);
  }
}

function normalize(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}
