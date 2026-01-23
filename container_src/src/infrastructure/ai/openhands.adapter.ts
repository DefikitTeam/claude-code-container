/**
 * OpenHands adapter configuration types and defaults
 * Phase 2 - T007: provide a typed config and defaults that the adapter can
 * consume. Keep this file single-responsibility: no network logic here.
 */

export interface OpenHandsAdapterConfig {
  // API key for OpenHands. Optional here since callers may inject it at runtime.
  apiKey?: string;

  // Base URL for OpenHands REST endpoints
  baseUrl: string;

  // Polling interval (ms) when using REST polling (optional fallback)
  pollingIntervalMs: number;

  // Maximum number of retries for transient errors
  maxRetries: number;

  // Base backoff in ms for exponential retry (multiplied by 2^attempt)
  retryBackoffBaseMs: number;

  // Maximum number of events to keep in memory for a conversation
  maxEventBuffer: number;

  // Optional extra headers to include in HTTP requests
  headers?: Record<string, string>;

  // If true, adapter will be considered disabled and should not be selected
  disabled?: boolean;
}

interface OpenHandsEvent {
  id: string;
  type: string;
  source: string;
  message?: string;
  result?: { state: string };
  error?: string;
}

/**
 * Defaults used when creating an OpenHandsAdapterConfig. These are conservative
 * values chosen to be safe for most environments. Callers may override any
 * field returned here.
 */
export const defaultOpenHandsConfig: OpenHandsAdapterConfig = {
  apiKey: process.env.OPENHANDS_API_KEY || undefined,
  // NOTE: The canonical API host used in OpenHands docs is https://app.all-hands.dev
  // Use that as the default to avoid DNS issues with older or unofficial hostnames.
  // Callers may still override via OPENHANDS_BASE_URL.
  baseUrl: process.env.OPENHANDS_BASE_URL || 'https://app.all-hands.dev',
  pollingIntervalMs: Number(process.env.OPENHANDS_POLLING_INTERVAL_MS || 2000),
  maxRetries: Number(process.env.OPENHANDS_MAX_RETRIES || 3),
  retryBackoffBaseMs: Number(
    process.env.OPENHANDS_RETRY_BACKOFF_BASE_MS || 500,
  ),
  maxEventBuffer: Number(process.env.OPENHANDS_MAX_EVENT_BUFFER || 1000),
  headers: {},
  disabled: (process.env.CLAUDE_CLIENT_DISABLE_OPENHANDS || 'false') === 'true',
};

/**
 * Helper to produce a config object merged with defaults. This keeps callers
 * from having to reference `process.env` directly and centralizes defaults.
 */
export function loadConfig(
  overrides?: Partial<OpenHandsAdapterConfig>,
): OpenHandsAdapterConfig {
  return {
    ...defaultOpenHandsConfig,
    ...(overrides || {}),
  };
}
import type { ClaudeAdapter, ClaudeRuntimeContext } from '../claude/adapter.js';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import { ConversationManager } from '../../services/openhands/conversation-manager.js';
import { io, Socket } from 'socket.io-client';

// Lightweight logger scoped to this adapter so all logs share the same
// prefix and can be changed later to a different logging backend.
const logger = {
  error: (...args: unknown[]) => console.error('[OpenHandsAdapter]', ...args),
  warn: (...args: unknown[]) => console.warn('[OpenHandsAdapter]', ...args),
  info: (...args: unknown[]) => console.info('[OpenHandsAdapter]', ...args),
  debug: (...args: unknown[]) => console.debug('[OpenHandsAdapter]', ...args),
};

/**
 * OpenHandsAdapter skeleton implementing the ClaudeAdapter interface.
 *
 * This is intentionally minimal for T012: it wires configuration and exposes
 * the expected methods. Detailed `run` behavior (polling, websocket, events,
 * callbacks) will be implemented in subsequent tasks.
 */
