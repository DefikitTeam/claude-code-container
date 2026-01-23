import http from 'node:http';
import { Router } from './router.js';
import { loggingMiddleware } from './middleware/logging.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandlingMiddleware } from './middleware/error-handler.js';
import { registerHealthRoute } from './routes/health-route.js';
import { registerProcessRoute } from './routes/process-route.js';
import { registerProcessPromptRoute } from './routes/process-prompt-route.js';
import { registerAcpRoutes } from './routes/acp-route.js';
import { logWithContext } from './utils/logger.js';
import type {
  HttpContext,
  Middleware,
  NextFunction,
  HttpMethod,
} from './types.js';

const DEFAULT_PORT = parseInt(process.env.PORT || '8080', 10);

export interface RunHttpServerOptions {
  port?: number;
}

export function createHttpServer(): http.Server {
  const router = new Router();
  registerHealthRoute(router);
  registerProcessRoute(router);
  registerProcessPromptRoute(router);
  registerAcpRoutes(router);

  const middlewares: Middleware[] = [
    errorHandlingMiddleware,
    loggingMiddleware,
    corsMiddleware,
  ];

  const handler = compose(middlewares, async (ctx) => {
    await router.dispatch(ctx);
  });

  return http.createServer(async (req, res) => {
    console.error(`[CONTAINER-HTTP] ========================================`);
    console.error(`[CONTAINER-HTTP] Received: ${req.method} ${req.url}`);
    console.error(`[CONTAINER-HTTP] Time: ${new Date().toISOString()}`);
    const context = buildContext(req, res);
    try {
      await handler(context);
      console.error(`[CONTAINER-HTTP] Completed: ${req.method} ${req.url}`);
    } catch (err) {
      console.error(
        `[CONTAINER-HTTP] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  });
}

export async function runHttpServer(
  argv: Record<string, unknown> = {},
): Promise<void> {
  const port = Number(argv.port) || DEFAULT_PORT;
  const server = createHttpServer();

  logWithContext('SERVER', 'Build info', {
    buildSha: process.env.BUILD_SHA || null,
    buildTime: process.env.BUILD_TIME || null,
    nodeVersion: process.version,
  });

  logWithContext('SERVER', `Starting HTTP Server on port ${port}`);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      logWithContext(
        'SERVER',
        `HTTP server listening on http://0.0.0.0:${port}`,
      );
      logWithContext('SERVER', 'Routes registered', {
        routes: [
          'GET /health',
          'POST /process',
          'POST /process-prompt',
          'POST /acp',
        ],
      });
      resolve();
    });
    server.on('error', reject);
  });

  const shutdown = (signal: string) => {
    logWithContext('SERVER', `Received ${signal}, shutting down`);
    server.close(() => {
      logWithContext('SERVER', 'HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function buildContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): HttpContext {
  const method = (req.method || 'GET').toUpperCase() as HttpMethod;
  const originalUrl = req.url || '/';
  const requestUrl = new URL(originalUrl, 'http://localhost');

  return {
    req,
    res,
    method,
    url: requestUrl.href,
    path: requestUrl.pathname.replace(/\/$/, '') || '/',
    query: requestUrl.searchParams,
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    startTime: Date.now(),
  };
}

function compose(
  middlewares: Middleware[],
  terminal: (ctx: HttpContext) => Promise<void>,
) {
  return async (ctx: HttpContext): Promise<void> => {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;
      const fn = middlewares[i];
      if (!fn) {
        await terminal(ctx);
        return;
      }
      await fn(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
}
