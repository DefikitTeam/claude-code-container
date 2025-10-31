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
  // Required: initial user message (OpenHands API field name)
  initial_user_msg: string;

  // Optional: repository in format "owner/repo" (OpenHands API field name)
  repository?: string;

  // Optional: additional repositories for multi-repo support
  // Note: Check OpenHands API docs for current multi-repo support
  repositories?: Array<{ owner: string; repo: string; ref?: string }>;

  // Note: Model selection is typically done via headers or account settings,
  // not in the request body. If needed, check OpenHands API for supported fields.
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
    // The OpenHands docs and examples use https://app.all-hands.dev as the API host.
    // Use that as the default here but allow overriding via options or OPENHANDS_BASE_URL.
    return this.options?.baseUrl || process.env.OPENHANDS_BASE_URL || 'https://app.all-hands.dev';
  }

  /**
   * Return an ordered list of candidate base URLs to try. First preference
   * is options.baseUrl, then OPENHANDS_BASE_URL, then canonical hosts.
   */
  private baseUrlCandidates(): string[] {
    const seen = new Set<string>();
    const candidates = [
      this.options?.baseUrl,
      process.env.OPENHANDS_BASE_URL,
      'https://app.all-hands.dev',
      'https://api.openhands.ai',
    ];
    const out: string[] = [];
    for (const c of candidates) {
      if (!c) continue;
      const trimmed = String(c).trim().replace(/\/$/, '');
      if (!trimmed) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
    return out;
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    // Normalize and sanitize API key values. Some environments accidentally
    // set the literal string 'undefined' or 'null' which would pass a Boolean
    // check but are not valid credentials. Treat those as absent.
    const raw = this.options?.apiKey ?? process.env.OPENHANDS_API_KEY ?? process.env.LLM_API_KEY;
    const apiKey = typeof raw === 'string' && raw.trim() && raw !== 'undefined' && raw !== 'null' ? raw.trim() : undefined;
    if (apiKey) {
      // Prefer standard Bearer Authorization but include common alternate
      // header names some deployments accept (x-api-key) to improve
      // compatibility with self-hosted or proxied installations.
      h['authorization'] = `Bearer ${apiKey}`;
      h['x-api-key'] = apiKey;

      // Some deployments (and some endpoints like /api/options/agents)
      // accept a session-style key presented as X-Session-API-Key (for
      // example OpenRouter-style tokens `sk-or-...`). Detect common
      // OpenRouter prefix and add the header to improve compatibility
      // when callers only have that token available.
      try {
        if (typeof apiKey === 'string' && /^sk-or-/.test(apiKey)) {
          h['x-session-api-key'] = apiKey;
        }
      } catch (e) {
        // Defensive: if regex throws for any reason, ignore and proceed
      }
    }
    if (this.options?.headers) Object.assign(h, this.options.headers);
    return h;
  }

  /**
   * Create a new OpenHands conversation by POSTing to /api/conversations.
   * Returns the parsed ConversationStatusResponse on success or throws an
   * Error with diagnostic information on failure.
   */
  async createConversation(req: CreateConversationRequest, signal?: AbortSignal): Promise<ConversationStatusResponse> {
    const candidates = this.baseUrlCandidates();
    let lastNetworkErr: any = null;
    let res: Response | undefined;
    for (const base of candidates) {
      const url = `${base.replace(/\/$/, '')}/api/conversations`;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(req),
          signal,
        });
        // if we got a response, stop trying alternatives
        break;
      } catch (err: any) {
        // Network-level failure (DNS/TCP/TLS) -> remember and try next candidate
        lastNetworkErr = err;
        // continue to next candidate
        continue;
      }
    }

    if (!res) {
      const msg = String(lastNetworkErr?.message ?? lastNetworkErr ?? 'unknown network error');
      const e = new Error(`[ConversationManager] network error when POST (all candidates tried): ${msg}`);
      e.name = 'NetworkError';
      (e as any).code = lastNetworkErr?.code ?? undefined;
      throw e;
    }

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
    const candidates = this.baseUrlCandidates();
    let lastNetworkErr: any = null;
    let res: Response | undefined;
    for (const base of candidates) {
      let url = `${base.replace(/\/$/, '')}/api/conversations/${encodeURIComponent(
        conversationId
      )}`;
      if (typeof latestEventId === 'number') {
        url += `?latest_event_id=${encodeURIComponent(String(latestEventId))}`;
      }
      try {
        res = await fetch(url, { method: 'GET', headers: this.buildHeaders(), signal });
        break;
      } catch (err: any) {
        lastNetworkErr = err;
        continue;
      }
    }

    if (!res) {
      const msg = String(lastNetworkErr?.message ?? lastNetworkErr ?? 'unknown network error');
      const e = new Error(`[ConversationManager] network error when GET (all candidates tried): ${msg}`);
      e.name = 'NetworkError';
      (e as any).code = lastNetworkErr?.code ?? undefined;
      throw e;
    }
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