export class OpenHandsAdapter implements ClaudeAdapter {
  // Keep runtime-kind compatible name (ClaudeRuntimeKind) while exposing a
  // more specific adapter identifier for logging and diagnostics.
  // The runtime selector expects `name` to be one of 'sdk'|'cli'|'http-api'.
  readonly name = 'http-api' as const;

  // Human/readable adapter id used for logs and diagnostics so we can
  // distinguish this adapter instance from other http-api adapters.
  readonly adapterId = 'openhands' as const;
  private cfg: OpenHandsAdapterConfig;

  // Socket.IO client session management
  // Maps sessionId -> Socket.IO client for multi-turn conversations
  private socketClients: Map<string, Socket> = new Map();

  constructor(config?: Partial<OpenHandsAdapterConfig>) {
    this.cfg = loadConfig(config);
  }

  /**
   * Minimal canHandle implementation. T013 will refine this to check
   * environment variables and explicit disabling flags.
   */
  canHandle(context: ClaudeRuntimeContext): boolean {
    // Respect explicit disabling via config or environment
    if (this.cfg.disabled) return false;
    if ((process.env.CLAUDE_CLIENT_DISABLE_OPENHANDS || 'false') === 'true')
      return false;

    // Determine API key from (1) adapter config override, (2) runtime context, (3) environment
    const apiKey =
      this.cfg.apiKey ??
      context.apiKey ??
      process.env.OPENHANDS_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      process.env.ALLHANDS_API_KEY;

    // Only handle if we have an API key
    return Boolean(apiKey);
  }

