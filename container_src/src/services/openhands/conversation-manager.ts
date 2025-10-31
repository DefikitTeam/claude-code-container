// Conversation types for OpenHands integration
// Phase 2 - T006: Define OpenHandsConversation and related interfaces

export type ConversationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OpenHandsConversation {
  // server-provided unique conversation id
  id: string;

  // optional human friendly title
  title?: string;

  // creation time as ISO 8601
  createdAt: string;

  // last updated time as ISO 8601
  updatedAt?: string;

  // current conversation status
  status: ConversationStatus;

  // optional summary or aggregated text
  summary?: string;

  // metadata such as repo list, user id, etc.
  metadata?: Record<string, unknown>;
}

export interface CreateConversationRequest {
  // initial prompt or user message
  prompt: string;

  // optional repositories context (multi-repo support)
  repositories?: Array<{ owner: string; repo: string; ref?: string }>;

  // optional model / adapter configuration overrides
  config?: Record<string, unknown>;
}

export interface ConversationStatusResponse {
  // mirror OpenHands API: id, status, events, error, completed_at
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'error' | string;
  events?: Array<Record<string, unknown>>;
  error?: string;
  completed_at?: string;
}

/**
 * ConversationManager is a small helper that encapsulates HTTP calls to the
 * OpenHands REST conversation endpoints. It is intentionally minimal and has
 * no side-effects beyond performing HTTP requests and returning parsed JSON.
 */
export class ConversationManager {
  constructor(private options?: { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }) {}

  /**
   * Error type that includes an HTTP status code and optional body for
   * better classification by callers.
   */
  /* eslint-disable-next-line @typescript-eslint/no-extraneous-class */
  static HTTPError = class HTTPError extends Error {
    status: number;
    body?: string;
    constructor(status: number, body?: string) {
      super(`[ConversationManager] HTTP ${status}: ${body ?? ''}`);
      this.name = 'HTTPError';
      this.status = status;
      this.body = body;
    }
  };

  private baseUrl(): string { 
    return this.options?.baseUrl || process.env.OPENHANDS_BASE_URL || 'https://api.openhands.ai';
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    const apiKey = this.options?.apiKey ?? process.env.OPENHANDS_API_KEY;
    if (apiKey) h['authorization'] = `Bearer ${apiKey}`;
    if (this.options?.headers) Object.assign(h, this.options.headers);
    return h;
  }

  /**
   * Create a new OpenHands conversation by POSTing to /api/conversations.
   * Returns the parsed ConversationStatusResponse on success or throws an
   * Error with diagnostic information on failure.
   */
  async createConversation(req: CreateConversationRequest, signal?: AbortSignal): Promise<ConversationStatusResponse> {
    const url = `${this.baseUrl().replace(/\/$/, '')}/api/conversations`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(req),
      signal,
    });

    const text = await res.text();
    if (!res.ok) {
      // attempt to surface any JSON error body, otherwise include raw text
      let body = text;
      try {
        const p = JSON.parse(text);
        body = JSON.stringify(p);
      } catch (e) {
        // keep raw text
      }
      throw new (ConversationManager.HTTPError)(res.status, body);
    }

    try {
      const json = JSON.parse(text) as ConversationStatusResponse;
      return json;
    } catch (err) {
      throw new Error(`[ConversationManager.createConversation] invalid-json response: ${String(err)} - raw: ${text}`);
    }
  }

  /**
   * Retrieve conversation status and basic metadata from OpenHands.
   */
  async getConversationStatus(conversationId: string, latestEventId?: number, signal?: AbortSignal): Promise<ConversationStatusResponse> {
    let url = `${this.baseUrl().replace(/\/$/, '')}/api/conversations/${encodeURIComponent(
      conversationId
    )}`;
    if (typeof latestEventId === 'number') {
      url += `?latest_event_id=${encodeURIComponent(String(latestEventId))}`;
    }
    const res = await fetch(url, { method: 'GET', headers: this.buildHeaders(), signal });
    const text = await res.text();
    if (!res.ok) {
      let body = text;
      try {
        const p = JSON.parse(text);
        body = JSON.stringify(p);
      } catch (e) {
        // keep raw
      }
      throw new (ConversationManager.HTTPError)(res.status, body);
    }

    try {
      const json = JSON.parse(text) as ConversationStatusResponse;
      return json;
    } catch (err) {
      throw new Error(`[ConversationManager.getConversationStatus] invalid-json response: ${String(err)} - raw: ${text}`);
    }
  }
}

export default ConversationManager;
