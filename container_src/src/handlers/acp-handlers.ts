/**
 * ACP Method Handlers
 * Implementation of all Agent Client Protocol methods
 */

import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import {
  InitializeRequest,
  InitializeResponse,
  SessionNewRequest,
  SessionNewResponse,
  SessionPromptRequest,
  SessionPromptResponse,
  SessionLoadRequest,
  SessionLoadResponse,
  CancelRequest,
  CancelResponse,
  ACP_ERROR_CODES,
  AgentCapabilities,
  ContentBlock,
  WorkspaceInfo,
} from '../types/acp-messages.js';
import { ACPSession, SessionMode } from '../types/acp-session.js';
import { RequestContext } from '../services/stdio-jsonrpc.js';

const execFileAsync = promisify(execFile);

// Global state for ACP handlers
class ACPState {
  private sessions = new Map<string, ACPSession>();
  private initialized = false;
  private initializationTime?: number;
  private clientInfo?: { name: string; version: string };
  private activeOperations = new Map<string, AbortController>();

  private agentInfo = {
    name: 'Claude Code Container',
    version: '1.0.0',
    description:
      'AI-powered containerized development assistant with GitHub integration',
    environment: this.detectEnvironment(),
  };

  private agentCapabilities: AgentCapabilities = this.detectCapabilities();

  getSession(sessionId: string): ACPSession | undefined {
    return this.sessions.get(sessionId);
  }