  /**
   * Run conversation via Socket.IO real-time streaming.
   * Manages Socket.IO client per session for multi-turn conversations.
   */
  private async runViaSocketIO(
    conversationId: string,
    sessionId: string,
    apiKey: string,
    prompt: string,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    let collectedOutput = '';
    let isCompleted = false;

    return new Promise((resolve, reject) => {
      // Get or create Socket.IO client for this session
      let socket = this.socketClients.get(sessionId);

      // Timeout and abort tracking
      let conversationTimeout: NodeJS.Timeout | null = null;
      let connectionTimeout: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (socket && socket.connected) {
          logger.debug('Socket.IO cleanup', { sessionId, wasConnected: true });
          // Don't disconnect - keep connection alive for multi-turn
          // socket.disconnect();
        }
        // Clear all timeouts
        if (conversationTimeout) clearTimeout(conversationTimeout);
        if (connectionTimeout) clearTimeout(connectionTimeout);
        // Remove abort listener
        abortSignal.removeEventListener('abort', abortHandler);
      };

      const complete = (result: {
        success: boolean;
        output?: string;
        error?: string;
      }) => {
        if (isCompleted) return;
        isCompleted = true;
        logger.debug('Socket.IO completing', {
          sessionId,
          success: result.success,
        });
        cleanup();
        resolve(result);
      };

      const fail = (error: string) => {
        if (isCompleted) return;
        isCompleted = true;
        logger.error('Socket.IO failing', { sessionId, error });
        cleanup();
        resolve({ success: false, error });
      };

      // Handle abort signal
      const abortHandler = () => {
        logger.info('Conversation aborted by signal', { sessionId });
        fail('Aborted by user');
      };
      abortSignal.addEventListener('abort', abortHandler);

      if (!socket) {
        logger.info('Creating new Socket.IO client', {
          sessionId,
          conversationId,
          baseUrl: this.cfg.baseUrl,
        });

        // Create Socket.IO client with autoConnect: false to register handlers first
        socket = io(this.cfg.baseUrl, {
          autoConnect: false, // Don't auto-connect, we'll call connect() after registering handlers
          transports: ['websocket', 'polling'], // Allow fallback to polling
          auth: {
            token: apiKey,
          },
          query: {
            conversation_id: conversationId,
            latest_event_id: '-1', // Use -1 to get all events from start
            // NOTE: Official docs don't use session_api_key, testing without it
            // If connection fails, may need to fetch it from /api/conversations/{id}/config
          },
          reconnection: true,
          reconnectionAttempts: 3,
          reconnectionDelay: 1000,
          timeout: 20000,
        });

        this.socketClients.set(sessionId, socket);

        // Register event handlers BEFORE connecting
        socket.on('connect', () => {
          logger.info('✅ Socket.IO connected successfully', {
            sessionId,
            socketId: socket!.id,
            transport: socket!.io.engine.transport.name,
            conversationId,
          });

          // Register engine-level ping/pong handlers AFTER connection (engine now exists)
          socket!.io.engine.on('ping', () => {
            logger.debug('🏓 Socket.IO ping sent', { sessionId });
          });

          socket!.io.engine.on('pong', () => {
            logger.debug('🏓 Socket.IO pong received', { sessionId });
          });

          // Clear connection timeout on successful connect
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }

          // 🔥 CRITICAL: Send initial user action to start conversation processing
          // Without this, OpenHands won't process the conversation even though it's created
          logger.info('📤 Sending initial user action', {
            sessionId,
            promptLength: prompt.length,
          });
          socket!.emit('oh_user_action', {
            type: 'message',
            source: 'user',
            message: prompt,
          });
        });

        socket.on('disconnect', (reason) => {
          logger.warn('Socket.IO disconnected', { sessionId, reason });
          if (!isCompleted) {
            fail(`Connection disconnected: ${reason}`);
          }
        });

        socket.on('connect_error', (error) => {
          logger.error('❌ Socket.IO connection error', {
            sessionId,
            errorMessage: error.message,
            errorType: error.constructor.name,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            queryParams: {
              conversation_id: conversationId,
              has_session_api_key: Boolean(apiKey),
              latest_event_id: '-1',
            },
          });
          if (!isCompleted) {
            fail(`Connection error: ${error.message}`);
          }
        });

        socket.on('error', (error) => {
          logger.error('Socket.IO generic error', { sessionId, error });
        });

        // Debug: log all Socket.IO engine events
        socket.io.on('open', () => {
          logger.debug(
            '🔌 Socket.IO engine opened (low-level transport connected)',
            { sessionId },
          );
        });

        socket.io.on('close', (reason) => {
          logger.debug(
            '🔌 Socket.IO engine closed (low-level transport closed)',
            { sessionId, reason },
          );
        });

        // Note: ping/pong handlers are registered in 'connect' event handler above
        // because socket.io.engine doesn't exist until after connect() is called

        socket.io.on('error', (error) => {
          logger.error('Socket.IO engine error', { sessionId, error });
        });

        socket.io.on('reconnect_attempt', (attempt) => {
          logger.info('Socket.IO reconnect attempt', { sessionId, attempt });
        });

        socket.io.on('reconnect_error', (error) => {
          logger.error('Socket.IO reconnect error', { sessionId, error });
        });

        socket.io.on('reconnect_failed', () => {
          logger.error('Socket.IO reconnect failed', { sessionId });
        });

        // OpenHands event: oh_event
        socket.on('oh_event', (event: OpenHandsEvent) => {
          logger.debug('Received oh_event', {
            sessionId,
            eventId: event.id,
            type: event.type,
            source: event.source,
            hasMessage: Boolean(event.message),
          });

          // Collect agent output
          if (event.source === 'agent' && typeof event.message === 'string') {
            collectedOutput += event.message;
            callbacks.onDelta?.({ text: event.message });
          }

          // Check for completion
          if (
            event.type === 'agent_state_changed' &&
            event.result?.state === 'finished'
          ) {
            logger.info('Conversation completed via Socket.IO', { sessionId });
            complete({ success: true, output: collectedOutput });
          }

          // Check for errors
          if (event.type === 'error') {
            logger.error('Received error event', {
              sessionId,
              error: event.message,
            });
            fail(event.message || 'Unknown error from OpenHands');
          }
        });

        // Now connect after handlers are registered
        logger.info('🚀 Initiating Socket.IO connection', {
          sessionId,
          baseUrl: this.cfg.baseUrl,
          conversationId,
          hasApiKey: Boolean(apiKey),
          apiKeyPrefix: apiKey.substring(0, 8) + '...',
          queryParams: {
            conversation_id: conversationId,
            has_session_api_key: true,
            latest_event_id: '-1',
          },
        });
        socket.connect();

        // Set connection timeout (20 seconds)
        connectionTimeout = setTimeout(() => {
          if (!socket!.connected && !isCompleted) {
            logger.error('Socket.IO connection timeout after 20s', {
              sessionId,
              socketConnected: socket!.connected,
              socketId: socket!.id,
            });
            fail(
              'Connection timeout: Could not connect to OpenHands within 20 seconds',
            );
          }
        }, 20000);
      } else {
        logger.info('Reusing existing Socket.IO client', {
          sessionId,
          conversationId,
        });

        // For reused socket, event handlers already registered, just check connection
        if (!socket.connected) {
          logger.info('Reconnecting reused Socket.IO client', { sessionId });
          socket.connect();
        } else {
          logger.info('Socket.IO already connected (reused)', {
            sessionId,
            socketId: socket.id,
          });
        }
      }

      // Conversation timeout fallback (5 minutes)
      conversationTimeout = setTimeout(
        () => {
          if (!isCompleted) {
            logger.warn('Socket.IO conversation timeout after 5 minutes', {
              sessionId,
            });
            fail('Conversation timed out after 5 minutes');
          }
        },
        5 * 60 * 1000,
      );
    });
  }

  /**
   * Run a prompt using OpenHands REST API and Socket.IO streaming.
   * Creates a conversation, sends initial_user_msg to start processing, and streams results.
   */
  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    try {
      const startTime = Date.now();

      // Use the same API key resolution logic as canHandle() to ensure consistency
      const apiKey =
        this.cfg.apiKey ??
        context.apiKey ??
        process.env.OPENHANDS_API_KEY ??
        process.env.OPENROUTER_API_KEY ??
        process.env.ALLHANDS_API_KEY;

      if (!apiKey) {
        const err = new Error('[OpenHandsAdapter] missing API key');
        logger.error('API key missing - cannot proceed');
        callbacks.onError?.(err);
        throw err;
      }

      // Extract repository information from context if available
      const repository =
        ((runOptions as unknown as Record<string, unknown>)?.repository as string) ??
        ((context as unknown as Record<string, unknown>)?.repository as string) ??
        process.env.OPENHANDS_REPOSITORY;

      logger.info('starting OpenHands conversation', {
        hasRepository: Boolean(repository),
        promptLength: prompt.length,
      });

      // Notify start
      callbacks.onStart?.({ startTime });

      // Create conversation manager
      const conversationManager = new ConversationManager({
        baseUrl: this.cfg.baseUrl,
        apiKey,
        headers: this.cfg.headers,
      });

      // Create conversation with initial user message
      const createRequest = {
        initial_user_msg: prompt,
        ...(repository && { repository }),
      };

      logger.debug('creating conversation', { repository });
      const conversation = await conversationManager.createConversation(
        createRequest,
        abortSignal,
      );

      logger.info('conversation created', {
        conversationId: conversation.id,
        initialStatus: conversation.status,
      });

      // 🔍 CRITICAL FIX: ALWAYS poll conversation status before connecting WebSocket
      // OpenHands server rejects connections if conversation not ready (status: 'ok', 'pending', etc.)
      // Cloud returns 'ok' initially, not 'pending', so we MUST poll regardless of initial status
      logger.info('⏳ Polling conversation status to ensure ready...', {
        conversationId: conversation.id,
        initialStatus: conversation.status,
      });

      const maxPolls = 10;
      const pollIntervalMs = 500;
      let currentStatus = conversation.status;
      let isReady = false;

      // Check if already ready (case-insensitive comparison for status)
      const statusUpper = currentStatus?.toUpperCase() || '';
      if (statusUpper === 'RUNNING' || statusUpper === 'IN_PROGRESS') {
        logger.info('✅ Conversation already ready', {
          conversationId: conversation.id,
          status: currentStatus,
        });
        isReady = true;
      } else {
        // Poll until ready
        for (let i = 0; i < maxPolls; i++) {
          if (abortSignal.aborted) {
            throw new Error(
              '[OpenHandsAdapter] aborted while waiting for conversation ready',
            );
          }

          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

          const status = await conversationManager.getConversationStatus(
            conversation.id,
            undefined,
            abortSignal,
          );
          currentStatus = status.status;

          logger.debug('conversation status poll', {
            conversationId: conversation.id,
            status: currentStatus,
            poll: i + 1,
          });

          // Case-insensitive comparison
          const currentStatusUpper = currentStatus?.toUpperCase() || '';
          if (
            currentStatusUpper === 'RUNNING' ||
            currentStatusUpper === 'IN_PROGRESS'
          ) {
            logger.info('✅ Conversation ready', {
              conversationId: conversation.id,
              status: currentStatus,
              pollsNeeded: i + 1,
              timeMs: (i + 1) * pollIntervalMs,
            });
            isReady = true;
            break;
          }

          // Check for failure states (case-insensitive)
          if (
            currentStatusUpper === 'FAILED' ||
            currentStatusUpper === 'ERROR'
          ) {
            throw new Error(
              `[OpenHandsAdapter] conversation failed during initialization: ${currentStatus}`,
            );
          }
        }

        // If still not ready after max polls, log warning but proceed
        if (!isReady) {
          logger.warn(
            '⚠️ Conversation not ready after max polls, attempting connection anyway',
            {
              conversationId: conversation.id,
              currentStatus,
              maxPolls,
              totalWaitMs: maxPolls * pollIntervalMs,
            },
          );
        }
      }

      // Generate or extract sessionId for Socket.IO connection management
      const sessionId = (runOptions as { sessionId?: string })?.sessionId || conversation.id;

      // Run conversation via Socket.IO streaming
      const result = await this.runViaSocketIO(
        conversation.id,
        sessionId,
        apiKey,
        prompt,
        callbacks,
        abortSignal,
      );

      const durationMs = Date.now() - startTime;
      logger.info('OpenHands conversation completed', {
        success: result.success,
        durationMs,
        hasOutput: Boolean(result.output),
      });

      if (result.success && result.output) {
        callbacks.onComplete?.({ fullText: result.output, durationMs });
        return { fullText: result.output };
      } else {
        const err = new Error(
          `[OpenHandsAdapter] conversation failed: ${result.error || 'Unknown error'}`,
        );
        callbacks.onError?.(err);
        throw err;
      }
    } catch (topLevelErr: unknown) {
      logger.error('[OpenHandsAdapter] UNCAUGHT ERROR in run():', {
        message: String((topLevelErr as Record<string, unknown>)?.message ?? topLevelErr),
        name: (topLevelErr as Error)?.name,
        stack: (topLevelErr as Error)?.stack?.split('\n').slice(0, 3).join('\n'),
      });
      throw topLevelErr;
    }
  }

  /**
   * Disconnect Socket.IO client for a specific session.
   * Useful for cleanup after session completion or timeout.
   */
  disconnectSession(sessionId: string): void {
    const socket = this.socketClients.get(sessionId);
    if (socket) {
      logger.info('Disconnecting Socket.IO client', { sessionId });
      socket.disconnect();
      this.socketClients.delete(sessionId);
    }
  }

  /**
   * Disconnect all Socket.IO clients.
   * Useful for graceful shutdown or cleanup.
   */
  disconnectAll(): void {
    logger.info('Disconnecting all Socket.IO clients', {
      count: this.socketClients.size,
    });
    for (const [sessionId, socket] of this.socketClients.entries()) {
      socket.disconnect();
    }
    this.socketClients.clear();
  }

  /**
   * Get active session count for monitoring.
   */
  getActiveSessionCount(): number {
    return this.socketClients.size;
  }
}

export default OpenHandsAdapter;
