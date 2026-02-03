/**
 * OpenAI SDK adapter for OpenRouter integration
 *
 * This adapter uses the official OpenAI SDK to communicate with OpenRouter's API.
 * OpenRouter provides a unified interface to 200+ LLMs including Claude, GPT, Gemini, etc.
 *
 * Key features:
 * - Simple HTTP streaming (no WebSocket complexity)
 * - Native tool calling support
 * - Multi-model fallback capabilities
 * - Compatible with Cloudflare Workers (stateless)
 *
 * Documentation:
 * - OpenRouter Docs: https://openrouter.ai/docs/community/open-ai-sdk
 * - OpenAI SDK: https://github.com/openai/openai-node
 * - Examples: https://github.com/OpenRouterTeam/openrouter-examples
 */

import OpenAI from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers';
import type { ClaudeAdapter, ClaudeRuntimeContext } from '../claude/adapter.js';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import { calculateCost } from './utils/cost-calculator.js';
import { costTracker } from './services/cost-tracker.service.js';

// Lightweight logger scoped to this adapter
const logger = {
  error: (...args: unknown[]) =>
    console.error('[OpenAIOpenRouterAdapter]', ...args),
  warn: (...args: unknown[]) =>
    console.warn('[OpenAIOpenRouterAdapter]', ...args),
  info: (...args: unknown[]) =>
    console.info('[OpenAIOpenRouterAdapter]', ...args),
  debug: (...args: unknown[]) =>
    console.debug('[OpenAIOpenRouterAdapter]', ...args),
};

// const FORCED_OPENROUTER_MODEL = 'x-ai/grok-code-fast-1' as const;
const FORCED_OPENROUTER_MODEL = 'google/gemini-2.0-flash-lite-001' as const; // Free model available

/**
 * Configuration for OpenAI OpenRouter adapter
 */
export interface OpenAIOpenRouterConfig {
  // Base URL for OpenRouter API (defaults to https://openrouter.ai/api/v1)
  baseURL?: string;

  // API key for OpenRouter (defaults to OPENROUTER_API_KEY env var)
  apiKey?: string;

  // Default model to use (defaults to openai/gpt-5)
  defaultModel?: string;

  // Optional HTTP referer header (for OpenRouter rankings)
  httpReferer?: string;

  // Optional site name header (for OpenRouter rankings)
  siteName?: string;

  // Request timeout in milliseconds
  timeout?: number;

  // Maximum retries for transient errors
  maxRetries?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<OpenAIOpenRouterConfig, 'apiKey'>> = {
  baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  defaultModel: FORCED_OPENROUTER_MODEL,
  httpReferer:
    process.env.OPENROUTER_HTTP_REFERER ||
    'https://github.com/DefikitTeam/claude-code-container',
  siteName: process.env.OPENROUTER_SITE_NAME || 'Claude Code Container',
  timeout: Number(process.env.OPENROUTER_TIMEOUT || 900000), // 15 minutes
  maxRetries: Number(process.env.OPENROUTER_MAX_RETRIES || 2),
};

/**
 * OpenAI SDK adapter for OpenRouter
 *
 * Implements the ClaudeAdapter interface using OpenAI SDK + OpenRouter.
 * This provides a simpler, more reliable alternative to WebSocket-based adapters.
 */
export class OpenAIOpenRouterAdapter implements ClaudeAdapter {
  // Runtime kind (must be one of 'sdk' | 'cli' | 'http-api')
  readonly name = 'http-api' as const;

  // Adapter identifier for logging and diagnostics
  readonly adapterId = 'openai-openrouter' as const;

  private config: Required<Omit<OpenAIOpenRouterConfig, 'apiKey'>> & {
    apiKey?: string;
  };

  constructor(config?: OpenAIOpenRouterConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      apiKey: config?.apiKey || process.env.OPENROUTER_API_KEY,
      ...(config || {}),
    };

    // Enforce the model even if caller tries to override it.
    this.config.defaultModel = FORCED_OPENROUTER_MODEL;

    logger.debug('initialized', {
      baseURL: this.config.baseURL,
      defaultModel: this.config.defaultModel,
      hasApiKey: Boolean(this.config.apiKey),
      timeout: this.config.timeout,
    });
  }

