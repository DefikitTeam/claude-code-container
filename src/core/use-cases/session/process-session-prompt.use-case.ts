import { IContainerService } from '../../interfaces/services/container.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface ProcessSessionPromptDto {
  sessionId: string;
  userId: string;
  installationId: string;
  prompt: string;
  githubToken: string;
}

export interface ProcessSessionPromptResult {
  success: boolean;
  commitSha: string;
  commitUrl: string;
  commitMessage: string;
  filesChanged: Array<{ path: string; status: string }>;
  workingBranch: string;
  totalCommits: number;
}

/**
 * Process Session Prompt Use Case
 * Processes a prompt in coding mode session, creating a commit on the persistent working branch
 */
export class ProcessSessionPromptUseCase {
  constructor(
    private readonly containerService: IContainerService,
    private readonly env: Env,
  ) {}

  async execute(
    dto: ProcessSessionPromptDto,
  ): Promise<ProcessSessionPromptResult> {
    console.log(
      `[ProcessSessionPrompt] Executing for session ${dto.sessionId}`,
    );

    // Validate input
    if (!dto.sessionId || !dto.prompt || !dto.githubToken) {
      console.error('[ProcessSessionPrompt] Missing required fields');
      throw new ValidationError(
        'sessionId, prompt, and githubToken are required',
      );
    }

    // Get session from Durable Object
    const sessionDO = this.env.ACP_SESSION.idFromName(dto.sessionId);
    const sessionStub = this.env.ACP_SESSION.get(sessionDO);
    const sessionResponse = await sessionStub.fetch(
      `http://do/session?sessionId=${dto.sessionId}`,
    );

    if (!sessionResponse.ok) {
      console.error('[ProcessSessionPrompt] Session not found');
      throw new Error('Session not found');
    }

    const session = await sessionResponse.json<any>();
    console.log(
      `[ProcessSessionPrompt] Session loaded. CodingMode: ${session.codingModeEnabled}`,
    );

    // Validate coding mode is enabled
    if (!session.codingModeEnabled) {
      throw new ValidationError('Coding mode is not enabled for this session');
    }

    if (
      !session.workingBranch ||
      !session.selectedRepository ||
      !session.selectedBranch
    ) {
      console.error('[ProcessSessionPrompt] Incomplete config', session);
      throw new ValidationError(
        'Session coding mode configuration is incomplete',
      );
    }

    // Extract repository owner and name from selectedRepository (format: "owner/repo")
    const [owner, repo] = session.selectedRepository.split('/');
    if (!owner || !repo) {
      throw new ValidationError('Invalid repository format');
    }

    // Spawn container if not already assigned
    let containerId = session.containerId;
    if (!containerId) {
      console.log('[ProcessSessionPrompt] Spawning new container');
      const result = await this.containerService.spawn({
        configId: dto.sessionId,
        installationId: dto.installationId,
        userId: dto.userId,
        containerImage: 'default', // Use default container image
        environmentVariables: {
          GITHUB_TOKEN: dto.githubToken,
        },
        resourceLimits: {
          cpuMillis: 1000,
          memoryMb: 512,
          timeoutSeconds: 300,
        },
      });
      containerId = result.containerId;

      // Update session with container ID
      const updateResponse = await sessionStub.fetch('http://do/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: dto.sessionId,
          containerId,
        }),
      });

      if (!updateResponse.ok) {
        console.error('Failed to update session with containerId');
      }
    } else {
      console.log(`[ProcessSessionPrompt] Reusing container ${containerId}`);
    }

    // Prepare JSON-RPC request for ACP session/prompt
    // This uses the main branch's robust ACP flow which handles git internally via Claude SDK
    const rpcRequest = {
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        sessionId: dto.sessionId,
        content: [{ type: 'text', text: dto.prompt }],
        // Enable commit-only mode (no PRs)
        automation: { mode: 'commit-only' },
        // Pass repository context for persistent branch mode
        // Format must match Container's PromptProcessor.findRepositoryCandidate expectations
        agentContext: {
          repository: {
            owner: owner,
            name: repo,
            cloneUrl: `https://github.com/${owner}/${repo}.git`,
            defaultBranch: session.selectedBranch || 'main',
          },
          automation: {
            mode: 'commit-only',
            branchName: session.workingBranch,
            baseBranch: session.selectedBranch || 'main',
          },
        },
        // Pass authentication
        githubToken: dto.githubToken,
        userId: dto.userId,
        installationId: dto.installationId,
        // CRITICAL: Pass API key for LLM (OpenRouter/Anthropic)
        anthropicApiKey:
          (this.env as any).OPENROUTER_API_KEY ||
          (this.env as any).ANTHROPIC_API_KEY,
      },
      id: Date.now(),
    };

    console.log('[ProcessSessionPrompt] Calling ContainerService execute');
    try {
      // Call container's /acp endpoint via containerService
      // Flow: Worker → ContainerDO → Container HTTP server (/acp)
      const result = await this.containerService.execute(
        containerId,
        JSON.stringify(rpcRequest),
        '/acp',
      );

      console.log(
        `[ProcessSessionPrompt] Container executed. ExitCode: ${result.exitCode}`,
      );

      if (result.exitCode !== 0) {
        throw new Error(`Container execution failed: ${result.stderr}`);
      }

      // Parse JSON-RPC response
      // Response format: { jsonrpc: "2.0", result: { ... }, id: ... } or { jsonrpc: "2.0", error: { ... }, id: ... }
      let rpcResponse;
      try {
        rpcResponse = JSON.parse(result.stdout);
      } catch (e) {
        throw new Error(`Failed to parse container response: ${result.stdout}`);
      }

      if (rpcResponse.error) {
        const errorData = rpcResponse.error.data
          ? JSON.stringify(rpcResponse.error.data)
          : '';
        throw new Error(
          `ACP Error ${rpcResponse.error.code}: ${rpcResponse.error.message} ${errorData}`,
        );
      }

      const containerResult = rpcResponse.result;

      // Extract commit info from githubAutomation structure
      const automation = containerResult.githubAutomation || {};
      const commit = automation.commit || {};
      const pr = automation.pullRequest || {};
      const filesChanged =
        commit.filesChanged || containerResult.filesChanged || [];

      // Build commit URL from sha and repository
      const commitUrl = commit.sha
        ? `https://github.com/${owner}/${repo}/commit/${commit.sha}`
        : '';

      // Update commit tracking in session
      const updateResponse = await sessionStub.fetch(
        'http://do/session/commit-tracking',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: dto.sessionId,
            commitSha: commit.sha || '',
          }),
        },
      );

      if (!updateResponse.ok) {
        console.error('Failed to update commit tracking in session');
      }

      return {
        success: true,
        commitSha: commit.sha || '',
        commitUrl: commitUrl,
        commitMessage: commit.message || containerResult.summary || '',
        filesChanged: filesChanged,
        workingBranch: automation.branch || session.workingBranch,
        totalCommits: (session.totalCommits || 0) + (commit.sha ? 1 : 0),
        // Include additional data for FE display
        pullRequestUrl: pr.url || '',
        pullRequestNumber: pr.number || null,
        summary: containerResult.summary || '',
        status: automation.status || 'unknown',
      };
    } catch (err) {
      console.error('[ProcessSessionPrompt] Execution error:', err);
      throw err;
    }
  }
}
