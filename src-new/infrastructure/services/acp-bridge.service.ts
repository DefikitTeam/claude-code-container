/**
 * ACP Bridge Service
 * Handles routing ACP (Agent Communication Protocol) JSON-RPC 2.0 requests to container
 * Ported from src/acp-bridge.ts to clean architecture
 */

import type {
  ACPMessage,
  ACPSession,
  ACPSessionPromptResult,
  SessionPromptAuditRecord,
  GitHubAutomationResult,
  GitHubAutomationAudit,
  GitHubAutomationAuditDiagnostics,
} from '../../shared/types/common.types';

/**
 * ACP Bridge Service Interface
 */
export interface IACPBridgeService {
  /**
   * Route an ACP method to the container
   */
  routeACPMethod(method: string, params: any, env: any): Promise<any>;

  /**
   * Handle session prompt side effects (audit logging)
   */
  handleSessionPromptSideEffects(args: {
    env: any;
    sessionId?: string;
    result: ACPSessionPromptResult;
  }): Promise<void>;

  /**
   * Get current sessions
   */
  getSessions(): ACPSession[];

  /**
   * Get ACP status including container health
   */
  getStatus(env: any): Promise<{
    success: boolean;
    bridge: any;
    container: any;
  }>;
}

/**
 * ACP Bridge Service Implementation
 */
export class ACPBridgeService implements IACPBridgeService {
  private sessions: Map<string, ACPSession> = new Map();
  private static readonly MAX_COMMIT_MESSAGE_AUDIT_LENGTH = 160;

  /**
   * Route an ACP method to the container's ACP server
   */
  async routeACPMethod(method: string, params: any, env: any): Promise<any> {
    try {
      // Optional bypass when containers disabled locally
      if (env.NO_CONTAINERS === 'true') {
        console.log(`[ACP-BRIDGE] NO_CONTAINERS flag set - returning mock response for ${method}`);
        return this.getMockResponse(method);
      }

      console.log(`[ACP-BRIDGE] Routing method: ${method}`);

      // Route all ACP operations to a consistent container instance to maintain session state
      // Using single container pool since session state is stored in memory
      const containerName = 'acp-session';

      const containerId = env.MY_CONTAINER.idFromName(containerName);
      const container = env.MY_CONTAINER.get(containerId);

      // Create JSON-RPC request for container ACP server
      // Include API key in params so container can access it
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        method: method,
        params: {
          ...params,
          anthropicApiKey: env.ANTHROPIC_API_KEY, // Pass API key in request params
        },
        id: Date.now(),
      };

      console.log(`[ACP-BRIDGE] Sending to container:`, {
        method,
        containerName,
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
            ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
            NODE_ENV: 'production',
          },
        },
      );

      console.log(`[ACP-BRIDGE] Container response status:`, containerResponse.status);

      if (!containerResponse.ok) {
        const errorText = await containerResponse.text();
        console.error(`[ACP-BRIDGE] Container error:`, errorText);
        return {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Container processing failed',
            data: { status: containerResponse.status, error: errorText },
          },
          id: jsonRpcRequest.id,
        };
      }

      // Parse container response
      const responseText = await containerResponse.text();
      console.log(`[ACP-BRIDGE] Container response length:`, responseText.length);

      let containerResult;
      try {
        containerResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[ACP-BRIDGE] Invalid JSON response:`, responseText.substring(0, 200));
        return {
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error - container returned invalid JSON',
            data: { response: responseText.substring(0, 200) },
          },
          id: jsonRpcRequest.id,
        };
      }

      // Handle session/prompt side effects
      if (method === 'session/prompt' && containerResult?.result) {
        await this.handleSessionPromptSideEffects({
          env,
          sessionId: params?.sessionId,
          result: containerResult.result as ACPSessionPromptResult,
        });
      }

      console.log(`[ACP-BRIDGE] Successfully routed ${method} to container`);
      return containerResult;
    } catch (error) {
      console.error(`[ACP-BRIDGE] Router error for ${method}:`, error);
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error in ACP bridge',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
        id: Date.now(),
      };
    }
  }

  /**
   * Handle session prompt side effects (audit logging, etc.)
   */
  async handleSessionPromptSideEffects(args: {
    env: any;
    sessionId?: string;
    result: ACPSessionPromptResult;
  }): Promise<void> {
    const { env, sessionId, result } = args;

    const sanitizedAutomation = this.sanitizeGitHubAutomation(result.githubAutomation);
    if (!sanitizedAutomation) {
      return;
    }

    const resolvedSessionId = sessionId || result.meta?.workspace?.sessionId || null;

    if (!resolvedSessionId) {
      console.warn('[ACP-BRIDGE] Unable to log automation result - missing sessionId');
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

    await this.appendSessionAudit(env, auditRecord.sessionId, auditRecord);
  }

  /**
   * Get current sessions
   */
  getSessions(): ACPSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get ACP status including container health
   */
  async getStatus(env: any): Promise<{ success: boolean; bridge: any; container: any }> {
    try {
      // Get status from container as well (use consistent ACP container name)
      const containerId = env.MY_CONTAINER.idFromName('acp-session');
      const container = env.MY_CONTAINER.get(containerId);

      const containerResponse = await container.fetch(new Request('https://container/health'));

      let containerHealth = null;
      if (containerResponse.ok) {
        try {
          const responseText = await containerResponse.text();
          containerHealth = JSON.parse(responseText);
        } catch (e) {
          containerHealth = { error: 'Invalid container response' };
        }
      }

      return {
        success: true,
        bridge: {
          sessions: this.getSessions().slice(0, 50),
          timestamp: new Date().toISOString(),
          version: 'enhanced-bridge-v1.0',
        },
        container: containerHealth,
      };
    } catch (error) {
      return {
        success: true,
        bridge: {
          sessions: this.getSessions().slice(0, 50),
          timestamp: new Date().toISOString(),
          version: 'enhanced-bridge-v1.0',
          error: error instanceof Error ? error.message : String(error),
        },
        container: { error: 'Container unreachable' },
      };
    }
  }

  /**
   * Get mock response for development/testing
   */
  private getMockResponse(method: string): any {
    return {
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
    };
  }

  /**
   * Sanitize GitHub automation result for audit logging
   */
  private sanitizeGitHubAutomation(
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
        audit.commitMessage = this.truncate(
          automation.commit.message,
          ACPBridgeService.MAX_COMMIT_MESSAGE_AUDIT_LENGTH,
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

  /**
   * Append session audit record to ACP Session DO
   */
  private async appendSessionAudit(
    env: any,
    sessionId: string,
    record: SessionPromptAuditRecord,
  ): Promise<void> {
    const namespace = env.ACP_SESSION;
    if (!namespace) {
      console.warn('[ACP-BRIDGE] ACP_SESSION namespace not configured');
      return;
    }

    try {
      const id = namespace.idFromName(sessionId);
      const stub = namespace.get(id);
      await stub.fetch(
        new Request(`https://acp-session/${encodeURIComponent(sessionId)}/audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        }),
      );
    } catch (error) {
      console.warn('[ACP-BRIDGE] Failed to append session audit', error);
    }
  }

  /**
   * Truncate string to max length
   */
  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1)}…`;
  }
}