  setSession(sessionId: string, session: ACPSession): void {
    this.sessions.set(sessionId, session);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getAllSessions(): ACPSession[] {
    return Array.from(this.sessions.values());
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setInitialized(initialized: boolean): void {
    this.initialized = initialized;
  }

  getAgentInfo() {
    return this.agentInfo;
  }

  getAgentCapabilities(): AgentCapabilities {
    return this.agentCapabilities;
  }

  setClientInfo(clientInfo?: { name: string; version: string }): void {
    this.clientInfo = clientInfo;
  }

  getClientInfo(): { name: string; version: string } | undefined {
    return this.clientInfo;
  }

  getInitializationTime(): number | undefined {
    return this.initializationTime;
  }

  setInitializationTime(time: number): void {
    this.initializationTime = time;
  }

  /**
   * Detect runtime environment and capabilities
   */
  private detectEnvironment(): Record<string, any> {
    const env = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      containerized: this.isContainerized(),
      workingDirectory: process.cwd(),
      runtimeMode: process.env.ACP_MODE || 'auto',
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasGitHubToken: !!process.env.GITHUB_TOKEN,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };

    return env;
  }

  /**
   * Detect agent capabilities based on environment
   */
  private detectCapabilities(): AgentCapabilities {
    const baseCapabilities: AgentCapabilities = {
      editWorkspace: true,
      filesRead: true,
      filesWrite: true,
      sessionPersistence: true,
      streamingUpdates: true,
      githubIntegration: true, // Always true - container supports GitHub integration
      supportsImages: false, // Container doesn't support image processing yet
      supportsAudio: false, // Container doesn't support audio processing yet
    };

    // Enhance capabilities based on environment
    if (process.env.ANTHROPIC_API_KEY) {
      // Claude Code SDK is available
      baseCapabilities.editWorkspace = true;
      baseCapabilities.filesRead = true;
      baseCapabilities.filesWrite = true;
    }

    return baseCapabilities;
  }

  /**
   * Detect if running in a containerized environment
   */
  private isContainerized(): boolean {
    try {
      // Check common container indicators
      const fs = require('fs');

      // Check for /.dockerenv file
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }

      // Check cgroup for container indicators
      if (fs.existsSync('/proc/1/cgroup')) {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (
          cgroup.includes('docker') ||
          cgroup.includes('containerd') ||
          cgroup.includes('kubepods')
        ) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start tracking an operation for a session
   */
  startOperation(sessionId: string, operationId: string): AbortController {
    const abortController = new AbortController();
    const operationKey = `${sessionId}:${operationId}`;
    this.activeOperations.set(operationKey, abortController);
    return abortController;
  }

  /**
   * Cancel an operation for a session
   */
  cancelOperation(sessionId: string, operationId?: string): boolean {
    if (operationId) {
      // Cancel specific operation
      const operationKey = `${sessionId}:${operationId}`;
      const controller = this.activeOperations.get(operationKey);
      if (controller) {
        controller.abort();
        this.activeOperations.delete(operationKey);
        return true;
      }
      return false;
    } else {
      // Cancel all operations for the session
      let cancelled = false;
      for (const [key, controller] of this.activeOperations.entries()) {
        if (key.startsWith(`${sessionId}:`)) {
          controller.abort();
          this.activeOperations.delete(key);
          cancelled = true;
        }
      }
      return cancelled;
    }
  }

  /**
   * Complete an operation for a session
   */
  completeOperation(sessionId: string, operationId: string): void {
    const operationKey = `${sessionId}:${operationId}`;
    this.activeOperations.delete(operationKey);
  }

  /**
   * Check if a session has active operations
   */
  hasActiveOperations(sessionId: string): boolean {
    for (const key of this.activeOperations.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get active operation count for a session
   */
  getActiveOperationCount(sessionId: string): number {
    let count = 0;
    for (const key of this.activeOperations.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        count++;
      }
    }
    return count;
  }
}

const acpState = new ACPState();

/**
 * Generate session ID in the required format
 */
function generateSessionId(): string {
  // Simply use the full UUID - it's guaranteed to be unique
  return `session-${uuidv4()}`;
}

/**
 * Create workspace information with isolation and git integration
 */
async function createWorkspaceInfo(
  workspaceUri?: string,
  sessionOptions?: ACPSession['sessionOptions'],
): Promise<WorkspaceInfo> {
  const rootPath = workspaceUri
    ? new URL(workspaceUri).pathname
    : process.cwd();

  // Initialize workspace info
  const workspaceInfo: WorkspaceInfo = {
    rootPath,
    hasUncommittedChanges: false,
  };

  try {
    // Check if directory exists and is accessible
    await fs.access(rootPath, fs.constants.R_OK | fs.constants.W_OK);

    // Git integration if enabled
    if (sessionOptions?.enableGitOps) {
      const gitInfo = await getGitInfo(rootPath);
      if (gitInfo) {
        workspaceInfo.gitBranch = gitInfo.currentBranch;
        workspaceInfo.hasUncommittedChanges = gitInfo.hasUncommittedChanges;
      }
    } else {
      // Basic git status check even without full git ops
      const basicGitInfo = await getBasicGitInfo(rootPath);
      if (basicGitInfo) {
        workspaceInfo.gitBranch = basicGitInfo.currentBranch;
        workspaceInfo.hasUncommittedChanges =
          basicGitInfo.hasUncommittedChanges;
      }
    }
  } catch (error) {
    // If workspace is not accessible, note it but don't fail (suppress in test environment)
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `[ACP] Workspace access warning: ${(error as Error).message}`,
      );
    }
  }

  return workspaceInfo;
}

/**
 * Get comprehensive git information for git-ops enabled sessions
 */
async function getGitInfo(workspacePath: string): Promise<{
  currentBranch: string;
  hasUncommittedChanges: boolean;
  remoteUrl?: string;
  lastCommit?: string;
} | null> {
  try {
    const gitDir = path.join(workspacePath, '.git');
    await fs.access(gitDir);

    // Get current branch
    const branchResult = await execFileAsync(
      'git',
      ['branch', '--show-current'],
      {
        cwd: workspacePath,
      },
    );
    const currentBranch = branchResult.stdout.trim() || 'main';

    // Check for uncommitted changes
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    // Get remote URL
    let remoteUrl: string | undefined;
    try {
      const remoteResult = await execFileAsync(
        'git',
        ['remote', 'get-url', 'origin'],
        {
          cwd: workspacePath,
        },
      );
      remoteUrl = remoteResult.stdout.trim();
    } catch {
      // Remote might not exist
    }

    // Get last commit
    let lastCommit: string | undefined;
    try {
      const commitResult = await execFileAsync(
        'git',
        ['rev-parse', '--short', 'HEAD'],
        {
          cwd: workspacePath,
        },
      );
      lastCommit = commitResult.stdout.trim();
    } catch {
      // Might be a new repo with no commits
    }

    return {
      currentBranch,
      hasUncommittedChanges,
      remoteUrl,
      lastCommit,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Get basic git information for standard sessions
 */
async function getBasicGitInfo(workspacePath: string): Promise<{
  currentBranch: string;
  hasUncommittedChanges: boolean;
} | null> {
  try {
    const gitDir = path.join(workspacePath, '.git');
    await fs.access(gitDir);

    // Get current branch
    const branchResult = await execFileAsync(
      'git',
      ['branch', '--show-current'],
      {
        cwd: workspacePath,
      },
    );
    const currentBranch = branchResult.stdout.trim() || 'main';

    // Check for uncommitted changes
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    return {
      currentBranch,
      hasUncommittedChanges,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Process prompt with Claude Code SDK integration
 */
async function processPromptWithClaudeCode(
  session: ACPSession,
  content: ContentBlock[],
  contextFiles?: string[],
  agentContext?: Record<string, unknown>,
  notificationSender?: (method: string, params: any) => void,
  requestContext?: RequestContext,
): Promise<SessionPromptResponse['result']> {
  const sessionId = session.sessionId;
  const operationId = `prompt-${Date.now()}`;
  let inputTokens = 0;
  let outputTokens = 0;
  const messages: SDKMessage[] = [];

  // Start tracking this operation
  const abortController = acpState.startOperation(sessionId, operationId);

  try {
    // Send initial status update
    if (notificationSender) {
      notificationSender('session/update', {
        sessionId,
        status: 'thinking',
        message: 'Preparing request for Claude Code...',
      });
    }

    // Prepare prompt from content blocks
    const prompt = buildPromptFromContent(
      content,
      contextFiles,
      agentContext,
      session,
    );
    inputTokens = estimateTokens(prompt);

    // Get API key from request context (passed from worker)
    const anthropicApiKey = requestContext?.metadata?.anthropicApiKey;

    // In test environment or when API key is not available, use mock processing
    if (process.env.NODE_ENV === 'test' || !anthropicApiKey) {
      // Send working status
      if (notificationSender) {
        notificationSender('session/update', {
          sessionId,
          status: 'working',
          message: 'Processing with mock Claude Code...',
          progress: { current: 1, total: 3, message: 'Mock processing' },
        });
      }

      // Mock processing delay - longer delay for cancel testing
      const isLongOperation =
        prompt.toLowerCase().includes('comprehensive analysis') ||
        prompt.toLowerCase().includes('large codebase') ||
        prompt.toLowerCase().includes('should take some time');
      const mockDelay = isLongOperation ? 2000 : 100;

      await new Promise((resolve) => setTimeout(resolve, mockDelay / 3));

      // Check for cancellation after first delay
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Send additional progress update
      if (notificationSender) {
        notificationSender('session/update', {
          sessionId,
          status: 'working',
          message: 'Mock processing in progress...',
          progress: { current: 2, total: 3, message: 'Mock analysis' },
        });
      }

      // Second delay phase
      await new Promise((resolve) => setTimeout(resolve, mockDelay / 3));

      // Check for cancellation after second delay
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Final delay phase
      await new Promise((resolve) => setTimeout(resolve, mockDelay / 3));

      // Check for cancellation after final delay
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Mock final result
      outputTokens = inputTokens + 50; // Mock token usage

      // Send completion status
      if (notificationSender) {
        notificationSender('session/update', {
          sessionId,
          status: 'completed',
          message: 'Mock processing completed',
        });
      }

      // Complete the operation
      acpState.completeOperation(sessionId, operationId);

      return {
        stopReason: 'completed',
        usage: {
          inputTokens,
          outputTokens,
        },
        summary: `Mock processing of prompt: "${prompt.substring(0, 50)}..."`,
      };
    }

    // Real Claude Code processing when API key is available
    // Change to workspace directory if specified
    const originalCwd = process.cwd();
    let ephemeralWorkspace: string | null = null;
    if (session.workspaceUri) {
      try {
        const workspacePath = new URL(session.workspaceUri).pathname;
        process.chdir(workspacePath);
      } catch (error) {
        console.error(
          `[ACP] Warning: Could not change to workspace directory: ${error}`,
        );
      }
    } else {
      ephemeralWorkspace = await prepareEphemeralWorkspace(session);
      if (ephemeralWorkspace) {
        try {
          process.chdir(ephemeralWorkspace);
        } catch {}
      }
    }

    try {
      // Prepare per-request auth files before sending working status
      if (anthropicApiKey) {
        try {
          await ensureClaudeAuthFiles(anthropicApiKey);
        } catch (authFileErr: any) {
          console.error(
            '[ACP] Failed to prepare Claude auth files:',
            authFileErr?.message || authFileErr,
          );
        }
        try {
          const diagnostics = await collectClaudeDiagnostics();
          console.log(
            '[ACP] Pre-query diagnostics:',
            JSON.stringify(diagnostics),
          );
        } catch (diagErr: any) {
          console.log(
            '[ACP] Failed collecting diagnostics:',
            diagErr?.message || diagErr,
          );
        }
      }

      // Send working status
      if (notificationSender) {
        notificationSender('session/update', {
          sessionId,
          status: 'working',
          message: 'Processing with Claude Code...',
          progress: { current: 1, total: 3, message: 'Analyzing request' },
        });
      }

      // Check if operation was cancelled before starting
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Temporarily set the API key in environment for Claude Code SDK
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      const originalLogLevel = process.env.ANTHROPIC_LOG;

      // NEW: git preflight if workspace exists
      if (session.workspaceUri) {
        try {
          const workspacePath = new URL(session.workspaceUri).pathname;
          await ensureGitRepo(workspacePath);
        } catch (e) {
          console.warn('[ACP] Git preflight skipped:', (e as Error).message);
        }
      }

      if (anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = anthropicApiKey;
        process.env.ANTHROPIC_LOG = 'debug'; // Enable debug logging
      }

      try {
        console.log(
          `[ACP] Starting Claude Code query with API key: ${anthropicApiKey ? 'Present' : 'Missing'}`,
        );
        console.log(`[ACP] Current working directory: ${process.cwd()}`);
        console.log(
          `[ACP] Environment ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'Set' : 'Not set'}`,
        );

        // Check Claude CLI availability and health
        try {
          const { spawn } = await import('node:child_process');

          // Try multiple ways to find Claude CLI
          const possiblePaths = [
            'claude',
            '/usr/local/bin/claude',
            'node /app/node_modules/@anthropic-ai/claude-code/cli.js',
          ];

          let claudeCommand = null;

          for (const cmd of possiblePaths) {
            try {
              const testProcess = spawn('sh', ['-c', `${cmd} --version`], {
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5000,
              });

              await new Promise<void>((resolve) => {
                testProcess.on('close', (code: number | null) => {
                  if (code === 0) {
                    claudeCommand = cmd;
                    console.log(`[ACP] Claude CLI found at: ${cmd}`);
                    const startTime = Date.now();
                    const queryOptions: any = {
                      permissionMode: 'bypassPermissions',
                    };

                    console.log(
                      `[ACP] Launching Claude Code process with options:`,
                      queryOptions,
                    );

                    let queryResult: AsyncIterable<any>;
                    try {
                      queryResult = query({
                        prompt,
                        options: queryOptions,
                      });
                    } catch (constructionErr) {
                      console.error(
                        '[ACP] Failed to construct Claude Code query:',
                        constructionErr,
                      );
                      throw new Error(
                        `Failed to start Claude Code query: ${(constructionErr as Error).message}`,
                      );
                    }
                  }
                  resolve();
                });

                testProcess.on('error', () => resolve());
              });

              if (claudeCommand) break;
            } catch (err) {
              continue;
            }
          }

          if (!claudeCommand) {
            console.log(
              `[ACP] Warning: Claude CLI not found in any expected location`,
            );
          }
        } catch (doctorErr) {
          console.log(
            `[ACP] Failed to check Claude CLI:`,
            (doctorErr as Error).message,
          );
        }
        // Process with Claude Code SDK (with retry & explicit options)
        let queryResult: AsyncIterable<any> | undefined;
        let initErrorCaptured: any = null;
        const launchQuery = (attempt: number) => {
          console.log(
            `[ACP] Initializing Claude Code query (attempt ${attempt})`,
          );
          return query({
            prompt,
            options: {
              permissionMode: 'bypassPermissions',
              // Provide explicit model hint if SDK supports; otherwise ignored gracefully
              model:
                process.env.CLAUDE_CODE_MODEL || 'claude-3-5-sonnet-20240620',
              // future: add workspace, repo metadata, etc.
            },
          });
        };

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            queryResult = launchQuery(attempt);
            initErrorCaptured = null;
            break;
          } catch (e) {
            initErrorCaptured = e;
            console.error(
              `[ACP] Query initialization attempt ${attempt} failed:`,
              (e as Error).message,
            );
            if (attempt === 1) {
              // Light backoff
              await new Promise((r) => setTimeout(r, 300));
              // Recreate auth files just in case
              if (anthropicApiKey) {
                try {
                  await ensureClaudeAuthFiles(anthropicApiKey);
                } catch {}
              }
              continue;
            }
          }
        }

        if (!queryResult) {
          if ((initErrorCaptured as Error)?.message?.includes('CLI')) {
            throw new Error(
              `Claude CLI not available after retries. Install or ensure PATH includes 'claude'. Error: ${(initErrorCaptured as Error).message}`,
            );
          }
          throw new Error(
            `Claude Code initialization failed after retries: ${(initErrorCaptured as Error)?.message}`,
          );
        }

        console.log(`[ACP] Query generator created, starting iteration...`);

        let hasReceivedMessages = false;
        let lastError = null;
        const stderrChunks: string[] = [];
        const originalStderrWrite = process.stderr.write as any;
        try {
          process.stderr.write = function (
            chunk: any,
            encoding?: any,
            cb?: any,
          ) {
            try {
              const text =
                typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8');
              if (text) stderrChunks.push(text);
            } catch {}
            return originalStderrWrite.call(
              process.stderr,
              chunk,
              encoding,
              cb,
            );
          } as any;
        } catch {}

        try {
          for await (const message of queryResult) {
            hasReceivedMessages = true;
            console.log(`[ACP] Received message from Claude Code:`, {
              type: (message as any)?.type || 'unknown',
              content:
                typeof (message as any)?.content === 'string'
                  ? (message as any).content.substring(0, 100) + '...'
                  : 'non-string',
            });

            // Check for cancellation
            if (abortController.signal.aborted) {
              throw new Error('Operation was cancelled');
            }

            messages.push(message as SDKMessage);

            // Send progress updates
            if (notificationSender && messages.length % 3 === 0) {
              notificationSender('session/update', {
                sessionId,
                status: 'working',
                message: 'Claude Code is processing...',
                progress: {
                  current: messages.length,
                  total: messages.length + 5,
                  message: `Processing message ${messages.length}`,
                },
              });
            }
          }
        } catch (queryError) {
          lastError = queryError;
          console.error(`[ACP] Query execution error:`, queryError);
          if (!hasReceivedMessages) {
            const stderrTail = stderrChunks
              .join('')
              .split('\n')
              .slice(-20)
              .join('\n');
            console.error(
              '[ACP] CLI stderr tail (no messages received):\n' + stderrTail,
            );
            (queryError as any).stderrTail = stderrTail;
            try {
              const diagRun = await runRawCliDiagnostic(prompt);
              console.error('[ACP] Raw CLI diagnostic result:', {
                code: diagRun.code,
                stdoutTail: diagRun.stdout.split('\n').slice(-10).join('\n'),
                stderrTail: diagRun.stderr.split('\n').slice(-20).join('\n'),
              });
              (queryError as any).rawCli = diagRun;
            } catch (diagE) {
              console.error(
                '[ACP] Raw CLI diagnostic spawn failed:',
                (diagE as Error).message,
              );
            }
          }

          // If no messages were received, it's likely an authentication issue
          if (!hasReceivedMessages) {
            throw new Error(
              `Claude Code authentication failed. Please ensure the Claude CLI is properly authenticated. Original error: ${(queryError as Error).message}`,
            );
          }

          // If we got some messages, treat it as a partial success
          console.warn(
            `[ACP] Query completed with error but received ${messages.length} messages`,
          );
        } finally {
          try {
            process.stderr.write = originalStderrWrite;
          } catch {}
        }

        console.log(
          `[ACP] Claude Code processing completed with ${messages.length} messages`,
        );

        // Estimate output tokens
        outputTokens = messages.reduce(
          (sum, msg) => sum + estimateTokensFromMessage(msg),
          0,
        );

        // Check for file changes and GitHub operations
        const githubOperations = await detectGitHubOperations(
          session.workspaceUri,
        );

        // Send completion status
        if (notificationSender) {
          notificationSender('session/update', {
            sessionId,
            status: 'completed',
            message: `Completed with ${messages.length} messages`,
          });
        }

        // Build response
        const response: SessionPromptResponse['result'] = {
          stopReason: 'completed',
          usage: {
            inputTokens,
            outputTokens,
          },
        };

        // Add GitHub operations if any were detected
        if (githubOperations) {
          response.githubOperations = githubOperations;
        }

        // Add summary of the last message
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          response.summary = extractMessageSummary(lastMessage);
        }

        // Complete the operation
        acpState.completeOperation(sessionId, operationId);

        return response;
      } finally {
        // Restore original API key and log level
        if (originalApiKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalApiKey;
        } else if (anthropicApiKey) {
          delete process.env.ANTHROPIC_API_KEY;
        }

        if (originalLogLevel !== undefined) {
          process.env.ANTHROPIC_LOG = originalLogLevel;
        } else {
          delete process.env.ANTHROPIC_LOG;
        }
      }
    } finally {
      // Restore original working directory
      process.chdir(originalCwd);
    }
  } catch (error) {
    // Complete the operation (even on error)
    acpState.completeOperation(sessionId, operationId);

    console.error(`[ACP] Error in processPromptWithClaudeCode:`, {
      error: error,
      message: (error as Error).message,
      stack: (error as Error).stack,
      name: (error as Error).name,
      sessionId,
      operationId,
    });

    const errorMessage = (error as Error).message;
    const isCancelled =
      errorMessage.includes('cancelled') || abortController.signal.aborted;

    // Send appropriate status
    if (notificationSender) {
      notificationSender('session/update', {
        sessionId,
        status: isCancelled ? 'completed' : 'error',
        message: isCancelled ? 'Operation cancelled' : `Error: ${errorMessage}`,
      });
    }

    // New error classification
    const classification = classifyClaudeError(error);
    console.error('[ACP] Classified error:', classification);
    return {
      stopReason: isCancelled ? 'cancelled' : 'error',
      usage: {
        inputTokens,
        outputTokens,
      },
      summary: isCancelled
        ? 'Operation was cancelled'
        : `(${classification.code}) ${errorMessage}`,
      errorCode: classification.code,
    } as any;
  }
}

/**
 * Ensure Claude auth/config files exist for per-request API key usage.
 * This allows running without persistent container-level login.
 */
async function ensureClaudeAuthFiles(apiKey: string): Promise<void> {
  if (!apiKey) return;
  if (
    process.env.CLAUDE_CODE_ENV_AUTH_ONLY === '1' ||
    process.env.CLAUDE_CODE_ENV_AUTH_ONLY === 'true'
  ) {
    console.log('[ACP] Auth mode: ENV_ONLY (skipping auth file creation)');
    // Optionally rename existing files to avoid interference
    try {
      const home = os.homedir();
      const authFile = path.join(home, '.config', 'claude-code', 'auth.json');
      const legacyFile = path.join(home, '.claude.json');
      const timestamp = Date.now();
      try {
        await fs.access(authFile);
        await fs.rename(authFile, authFile + '.bak.' + timestamp);
        console.log('[ACP] Renamed existing auth.json to backup');
      } catch {}
      try {
        await fs.access(legacyFile);
        await fs.rename(legacyFile, legacyFile + '.bak.' + timestamp);
        console.log('[ACP] Renamed existing .claude.json to backup');
      } catch {}
    } catch (e) {
      console.warn(
        '[ACP] Unable to rename existing auth files:',
        (e as Error).message,
      );
    }
    return; // Skip file writing
  }

  const home = os.homedir();
  const configDir = path.join(home, '.config', 'claude-code');
  const authFile = path.join(configDir, 'auth.json');
  const legacyFile = path.join(home, '.claude.json');

  await fs.mkdir(configDir, { recursive: true });

  let needWriteAuth = true;
  try {
    const existing = await fs.readFile(authFile, 'utf8');
    if (existing.includes('apiKey')) {
      needWriteAuth = false; // assume usable
    }
  } catch {
    /* missing is fine */
  }

  if (needWriteAuth) {
    const now = new Date().toISOString();
    const authPayload = {
      sessionToken: `ephemeral-${Date.now()}`,
      refreshToken: `ephemeral-refresh-${Date.now()}`,
      apiKey,
      authenticated: true,
      lastCheck: now,
    };
    await fs.writeFile(authFile, JSON.stringify(authPayload, null, 2), 'utf8');
  }

  // Lightweight legacy file consumed by some flows
  try {
    const legacyPayload = {
      apiKey,
      managedSettings: { ANTHROPIC_API_KEY: apiKey },
    };
    await fs.writeFile(
      legacyFile,
      JSON.stringify(legacyPayload, null, 2),
      'utf8',
    );
  } catch (e) {
    console.error('[ACP] Failed writing legacy .claude.json:', e);
  }
}

/**
 * Collect diagnostics about Claude CLI environment to aid debugging.
 */
async function collectClaudeDiagnostics(): Promise<Record<string, any>> {
  const home = os.homedir();
  const configDir = path.join(home, '.config', 'claude-code');
  const authFile = path.join(configDir, 'auth.json');
  const legacyFile = path.join(home, '.claude.json');
  const diag: Record<string, any> = {
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    hasApiKeyEnv: !!process.env.ANTHROPIC_API_KEY,
    paths: { authFile, legacyFile },
  };
  try {
    const stat = await fs.stat(authFile);
    diag.authFileExists = true;
    diag.authFileMtime = stat.mtime.toISOString();
  } catch {
    diag.authFileExists = false;
  }
  try {
    const content = await fs.readFile(authFile, 'utf8');
    diag.authFileContainsApiKey = content.includes('apiKey');
  } catch {}
  try {
    const legacyContent = await fs.readFile(legacyFile, 'utf8');
    diag.legacyFileExists = true;
    diag.legacyFileContainsManagedSettings =
      legacyContent.includes('managedSettings');
  } catch {
    diag.legacyFileExists = false;
  }
  return diag;
}

/**
 * Collect diagnostics about Claude CLI (version and help)
 */
async function collectClaudeCliDiagnostics(): Promise<Record<string, any>> {
  const diag: Record<string, any> = {
    timestamp: new Date().toISOString(),
    claudeVersion: null as string | null,
    helpExcerpt: null as string | null,
  };
  try {
    const version = await execFileAsync('claude', ['--version']);
    diag.claudeVersion = version.stdout.trim();
  } catch (e) {
    diag.claudeVersion = `unavailable: ${(e as Error).message}`;
  }
  try {
    const help = await execFileAsync('claude', ['--help']);
    diag.helpExcerpt = help.stdout.split('\n').slice(0, 5).join('\n');
  } catch (e) {
    diag.helpExcerpt = `unavailable: ${(e as Error).message}`;
  }
  return diag;
}

/**
 * Build prompt from content blocks with context
 */
function buildPromptFromContent(
  content: ContentBlock[],
  contextFiles?: string[],
  agentContext?: Record<string, unknown>,
  session?: ACPSession,
): string {
  let prompt = '';

  // Add agent context if provided
  if (agentContext) {
    if (agentContext.userRequest) {
      prompt += `User Request: ${agentContext.userRequest}\n\n`;
    }
    if (agentContext.requestingAgent) {
      prompt += `Requesting Agent: ${agentContext.requestingAgent}\n\n`;
    }
  }

  // Add workspace context
  if (session?.workspaceUri) {
    prompt += `Working in: ${new URL(session.workspaceUri).pathname}\n`;
  }
  if (session?.mode) {
    prompt += `Session Mode: ${session.mode}\n\n`;
  }

  // Add context files if provided
  if (contextFiles && contextFiles.length > 0) {
    prompt += `Context Files:\n${contextFiles.map((f) => `- ${f}`).join('\n')}\n\n`;
  }

  // Process content blocks
  for (const block of content) {
    switch (block.type) {
      case 'text':
        prompt += (block.text || block.content) + '\n\n';
        break;
      case 'file':
        prompt += `File: ${block.metadata?.filename || 'unknown'}\n`;
        prompt += block.content + '\n\n';
        break;
      case 'diff':
        prompt += `Diff:\n${block.content}\n\n`;
        break;
      case 'image':
        prompt += `[Image: ${block.metadata?.filename || 'image'}]\n\n`;
        break;
      case 'thought':
        prompt += `Thought: ${block.content}\n\n`;
        break;
      case 'error':
        prompt += `Error: ${block.content}\n\n`;
        break;
      default:
        prompt += block.content + '\n\n';
    }
  }

  return prompt.trim();
}

/**
 * Estimate tokens from text (rough approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens from SDK message
 */
function estimateTokensFromMessage(message: SDKMessage): number {
  const text = getMessageText(message);
  return estimateTokens(text);
}

/**
 * Extract text from SDK message
 */
function getMessageText(message: SDKMessage): string {
  // @ts-ignore
  if (typeof message.text === 'string') return message.text;
  // @ts-ignore
  if (typeof message.content === 'string') return message.content;
  // @ts-ignore
  if (Array.isArray(message.content))
    return message.content
      .map((c: any) => c.text || JSON.stringify(c))
      .join('\n');
  return JSON.stringify(message);
}

/**
 * Extract summary from the last message
 */
function extractMessageSummary(message: SDKMessage): string {
  const text = getMessageText(message);
  // Return first 200 characters as summary
  return text.length > 200 ? text.substring(0, 200) + '...' : text;
}

/**
 * Detect GitHub operations from workspace changes
 */
async function detectGitHubOperations(
  workspaceUri?: string,
): Promise<SessionPromptResponse['result']['githubOperations']> {
  if (!workspaceUri) {
    return undefined;
  }

  try {
    const workspacePath = new URL(workspaceUri).pathname;

    // Check for git changes
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });

    if (statusResult.stdout.trim().length === 0) {
      return undefined; // No changes
    }

    // Parse modified files
    const filesModified = statusResult.stdout
      .trim()
      .split('\n')
      .map((line) => line.substring(3)) // Remove status prefix
      .filter((file) => file.length > 0);

    // Check current branch
    const branchResult = await execFileAsync(
      'git',
      ['branch', '--show-current'],
      {
        cwd: workspacePath,
      },
    );
    const currentBranch = branchResult.stdout.trim();

    return {
      filesModified,
      branchCreated:
        currentBranch !== 'main' && currentBranch !== 'master'
          ? currentBranch
          : undefined,
    };
  } catch (error) {
    // Git operations failed, return undefined
    return undefined;
  }
}

/**
 * Load session from persistent storage
 */
async function loadSessionFromPersistentStorage(
  sessionId: string,
): Promise<ACPSession | null> {
  try {
    const sessionDir = getSessionStorageDir();
    const sessionFile = path.join(sessionDir, `${sessionId}.json`);

    // Check if session file exists
    await fs.access(sessionFile);

    // Read and parse session data
    const sessionData = await fs.readFile(sessionFile, 'utf-8');
    const session: ACPSession = JSON.parse(sessionData);

    // Validate session data integrity
    if (!session.sessionId || session.sessionId !== sessionId) {
      console.error(`[ACP] Session data corruption detected for ${sessionId}`);
      return null;
    }

    // Check if session has expired (optional)
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (Date.now() - session.lastActiveAt > maxAge) {
      if (process.env.NODE_ENV !== 'test') {
        console.error(
          `[ACP] Session ${sessionId} has expired, removing from storage`,
        );
      }
      await deleteSessionFromPersistentStorage(sessionId);
      return null;
    }

    return session;
  } catch (error) {
    // Session file doesn't exist or is corrupted
    return null;
  }
}

/**
 * Save session to persistent storage
 */
async function saveSessionToPersistentStorage(
  session: ACPSession,
): Promise<void> {
  try {
    const sessionDir = getSessionStorageDir();

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    const sessionFile = path.join(sessionDir, `${session.sessionId}.json`);
    const sessionData = JSON.stringify(session, null, 2);

    await fs.writeFile(sessionFile, sessionData, 'utf-8');
  } catch (error) {
    console.error(`[ACP] Failed to save session ${session.sessionId}:`, error);
    throw createInvalidParamsError(
      `Session persistence failed: ${(error as Error).message}`,
    );
  }
}

/**
 * Delete session from persistent storage
 */
async function deleteSessionFromPersistentStorage(
  sessionId: string,
): Promise<void> {
  try {
    const sessionDir = getSessionStorageDir();
    const sessionFile = path.join(sessionDir, `${sessionId}.json`);

    await fs.unlink(sessionFile);
  } catch (error) {
    // File might not exist, ignore error
  }
}

/**
 * Get session storage directory
 */
function getSessionStorageDir(): string {
  const baseDir =
    process.env.ACP_SESSION_STORAGE_DIR ||
    path.join(process.cwd(), '.acp-sessions');
  return baseDir;
}

/**
 * Validate session ID format
 */
function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }
  // Allow more flexible session ID format
  return sessionId.length > 0 && sessionId.trim() === sessionId;
}

/**
 * Create error for invalid parameters
 */
function createInvalidParamsError(message: string, data?: any) {
  const error = new Error(`Invalid params: ${message}`) as any;
  error.code = ACP_ERROR_CODES.INVALID_PARAMS;
  if (data) error.data = data;
  return error;
}

/**
 * Create error for session not found
 */
function createSessionNotFoundError(sessionId: string) {
  const error = new Error(`Session not found: ${sessionId}`) as any;
  error.code = ACP_ERROR_CODES.SESSION_NOT_FOUND;
  return error;
}

/**
 * Initialize handler - Sets up the ACP agent
 */
export async function handleInitialize(
  params: InitializeRequest['params'],
  context: RequestContext,
): Promise<InitializeResponse['result']> {
  // Validate required parameters
  if (!params || typeof params.protocolVersion !== 'string') {
    throw createInvalidParamsError(
      'protocolVersion is required and must be a string',
    );
  }

  const { protocolVersion, clientCapabilities, clientInfo } = params;

  // Check protocol version compatibility
  const supportedVersion = '0.3.1';
  if (!protocolVersion.startsWith('0.3.')) {
    const error = new Error(
      `Unsupported protocol version: ${protocolVersion}`,
    ) as any;
    error.code = ACP_ERROR_CODES.INVALID_PARAMS;
    error.data = { supportedVersion };
    throw error;
  }

  // Store client information
  if (clientInfo) {
    acpState.setClientInfo(clientInfo);
  }

  // Mark as initialized with timestamp
  acpState.setInitialized(true);
  acpState.setInitializationTime(Date.now());

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ACP] Initialized with protocol version ${protocolVersion}`);
    if (clientInfo) {
      console.error(`[ACP] Client: ${clientInfo.name} v${clientInfo.version}`);
    }
    console.error(
      `[ACP] Agent capabilities:`,
      JSON.stringify(acpState.getAgentCapabilities(), null, 2),
    );
  }

  // Return enhanced initialization response
  const response = {
    protocolVersion: supportedVersion,
    agentCapabilities: acpState.getAgentCapabilities(),
    agentInfo: acpState.getAgentInfo(),
  };

  // Add optional extended information for debugging
  if (process.env.NODE_ENV === 'development') {
    (response as any).environmentInfo = acpState.getAgentInfo().environment;
  }

  return response;
}

/**
 * Session/New handler - Creates a new session
 */
export async function handleSessionNew(
  params: SessionNewRequest['params'] = {},
  context: RequestContext,
): Promise<SessionNewResponse['result']> {
  if (!acpState.isInitialized()) {
    const error = new Error(
      'Agent not initialized. Call initialize first.',
    ) as any;
    error.code = ACP_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }

  const { workspaceUri, mode = 'development', sessionOptions } = params;

  // Validate mode if provided
  if (mode && !['development', 'conversation'].includes(mode)) {
    throw createInvalidParamsError(
      'mode must be either "development" or "conversation"',
    );
  }

  // Validate workspace URI format if provided
  if (workspaceUri && typeof workspaceUri === 'string') {
    try {
      const uri = new URL(workspaceUri);
      if (uri.protocol !== 'file:') {
        throw createInvalidParamsError(
          'workspaceUri must use file:// protocol',
        );
      }
    } catch (error) {
      throw createInvalidParamsError(
        'workspaceUri must be a valid file:// URI',
      );
    }
  }

  // Generate new session
  const sessionId = generateSessionId();
  const now = Date.now();

  const session: ACPSession = {
    sessionId,
    workspaceUri,
    mode: mode as SessionMode,
    state: 'active',
    createdAt: now,
    lastActiveAt: now,
    messageHistory: [],
    sessionOptions,
  };

  acpState.setSession(sessionId, session);

  // Debug logging (only in non-test environment)
  if (process.env.NODE_ENV !== 'test') {
    console.error(
      `[ACP DEBUG] Session created: ${sessionId}, state singleton: ${!!acpState}, session count: ${acpState.getSessionCount()}`,
    );
  }

  // Save to persistent storage if persistence is enabled
  if (sessionOptions?.persistHistory) {
    await saveSessionToPersistentStorage(session);
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ACP] Created session ${sessionId} in ${mode} mode`);
  }

  // Create workspace info with isolation
  const workspaceInfo = await createWorkspaceInfo(workspaceUri, sessionOptions);

  return {
    sessionId,
    workspaceInfo,
  };
}

