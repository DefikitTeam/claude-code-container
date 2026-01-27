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
      const result: ProcessPromptResult =
        await processPromptService.execute(payload);

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
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logWithContext('PROCESS-PROMPT-ROUTE', 'Error processing prompt', {
        requestId: ctx.requestId,
        error: errorMessage,
      });

      jsonResponse(ctx.res, 500, {
        success: false,
        error: errorMessage,
        stack:
          process.env.NODE_ENV === 'development'
            ? (error as Error).stack
            : undefined,
      });
    }
  });
}

function validateRequest(payload: unknown): string | null {
  const p = payload as Partial<ProcessPromptRequest>;
  if (!p.sessionId || typeof p.sessionId !== 'string') {
    return 'Missing or invalid sessionId';
  }

  if (typeof p.taskId !== 'number') {
    return 'Missing or invalid taskId';
  }

  if (!p.prompt || typeof p.prompt !== 'string') {
    return 'Missing or invalid prompt';
  }

  if (!p.repository || typeof p.repository !== 'object') {
    return 'Missing or invalid repository';
  }

  if (!p.repository.url || typeof p.repository.url !== 'string') {
    return 'Missing or invalid repository.url';
  }

  if (
    !p.repository.baseBranch ||
    typeof p.repository.baseBranch !== 'string'
  ) {
    return 'Missing or invalid repository.baseBranch';
  }

  if (
    !p.repository.workingBranch ||
    typeof p.repository.workingBranch !== 'string'
  ) {
    return 'Missing or invalid repository.workingBranch';
  }

  if (!p.githubToken || typeof p.githubToken !== 'string') {
    return 'Missing or invalid githubToken';
  }

  if (p.llmProvider && (typeof p.llmProvider !== 'object' || !p.llmProvider.provider)) {
      return 'Invalid llmProvider configuration';
  }

  return null;
}
