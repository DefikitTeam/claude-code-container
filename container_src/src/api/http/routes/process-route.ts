import { logWithContext } from '../utils/logger.js';
import { jsonResponse } from '../utils/responses.js';
import { readRequestBody, parseJsonBody } from '../utils/body.js';
import type { Router } from '../router.js';

interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
  pullRequestUrl?: string;
  logs?: string[];
}

export function registerProcessRoute(router: Router): void {
  router.register('POST', '/process', async (ctx) => {
    logWithContext('PROCESS', 'Process request received', {
      requestId: ctx.requestId,
    });

    let payload: Record<string, unknown>;
    try {
      const raw = await readRequestBody(ctx.req);
      payload = parseJsonBody<Record<string, unknown>>(raw);
    } catch (error) {
      logWithContext('PROCESS', 'Invalid JSON in request body', {
        requestId: ctx.requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      jsonResponse(ctx.res, 400, {
        success: false,
        message: 'Invalid JSON in request body',
      });
      return;
    }

    const response: ContainerResponse = {
      success: true,
      message: 'Request processed successfully',
      logs: [
        `Processed request of type: ${
          typeof payload.type === 'string' ? payload.type : 'unknown'
        }`,
      ],
    };

    logWithContext('PROCESS', 'Request processed successfully', {
      requestId: ctx.requestId,
      type: payload.type,
    });

    jsonResponse(ctx.res, 200, response);
  });
}
