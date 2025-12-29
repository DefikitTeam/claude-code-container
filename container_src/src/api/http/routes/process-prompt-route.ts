/**
 * Process Prompt Route
 * Handles POST /process-prompt for persistent branch commits
 */

import { logWithContext } from '../utils/logger.js';
import { jsonResponse } from '../utils/responses.js';
import { readRequestBody, parseJsonBody } from '../utils/body.js';
import { getRuntimeServices } from '../../../config/runtime-services.js';
import type { Router } from '../router.js';
import type {
  ProcessPromptRequest,
  ProcessPromptResult,
} from '../../../services/process-prompt.service.js';

export function registerProcessPromptRoute(router: Router): void {
  router.register('POST', '/process-prompt', async (ctx) => {
    logWithContext('PROCESS-PROMPT-ROUTE', 'Process prompt request received', {
      requestId: ctx.requestId,
    });

    let payload: ProcessPromptRequest;
    try {
      const raw = await readRequestBody(ctx.req);
      payload = parseJsonBody<ProcessPromptRequest>(raw);
    } catch (error) {
      logWithContext('PROCESS-PROMPT-ROUTE', 'Invalid JSON in request body', {
        requestId: ctx.requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      jsonResponse(ctx.res, 400, {
        success: false,
        error: 'Invalid JSON in request body',
      });
      return;
    }

    // Validate required fields
    const validationError = validateRequest(payload);
    if (validationError) {
      logWithContext('PROCESS-PROMPT-ROUTE', 'Validation failed', {
        requestId: ctx.requestId,
        error: validationError,
      });

      jsonResponse(ctx.res, 400, {
        success: false,
        error: validationError,
      });
      return;
    }

    try {
      // Get service instance from runtime services
      const { processPromptService } = getRuntimeServices();

      // Execute prompt processing
      const result: ProcessPromptResult = await processPromptService.execute(payload);

      logWithContext('PROCESS-PROMPT-ROUTE', 'Request processed successfully', {
        requestId: ctx.requestId,
        sessionId: payload.sessionId,
        commitSha: result.commitSha.substring(0, 7),
        filesChanged: result.filesChanged.length,
      });

      jsonResponse(ctx.res, 200, {
        success: true,
        ...result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logWithContext('PROCESS-PROMPT-ROUTE', 'Error processing prompt', {
        requestId: ctx.requestId,
        error: errorMessage,
      });

      jsonResponse(ctx.res, 500, {
        success: false,
        error: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined,
      });
    }
  });
}

function validateRequest(payload: any): string | null {
  if (!payload.sessionId || typeof payload.sessionId !== 'string') {
    return 'Missing or invalid sessionId';
  }

  if (typeof payload.taskId !== 'number') {
    return 'Missing or invalid taskId';
  }

  if (!payload.prompt || typeof payload.prompt !== 'string') {
    return 'Missing or invalid prompt';
  }

  if (!payload.repository || typeof payload.repository !== 'object') {
    return 'Missing or invalid repository';
  }

  if (!payload.repository.url || typeof payload.repository.url !== 'string') {
    return 'Missing or invalid repository.url';
  }

  if (!payload.repository.baseBranch || typeof payload.repository.baseBranch !== 'string') {
    return 'Missing or invalid repository.baseBranch';
  }

  if (!payload.repository.workingBranch || typeof payload.repository.workingBranch !== 'string') {
    return 'Missing or invalid repository.workingBranch';
  }

  if (!payload.githubToken || typeof payload.githubToken !== 'string') {
    return 'Missing or invalid githubToken';
  }

  return null;
}
