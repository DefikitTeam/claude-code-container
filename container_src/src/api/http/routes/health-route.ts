import { execSync } from 'node:child_process';
import { logWithContext } from '../utils/logger.js';
import { jsonResponse } from '../utils/responses.js';
import type { Router } from '../router.js';

interface HealthStatus {
  status: string;
  message: string;
  timestamp: string;
  claudeCodeAvailable: boolean;
  apiKeyAvailable: boolean;
  runtimeFlags: {
    disableSdk: boolean;
    disableCli: boolean;
    sdkStream: boolean;
  };
}

export function registerHealthRoute(router: Router): void {
  router.register('GET', '/health', async (ctx) => {
    logWithContext('HEALTH', 'Health check requested', {
      requestId: ctx.requestId,
    });

    const skipCliCheck = process.env.CLAUDE_HTTP_SKIP_CLI_CHECK === '1';

    let claudeCliAvailable = false;
    if (!skipCliCheck) {
      try {
        try {
          execSync('claude-code --version', { timeout: 5000, stdio: 'pipe' });
          claudeCliAvailable = true;
        } catch {
          execSync('claude --version', { timeout: 5000, stdio: 'pipe' });
          claudeCliAvailable = true;
        }
      } catch (error) {
        logWithContext('HEALTH', 'Claude CLI not available', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const response: HealthStatus = {
      status: claudeCliAvailable ? 'healthy' : 'degraded',
      message: claudeCliAvailable
        ? 'Claude Code Container HTTP Server'
        : 'Claude Code Container HTTP Server (Claude CLI not authenticated)',
      timestamp: new Date().toISOString(),
      claudeCodeAvailable: claudeCliAvailable,
      apiKeyAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
      runtimeFlags: {
        disableSdk: process.env.CLAUDE_CLIENT_DISABLE_SDK === '1',
        disableCli: process.env.CLAUDE_CLIENT_DISABLE_CLI === '1',
        sdkStream: process.env.CLAUDE_CLIENT_SDK_STREAM === '1',
      },
    };

    logWithContext('HEALTH', 'Health check response', {
      status: response.status,
      claudeCodeAvailable: response.claudeCodeAvailable,
      apiKeyAvailable: response.apiKeyAvailable,
      requestId: ctx.requestId,
    });

    jsonResponse(ctx.res, 200, response);
  });
}
