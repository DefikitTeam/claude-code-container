export interface ClaudeCallbacks {
  onStart?: (meta: { startTime: number }) => void;
  onDelta?: (delta: { text?: string; tokens?: number }) => void;
  onComplete?: (result: { fullText: string; durationMs: number }) => void;
  onError?: (err: unknown) => void;
}

export interface RunOptions {
  sessionId: string;
  operationId?: string;
  workspacePath?: string;
  apiKey?: string;
  abortSignal?: AbortSignal;
  model?: string;
  messages?: Array<unknown>; // Full message history
  llmProvider?: {
    provider: 'openrouter' | 'local-glm';
    baseURL: string;
    model: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  jwtToken?: string;
}

export interface ClaudeResult {
  fullText: string;
  tokens?: {
    input: number;
    output: number;
  };
  stopReason?: string;
  toolUse?: Array<{ name: string }>;
}

export interface IClaudeService {
  runPrompt(
    prompt: string,
    options: RunOptions,
    callbacks?: ClaudeCallbacks,
  ): Promise<ClaudeResult>;

  cancel(sessionId: string): Promise<void>;
  cancelOperation(sessionId: string, operationId: string): Promise<void>;
}
