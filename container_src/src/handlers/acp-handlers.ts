/**
 * ACP Method Handlers
 * Implementation of all Agent Client Protocol methods
 */

import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
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
  WorkspaceInfo
} from '../types/acp-messages.js';
import { ACPSession, SessionMode } from '../types/acp-session.js';
import { RequestContext } from '../services/stdio-jsonrpc.js';

const execFileAsync = promisify(execFile);

// Global state for ACP handlers
class ACPState {
  private sessions = new Map<string, ACPSession>();
  private initialized = false;
  private initializationTime?: number;
  private clientInfo?: { name: string; version: string; };
  private activeOperations = new Map<string, AbortController>();

  private agentInfo = {
    name: 'Claude Code Container',
    version: '1.0.0',
    description: 'AI-powered containerized development assistant with GitHub integration',
    environment: this.detectEnvironment()
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

  setClientInfo(clientInfo?: { name: string; version: string; }): void {
    this.clientInfo = clientInfo;
  }

  getClientInfo(): { name: string; version: string; } | undefined {
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
      uptime: process.uptime()
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
      githubIntegration: !!process.env.GITHUB_TOKEN,
      supportsImages: false, // Container doesn't support image processing yet
      supportsAudio: false   // Container doesn't support audio processing yet
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
        if (cgroup.includes('docker') || cgroup.includes('containerd') || cgroup.includes('kubepods')) {
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
  sessionOptions?: ACPSession['sessionOptions']
): Promise<WorkspaceInfo> {
  const rootPath = workspaceUri ? new URL(workspaceUri).pathname : process.cwd();

  // Initialize workspace info
  const workspaceInfo: WorkspaceInfo = {
    rootPath,
    hasUncommittedChanges: false
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
        workspaceInfo.hasUncommittedChanges = basicGitInfo.hasUncommittedChanges;
      }
    }

  } catch (error) {
    // If workspace is not accessible, note it but don't fail
    console.error(`[ACP] Workspace access warning: ${(error as Error).message}`);
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
    const branchResult = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workspacePath
    });
    const currentBranch = branchResult.stdout.trim() || 'main';

    // Check for uncommitted changes
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath
    });
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    // Get remote URL
    let remoteUrl: string | undefined;
    try {
      const remoteResult = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: workspacePath
      });
      remoteUrl = remoteResult.stdout.trim();
    } catch {
      // Remote might not exist
    }

    // Get last commit
    let lastCommit: string | undefined;
    try {
      const commitResult = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: workspacePath
      });
      lastCommit = commitResult.stdout.trim();
    } catch {
      // Might be a new repo with no commits
    }

    return {
      currentBranch,
      hasUncommittedChanges,
      remoteUrl,
      lastCommit
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
    const branchResult = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workspacePath
    });
    const currentBranch = branchResult.stdout.trim() || 'main';

    // Check for uncommitted changes
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath
    });
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    return {
      currentBranch,
      hasUncommittedChanges
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
  notificationSender?: (method: string, params: any) => void
): Promise<SessionPromptResponse['result']> {

  // Check if Claude Code SDK is available
  if (!process.env.ANTHROPIC_API_KEY) {
    throw createInvalidParamsError('Claude Code integration requires ANTHROPIC_API_KEY environment variable');
  }

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
        message: 'Preparing request for Claude Code...'
      });
    }

    // Prepare prompt from content blocks
    const prompt = buildPromptFromContent(content, contextFiles, agentContext, session);
    inputTokens = estimateTokens(prompt);

    // Change to workspace directory if specified
    const originalCwd = process.cwd();
    if (session.workspaceUri) {
      try {
        const workspacePath = new URL(session.workspaceUri).pathname;
        process.chdir(workspacePath);
      } catch (error) {
        console.error(`[ACP] Warning: Could not change to workspace directory: ${error}`);
      }
    }

    try {
      // Send working status
      if (notificationSender) {
        notificationSender('session/update', {
          sessionId,
          status: 'working',
          message: 'Processing with Claude Code...',
          progress: { current: 1, total: 3, message: 'Analyzing request' }
        });
      }

      // Check if operation was cancelled before starting
      if (abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Process with Claude Code SDK
      for await (const message of query({
        prompt,
        options: {
          permissionMode: 'bypassPermissions'
        }
      })) {
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
              message: `Processing message ${messages.length}`
            }
          });
        }
      }

      // Estimate output tokens
      outputTokens = messages.reduce((sum, msg) => sum + estimateTokensFromMessage(msg), 0);

      // Check for file changes and GitHub operations
      const githubOperations = await detectGitHubOperations(session.workspaceUri);

      // Send completion status
      if (notificationSender) {
        notificationSender('session/update', {
          sessionId,
          status: 'completed',
          message: `Completed with ${messages.length} messages`
        });
      }

      // Build response
      const response: SessionPromptResponse['result'] = {
        stopReason: 'completed',
        usage: {
          inputTokens,
          outputTokens
        }
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
      // Restore original working directory
      process.chdir(originalCwd);
    }

  } catch (error) {
    // Complete the operation (even on error)
    acpState.completeOperation(sessionId, operationId);

    const errorMessage = (error as Error).message;
    const isCancelled = errorMessage.includes('cancelled') || abortController.signal.aborted;

    // Send appropriate status
    if (notificationSender) {
      notificationSender('session/update', {
        sessionId,
        status: isCancelled ? 'completed' : 'error',
        message: isCancelled ? 'Operation cancelled' : `Error: ${errorMessage}`
      });
    }

    // Return appropriate response
    return {
      stopReason: isCancelled ? 'cancelled' : 'error',
      usage: {
        inputTokens,
        outputTokens
      },
      summary: isCancelled ? 'Operation was cancelled' : `Error occurred during processing: ${errorMessage}`
    };
  }
}