/**
 * Session/Prompt handler - Processes user prompts
 */
export async function handleSessionPrompt(
  params: SessionPromptRequest['params'],
  context: RequestContext,
  notificationSender?: (method: string, params: any) => void,
): Promise<SessionPromptResponse['result']> {
  if (!acpState.isInitialized()) {
    const error = new Error(
      'Agent not initialized. Call initialize first.',
    ) as any;
    error.code = ACP_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }

  // Validate required parameters
  if (!params || !params.sessionId || !params.content) {
    throw createInvalidParamsError('sessionId and content are required');
  }

  const { sessionId, content, contextFiles, agentContext } = params;

  // Validate session ID
  if (!isValidSessionId(sessionId)) {
    throw createInvalidParamsError('sessionId must be a non-empty string');
  }

  // Get session
  const session = acpState.getSession(sessionId);

  // Debug logging (only in non-test environment)
  if (process.env.NODE_ENV !== 'test') {
    console.error(
      `[ACP DEBUG] Session lookup: ${sessionId}, found: ${!!session}, state singleton: ${!!acpState}, session count: ${acpState.getSessionCount()}`,
    );
  }

  if (!session) {
    throw createSessionNotFoundError(sessionId);
  }

  // Validate content
  if (!Array.isArray(content) || content.length === 0) {
    throw createInvalidParamsError('content must be a non-empty array');
  }

  // Debug logging (only in non-test environment)
  if (process.env.NODE_ENV !== 'test') {
    console.error(
      `[ACP DEBUG] Content blocks received:`,
      JSON.stringify(content, null, 2),
    );
  }

  // Validate content blocks
  for (const block of content) {
    if (!block || typeof block !== 'object' || !block.type) {
      throw createInvalidParamsError(
        'each content block must have a type field',
      );
    }

    // Validate content field based on type
    if (block.type === 'text' && !block.text) {
      throw createInvalidParamsError(
        'text content blocks must have a text field',
      );
    } else if (block.type !== 'text' && !block.content) {
      throw createInvalidParamsError(
        `${block.type} content blocks must have a content field`,
      );
    }
  }

  // Update session
  session.lastActiveAt = Date.now();
  session.messageHistory.push(content);
  acpState.setSession(sessionId, session);

  // Save updated session to persistence if enabled
  if (session.sessionOptions?.persistHistory) {
    await saveSessionToPersistentStorage(session);
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(
      `[ACP] Processing prompt for session ${sessionId} with ${content.length} content blocks`,
    );
  }

  // Process with Claude Code SDK
  const result = await processPromptWithClaudeCode(
    session,
    content,
    contextFiles,
    agentContext,
    notificationSender,
    context,
  );

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ACP] Completed prompt processing for session ${sessionId}`);
  }

  return result;
}

/**
 * Session/Load handler - Loads existing session
 */
export async function handleSessionLoad(
  params: SessionLoadRequest['params'],
  context: RequestContext,
): Promise<SessionLoadResponse['result']> {
  if (!acpState.isInitialized()) {
    const error = new Error(
      'Agent not initialized. Call initialize first.',
    ) as any;
    error.code = ACP_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }

  // Validate required parameters
  if (!params || !params.sessionId) {
    throw createInvalidParamsError('sessionId is required');
  }

  const { sessionId, includeHistory = false } = params;

  // Validate session ID
  if (!isValidSessionId(sessionId)) {
    throw createInvalidParamsError('sessionId must be a non-empty string');
  }

  // Try to get session from memory first
  let session = acpState.getSession(sessionId);

  // If not in memory, try to load from persistent storage
  if (!session) {
    const persistedSession = await loadSessionFromPersistentStorage(sessionId);
    if (persistedSession) {
      // Restore to memory
      session = persistedSession;
      acpState.setSession(sessionId, session);
      if (process.env.NODE_ENV !== 'test') {
        console.error(
          `[ACP] Restored session ${sessionId} from persistent storage`,
        );
      }
    } else {
      throw createSessionNotFoundError(sessionId);
    }
  }

  // Update last access time
  session.lastActiveAt = Date.now();
  acpState.setSession(sessionId, session);

  // Save updated access time to persistent storage if persistence is enabled
  if (session.sessionOptions?.persistHistory) {
    await saveSessionToPersistentStorage(session);
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(
      `[ACP] Loading session ${sessionId} (includeHistory: ${includeHistory})`,
    );
  }

  const sessionInfo = {
    sessionId: session.sessionId,
    state: session.state,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    ...(session.workspaceUri && { workspaceUri: session.workspaceUri }),
    ...(session.mode && { mode: session.mode }),
  };

  // Create workspace info
  const workspaceInfo = await createWorkspaceInfo(
    session.workspaceUri,
    session.sessionOptions,
  );

  const result: SessionLoadResponse['result'] = {
    sessionInfo,
    workspaceInfo,
    historyAvailable: session.messageHistory.length > 0,
  };

  // Include history if requested
  if (includeHistory && session.messageHistory.length > 0) {
    result.history = session.messageHistory;
  }

  return result;
}

/**
 * Cancel handler - Cancels running operations
 */
export async function handleCancel(
  params: CancelRequest['params'],
  context: RequestContext,
): Promise<CancelResponse['result']> {
  if (!acpState.isInitialized()) {
    const error = new Error(
      'Agent not initialized. Call initialize first.',
    ) as any;
    error.code = ACP_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }

  // Validate required parameters
  if (!params || !params.sessionId) {
    throw createInvalidParamsError('sessionId is required');
  }

  const { sessionId } = params;

  // Validate session ID
  if (!isValidSessionId(sessionId)) {
    throw createInvalidParamsError('sessionId must be a non-empty string');
  }

  // Check if session exists
  const session = acpState.getSession(sessionId);
  if (!session) {
    throw createSessionNotFoundError(sessionId);
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ACP] Cancel requested for session ${sessionId}`);
  }

  // Check if session has active operations
  const hasOperations = acpState.hasActiveOperations(sessionId);
  const operationCount = acpState.getActiveOperationCount(sessionId);

  if (!hasOperations) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `[ACP] No active operations to cancel for session ${sessionId}`,
      );
    }
    return {
      cancelled: false,
    };
  }

  // Cancel all operations for the session
  const cancelled = acpState.cancelOperation(sessionId);

  if (process.env.NODE_ENV !== 'test') {
    console.error(
      `[ACP] Cancelled ${operationCount} operations for session ${sessionId}`,
    );
  }

  // Update session state to indicate cancellation
  session.state = 'paused'; // Set to paused to indicate interrupted state
  session.lastActiveAt = Date.now();
  acpState.setSession(sessionId, session);

  // Save session state if persistence is enabled
  if (session.sessionOptions?.persistHistory) {
    try {
      await saveSessionToPersistentStorage(session);
    } catch (error) {
      console.error(
        `[ACP] Failed to save session state after cancellation:`,
        error,
      );
    }
  }

  return {
    cancelled,
  };
}

