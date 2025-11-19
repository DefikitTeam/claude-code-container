import getStreamBrokerConfig from '../../config/index.js';

export interface PostToBrokerOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const postToBrokerMetrics = {
  totalPosts: 0,
  success: 0,
  failure: 0,
  totalDurationMs: 0,
};

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
  postToBrokerMetrics.totalPosts += 1;

  while (attempt <= maxRetries) {
    try {
      const start = Date.now();
      attempt += 1;
      // Fire the fetch and return on success
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
      });
      if (res.ok) {
        const dur = Date.now() - start;
        postToBrokerMetrics.success += 1;
        postToBrokerMetrics.totalDurationMs += dur;
        console.error(`[postToBroker] success sessionId=${sessionId} attempt=${attempt} durationMs=${dur}`);
        return;
      }
      // Non-OK response - throw to trigger retry
      const text = await res.text();
      console.error(
        `[postToBroker] failed attempt ${attempt} status=${res.status} url=${url} body=${text}`,
      );
      const dur = Date.now() - start;
      postToBrokerMetrics.failure += 1;
      postToBrokerMetrics.totalDurationMs += dur;
      console.error(`[postToBroker] failed attempt ${attempt} status=${res.status} url=${url} body=${text} durationMs=${dur}`);
      if (attempt > maxRetries) {
        console.error('[postToBroker] max retries exceeded');
        return;
      }
    } catch (err) {
      const dur = 0;
      postToBrokerMetrics.failure += 1;
      postToBrokerMetrics.totalDurationMs += dur;
      console.error(`[postToBroker] network error attempt ${attempt}:`, err);
      if (attempt > maxRetries) {
        console.error('[postToBroker] max retries exceeded');
        return;
      }
    }

    // Exponential backoff with jitter
    const jitter = Math.floor(Math.random() * 100); // up to 100ms jitter
    await sleep(backoff + jitter);
    backoff *= 2;
  }
}

export default postToBroker;
