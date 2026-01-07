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
   * Route an ACP method to the container (synchronous - waits for completion)
   */
  routeACPMethod(method: string, params: any, env: any): Promise<any>;

  /**
   * Route an ACP method to the container and return the raw Response for streaming.
   * This bypasses JSON parsing to enable end-to-end streaming and avoid Cloudflare 524 timeout.
   */
  routeACPMethodStream(method: string, params: any, env: any): Promise<Response>;

  /**
   * Route an ACP method to the container asynchronously
   * Returns immediately with jobId, actual processing happens in background
   */
  routeACPMethodAsync(
    method: string,
    params: any,
    env: any,
  ): Promise<{
    jobId: string;
    status: string;
  }>;

  /**
   * Get async job status
   */
  getAsyncJobStatus(jobId: string, env: any): Promise<any>;

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
  ) { }

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
            message:
              'Invalid params: userId is required for multi-tenant security',
            data: {
              hint: 'Include userId in your request params. Get userId from /register-user endpoint.',
            },
          },
          id: Date.now(),
        };
      }

      // Use worker's own OpenRouter API key (from environment/secrets)
      const openrouterApiKey = env.OPENROUTER_API_KEY;

      if (!openrouterApiKey) {
        console.error(
          '[ACP-BRIDGE] Missing OPENROUTER_API_KEY in worker environment',
        );
        return {
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Worker not configured: Missing OPENROUTER_API_KEY',
            data: {
              hint: 'Set OPENROUTER_API_KEY in worker secrets (wrangler secret put OPENROUTER_API_KEY)',
            },
          },
          id: Date.now(),
        };
      }

      // Fetch user configuration to get their installation ID for GitHub operations
      console.log(`[ACP-BRIDGE] Fetching config for user: ${userId}`);
      let userConfig;
      try {
        userConfig = await this.fetchUserConfig(env, userId);
      } catch (error) {
        console.error('[ACP-BRIDGE] User config fetch failed:', error);
        return {
          jsonrpc: '2.0',
          error: {
            code: -32002,
            message: error instanceof Error ? error.message : 'User not found',
            data: {
              userId,
              hint: 'Register user first via POST /register-user with installationId',
            },
          },
          id: Date.now(),
        };
      }

      console.log(
        `[ACP-BRIDGE] Using worker OpenRouter API key for user: ${userId} (installation: ${userConfig.installationId})`,
      );

      // Optional bypass when containers disabled locally (AFTER validation!)
      if (env.NO_CONTAINERS === 'true') {
        console.log(
          `[ACP-BRIDGE] NO_CONTAINERS flag set - returning mock response for ${method}`,
        );
        return this.getMockResponse(method);
      }

      console.log(`[ACP-BRIDGE] Routing method: ${method}`);

      // Generate GitHub installation token and fetch repository info
      let githubToken: string | undefined;
      let githubTokenError: string | undefined;
      let repository: string | undefined;

      // Fallback: Check params for installationId if not in userConfig
      const installationId = userConfig.installationId || params.installationId || params.context?.installationId || params.agentContext?.installationId;

      if (this.tokenService && installationId) {
        try {
          console.log(
            `[ACP-BRIDGE] Generating GitHub token for installation: ${installationId}`,
          );
          const tokenResult = await this.tokenService.getInstallationToken(
            installationId,
          );
          githubToken = tokenResult.token;
          console.log(`[ACP-BRIDGE] GitHub token generated successfully`);

          // Fetch repositories from installation to auto-populate repository metadata
          if (this.githubService) {
            try {
              console.log(
                `[ACP-BRIDGE] Fetching repositories for installation: ${userConfig.installationId}`,
              );
              const repositories = await this.githubService.fetchRepositories(
                userConfig.installationId,
              );

              if (repositories.length > 0) {
                // Use the first repository (installations typically have one repo)
                repository = repositories[0].fullName;
                console.log(
                  `[ACP-BRIDGE] Auto-detected repository: ${repository} (from ${repositories.length} available)`,
                );
              } else {
                console.warn(
                  `[ACP-BRIDGE] No repositories found for installation ${installationId}`,
                );
              }
            } catch (repoError) {
              console.warn(
                `[ACP-BRIDGE] Failed to fetch repositories:`,
                repoError,
              );
              // Continue without repository info - user can still pass it manually
            }
          }

        } catch (error: any) {
          console.warn(`[ACP-BRIDGE] Failed to generate GitHub token:`, error);
          githubTokenError = error instanceof Error ? error.message : String(error);
          // Continue without GitHub token - container will skip GitHub operations but will know why
        }
      } else {
        console.log(
          `[ACP-BRIDGE] No token service or installation ID - GitHub operations will be skipped`,
        );
      }

      // Route all ACP operations to a consistent container instance to maintain session state.
      // NOTE: This must be provider-aware; ACP endpoints previously hardwired to Cloudflare (env.MY_CONTAINER)
      // which would wake Cloudflare containers even when CONTAINER_PROVIDER=daytona.
      const containerName = 'acp-session';

      // CRITICAL: Fetch message history from ACPSessionDO for session/prompt calls
      let messageHistory: any[] = [];
      if (method === 'session/prompt' && params?.sessionId) {
        try {
          console.log(`[ACP-BRIDGE] Fetching message history for session: ${params.sessionId}`);
          const sessionDO = env.ACP_SESSION.idFromName(params.sessionId);
          const sessionStub = env.ACP_SESSION.get(sessionDO);

          const response = await sessionStub.fetch(
            `http://do/session/messages?sessionId=${params.sessionId}&limit=20`
          );

          if (response.ok) {
            const data = await response.json() as { messages: any[] };
            messageHistory = data.messages || [];
            console.log(`[ACP-BRIDGE] Fetched ${messageHistory.length} messages from history`);
          } else {
            console.warn(`[ACP-BRIDGE] Failed to fetch message history: ${response.status}`);
          }
        } catch (historyError) {
          console.warn(`[ACP-BRIDGE] Error fetching message history:`, historyError);
          // Continue without history - not fatal
        }
      }

      // Create JSON-RPC request for container ACP server
      // Use worker's OpenRouter API key (not user-provided)
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        method: method,
        params: {
          ...params,
          anthropicApiKey: openrouterApiKey, // ✅ Use worker's OpenRouter API key
          // Also pass GitHub token at top level for container compatibility
          ...(githubToken ? { githubToken } : {}),
           // Pass token error if generation failed
          ...(githubTokenError ? { githubTokenError } : {}),
          // Auto-inject GitHub context (token + repository) from installation
          context: {
            ...(params.context || {}),
            // Auto-inject repository if not provided by user
            ...(repository && !params.context?.repository
              ? { repository }
              : {}),
            // Inject GitHub token in context.github.token (for handlers that expect it here)
            ...(githubToken
              ? {
                github: {
                  ...(params.context?.github || {}),
                  token: githubToken,
                },
              }
              : {}),
            // ✅ CRITICAL FIX: Include message history from persistent storage
            ...(messageHistory.length > 0 ? { messageHistory } : {}),
          },
        },
        id: Date.now(),
      };

      const cloudflareContainerId =
        env.CONTAINER_PROVIDER === 'daytona'
          ? undefined
          : env.MY_CONTAINER.idFromName(containerName);
      const cloudflareContainer =
        cloudflareContainerId && env.CONTAINER_PROVIDER !== 'daytona'
          ? env.MY_CONTAINER.get(cloudflareContainerId)
          : undefined;

      const containerIdForLogs =
        env.CONTAINER_PROVIDER === 'daytona'
          ? `daytona:${containerName}`
          : cloudflareContainerId?.toString() ?? 'unknown';

      console.log(`[ACP-BRIDGE] Sending to container:`, {
        method,
        containerName,
        userId,
        hasSessionId: !!params?.sessionId,
        hasRepository: !!repository || !!params.context?.repository,
        repository: repository || params.context?.repository || 'none',
        paramsKeys: Object.keys(params || {}),
        hasOpenRouterApiKey: !!openrouterApiKey,
        openrouterApiKeyLength: openrouterApiKey?.length || 0,
        containerId: containerIdForLogs,
      });

      // Debug: Log what we're actually sending
      console.log(
        `[ACP-BRIDGE] JSON-RPC request params keys:`,
        Object.keys(jsonRpcRequest.params),
      );

      // Route to container ACP server via HTTP
      let containerResponse: Response;
      if (env.CONTAINER_PROVIDER === 'daytona') {
        containerResponse = await this.fetchDaytonaACP(env, jsonRpcRequest, {
          containerName,
          installationId: userConfig?.installationId,
          userId,
        });
      } else {
        containerResponse = await cloudflareContainer!.fetch(
          new Request('https://container/acp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-ACP-Bridge': 'true',
            },
            body: JSON.stringify(jsonRpcRequest),
          }),
        );
      }

      const debugProcessUrl = containerResponse.headers.get('X-Debug-Process-Url');

      console.log(
        `[ACP-BRIDGE] Container response status:`,
        containerResponse.status,
      );

      if (!containerResponse.ok) {
        const errorText = await containerResponse.text();
        console.error(`[ACP-BRIDGE] Container error:`, errorText);
        return {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Container processing failed',
            data: { status: containerResponse.status, error: errorText, debugUrl: debugProcessUrl },
          },
          id: jsonRpcRequest.id,
        };
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
        return {
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error - container returned invalid JSON',
            data: { response: responseText.substring(0, 200), debugUrl: debugProcessUrl },
          },
          id: jsonRpcRequest.id,
        };
      }

      // Handle session/prompt side effects
      if (method === 'session/prompt' && containerResult?.result) {
        // Extract user prompt from content blocks
        let userPrompt = '';
        if (params?.content && Array.isArray(params.content)) {
          userPrompt = params.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text || '')
            .join('\n');
        }

        await this.handleSessionPromptSideEffects({
          env,
          sessionId: params?.sessionId,
          result: containerResult.result as ACPSessionPromptResult,
          userPrompt,
        });
      }

      console.log(`[ACP-BRIDGE] Successfully routed ${method} to container`);
      console.log(
        `[ACP-BRIDGE] Returning result with keys:`,
        Object.keys(containerResult || {}),
      );
      console.log(`[ACP-BRIDGE] Result structure:`, {
        hasJsonrpc: !!containerResult?.jsonrpc,
        hasId: !!containerResult?.id,
        hasResult: !!containerResult?.result,
        hasError: !!containerResult?.error,
        resultType: typeof containerResult?.result,
      });

      // Log a sample of the actual response being returned
      if (containerResult?.result) {
        console.log(
          `[ACP-BRIDGE] Result sample:`,
          JSON.stringify(containerResult).substring(0, 300),
        );
      }

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
   * Route an ACP method to the container and return the raw Response for streaming.
   * This method does NOT parse JSON - it returns the Response object directly.
   * Use this for long-running operations to avoid Cloudflare 524 timeout.
   */
  async routeACPMethodStream(method: string, params: any, env: any): Promise<Response> {
    // Validate userId for multi-tenant security
    const userId = params?.userId;
    if (!userId) {
      console.error('[ACP-BRIDGE-STREAM] Missing userId in request params');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params: userId is required for multi-tenant security',
        },
        id: Date.now(),
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate OpenRouter API Key
    const openrouterApiKey = env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      console.error('[ACP-BRIDGE-STREAM] Missing OPENROUTER_API_KEY');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Worker not configured: Missing OPENROUTER_API_KEY',
        },
        id: Date.now(),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch user config
    let userConfig;
    try {
      userConfig = await this.fetchUserConfig(env, userId);
    } catch (error) {
      console.error('[ACP-BRIDGE-STREAM] User config fetch failed:', error);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32002,
          message: 'User config not found',
        },
        id: Date.now(),
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate GitHub installation token and fetch repository info (same as routeACPMethod)
    let githubToken: string | undefined;
    let githubTokenError: string | undefined;
    let repository: string | undefined;

    // Fallback: Check params for installationId if not in userConfig
    const installationId = userConfig.installationId || params.installationId || params.context?.installationId || params.agentContext?.installationId;

    if (this.tokenService && installationId) {
      try {
        console.log(
          `[ACP-BRIDGE-STREAM] Generating GitHub token for installation: ${installationId}`,
        );
        const tokenResult = await this.tokenService.getInstallationToken(
          installationId,
        );
        githubToken = tokenResult.token;
        console.log(`[ACP-BRIDGE-STREAM] GitHub token generated successfully`);

        // Fetch repositories from installation to auto-populate repository metadata
        if (this.githubService) {
          try {
            console.log(
              `[ACP-BRIDGE-STREAM] Fetching repositories for installation: ${installationId}`,
            );
            const repositories = await this.githubService.fetchRepositories(
              installationId,
            );

            if (repositories.length > 0) {
              // Use the first repository (installations typically have one repo)
              repository = repositories[0].fullName;
              console.log(
                `[ACP-BRIDGE-STREAM] Auto-detected repository: ${repository} (from ${repositories.length} available)`,
              );
            } else {
              console.warn(
                `[ACP-BRIDGE-STREAM] No repositories found for installation ${installationId}`,
              );
            }
          } catch (repoError) {
            console.warn(
              `[ACP-BRIDGE-STREAM] Failed to fetch repositories:`,
              repoError,
            );
            // Continue without repository info - user can still pass it manually
          }
        }

      } catch (error: any) {
        console.warn(`[ACP-BRIDGE-STREAM] Failed to generate GitHub token:`, error);
        githubTokenError = error instanceof Error ? error.message : String(error);
        // Continue without GitHub token - container will skip GitHub operations but will know why
      }
    } else {
      console.log(
        `[ACP-BRIDGE-STREAM] No token service or installation ID - GitHub operations will be skipped`,
      );
    }

    // Build JSON-RPC request with injected credentials (same structure as routeACPMethod)
    const containerName = 'acp-session';
    const jsonRpcRequest = {
      jsonrpc: '2.0',
      method: method,
      params: {
        ...params,
        anthropicApiKey: openrouterApiKey,
        // Also pass GitHub token at top level for container compatibility
        ...(githubToken ? { githubToken } : {}),
        // Pass token error if generation failed
        ...(githubTokenError ? { githubTokenError } : {}),
        // Auto-inject GitHub context (token + repository) from installation
        context: {
          ...(params.context || {}),
          // Auto-inject repository if not provided by user
          ...(repository && !params.context?.repository
            ? { repository }
            : {}),
          // Inject GitHub token in context.github.token (for handlers that expect it here)
          ...(githubToken
            ? {
              github: {
                ...(params.context?.github || {}),
                token: githubToken,
              },
            }
            : {}),
        },
      },
      id: Date.now(),
    };

    console.log(`[ACP-BRIDGE-STREAM] Routing ${method} to container (streaming mode)`, {
      hasGithubToken: !!githubToken,
      hasRepository: !!repository || !!params.context?.repository,
      installationId: installationId || 'none',
    });


    try {
      if (env.CONTAINER_PROVIDER === 'daytona') {
        // Daytona: Use Public URL for direct streaming access
        return await this.fetchDaytonaACPStream(env, jsonRpcRequest, {
          containerName,
          installationId: userConfig?.installationId,
          userId,
        });
      } else {
        // Cloudflare Container: Return fetch Response directly (no buffering)
        const cloudflareContainerId = env.MY_CONTAINER.idFromName(containerName);
        const cloudflareContainer = env.MY_CONTAINER.get(cloudflareContainerId);
        
        // IMPORTANT: Call the dedicated streaming endpoint, NOT the generic /acp endpoint
        // The /acp endpoint uses dispatchJsonRpc() which buffers the entire response
        // The /acp/session/prompt?stream=true endpoint streams chunks in real-time
        const response = await cloudflareContainer.fetch(
          new Request('https://container/acp/session/prompt?stream=true', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-ACP-Bridge': 'true',
              'X-ACP-Streaming': 'true',
            },
            body: JSON.stringify(jsonRpcRequest.params), // Send params directly, not wrapped in JSON-RPC
          }),
        );
        
        console.log(`[ACP-BRIDGE-STREAM] Cloudflare container response status: ${response.status}`);
        return response;
      }
    } catch (error) {
      console.error(`[ACP-BRIDGE-STREAM] Stream routing error:`, error);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Stream routing failed',
          data: { error: error instanceof Error ? error.message : String(error) },
        },
        id: Date.now(),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Daytona Streaming: Fetch ACP via Public URL (bypass Toolbox API buffering)
   */
  private async fetchDaytonaACPStream(
    env: any,
    jsonRpcRequest: any,
    meta: { containerName: string; installationId?: string; userId?: string },
  ): Promise<Response> {
    const apiUrlRaw: string | undefined = env.DAYTONA_API_URL;
    const apiKey: string | undefined = env.DAYTONA_API_KEY;
    const organizationId: string | undefined = env.DAYTONA_ORGANIZATION_ID;

    if (!apiUrlRaw || !apiKey) {
      throw new Error('Daytona config missing: DAYTONA_API_URL and DAYTONA_API_KEY required');
    }

    let apiUrl = apiUrlRaw.split('#')[0];
    if (!apiUrl.endsWith('/')) apiUrl += '/';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (organizationId) {
      headers['X-Daytona-Organization-ID'] = organizationId;
    }

    // 1. Get or Create Sandbox with Public URL enabled
    const snapshotName = env.DAYTONA_ACP_SNAPSHOT_NAME || env.DAYTONA_SNAPSHOT_NAME || 'daytonaio/sandbox:0.5.0-slim';
    
    // List existing sandboxes
    const listResp = await fetch(new URL('sandbox', apiUrl).toString(), {
      method: 'GET',
      headers,
    });
    if (!listResp.ok) {
      throw new Error(`Daytona list sandboxes failed: ${listResp.status}`);
    }
    const sandboxes = (await listResp.json()) as any[];
    let sandbox = sandboxes.find((s: any) => s.state === 'started' || s.status === 'running');

    // Create if not exists
    if (!sandbox) {
      console.log(`[ACP-BRIDGE-STREAM] Creating new Daytona sandbox with public URL...`);
      const createResp = await fetch(new URL('sandbox', apiUrl).toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          snapshot: snapshotName,
          public: true, // CRITICAL: Enable public URL for streaming
          envVars: {
            OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
          },
          labels: {
            configId: meta.containerName,
            userId: meta.userId || 'unknown',
          },
        }),
      });
      if (!createResp.ok) {
        const errText = await createResp.text();
        throw new Error(`Daytona create sandbox failed: ${createResp.status} - ${errText}`);
      }
      sandbox = await createResp.json();

      // Poll until started (max 60s)
      const maxWait = 60000;
      const pollInterval = 2000;
      const startTime = Date.now();
      while (sandbox.state !== 'started' && sandbox.status !== 'running') {
        if (Date.now() - startTime > maxWait) {
          throw new Error(`Sandbox did not start in ${maxWait / 1000}s`);
        }
        await new Promise(r => setTimeout(r, pollInterval));
        const statusResp = await fetch(new URL(`sandbox/${sandbox.id}`, apiUrl).toString(), { headers });
        if (statusResp.ok) sandbox = await statusResp.json();
      }
    }

    // 2. Refresh to get public URL
    const statusResp = await fetch(new URL(`sandbox/${sandbox.id}`, apiUrl).toString(), { headers });
    if (statusResp.ok) sandbox = await statusResp.json();

    if (!sandbox.publicUrl) {
      console.error('[ACP-BRIDGE-STREAM] Sandbox has no publicUrl:', sandbox);
      throw new Error('Daytona sandbox has no public URL. Ensure sandbox is created with public:true.');
    }

    // 3. Fetch directly via Proxy (streaming enabled)
    // Direct Proxy Pattern: https://22222-<sandbox-id>.proxy.daytona.defikit.net/acp
    const targetUrl = `https://22222-${sandbox.id}.proxy.daytona.defikit.net/acp`;
    console.log(`[ACP-BRIDGE-STREAM] Proxying to Daytona Sandbox: ${targetUrl}`);

    return fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ACP-Streaming': 'true',
        'Authorization': `Bearer ${apiKey}`,
        ...(organizationId ? { 'X-Daytona-Organization-ID': organizationId } : {}),
      },
      body: JSON.stringify(jsonRpcRequest),
    });
  }

  /**
   * Handle session prompt side effects (audit logging, etc.)
   */
  async handleSessionPromptSideEffects(args: {
    env: any;
    sessionId?: string;
    result: ACPSessionPromptResult;
    userPrompt?: string;  // NEW: user's prompt text
  }): Promise<void> {
    const { env, sessionId, result, userPrompt } = args;

    const resolvedSessionId =
      sessionId || result.meta?.workspace?.sessionId || null;

    if (!resolvedSessionId) {
      console.warn(
        '[ACP-BRIDGE] Unable to log automation result - missing sessionId',
      );
      return;
    }

    // ✅ CRITICAL: Save messages to ACPSessionDO for persistence across container restarts
    if (userPrompt && result.summary) {
      try {
        const timestamp = Date.now();
        const messages: any[] = [
          {
            role: 'user',
            content: userPrompt,
            timestamp,
          },
          {
            role: 'assistant',
            content: result.summary,
            timestamp: timestamp + 1,
            metadata: {
              hadToolUsage: !!(result.githubAutomation || result.githubOperations),
              stopReason: result.stopReason,
            },
          },
        ];

        const sessionDO = env.ACP_SESSION.idFromName(resolvedSessionId);
        const sessionStub = env.ACP_SESSION.get(sessionDO);

        const saveResponse = await sessionStub.fetch('http://do/session/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: resolvedSessionId,
            messages,
          }),
        });

        if (saveResponse.ok) {
          console.log(`[ACP-BRIDGE] ✅ Saved ${messages.length} messages to session ${resolvedSessionId}`);
        } else {
          console.warn(`[ACP-BRIDGE] ⚠️ Failed to save messages: ${saveResponse.status}`);
        }
      } catch (saveError) {
        console.error(`[ACP-BRIDGE] Error saving messages:`, saveError);
        // Non-fatal - continue with other side effects
      }
    }

    // Save audit record
    const sanitizedAutomation = this.sanitizeGitHubAutomation(
      result.githubAutomation,
    );
    if (!sanitizedAutomation) {
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
  async getStatus(
    env: any,
  ): Promise<{ success: boolean; bridge: any; container: any }> {
    try {
      // Get status from container as well (use consistent ACP container name)
      const containerResponse =
        env.CONTAINER_PROVIDER === 'daytona'
          ? await this.fetchDaytonaHealth(env, { containerName: 'acp-session' })
          : await (async () => {
            const containerId = env.MY_CONTAINER.idFromName('acp-session');
            const container = env.MY_CONTAINER.get(containerId);
            return container.fetch(new Request('https://container/health'));
          })();

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

  private async fetchDaytonaACP(
    env: any,
    jsonRpcRequest: any,
    meta: {
      containerName: string;
      installationId?: string;
      userId?: string;
    },
  ): Promise<Response> {
    const apiUrlRaw: string | undefined = env.DAYTONA_API_URL;
    const apiKey: string | undefined = env.DAYTONA_API_KEY;
    if (!apiUrlRaw || !apiKey) {
      throw new Error(
        'CONTAINER_PROVIDER=daytona requires DAYTONA_API_URL and DAYTONA_API_KEY (ACP bridge)',
      );
    }

    // Sanitize API URL: remove hash and ensure trailing slash
    let apiUrl = apiUrlRaw.split('#')[0];
    if (!apiUrl.endsWith('/')) {
      apiUrl += '/';
    }

    // Get registered snapshot name from environment (from Daytona Dashboard)
    // Default to base Daytona sandbox image which includes Node.js
    const snapshotName: string =
      env.DAYTONA_ACP_SNAPSHOT_NAME || env.DAYTONA_SNAPSHOT_NAME || 'daytonaio/sandbox:0.5.0-slim';

    const configId: string =
      env.DAYTONA_ACP_CONFIG_ID || env.DAYTONA_CONFIG_ID || meta.containerName;

    // Organization ID for JWT token auth (required when using JWT instead of API key)
    const organizationId: string | undefined = env.DAYTONA_ORGANIZATION_ID;

    console.log(`[ACP-BRIDGE] Using Daytona Toolbox API with snapshot: ${snapshotName}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // Add organization ID header if configured (required for JWT auth)
    if (organizationId) {
      headers['X-Daytona-Organization-ID'] = organizationId;
      console.log(`[ACP-BRIDGE] Using organization ID: ${organizationId}`);
    }

    type Workspace = {
      id: string;
      status: string;
      state?: string;
      publicUrl?: string;
      ports?: Record<string, string>;
      configId?: string;
    };

    // Use relative path 'sandbox' to append to apiUrl (Daytona uses /sandbox not /workspace)
    const listUrl = new URL('sandbox', apiUrl);
    const listResp = await fetch(listUrl.toString(), {
      method: 'GET',
      headers,
    });
    if (!listResp.ok) {
      const text = await listResp.text();
      throw new Error(
        `Daytona list sandboxes failed (${listResp.status}): ${text}`,
      );
    }
    // Daytona /sandbox returns array directly
    const listJson = (await listResp.json()) as Workspace[];
    // Check for running/started sandbox - Daytona uses 'state' field
    const existing = listJson.find(
      (ws) => ws.state === 'started' || ws.status === 'running' || ws.status === 'ready',
    );

    const workspace = existing
      ? existing
      : await (async () => {
        console.log(`[ACP-BRIDGE] Creating new sandbox from snapshot: ${snapshotName}`);

        const createResp = await fetch(new URL('sandbox', apiUrl).toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            // Use 'snapshot' field with registered snapshot NAME or Docker image
            snapshot: snapshotName,
            // Set public:true for potential future HTTP access
            public: true,
            // Environment variables for the sandbox
            envVars: {
              OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
              OPENROUTER_DEFAULT_MODEL: env.OPENROUTER_DEFAULT_MODEL,
              OPENHANDS_API_KEY: env.OPENHANDS_API_KEY,
              OPENHANDS_DEFAULT_MODEL: env.OPENHANDS_DEFAULT_MODEL,
              ALLHANDS_API_KEY: env.ALLHANDS_API_KEY,
              ENABLE_DEEP_REASONING: env.ENABLE_DEEP_REASONING,
              DEEP_REASONING_THRESHOLD: env.DEEP_REASONING_THRESHOLD,
              PROCESSING_TIMEOUT: env.PROCESSING_TIMEOUT,
              CLAUDE_CODE_TIMEOUT: env.CLAUDE_CODE_TIMEOUT,
            },
            // Labels for identification (optional)
            labels: {
              configId,
              installationId: meta.installationId || 'unknown',
              userId: meta.userId || 'unknown',
            },
          }),
        });
        if (!createResp.ok) {
          const text = await createResp.text();
          throw new Error(
            `Daytona create sandbox failed (${createResp.status}): ${text}`,
          );
        }
        return (await createResp.json()) as Workspace;
      })();

    console.log(`[ACP-BRIDGE] Sandbox created: ${workspace.id}, state: ${workspace.state || workspace.status}`);

    // Wait for sandbox to be ready (poll until state is 'started')
    const maxWaitMs = 60000; // 60 seconds max wait
    const pollIntervalMs = 2000; // Poll every 2 seconds
    const startTime = Date.now();

    while (workspace.state !== 'started' && workspace.status !== 'running') {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(`Sandbox ${workspace.id} did not start within ${maxWaitMs / 1000}s (current state: ${workspace.state || workspace.status})`);
      }

      console.log(`[ACP-BRIDGE] Waiting for sandbox ${workspace.id} to start (state: ${workspace.state || workspace.status})...`);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Poll sandbox status
      const statusUrl = new URL(`sandbox/${workspace.id}`, apiUrl);
      const statusResp = await fetch(statusUrl.toString(), { method: 'GET', headers });
      if (statusResp.ok) {
        const updated = (await statusResp.json()) as Workspace;
        workspace.state = updated.state;
        workspace.status = updated.status;
        workspace.publicUrl = updated.publicUrl;
        workspace.ports = updated.ports;
      }
    }

    console.log(`[ACP-BRIDGE] Sandbox ready: ${workspace.id}, state: ${workspace.state || workspace.status}`);

    // Direct Proxy Pattern: https://22222-<sandbox-id>.proxy.daytona.defikit.net/acp
    // Use the exact pattern requested by user
    const targetUrl = `https://22222-${workspace.id}.proxy.daytona.defikit.net/acp`;
    
    console.log(`[ACP-BRIDGE] Proxying to Daytona Sandbox: ${targetUrl}`);

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`, // Explicitly pass the Daytona API Key
          ...(organizationId ? { 'X-Daytona-Organization-ID': organizationId } : {}),
        },
        body: JSON.stringify(jsonRpcRequest),
      });
      
      return response;
    } catch (error) {
       console.error(`[ACP-BRIDGE] Proxy request failed:`, error);
       throw error;
    }
  }



  /**
   * Execute ACP request via Daytona Toolbox API using curl with files
   * FIXED VERSION - Avoids node -e (which doesn't work) and uses file-based curl
   */


  private async fetchDaytonaHealth(
    env: any,
    meta: { containerName: string },
  ): Promise<Response> {
    // Reuse the same routing as ACP but hit /health.
    const apiUrlRaw: string | undefined = env.DAYTONA_API_URL;
    const apiKey: string | undefined = env.DAYTONA_API_KEY;
    const organizationId: string | undefined = env.DAYTONA_ORGANIZATION_ID;
    
    if (!apiUrlRaw || !apiKey) {
      throw new Error(
        'CONTAINER_PROVIDER=daytona requires DAYTONA_API_URL and DAYTONA_API_KEY (ACP bridge health)',
      );
    }

    // Sanitize API URL
    let apiUrl = apiUrlRaw.split('#')[0];
    if (!apiUrl.endsWith('/')) {
      apiUrl += '/';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (organizationId) {
      headers['X-Daytona-Organization-ID'] = organizationId;
    }

    // List sandboxes to check for running instances
    const listUrl = new URL('sandbox', apiUrl);
    const listResp = await fetch(listUrl.toString(), {
      method: 'GET',
      headers,
    });
    
    if (!listResp.ok) {
      const text = await listResp.text();
      return new Response(text, { status: listResp.status });
    }
    
    // Daytona /sandbox returns array directly
    const sandboxes = (await listResp.json()) as Array<{
      id: string;
      state?: string;
      status: string;
    }>;
    
    // Find a running sandbox
    const runningSandbox = sandboxes.find(
      (s) => s.state === 'started' || s.status === 'running' || s.status === 'ready',
    );
    
    if (!runningSandbox) {
      return new Response(
        JSON.stringify({ ok: false, error: 'no_running_sandbox' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Return health status based on sandbox state
    // No need for HTTP health check - just verify sandbox is running
    return new Response(
      JSON.stringify({
        ok: true,
        sandboxId: runningSandbox.id,
        state: runningSandbox.state || runningSandbox.status,
        provider: 'daytona-toolbox',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
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
   * Route an ACP method asynchronously (returns immediately with jobId)
   * Actual processing happens in background via Durable Object
   */
  async routeACPMethodAsync(
    method: string,
    params: any,
    env: any,
  ): Promise<{
    jobId: string;
    status: string;
  }> {
    try {
      // Validate userId
      const userId = params?.userId;
      if (!userId) {
        throw new Error('userId is required for multi-tenant security');
      }

      // Create async job in AsyncJobDO
      const asyncJobDO = this.getAsyncJobDO(env);
      const createResponse = await asyncJobDO.fetch(
        new Request('http://localhost/job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params }),
        }),
      );

      if (!createResponse.ok) {
        throw new Error(
          `Failed to create async job: ${createResponse.statusText}`,
        );
      }

      const jobData = (await createResponse.json()) as any;

      // Start background processing (fire-and-forget)
      // Use ctx.waitUntil if available, or just fire the promise
      const processingPromise = this.processAsyncJob(
        jobData.jobId,
        method,
        params,
        env,
      );

      // In Cloudflare Workers, we can use event.waitUntil to keep processing after response
      // For now, just fire-and-forget (container will continue processing)
      processingPromise.catch((error) => {
        console.error(
          `[ACP-BRIDGE] Background job ${jobData.jobId} failed:`,
          error,
        );
      });

      console.log(
        `[ACP-BRIDGE] Created async job: ${jobData.jobId} for method: ${method}`,
      );

      return {
        jobId: jobData.jobId,
        status: jobData.status,
      };
    } catch (error) {
      console.error('[ACP-BRIDGE] Failed to create async job:', error);
      throw error;
    }
  }

  /**
   * Process async job in background
   */
  private async processAsyncJob(
    jobId: string,
    method: string,
    params: any,
    env: any,
  ): Promise<void> {
    try {
      console.log(
        `[ACP-BRIDGE] Starting background processing for job: ${jobId}`,
      );

      // Update job status to processing
      const asyncJobDO = this.getAsyncJobDO(env);
      await asyncJobDO.fetch(
        new Request(`http://localhost/job/${jobId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'processing' }),
        }),
      );

      // Execute the actual ACP method (this can take a long time)
      const result = await this.routeACPMethod(method, params, env);

      // Update job with result
      await asyncJobDO.fetch(
        new Request(`http://localhost/job/${jobId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', result }),
        }),
      );

      console.log(`[ACP-BRIDGE] Job ${jobId} completed successfully`);
    } catch (error) {
      console.error(`[ACP-BRIDGE] Job ${jobId} failed:`, error);

      // Update job with error
      const asyncJobDO = this.getAsyncJobDO(env);
      await asyncJobDO
        .fetch(
          new Request(`http://localhost/job/${jobId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'failed',
              error: {
                code: 'PROCESSING_ERROR',
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          }),
        )
        .catch((e: any) => {
          console.error(
            `[ACP-BRIDGE] Failed to update job ${jobId} with error:`,
            e,
          );
        });
    }
  }

  /**
   * Get async job status
   */
  async getAsyncJobStatus(jobId: string, env: any): Promise<any> {
    try {
      const asyncJobDO = this.getAsyncJobDO(env);
      const response = await asyncJobDO.fetch(
        new Request(`http://localhost/job/${jobId}`, {
          method: 'GET',
        }),
      );

      if (!response.ok) {
        if (response.status === 404) {
          return {
            error: 'Job not found',
            code: 'JOB_NOT_FOUND',
          };
        }
        throw new Error(`Failed to get job status: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(
        `[ACP-BRIDGE] Failed to get job status for ${jobId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get AsyncJobDO instance
   */
  private getAsyncJobDO(env: any): any {
    const id = env.ASYNC_JOB.idFromName('async-jobs');
    return env.ASYNC_JOB.get(id);
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
      throw new Error(
        `User ${userId} not found. Please register first via /register-user`,
      );
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

      // Fire-and-forget with timeout to prevent blocking HTTP response
      const auditPromise = stub.fetch(
        new Request(
          `https://acp-session/${encodeURIComponent(sessionId)}/audit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
          },
        ),
      );

      // Race between audit call and 1-second timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Audit timeout')), 1000),
      );

      await Promise.race([auditPromise, timeoutPromise]).catch((error) => {
        console.warn(
          '[ACP-BRIDGE] Session audit timed out or failed:',
          error.message,
        );
      });
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
