/**
 * Refactor Placeholder (Phase 5: Claude Client Adapter)
 * --------------------------------------------------
 * Wraps current Claude interaction (streaming query) behind a stable interface supporting
 * callbacks for streaming events. Future strategies (different model backends) can implement
 * the same contract.
 */

export interface ClaudeRunCallbacks {
  onStart?: (meta: { startTime: number }) => void;
  onDelta?: (data: { text?: string; tokens?: number }) => void;
  onComplete?: (result: { fullText: string; durationMs: number }) => void;
  onError?: (err: unknown) => void;
}

export interface IClaudeClient {
  runPrompt(
    prompt: string,
    opts: { sessionId: string; workspacePath: string },
    callbacks?: ClaudeRunCallbacks,
  ): Promise<{ fullText: string }>;
  cancel(sessionId: string): Promise<void>; // Placeholder for future cancellation token implementation
}

export class ClaudeClient implements IClaudeClient {
  // TODO(acp-refactor/phase-5): Maintain map of in-flight sessions for cancellation.
  constructor(_deps?: { model?: string; timeoutMs?: number }) {}
  async runPrompt(
    _prompt: string,
    _opts: { sessionId: string; workspacePath: string },
    _callbacks?: ClaudeRunCallbacks,
  ): Promise<{ fullText: string }> {
    throw new Error(
      'ClaudeClient.runPrompt not implemented (refactor phase 5 placeholder)',
    );
  }
  async cancel(_sessionId: string): Promise<void> {
    throw new Error(
      'ClaudeClient.cancel not implemented (refactor phase 5 placeholder)',
    );
  }
}

export default ClaudeClient;
