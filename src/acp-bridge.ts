import { Hono } from 'hono';
import type {
  Env,
  ACPMessage,
  ACPSession,
  GitHubIssuePayload,
  ContainerRequest,
  ACPSessionPromptResult,
  SessionPromptAuditRecord,
  GitHubAutomationResult,
  GitHubAutomationAudit,
  GitHubAutomationAuditDiagnostics,
} from './types';

// Enhanced ACP bridge that routes all ACP methods to container's enhanced handlers
// This implements the production flow: Worker (8787) → Container (8080) → Enhanced ACP Handlers
const sessions: Map<string, ACPSession> = new Map();

export function addACPEndpoints(app: Hono<{ Bindings: Env }>) {
  // Helper function to get UserConfigDO
  const getUserConfigDO = (env: Env) => {
    const id = env.USER_CONFIG.idFromName('global');
    return env.USER_CONFIG.get(id);
  };

  // Helper function to fetch user config by userId
  const fetchUserConfig = async (env: Env, userId: string): Promise<any> => {
    const userConfigDO = getUserConfigDO(env);
    const response = await userConfigDO.fetch(
      new Request(`http://localhost/user?userId=${userId}`),
    );
    
    if (!response.ok) {
      throw new Error(`User ${userId} not found. Please register first via /register-user`);
    }
    
    return await response.json();
  };

  // Generic ACP method router - routes all ACP methods to container
  const acpMethodRouter = async (c: any, method: string, params: any) => {
    try {
      // Extract userId from params - REQUIRED for multi-tenant security
      // Validate BEFORE checking NO_CONTAINERS flag
      const userId = params?.userId;
      if (!userId) {
        console.error('[ACP-BRIDGE] Missing userId in request params');
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'Invalid params: userId is required for multi-tenant security',
            data: {
              hint: 'Include userId in your request params. Get userId from /register-user endpoint.',
            },
          },
          id: Date.now(),
        }, 400);
      }

      // Fetch user configuration to get their encrypted API key
      console.log(`[ACP-BRIDGE] Fetching config for user: ${userId}`);
      let userConfig;
      try {
        userConfig = await fetchUserConfig(c.env, userId);
      } catch (error) {
        console.error('[ACP-BRIDGE] User config fetch failed:', error);
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: error instanceof Error ? error.message : 'User not found',
            data: {
              userId,
              hint: 'Register user first via POST /register-user with installationId and anthropicApiKey',
            },
          },
          id: Date.now(),
        }, 404);
      }

      // Verify user has an API key
      if (!userConfig.anthropicApiKey) {
        console.error(`[ACP-BRIDGE] User ${userId} has no Anthropic API key configured`);
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32002,
            message: 'User has no Anthropic API key configured',
            data: {
              userId,
              hint: 'Update user configuration via PUT /user-config with anthropicApiKey',
            },
          },
          id: Date.now(),
        }, 400);
      }

      console.log(`[ACP-BRIDGE] Using API key for user: ${userId} (installation: ${userConfig.installationId})`);

      // Optional bypass when containers disabled locally (AFTER validation!)
      if (c.env.NO_CONTAINERS === 'true') {
        console.log(
          `[ACP-BRIDGE] NO_CONTAINERS flag set - returning mock response for ${method}`,
        );
        return c.json({
          jsonrpc: '2.0',
          result:
            method === 'session/prompt'
              ? {
                  stopReason: 'mock',
                  usage: { inputTokens: 0, outputTokens: 0 },
                  summary: 'Mocked (containers disabled)',
                }
              : method === 'session/new'
                ? {
                    sessionId: `mock-session-${Date.now()}`,
                    modes: { currentModeId: 'default', availableModes: [] },
                  }
                : method === 'initialize'
                  ? {
                      protocolVersion: 1,
                      agentCapabilities: {},
                      authMethods: [],
                    }
                  : {},
          id: Date.now(),
        });
      }

      console.log(`[ACP-BRIDGE] Routing method: ${method}`);

      // Route all ACP operations to a consistent container instance to maintain session state
      // Using single container pool since session state is stored in memory
      const containerName = 'acp-session';

      const containerId = c.env.MY_CONTAINER.idFromName(containerName);
      const container = c.env.MY_CONTAINER.get(containerId);

      // Create JSON-RPC request for container ACP server
      // Include user's decrypted API key in params (already decrypted by UserConfigDO)
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        method: method,
        params: {
          ...params,
          anthropicApiKey: userConfig.anthropicApiKey, // ✅ Use user's decrypted API key
        },
        id: Date.now(),
      };

      console.log(`[ACP-BRIDGE] Sending to container:`, {
        method,
        containerName,
        userId,
        hasSessionId: !!params?.sessionId,
        paramsKeys: Object.keys(params || {}),
        containerId: containerId.toString(),
      });

      // Route to container ACP server via HTTP
      const containerResponse = await container.fetch(
        new Request('https://container/acp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ACP-Bridge': 'true',
          },
          body: JSON.stringify(jsonRpcRequest),
        }),
        {
          env: {
            ANTHROPIC_API_KEY: userConfig.anthropicApiKey, // ✅ Pass user's API key to container
            NODE_ENV: 'production',
            USER_ID: userId,
            INSTALLATION_ID: userConfig.installationId,
          },
        },
      );

      console.log(
        `[ACP-BRIDGE] Container response status:`,
        containerResponse.status,
      );

      if (!containerResponse.ok) {
        const errorText = await containerResponse.text();
        console.error(`[ACP-BRIDGE] Container error:`, errorText);
        return c.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Container processing failed',
              data: { status: containerResponse.status, error: errorText },
            },
            id: jsonRpcRequest.id,
          },
          containerResponse.status,
        );
      }

      // Parse container response
      const responseText = await containerResponse.text();
      console.log(
        `[ACP-BRIDGE] Container response length:`,
        responseText.length,
      );

      let containerResult;
      try {
        containerResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error(
          `[ACP-BRIDGE] Invalid JSON response:`,
          responseText.substring(0, 200),
        );
        return c.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error - container returned invalid JSON',
              data: { response: responseText.substring(0, 200) },
            },
            id: jsonRpcRequest.id,
          },
          500,
        );
      }

      if (method === 'session/prompt' && containerResult?.result) {
        await handleSessionPromptSideEffects({
          env: c.env,
          sessionId: params?.sessionId,
          result: containerResult.result as ACPSessionPromptResult,
        });
      }

      console.log(`[ACP-BRIDGE] Successfully routed ${method} to container`);
      return c.json(containerResult);
    } catch (error) {
      console.error(`[ACP-BRIDGE] Router error for ${method}:`, error);
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error in ACP bridge',
            data: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
          id: Date.now(),
        },
        500,
      );
    }
  };

  // ACP v0.3.1 method endpoints - all route to enhanced container handlers

  // Initialize method
  app.post('/acp/initialize', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'initialize', body);
  });

  // Session management methods
  app.post('/acp/session/new', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'session/new', body);
  });

  app.post('/acp/session/prompt', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'session/prompt', body);
  });

  app.post('/acp/session/load', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'session/load', body);
  });

  // Cancel method
  app.post('/acp/cancel', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'cancel', body);
  });

  // Generic ACP method handler (catch-all for any other ACP methods)
  app.post('/acp/:method', async (c) => {
    const method = c.req.param('method');
    const body = await c.req.json();
    return await acpMethodRouter(c, method, body);
  });

  // Backward compatibility - legacy task execute endpoint
  app.post('/acp/task/execute', async (c) => {
    const msg = (await c.req.json()) as ACPMessage;
    const payload = (msg as any).params || (msg as any).payload;

    // If the payload is a GitHub issue payload, forward to the container processing flow
    if (payload && payload.issue && payload.repository) {
      try {
        const issue = payload as GitHubIssuePayload;
        const containerId = c.env.MY_CONTAINER.idFromName(
          `acp-issue-${issue.issue.id}`,
        );
        const container = c.env.MY_CONTAINER.get(containerId);

        const containerRequest: ContainerRequest = {
          type: 'process_issue',
          payload,
          config: {
            appId: c.env.FIXED_GITHUB_APP_ID || '',
            privateKey: '',
            webhookSecret: '',
          },
        };

        const resp = await container.fetch(
          new Request('https://container/process-issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerRequest),
          }),
        );

        const text = await resp.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }

        return c.json({
          success: true,
          forwarded: true,
          status: resp.status,
          result: parsed,
        });
      } catch (err) {
        return c.json(
          { success: false, error: (err as Error).message || String(err) },
          500,
        );
      }
    }

    // Legacy session tracking
    const target = (msg as any).target;
    if (target && sessions.has(target)) {
      const s = sessions.get(target)!;
      s.lastSeenAt = Date.now();
      return c.json({ success: true, deliveredTo: s.sessionId });
    }

    return c.json({ success: true, queued: true });
  });

  // Status and health endpoints
  app.get('/acp/status', async (c) => {
    try {
      // Get status from container as well (use consistent ACP container name)
      const containerId = c.env.MY_CONTAINER.idFromName('acp-session');
      const container = c.env.MY_CONTAINER.get(containerId);

      const containerResponse = await container.fetch(
        new Request('https://container/health'),
      );

      let containerHealth = null;
      if (containerResponse.ok) {
        try {
          const responseText = await containerResponse.text();
          containerHealth = JSON.parse(responseText);
        } catch (e) {
          containerHealth = { error: 'Invalid container response' };
        }
      }

      return c.json({
        success: true,
        bridge: {
          sessions: Array.from(sessions.values()).slice(0, 50),
          timestamp: new Date().toISOString(),
          version: 'enhanced-bridge-v1.0',
        },
        container: containerHealth,
      });
    } catch (error) {
      return c.json({
        success: true,
        bridge: {
          sessions: Array.from(sessions.values()).slice(0, 50),
          timestamp: new Date().toISOString(),
          version: 'enhanced-bridge-v1.0',
          error: error instanceof Error ? error.message : String(error),
        },
        container: { error: 'Container unreachable' },
      });
    }
  });
}

