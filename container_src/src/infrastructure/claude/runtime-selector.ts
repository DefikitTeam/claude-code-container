import os from 'os';
import path from 'path';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  IClaudeService,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import { resolveClaudeCli } from './cli-resolver.js';
import type { ClaudeAdapter, ClaudeRuntimeContext } from './adapter.js';
import { SDKClientAdapter } from './sdk-client.adapter.js';
import { CLIClientAdapter } from './cli-client.adapter.js';
import { HTTPAPIClientAdapter } from './http-api-client.adapter.js';
import { VercelOpenRouterAdapter } from '../ai/vercel-openrouter.adapter.js';

const DEFAULT_MODEL = 'claude-sonnet-4'; // Maps to anthropic/claude-sonnet-4 on OpenRouter

type InFlight = {
  sessionId: string;
  operationId?: string;
  abortController: AbortController;
};

export interface ClaudeRuntimeSelectorOptions {
  adapters?: ClaudeAdapter[];
  defaultModel?: string;
}

export class ClaudeRuntimeSelector implements IClaudeService {
  private readonly adapters: ClaudeAdapter[];
  private readonly inFlightBySession = new Map<string, InFlight[]>();
  private readonly inFlightByOperation = new Map<string, InFlight>();
  private readonly defaultModel: string;

  constructor(options: ClaudeRuntimeSelectorOptions = {}) {
    this.adapters = options.adapters ?? [
      new VercelOpenRouterAdapter(),
      new SDKClientAdapter(),
      new CLIClientAdapter(),
      new HTTPAPIClientAdapter(),
    ];
    this.defaultModel = options.defaultModel || DEFAULT_MODEL;
  }

  async runPrompt(
    prompt: string,
    options: RunOptions,
    callbacks: ClaudeCallbacks = {},
  ): Promise<ClaudeResult> {
    const startTime = Date.now();
    const sessionId = options.sessionId ?? `session-${startTime}`;
    const operationId =
      options.operationId ?? `op-${startTime}-${Math.random().toString(36).slice(2, 8)}`;

    const abortController = new AbortController();
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        throw new Error('aborted');
      }
      const forwardAbort = () => abortController.abort();
      options.abortSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    const inFlight: InFlight = { sessionId, operationId, abortController };
    this.registerInFlight(inFlight);

    callbacks.onStart?.({ startTime });

    let fullText = '';
    let inputTokens = this.estimateTokens(prompt);
    let outputTokens = 0;

    const bridgeCallbacks: ClaudeCallbacks = {
      onDelta: (delta) => {
        const text = delta.text ?? '';
        if (text) {
          fullText += text;
          const tokens = delta.tokens ?? this.estimateTokens(text);
          outputTokens += tokens;
          callbacks.onDelta?.({ text, tokens });
        }
      },
      onError: callbacks.onError,
    };

    try {
      const context = await this.createContext(options);
      const candidates = await this.planAdapters(context);

      let lastError: unknown = null;
      for (const adapter of candidates) {
        try {
          const result = await adapter.run(
            prompt,
            options,
            context,
            bridgeCallbacks,
            abortController.signal,
          );

          if (!fullText && result.fullText) {
            fullText = result.fullText;
          }

          const durationMs = Date.now() - startTime;
          callbacks.onComplete?.({ fullText, durationMs });

          return {
            fullText,
            tokens: {
              input: inputTokens,
              output: outputTokens || this.estimateTokens(fullText),
            },
          };
        } catch (error) {
          lastError = error;
          // Try next adapter in cascade.
        }
      }

      if (lastError) {
        throw lastError;
      }

      throw new Error('claude_runtime_unavailable');
    } catch (error) {
      callbacks.onError?.(error);
      throw error;
    } finally {
      this.unregisterInFlight(inFlight);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const entries = this.inFlightBySession.get(sessionId);
    if (!entries) return;

    for (const entry of [...entries]) {
      entry.abortController.abort();
      this.unregisterInFlight(entry);
    }
  }

  async cancelOperation(sessionId: string, operationId: string): Promise<void> {
    const key = `${sessionId}:${operationId}`;
    const entry = this.inFlightByOperation.get(key);
    if (!entry) return;

    entry.abortController.abort();
    this.unregisterInFlight(entry);
  }

  private registerInFlight(entry: InFlight): void {
    const list = this.inFlightBySession.get(entry.sessionId) ?? [];
    list.push(entry);
    this.inFlightBySession.set(entry.sessionId, list);
    if (entry.operationId) {
      this.inFlightByOperation.set(
        `${entry.sessionId}:${entry.operationId}`,
        entry,
      );
    }
  }

  private unregisterInFlight(entry: InFlight): void {
    const list = this.inFlightBySession.get(entry.sessionId);
    if (list) {
      const index = list.indexOf(entry);
      if (index >= 0) {
        list.splice(index, 1);
      }
      if (list.length === 0) {
        this.inFlightBySession.delete(entry.sessionId);
      } else {
        this.inFlightBySession.set(entry.sessionId, list);
      }
    }

    if (entry.operationId) {
      this.inFlightByOperation.delete(`${entry.sessionId}:${entry.operationId}`);
    }
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private async createContext(options: RunOptions): Promise<ClaudeRuntimeContext> {
    // Try ANTHROPIC_API_KEY first, then fall back to OPENROUTER_API_KEY for multi-model support
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      const diagnostics = await this.diagnostics();
      const error = new Error('anthropic_api_key_missing');
      (error as any).detail = { diagnostics };
      throw error;
    }

    const runningAsRoot =
      typeof process.getuid === 'function' && process.getuid() === 0;

    return {
      apiKey,
      workspacePath: options.workspacePath,
      model: options.model ?? this.defaultModel,
      runningAsRoot,
      disableSdk: process.env.CLAUDE_CLIENT_DISABLE_SDK === '1',
      disableCli: process.env.CLAUDE_CLIENT_DISABLE_CLI === '1',
      forceHttpApi: process.env.CLAUDE_CLIENT_FORCE_HTTP_API === '1',
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
    };
  }

  private async planAdapters(context: ClaudeRuntimeContext): Promise<ClaudeAdapter[]> {
    const ordered: ClaudeAdapter[] = [];

    const candidates = [...this.adapters];

    // When running as root, prioritise HTTP adapter.
    if (context.runningAsRoot || context.forceHttpApi) {
      candidates.sort((a, b) => {
        if (a.name === 'http-api') return -1;
        if (b.name === 'http-api') return 1;
        if (a.name === 'sdk') return 1;
        if (b.name === 'sdk') return -1;
        return 0;
      });
    }

    for (const adapter of candidates) {
      const canHandle = await Promise.resolve(adapter.canHandle(context));
      if (canHandle) {
        ordered.push(adapter);
      }
    }

    return ordered;
  }

  protected async diagnostics(): Promise<Record<string, unknown>> {
    const home = os.homedir();
    const configDir = path.join(home, '.config', 'claude-code');
    const authFile = path.join(configDir, 'auth.json');
    const legacyFile = path.join(home, '.claude.json');

    const cli = await resolveClaudeCli();

    return {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      hasApiKeyEnv: Boolean(process.env.ANTHROPIC_API_KEY),
      paths: { authFile, legacyFile },
      claudeCliCommand: cli?.command ?? null,
      claudeCliVersion: cli?.versionStdout ?? null,
      claudeCliVersionError: cli?.versionError ?? null,
    };
  }
}

export default ClaudeRuntimeSelector;