/**
 * Build prompt from content blocks with context
 */
function buildPromptFromContent(
  content: ContentBlock[],
  contextFiles?: string[],
  agentContext?: Record<string, unknown>,
  session?: ACPSession
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
    prompt += `Context Files:\n${contextFiles.map(f => `- ${f}`).join('\n')}\n\n`;
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
  if (Array.isArray(message.content)) return message.content.map((c: any) => (c.text || JSON.stringify(c))).join('\n');
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
async function detectGitHubOperations(workspaceUri?: string): Promise<SessionPromptResponse['result']['githubOperations']> {
  if (!workspaceUri) {
    return undefined;
  }

  try {
    const workspacePath = new URL(workspaceUri).pathname;

    // Check for git changes
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath
    });

    if (statusResult.stdout.trim().length === 0) {
      return undefined; // No changes
    }

    // Parse modified files
    const filesModified = statusResult.stdout
      .trim()
      .split('\n')
      .map(line => line.substring(3)) // Remove status prefix
      .filter(file => file.length > 0);

    // Check current branch
    const branchResult = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workspacePath
    });
    const currentBranch = branchResult.stdout.trim();

    return {
      filesModified,
      branchCreated: currentBranch !== 'main' && currentBranch !== 'master' ? currentBranch : undefined
    };

  } catch (error) {
    // Git operations failed, return undefined
    return undefined;
  }
}

/**
 * Load session from persistent storage
 */