export { sessions };

const MAX_COMMIT_MESSAGE_AUDIT_LENGTH = 160;

async function handleSessionPromptSideEffects(args: {
  env: Env;
  sessionId?: string;
  result: ACPSessionPromptResult;
}) {
  const { env, sessionId, result } = args;

  const sanitizedAutomation = sanitizeGitHubAutomation(result.githubAutomation);
  if (!sanitizedAutomation) {
    return;
  }

  const resolvedSessionId =
    sessionId || result.meta?.workspace?.sessionId || null;

  if (!resolvedSessionId) {
    console.warn(
      '[ACP-BRIDGE] Unable to log automation result - missing sessionId',
    );
    return;
  }

  const auditRecord: SessionPromptAuditRecord = {
    type: 'session_prompt_result',
    timestamp: new Date().toISOString(),
    sessionId: resolvedSessionId,
    stopReason: result.stopReason,
    usage: result.usage,
    githubAutomation: sanitizedAutomation,
    githubAutomationVersion: result.meta?.githubAutomationVersion,
  };

  await appendSessionAudit(env, auditRecord.sessionId, auditRecord);
}

function sanitizeGitHubAutomation(
  automation?: GitHubAutomationResult,
): GitHubAutomationAudit | undefined {
  if (!automation) {
    return undefined;
  }

  const audit: GitHubAutomationAudit = {
    status: automation.status,
  };

  if (automation.branch) {
    audit.branch = automation.branch;
  }

  if (automation.issue) {
    audit.issue = {
      number: automation.issue.number,
      url: automation.issue.url,
      title: automation.issue.title,
    };
  }

  if (automation.pullRequest) {
    audit.pullRequest = {
      number: automation.pullRequest.number,
      url: automation.pullRequest.url,
      branch: automation.pullRequest.branch,
      draft: automation.pullRequest.draft,
    };
  }

  if (automation.commit) {
    audit.commitSha = automation.commit.sha;
    if (automation.commit.message) {
      audit.commitMessage = truncate(
        automation.commit.message,
        MAX_COMMIT_MESSAGE_AUDIT_LENGTH,
      );
    }
  }

  if (automation.skippedReason) {
    audit.skippedReason = automation.skippedReason;
  }

  if (automation.error) {
    audit.error = {
      code: automation.error.code,
      message: automation.error.message,
      retryable: automation.error.retryable,
    };
  }

  const diagnostics = automation.diagnostics;
  const auditDiagnostics: GitHubAutomationAuditDiagnostics = {};

  if (typeof diagnostics?.durationMs === 'number') {
    auditDiagnostics.durationMs = diagnostics.durationMs;
  }

  if (typeof diagnostics?.attempts === 'number') {
    auditDiagnostics.attempts = diagnostics.attempts;
  }

  if (diagnostics?.errorCode) {
    auditDiagnostics.errorCode = diagnostics.errorCode;
  }

  if (Array.isArray(diagnostics?.logs)) {
    auditDiagnostics.logCount = diagnostics.logs.length;
  }

  if (Object.keys(auditDiagnostics).length > 0) {
    audit.diagnostics = auditDiagnostics;
  }

  return audit;
}

async function appendSessionAudit(
  env: Env,
  sessionId: string,
  record: SessionPromptAuditRecord,
) {
  const namespace = env.ACP_SESSION;
  if (!namespace) {
    console.warn('[ACP-BRIDGE] ACP_SESSION namespace not configured');
    return;
  }

  try {
    const id = namespace.idFromName(sessionId);
    const stub = namespace.get(id);
    await stub.fetch(
      new Request(
        `https://acp-session/${encodeURIComponent(sessionId)}/audit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        },
      ),
    );
  } catch (error) {
    console.warn('[ACP-BRIDGE] Failed to append session audit', error);
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

export const __acpBridgeInternals = {
  sanitizeGitHubAutomation,
  handleSessionPromptSideEffects,
  truncate,
};
