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

  // Polling interval (ms) when using REST polling
  pollingIntervalMs: number;

  // Whether to attempt WebSocket streaming first
  enableWebsocket: boolean;

  // WebSocket connection timeout (ms)
  websocketTimeoutMs: number;

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

/**
 * Defaults used when creating an OpenHandsAdapterConfig. These are conservative
 * values chosen to be safe for most environments. Callers may override any
 * field returned here.
 */
export const defaultOpenHandsConfig: OpenHandsAdapterConfig = {
  apiKey: process.env.OPENHANDS_API_KEY || undefined,
  baseUrl: process.env.OPENHANDS_BASE_URL || 'https://api.openhands.ai',
  pollingIntervalMs: Number(process.env.OPENHANDS_POLLING_INTERVAL_MS || 2000),
  enableWebsocket: (process.env.OPENHANDS_ENABLE_WEBSOCKET || 'true') === 'true',
  websocketTimeoutMs: Number(process.env.OPENHANDS_CONNECTION_TIMEOUT_MS || 10000),
  maxRetries: Number(process.env.OPENHANDS_MAX_RETRIES || 3),
  retryBackoffBaseMs: Number(process.env.OPENHANDS_RETRY_BACKOFF_BASE_MS || 500),
  maxEventBuffer: Number(process.env.OPENHANDS_MAX_EVENT_BUFFER || 1000),
  headers: {},
  disabled: (process.env.CLAUDE_CLIENT_DISABLE_OPENHANDS || 'false') === 'true',
};

/**
 * Helper to produce a config object merged with defaults. This keeps callers
 * from having to reference `process.env` directly and centralizes defaults.
 */