async function loadSessionFromPersistentStorage(sessionId: string): Promise<ACPSession | null> {
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
        console.error(`[ACP] Session ${sessionId} has expired, removing from storage`);
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
async function saveSessionToPersistentStorage(session: ACPSession): Promise<void> {
  try {
    const sessionDir = getSessionStorageDir();

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    const sessionFile = path.join(sessionDir, `${session.sessionId}.json`);
    const sessionData = JSON.stringify(session, null, 2);

    await fs.writeFile(sessionFile, sessionData, 'utf-8');

  } catch (error) {
    console.error(`[ACP] Failed to save session ${session.sessionId}:`, error);
    throw createInvalidParamsError(`Session persistence failed: ${(error as Error).message}`);
  }
}

/**
 * Delete session from persistent storage
 */
async function deleteSessionFromPersistentStorage(sessionId: string): Promise<void> {
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
  const baseDir = process.env.ACP_SESSION_STORAGE_DIR || path.join(process.cwd(), '.acp-sessions');
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
  context: RequestContext
): Promise<InitializeResponse['result']> {

  // Validate required parameters
  if (!params || typeof params.protocolVersion !== 'string') {
    throw createInvalidParamsError('protocolVersion is required and must be a string');
  }

  const { protocolVersion, clientCapabilities, clientInfo } = params;

  // Check protocol version compatibility
  const supportedVersion = '0.3.1';
  if (!protocolVersion.startsWith('0.3.')) {
    const error = new Error(`Unsupported protocol version: ${protocolVersion}`) as any;
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
    console.error(`[ACP] Agent capabilities:`, JSON.stringify(acpState.getAgentCapabilities(), null, 2));
  }

  // Return enhanced initialization response
  const response = {
    protocolVersion: supportedVersion,
    agentCapabilities: acpState.getAgentCapabilities(),
    agentInfo: acpState.getAgentInfo()
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
  context: RequestContext
): Promise<SessionNewResponse['result']> {

  if (!acpState.isInitialized()) {
    const error = new Error('Agent not initialized. Call initialize first.') as any;
    error.code = ACP_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }

  const { workspaceUri, mode = 'development', sessionOptions } = params;

  // Validate mode if provided
  if (mode && !['development', 'conversation'].includes(mode)) {
    throw createInvalidParamsError('mode must be either "development" or "conversation"');
  }

  // Validate workspace URI format if provided
  if (workspaceUri && typeof workspaceUri === 'string') {
    try {
      const uri = new URL(workspaceUri);
      if (uri.protocol !== 'file:') {
        throw createInvalidParamsError('workspaceUri must use file:// protocol');
      }
    } catch (error) {
      throw createInvalidParamsError('workspaceUri must be a valid file:// URI');
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
    sessionOptions
  };

  acpState.setSession(sessionId, session);

  // Debug logging
  console.log(`[ACP DEBUG] Session created: ${sessionId}, state singleton: ${!!acpState}, session count: ${acpState.getSessionCount()}`);

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
    workspaceInfo
  };
}

/**
 * Session/Prompt handler - Processes user prompts
 */
export async function handleSessionPrompt(
  params: SessionPromptRequest['params'],
  context: RequestContext,
  notificationSender?: (method: string, params: any) => void
): Promise<SessionPromptResponse['result']> {

  if (!acpState.isInitialized()) {
    const error = new Error('Agent not initialized. Call initialize first.') as any;
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

  // Debug logging
  console.log(`[ACP DEBUG] Session lookup: ${sessionId}, found: ${!!session}, state singleton: ${!!acpState}, session count: ${acpState.getSessionCount()}`);

  if (!session) {
    throw createSessionNotFoundError(sessionId);
  }

  // Validate content
  if (!Array.isArray(content) || content.length === 0) {
    throw createInvalidParamsError('content must be a non-empty array');
  }

  // Debug logging
  console.log(`[ACP DEBUG] Content blocks received:`, JSON.stringify(content, null, 2));

  // Validate content blocks
  for (const block of content) {
    if (!block || typeof block !== 'object' || !block.type) {
      throw createInvalidParamsError('each content block must have a type field');
    }

    // Validate content field based on type
    if (block.type === 'text' && !block.text) {
      throw createInvalidParamsError('text content blocks must have a text field');
    } else if (block.type !== 'text' && !block.content) {
      throw createInvalidParamsError(`${block.type} content blocks must have a content field`);
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
    console.error(`[ACP] Processing prompt for session ${sessionId} with ${content.length} content blocks`);
  }

  // Process with Claude Code SDK
  const result = await processPromptWithClaudeCode(
    session,
    content,
    contextFiles,
    agentContext,
    notificationSender
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
  context: RequestContext
): Promise<SessionLoadResponse['result']> {

  if (!acpState.isInitialized()) {
    const error = new Error('Agent not initialized. Call initialize first.') as any;
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
        console.error(`[ACP] Restored session ${sessionId} from persistent storage`);
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
    console.error(`[ACP] Loading session ${sessionId} (includeHistory: ${includeHistory})`);
  }

  const sessionInfo = {
    sessionId: session.sessionId,
    state: session.state,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    ...(session.workspaceUri && { workspaceUri: session.workspaceUri }),
    ...(session.mode && { mode: session.mode })
  };

  const result: SessionLoadResponse['result'] = {
    sessionInfo,
    historyAvailable: session.messageHistory.length > 0
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
  context: RequestContext
): Promise<CancelResponse['result']> {

  if (!acpState.isInitialized()) {
    const error = new Error('Agent not initialized. Call initialize first.') as any;
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
      console.error(`[ACP] No active operations to cancel for session ${sessionId}`);
    }
    return {
      cancelled: false
    };
  }

  // Cancel all operations for the session
  const cancelled = acpState.cancelOperation(sessionId);

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ACP] Cancelled ${operationCount} operations for session ${sessionId}`);
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
      console.error(`[ACP] Failed to save session state after cancellation:`, error);
    }
  }

  return {
    cancelled
  };
}

/**
 * Export all handlers for registration
 */
export const ACPHandlers = {
  'initialize': handleInitialize,
  'session/new': handleSessionNew,
  'session/prompt': handleSessionPrompt,
  'session/load': handleSessionLoad,
  'cancel': handleCancel
};