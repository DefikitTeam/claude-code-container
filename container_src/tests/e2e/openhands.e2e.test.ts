import { describe, it, expect } from 'vitest';
import OpenHandsAdapter from '../../src/infrastructure/ai/openhands.adapter.js';

// This test performs a real network call to OpenHands and is skipped by default.
// To run it, set environment variable REAL_OPENHANDS=1 and provide OPENHANDS_API_KEY.
// Additional environment variables:
//   OPENHANDS_E2E_TIMEOUT_MS - timeout in ms (default 120000)
// Behavior:
// - collects onDelta callbacks into `deltas`
// - aborts the run after timeout and fails the test if no progress
const runReal =
  process.env.REAL_OPENHANDS === '1' && !!process.env.OPENHANDS_API_KEY;

(runReal ? it : it.skip)(
  'real OpenHands e2e (manual, requires REAL_OPENHANDS=1 and OPENHANDS_API_KEY)',
  async () => {
    const timeoutMs = Number(process.env.OPENHANDS_E2E_TIMEOUT_MS ?? 120000);
    const deltas: string[] = [];
    let started = false;
    let completed = false;

    const adapter = new OpenHandsAdapter({});

    const onStart = () => {
      started = true;
    };
    const onDelta = (d: any) => {
      try {
        const text = typeof d === 'string' ? d : (d?.text ?? JSON.stringify(d));
        if (text) deltas.push(String(text));
      } catch (e) {
        // swallow parsing errors
      }
    };
    const onComplete = () => {
      completed = true;
    };
    const onError = (e: any) => {
      throw e;
    };
    const callbacks = { onStart, onDelta, onComplete, onError } as any;

    const abortController = new AbortController();

    // Safety timeout to abort long-running E2E runs
    const timeout = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const result = await adapter.run(
        'List TypeScript files in workspace',
        { model: 'default' } as any,
        {} as any,
        callbacks,
        abortController.signal,
      );

      // Basic assertions: we must have started and produced some text
      expect(started).toBe(true);
      // Accept either deltas or the final fullText; prefer deltas as progress indicator
      if (deltas.length === 0) {
        // if no deltas, ensure final text exists
        expect(result.fullText).toBeDefined();
        expect(String(result.fullText).length).toBeGreaterThan(0);
      } else {
        // ensure at least one non-empty delta
        const nonEmpty = deltas.find((t) => t && t.trim().length > 0);
        expect(nonEmpty).toBeDefined();
      }

      expect(completed || (result && result.fullText)).toBeTruthy();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // If we were rate-limited, skip/mark test as inconclusive to avoid CI flakiness
      if (/HTTP 429|Too Many Requests/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.warn('[e2e] OpenHands returned 429 - skipping e2e assertion');
        expect(true).toBe(true);
        return;
      }
      // Authentication errors should fail loudly
      if (/HTTP 401|HTTP 403|authentication error/i.test(msg)) {
        throw new Error(`[e2e] OpenHands auth error: ${msg}`);
      }
      // If aborted due to timeout, make a clearer failure
      if (abortController.signal.aborted) {
        throw new Error(`[e2e] aborted after ${timeoutMs}ms: ${msg}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },
);