export function loadConfig(overrides?: Partial<OpenHandsAdapterConfig>): OpenHandsAdapterConfig {
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
import ConversationManager from '../../services/openhands/conversation-manager.js';
import { EventParser } from '../../services/openhands/event-parser.js';
import { setTimeout as delay } from 'node:timers/promises';

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
  readonly name = 'http-api' as const;
  private cfg: OpenHandsAdapterConfig;

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
    if ((process.env.CLAUDE_CLIENT_DISABLE_OPENHANDS || 'false') === 'true') return false;

    // Determine API key from (1) adapter config override, (2) runtime context, (3) environment
    const apiKey = this.cfg.apiKey ?? context.apiKey ?? process.env.OPENHANDS_API_KEY ?? process.env.ALLHANDS_API_KEY ?? process.env.ALLHANDS_API_KEY;

    // Only handle if we have an API key
    return Boolean(apiKey);
  }

  /**
   * Run a prompt using OpenHands. Not implemented yet — T014+ will add
   * conversation creation, polling/WebSocket streaming, callbacks, and
   * error handling.
   */
  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    const startTime = Date.now();
    const apiKey = this.cfg.apiKey ?? runOptions.apiKey ?? context.apiKey ?? process.env.OPENHANDS_API_KEY ?? process.env.ALLHANDS_API_KEY;

    if (!apiKey) {
      const err = new Error('[OpenHandsAdapter] missing API key');
      callbacks.onError?.(err);
      throw err;
    }

  // Allow environment variables to override adapter config at runtime.
  // This makes it possible to change base URL and polling interval without
  // recreating the adapter instance (useful in containerized or test runs).
  const effectiveBaseUrl = process.env.OPENHANDS_BASE_URL ?? this.cfg.baseUrl;
  const effectivePollingMs = Number(process.env.OPENHANDS_POLLING_INTERVAL_MS ?? String(this.cfg.pollingIntervalMs ?? 2000));

  const cm = new ConversationManager({ baseUrl: effectiveBaseUrl, apiKey });
    const parser = new EventParser({ maxBuffer: this.cfg.maxEventBuffer });

    // Helper to safely invoke callbacks provided by the caller. Callbacks
    // must not be allowed to throw and disrupt adapter control flow.
    const safeInvoke = <T extends unknown>(fn: ((arg: T) => void) | undefined, arg: T, name = 'callback') => {
      if (!fn) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fn as any)(arg);
      } catch (cbErr) {
        console.error(`[OpenHandsAdapter] ${name} threw error:`, cbErr);
      }
    };

    // Helper to classify transient HTTP errors from ConversationManager messages
    const isTransientError = (msg: string) => /HTTP (429|500|503)/i.test(msg);

    // Create conversation with a small retry for transient failures
    let convResp;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        convResp = await cm.createConversation({ prompt, config: { model: runOptions.model } }, abortSignal);
        break;
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        logger.error('createConversation error:', msg);
        if (abortSignal.aborted) {
          const aerr = new Error('[OpenHandsAdapter] aborted during createConversation');
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw aerr;
        }

        // Prefer numeric status code when available (ConversationManager.HTTPError)
        const statusCode = typeof err?.status === 'number' ? Number(err.status) : undefined;

        // Permanent auth errors - do not retry
        if (statusCode === 401 || statusCode === 403) {
          const aerr = new Error(`[OpenHandsAdapter] authentication error HTTP ${statusCode}`);
          logger.error('auth error creating conversation:', { statusCode, msg });
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw err;
        }

        // Not found - permanent (likely bad id or endpoint) - do not retry
        if (statusCode === 404) {
          const aerr = new Error('[OpenHandsAdapter] createConversation returned 404 (not found)');
          logger.error('createConversation 404:', msg);
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw err;
        }

        // Transient server errors: allow retry/backoff
        if (statusCode === 429 || statusCode === 500 || statusCode === 503) {
          // continue to retry below
        } else if (attempt >= this.cfg.maxRetries || !isTransientError(msg)) {
          // If we don't recognize this as transient, surface and abort
          safeInvoke(callbacks.onError, err, 'onError');
          throw err;
        }

        const backoff = this.cfg.retryBackoffBaseMs * Math.pow(2, attempt);
        try {
          await delay(backoff, { signal: abortSignal });
        } catch (dErr: any) {
          if (abortSignal.aborted) {
            const aerr = new Error('[OpenHandsAdapter] aborted during retry backoff');
            safeInvoke(callbacks.onError, aerr, 'onError');
            throw aerr;
          }
          throw dErr;
        }
      }
    }

    if (!convResp || !convResp.id) {
      const err = new Error('[OpenHandsAdapter] invalid createConversation response');
      callbacks.onError?.(err);
      throw err;
    }

    const conversationId = convResp.id;
  logger.info('created conversation', { conversationId });

  // Notify start (safe wrapper to protect adapter from callback errors)
  safeInvoke(callbacks.onStart, { startTime }, 'onStart');

    // Polling loop: fetch conversation status until completed/failed/cancelled
    let lastSummary = '';
    let fullText = '';

  const pollingMs = effectivePollingMs || 2000;

  // Track latestEventId per OpenHands API (default -1). If server returns
  // numeric event indices we'll use them; otherwise fall back to incrementing
  // by the number of events received to avoid re-reading the same batch.
  let latestEventId = -1;

  while (true) {
      if (abortSignal.aborted) {
        const err = new Error('aborted');
        callbacks.onError?.(err);
        throw err;
      }

      // Wait before polling (skip immediate wait if no events yet)
      try {
        await delay(pollingMs, { signal: abortSignal });
      } catch (dErr: any) {
        if (abortSignal.aborted) {
          const aerr = new Error('[OpenHandsAdapter] aborted during polling delay');
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw aerr;
        }
        throw dErr;
      }

      let statusResp;
      try {
        statusResp = await cm.getConversationStatus(conversationId, latestEventId, abortSignal);
      } catch (err: any) {
  const msg = String(err?.message ?? err);
  logger.error('getConversationStatus error:', msg);
        if (abortSignal.aborted) {
          const aerr = new Error('[OpenHandsAdapter] aborted during getConversationStatus');
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw aerr;
        }

        const statusCode = typeof err?.status === 'number' ? Number(err.status) : undefined;

        // Auth errors - surface immediately
        if (statusCode === 401 || statusCode === 403) {
          const aerr = new Error(`[OpenHandsAdapter] authentication error HTTP ${statusCode}`);
          logger.error('auth error during getConversationStatus:', { statusCode, msg });
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw err;
        }

        // Not found - conversation may not exist -> treat as terminal
        if (statusCode === 404) {
          const aerr = new Error('[OpenHandsAdapter] conversation not found (404)');
          logger.error('getConversationStatus 404:', msg);
          safeInvoke(callbacks.onError, aerr, 'onError');
          throw err;
        }

        // Transient server errors: notify and continue retrying
        if (statusCode === 429 || statusCode === 500 || statusCode === 503 || isTransientError(msg)) {
          safeInvoke(callbacks.onError, err, 'onError');
          continue;
        }

        // Unknown/permanent -> surface and abort
        safeInvoke(callbacks.onError, err, 'onError');
        throw err;
      }

  // Prefer per-event streaming when available (OpenHands API: events[])
  const conv = statusResp as any;
  const events = (conv.events ?? []) as Array<Record<string, any>>;
      if (events.length > 0) {
        // Try to discover numeric event id if present
        const numericIds: number[] = [];
        for (const ev of events) {
          const maybe = ev['event_index'] ?? ev['index'] ?? ev['seq'] ?? ev['sequence'] ?? ev['numeric_id'];
          if (typeof maybe === 'number' && Number.isFinite(maybe)) numericIds.push(maybe as number);
        }

        for (const ev of events) {
          // Use EventParser to dedupe and buffer events
          const added = parser.parseAndAdd(ev);
          if (!added) continue; // skip duplicates or invalid

          // Extract message text when present
          const text = (typeof ev.message === 'string' && ev.message) ||
            (ev.payload && typeof ev.payload.text === 'string' && ev.payload.text) ||
            undefined;

          if (text) {
            fullText += text;
            // Currently we don't have token accounting from OpenHands events;
            // callers can augment with token info later if available. Use the
            // safe wrapper to call onDelta.
            safeInvoke(callbacks.onDelta, { text, tokens: undefined }, 'onDelta');
          }
        }

        // Update latestEventId: prefer max numeric id if available, otherwise
        // increment by number of events to avoid re-requesting same batch.
        if (numericIds.length > 0) {
          latestEventId = Math.max(latestEventId, ...numericIds);
        } else {
          latestEventId = latestEventId + events.length;
        }
      } else {
        // Fallback to summary field if events not present
        const conv = (statusResp as any) as { summary?: string };
        const summary = conv.summary ?? '';
        if (summary && summary.length > lastSummary.length) {
          const delta = summary.slice(lastSummary.length);
          lastSummary = summary;
          fullText = summary;
            try {
              callbacks.onDelta?.({ text: delta });
            } catch (cbErr) {
              logger.error('callback onDelta threw:', cbErr);
            }
        }
      }

      // Terminal statuses: normalize and detect a variety of server-side
      // status values or explicit error fields that indicate the conversation
      // is finished (successfully or with failure). This implements T017.
      const rawStatus = (conv.status ?? '') as string;
      const status = String(rawStatus).toLowerCase().trim();

      // If the server provided an explicit error object/message treat it as
      // a failure regardless of the 'status' string.
      const explicitError = (conv.error ?? conv.error_message ?? conv.failure_reason) as string | undefined;
      if (explicitError) {
        const err = new Error(`[OpenHandsAdapter] conversation error: ${String(explicitError)}`);
        logger.error('conversation explicit error:', explicitError);
        safeInvoke(callbacks.onError, err, 'onError');
        throw err;
      }

      // Success statuses
      if (status === 'completed' || status === 'done' || status === 'finished' || status === 'success') {
        const durationMs = Date.now() - startTime;
        logger.info('conversation completed', { conversationId, durationMs });
        safeInvoke(callbacks.onComplete, { fullText, durationMs }, 'onComplete');
        return { fullText };
      }

      // Failure statuses
      if (status === 'failed' || status === 'failure' || status === 'error' || status === 'errored' || status === 'cancelled' || status === 'aborted') {
        const reason = explicitError ?? rawStatus;
        const err = new Error(`[OpenHandsAdapter] conversation ${String(reason)}`);
        logger.error('conversation terminal failure:', { status: rawStatus, reason });
        safeInvoke(callbacks.onError, err, 'onError');
        throw err;
      }
      // otherwise loop
    }
  }
}

export default OpenHandsAdapter;
