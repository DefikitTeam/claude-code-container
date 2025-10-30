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

export default {} as const;