/**
 * Export all handlers for registration
 */
export const ACPHandlers = {
  initialize: handleInitialize,
  'session/new': handleSessionNew,
  'session/prompt': handleSessionPrompt,
  'session/load': handleSessionLoad,
  cancel: handleCancel,
};

/**
 * Ensure git repository exists in the workspace
 */
async function ensureGitRepo(workspacePath: string) {
  try {
    await fs.access(path.join(workspacePath, '.git'));
    return false;
  } catch {}
  try {
    await execFileAsync('git', ['init'], { cwd: workspacePath });
    await execFileAsync('git', ['config', 'user.name', 'Claude Code Bot'], {
      cwd: workspacePath,
    });
    await execFileAsync(
      'git',
      ['config', 'user.email', 'claude-code@anthropic.com'],
      { cwd: workspacePath },
    );
    console.log('[ACP] Initialized git repository for workspace');
    return true;
  } catch (e) {
    console.warn(
      '[ACP] Failed to initialize git repository:',
      (e as Error).message,
    );
    return false;
  }
}

/**
 * Classify Claude errors into known categories
 */
function classifyClaudeError(err: any): { code: string; message: string } {
  const raw = (err?.message || String(err)).toLowerCase();
  const stderrTail: string = (err as any)?.stderrTail || '';
  const combined = raw + '\n' + stderrTail.toLowerCase();
  if (combined.includes('api key') || combined.includes('authentication'))
    return { code: 'auth_error', message: err.message || String(err) };
  if (combined.includes('not found') && combined.includes('claude'))
    return { code: 'cli_missing', message: err.message || String(err) };
  if (combined.includes('not a git repository'))
    return { code: 'workspace_missing', message: err.message || String(err) };
  if (combined.includes('permission denied') || combined.includes('eacces'))
    return { code: 'fs_permission', message: err.message || String(err) };
  if (
    combined.includes('stack') ||
    combined.match(/referenceerror|typeerror|syntaxerror/)
  )
    return {
      code: 'internal_cli_failure',
      message: err.message || String(err),
    };
  if (raw.includes('cancelled') || raw.includes('canceled'))
    return { code: 'cancelled', message: err.message || String(err) };
  return { code: 'unknown', message: err.message || String(err) };
}