  /**
   * Check if this adapter can handle the given context
   *
   * Requirements:
   * - OpenRouter API key must be available
   * - Can be explicitly disabled via CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER env var
   */
  canHandle(context: ClaudeRuntimeContext): boolean {
    // Respect explicit disabling
    if (process.env.CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER === '1') {
      logger.debug(
        'adapter disabled via CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER',
      );
      return false;
    }

    // Determine API key from multiple sources (priority order):
    // 1. Adapter config override
    // 2. Runtime context
    // 3. Environment variable
    const apiKey =
      this.config.apiKey ?? context.apiKey ?? process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      logger.debug('no API key available');
      return false;
    }

    logger.debug('can handle', { hasApiKey: true });
    return true;
  }

  /**
   * Run a prompt using OpenAI SDK + OpenRouter
   *
   * Supports:
   * - Streaming responses (async iteration)
   * - Tool calling (function tools)
   * - Abort signals (cancellation)
   * - Delta callbacks (real-time updates)
   */
  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    const startTime = Date.now();

    try {
      // Resolve API key (same priority as canHandle)
      const apiKey =
        this.config.apiKey ?? context.apiKey ?? process.env.OPENROUTER_API_KEY;

      if (!apiKey) {
        throw new Error(
          '[OpenAIOpenRouterAdapter] missing API key - set OPENROUTER_API_KEY environment variable',
        );
      }

      // Resolve model (priority: runOptions > context > config default)
      const requestedModel =
        runOptions.model ?? context.model ?? this.config.defaultModel;
      const model = this.selectModel(requestedModel);

      logger.info('starting completion', {
        requestedModel,
        model,
        promptLength: prompt.length,
        streaming: true,
      });

      // Notify start
      callbacks.onStart?.({ startTime });

      // Create OpenAI client configured for OpenRouter
      // Wrapped with LangSmith for automatic tracing
      const client = wrapOpenAI(
        new OpenAI({
          apiKey,
          baseURL: this.config.baseURL,
          defaultHeaders: {
            'HTTP-Referer': this.config.httpReferer,
            'X-Title': this.config.siteName,
          },
          timeout: this.config.timeout,
          maxRetries: this.config.maxRetries,
        }),
      );

      // Check abort before starting
      if (abortSignal.aborted) {
        throw new Error('aborted');
      }

      // Prepare messages array
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'user', content: prompt },
      ];

      // Start streaming completion
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        max_tokens: 15600, // Reasonable limit to prevent credit exhaustion
      });

      // Process stream
      let fullText = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let cacheReadTokens = 0;

      // Iterate through streaming chunks
      for await (const chunk of stream) {
        // Check abort signal
        if (abortSignal.aborted) {
          throw new Error('aborted');
        }

        // Extract usage data from chunk (OpenRouter provides this)
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens || 0;
          completionTokens = chunk.usage.completion_tokens || 0;
          
          // OpenRouter may use different field names for cache tokens
          // Try both known field names and log which one is used
          const cacheHitTokens = (chunk.usage as any).prompt_cache_hit_tokens;
          const cacheReadTokensField = (chunk.usage as any).cache_read_input_tokens;
          cacheReadTokens = cacheHitTokens || cacheReadTokensField || 0;
          
          // Debug logging to understand OpenRouter's field naming
          if (cacheReadTokens > 0) {
            logger.debug('cache tokens detected', {
              cacheReadTokens,
              usingField: cacheHitTokens ? 'prompt_cache_hit_tokens' : 'cache_read_input_tokens',
            });
          }
        }

        // Extract delta content
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content || '';

        if (content) {
          fullText += content;

          // Notify delta callback (estimate tokens for real-time feedback)
          const estimatedTokens = Math.max(1, Math.ceil(content.length / 4));
          callbacks.onDelta?.({ text: content, tokens: estimatedTokens });
        }

        // Handle tool calls if present
        if (delta?.tool_calls) {
          logger.debug('tool calls received', {
            count: delta.tool_calls.length,
            tools: delta.tool_calls
              .map((tc) => tc.function?.name)
              .filter(Boolean),
          });

          // Note: Tool call handling would be implemented here when RunOptions supports it
          // For now, we just log them
        }

        // Check for finish reason
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          logger.debug('completion finished', {
            finishReason,
            outputLength: fullText.length,
          });
        }
      }

      const durationMs = Date.now() - startTime;

      // Warn if no token usage was received from OpenRouter
      if (promptTokens === 0 && completionTokens === 0 && fullText.length > 0) {
        logger.warn('no token usage received from OpenRouter', {
          model,
          contentLength: fullText.length,
          message: 'Token counts may be inaccurate. Check OpenRouter API response.',
        });
      }

      // Calculate actual cost using OpenRouter pricing
      const costCalculation = calculateCost(
        model,
        promptTokens,
        completionTokens,
        cacheReadTokens,
      );

      logger.info('completion succeeded', {
        durationMs,
        outputLength: fullText.length,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          cacheRead: cacheReadTokens,
          total: promptTokens + completionTokens,
        },
        cost: {
          input: `$${costCalculation.inputCostUsd.toFixed(6)}`,
          output: `$${costCalculation.outputCostUsd.toFixed(6)}`,
          total: `$${costCalculation.totalCostUsd.toFixed(6)}`,
        },
      });

      // Track cost for monitoring
      costTracker.trackCall(runOptions.sessionId || 'unknown', {
        model,
        promptTokens,
        completionTokens,
        cacheReadTokens,
        totalCostUsd: costCalculation.totalCostUsd,
        inputCostUsd: costCalculation.inputCostUsd,
        outputCostUsd: costCalculation.outputCostUsd,
        cacheReadCostUsd: costCalculation.cacheReadCostUsd,
      });

      // Notify completion
      callbacks.onComplete?.({ fullText, durationMs });

      return {
        fullText,
        tokens: {
          input: promptTokens,
          output: completionTokens,
          cache_read: cacheReadTokens,
          total: promptTokens + completionTokens,
        },
        costTracking: {
          model,
          promptTokens,
          completionTokens,
          cacheReadTokens,
          totalTokens: promptTokens + completionTokens,
          inputCostUsd: costCalculation.inputCostUsd,
          outputCostUsd: costCalculation.outputCostUsd,
          totalCostUsd: costCalculation.totalCostUsd,
        },
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      logger.error('completion failed', {
        durationMs,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined,
      });

      // Classify and re-throw with better error messages
      if (abortSignal.aborted) {
        const abortError = new Error('aborted');
        callbacks.onError?.(abortError);
        throw abortError;
      }

      if (error instanceof OpenAI.APIError) {
        // OpenAI SDK error with structured information
        const apiError = new Error(
          `openrouter_api_error_${error.status || 'unknown'}: ${error.message}`,
        );
        (apiError as unknown as Record<string, unknown>).detail = {
          status: error.status,
          type: error.type,
          code: error.code,
          message: error.message,
        };
        callbacks.onError?.(apiError);
        throw apiError;
      }

      // Generic error
      callbacks.onError?.(error);
      throw error;
    }
  }

  /**
   * Map model names to OpenRouter model identifiers
   *
   * Supports common short names (claude-sonnet-4) and full OpenRouter IDs (anthropic/claude-sonnet-4).
   * If a model ID already contains a slash, it's assumed to be a valid OpenRouter ID.
   */
  private selectModel(requestedModel?: string): string {
    void requestedModel;

    // Hard-force a single OpenRouter model.
    return FORCED_OPENROUTER_MODEL;

    /*
    // Default model mappings
    const modelMap: Record<string, string> = {
      // Claude models
      'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
      'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
      'claude-sonnet-4': 'anthropic/claude-sonnet-4',
      'claude-sonnet-4-5': 'anthropic/claude-sonnet-4', // Alias for claude-sonnet-4
      'claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet:thinking',

      // OpenAI models
      'gpt-4o': 'openai/gpt-4o',
      'gpt-4': 'openai/gpt-4',
      'gpt-5': 'openai/gpt-5',
      'gpt-5-mini': 'openai/gpt-5-mini',
      'o1': 'openai/o1',

      // Google models
      'gemini-2.0-flash': 'google/gemini-2.0-flash-lite-001',
      'gemini-2.0-flash-exp': 'google/gemini-2.0-flash-lite-001',
      'gemini-flash': 'google/gemini-2.0-flash-lite-001',

      // Coding-specific models
      'qwen-coder': 'qwen/qwen-2.5-coder-32b-instruct',

      // Reasoning models
      'deepseek-r1': 'deepseek/deepseek-r1',
    };

    if (!requestedModel) {
      return 'anthropic/claude-sonnet-4'; // Default
    }

    // Check if it's already an OpenRouter model ID (contains /)
    if (requestedModel.includes('/')) {
      return requestedModel;
    }

    // Map to OpenRouter model ID
    return modelMap[requestedModel] || `anthropic/${requestedModel}`;
    */
  }

}

export default OpenAIOpenRouterAdapter;
