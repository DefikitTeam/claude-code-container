import getStreamBrokerConfig from '../../config/index.js';

export interface PostToBrokerOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postToBroker(
  sessionId: string,
  envelope: any,
  token?: string,
  opts: PostToBrokerOptions = {},
): Promise<void> {
  const { maxRetries = 3, initialBackoffMs = 100 } = opts;

  const cfg = getStreamBrokerConfig();
  if (!cfg.enabled || !cfg.url) {
    // Not configured - no-op
    return;
  }

  const url = `${cfg.url.replace(/\/$/, '')}/api/streams/sessions/${encodeURIComponent(
    sessionId,
  )}/events`;

  const authHeader = token || cfg.key;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader) {
    headers.Authorization = `Bearer ${authHeader}`;
    headers['X-Stream-Key'] = authHeader;
  }

  let attempt = 0;
  let backoff = initialBackoffMs;

  while (attempt <= maxRetries) {
    try {
      attempt += 1;
      // Fire the fetch and return on success
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
      });
      if (res.ok) {
        return;
      }
      // Non-OK response - throw to trigger retry
      const text = await res.text();
      console.error(
        `[postToBroker] failed attempt ${attempt} status=${res.status} url=${url} body=${text}`,
      );
      if (attempt > maxRetries) {
        console.error('[postToBroker] max retries exceeded');
        return;
      }
    } catch (err) {
      console.error(`[postToBroker] network error attempt ${attempt}:`, err);
      if (attempt > maxRetries) {
        console.error('[postToBroker] max retries exceeded');
        return;
      }
    }

    // Exponential backoff
    await sleep(backoff);
    backoff *= 2;
  }
}

export default postToBroker;