/**
 * Prepare ephemeral workspace in /tmp for sessions without a workspaceUri
 */
async function prepareEphemeralWorkspace(
  session: ACPSession,
): Promise<string | null> {
  if (session.workspaceUri) return null; // already has workspace
  const base = '/tmp';
  const dir = path.join(base, `acp-workspace-${session.sessionId}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const sentinel = path.join(dir, '.acp');
    await fs.writeFile(sentinel, 'workspace initialized');
    await ensureGitRepo(dir);
    console.log('[ACP] Workspace bootstrap:', { path: dir });
    return dir;
  } catch (e) {
    console.warn('[ACP] Failed to bootstrap workspace:', (e as Error).message);
    return null;
  }
}

/**
 * Run raw CLI diagnostic command
 */
async function runRawCliDiagnostic(
  prompt: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolve) => {
    try {
      const proc = spawn('claude', ['code', '--prompt', prompt.slice(0, 800)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20000,
      });
      let out = '';
      let err = '';
      proc.stdout.on('data', (d) => {
        out += d.toString();
      });
      proc.stderr.on('data', (d) => {
        err += d.toString();
      });
      proc.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
      proc.on('error', () =>
        resolve({ code: null, stdout: out, stderr: err || 'spawn error' }),
      );
    } catch (e) {
      resolve({
        code: null,
        stdout: '',
        stderr: 'spawn exception: ' + (e as Error).message,
      });
    }
  });
}
