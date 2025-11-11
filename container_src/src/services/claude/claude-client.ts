import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import type { ClaudeAdapter } from '../../infrastructure/claude/adapter.js';
import { ClaudeRuntimeSelector } from '../../infrastructure/claude/runtime-selector.js';

export interface ClaudeClientOptions {
  defaultModel?: string;
  adapters?: ClaudeAdapter[];
}

export class ClaudeClient extends ClaudeRuntimeSelector {
  constructor(options: ClaudeClientOptions = {}) {
    super({
      adapters: options.adapters,
      defaultModel: options.defaultModel,
    });
  }

  async collectClaudeDiagnostics(): Promise<Record<string, unknown>> {
    return this.diagnostics();
  }

  override runPrompt(
    prompt: string,
    options: RunOptions,
    callbacks?: ClaudeCallbacks,
  ): Promise<ClaudeResult> {
    return super.runPrompt(prompt, options, callbacks);
  }
}

export const claudeClientSingleton = new ClaudeClient();

export default ClaudeClient;
