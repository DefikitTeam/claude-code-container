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
  // Note: JWT for Local GLM is read from LUMILINK_JWT_TOKEN environment variable
}

export interface ClaudeResult {
  fullText: string;
  tokens?: {
    input: number;
    output: number;
    cache_read?: number;
    total?: number;
  };
  cost?: {
    inputUsd: number;
    outputUsd: number;
    totalUsd: number;
  };
  costTracking?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
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
