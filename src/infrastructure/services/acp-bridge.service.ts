/**
 * ACP Bridge Service
 * Handles routing ACP (Agent Communication Protocol) JSON-RPC 2.0 requests to container
 * Ported from src/acp-bridge.ts to clean architecture
 */

import { DEFAULT_USER_CONFIG_STUB } from '../adapters/user-repository.do-adapter';
import type { IGitHubService } from '../../core/interfaces/services/github.service';
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

  constructor(
    private readonly tokenService?: any,
    private readonly githubService?: IGitHubService,
  ) {}

  /**
   * Route an ACP method to the container's ACP server
   */
  async routeACPMethod(method: string, params: any, env: any): Promise<any> {
    try {
      // Extract userId from params - REQUIRED for multi-tenant security
      // Validate BEFORE checking NO_CONTAINERS flag
      const userId = params?.userId;
      if (!userId) {
        console.error('[ACP-BRIDGE] Missing userId in request params');
        return {
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'Invalid params: userId is required for multi-tenant security',
            data: {
              hint: 'Include userId in your request params. Get userId from /register-user endpoint.',
            },
          },
          id: Date.now(),
        };
      }

      // Fetch user configuration to get their encrypted API key
      console.log(`[ACP-BRIDGE] Fetching config for user: ${userId}`);
      let userConfig;
      try {
        userConfig = await this.fetchUserConfig(env, userId);
      } catch (error) {
        console.error('[ACP-BRIDGE] User config fetch failed:', error);
        return {
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
        };
      }

      // Verify user has an API key
      if (!userConfig.anthropicApiKey) {
        console.error(`[ACP-BRIDGE] User ${userId} has no Anthropic API key configured`);
        return {
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
        };
      }

      console.log(`[ACP-BRIDGE] Using API key for user: ${userId} (installation: ${userConfig.installationId})`);

      // Optional bypass when containers disabled locally (AFTER validation!)
      if (env.NO_CONTAINERS === 'true') {
        console.log(`[ACP-BRIDGE] NO_CONTAINERS flag set - returning mock response for ${method}`);
        return this.getMockResponse(method);
      }

      console.log(`[ACP-BRIDGE] Routing method: ${method}`);

      // Generate GitHub installation token and fetch repository info
      let githubToken: string | undefined;
      let repository: string | undefined;

      if (this.tokenService && userConfig.installationId) {
        try {
          console.log(`[ACP-BRIDGE] Generating GitHub token for installation: ${userConfig.installationId}`);
          const tokenResult = await this.tokenService.getInstallationToken(userConfig.installationId);
          githubToken = tokenResult.token;
          console.log(`[ACP-BRIDGE] GitHub token generated successfully`);

          // Fetch repositories from installation to auto-populate repository metadata
          if (this.githubService) {
            try {
              console.log(`[ACP-BRIDGE] Fetching repositories for installation: ${userConfig.installationId}`);
              const repositories = await this.githubService.fetchRepositories(userConfig.installationId);
              
              if (repositories.length > 0) {
                // Use the first repository (installations typically have one repo)
                repository = repositories[0].fullName;
                console.log(`[ACP-BRIDGE] Auto-detected repository: ${repository} (from ${repositories.length} available)`);
              } else {
                console.warn(`[ACP-BRIDGE] No repositories found for installation ${userConfig.installationId}`);
              }
            } catch (repoError) {
              console.warn(`[ACP-BRIDGE] Failed to fetch repositories:`, repoError);
              // Continue without repository info - user can still pass it manually
            }
          }
        } catch (error) {
          console.warn(`[ACP-BRIDGE] Failed to generate GitHub token:`, error);
          // Continue without GitHub token - container will skip GitHub operations
        }
      } else {
        console.log(`[ACP-BRIDGE] No token service or installation ID - GitHub operations will be skipped`);
      }

      // Route all ACP operations to a consistent container instance to maintain session state
      // Using single container pool since session state is stored in memory
      const containerName = 'acp-session';

      const containerId = env.MY_CONTAINER.idFromName(containerName);
      const container = env.MY_CONTAINER.get(containerId);

      // Create JSON-RPC request for container ACP server
      // Include user's decrypted API key in params (already decrypted by UserConfigDO)
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        method: method,
        params: {
          ...params,
          anthropicApiKey: userConfig.anthropicApiKey, // ✅ Use user's decrypted API key
          // Auto-inject GitHub context (token + repository) from installation
          context: {
            ...(params.context || {}),
            // Auto-inject repository if not provided by user
            ...(repository && !params.context?.repository ? { repository } : {}),
            // Inject GitHub token in context.github.token (container expects it here)
            ...(githubToken ? {
              github: {
                ...(params.context?.github || {}),
                token: githubToken,
              }
            } : {}),
          },
        },
        id: Date.now(),
      };

      console.log(`[ACP-BRIDGE] Sending to container:`, {
        method,
        containerName,
        userId,
        hasSessionId: !!params?.sessionId,
        hasRepository: !!repository || !!params.context?.repository,
        repository: repository || params.context?.repository || 'none',
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
   * Fetch user configuration by userId from UserConfigDO
   */
  private async fetchUserConfig(env: any, userId: string): Promise<any> {
    const userConfigDO = this.getUserConfigDO(env);
    const response = await userConfigDO.fetch(
      new Request(`http://localhost/user?userId=${userId}`),
    );
    
    if (!response.ok) {
      throw new Error(`User ${userId} not found. Please register first via /register-user`);
    }
    
    return await response.json();
  }

  /**
   * Get UserConfigDO instance
   */
  private getUserConfigDO(env: any): any {
  const id = env.USER_CONFIG.idFromName(DEFAULT_USER_CONFIG_STUB);
    return env.USER_CONFIG.get(id);
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
