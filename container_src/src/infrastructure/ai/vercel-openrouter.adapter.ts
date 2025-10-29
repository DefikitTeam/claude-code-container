import { streamText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import GitService from '../..//services/git/git-service.js';
import type { ClaudeAdapter, ClaudeRuntimeContext } from '../claude/adapter.js';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';

/**
 * Vercel AI SDK + OpenRouter adapter
 * Official integration following Vercel AI SDK and OpenRouter documentation
 */
export class VercelOpenRouterAdapter implements ClaudeAdapter {
  readonly name = 'sdk' as const;

  canHandle(context: ClaudeRuntimeContext): boolean {
    if (context.disableSdk || context.forceHttpApi) return false;
    if (context.runningAsRoot) return false;
    return !!context.apiKey;
  }

  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    const startTime = Date.now();

    // 1. Create OpenRouter provider instance
    const openrouter = createOpenRouter({
      apiKey: context.apiKey, // Your premium OpenRouter API key
    });

    // 2. Select model (default to Claude 3.5 Sonnet for compatibility)
    const modelName = this.selectModel(context.model || runOptions.model);

      // Prepare tools (optional) if enabled by env var
      const tools: Record<string, any> | undefined =
        process.env.ENABLE_AGENT_TOOLS === '1'
          ? {
              applyPatch: tool({
                description: 'Apply a unified-diff patch to the repository workspace',
                inputSchema: z.object({
                  patch: z.string().min(1).describe('Unified diff patch to apply'),
                }),
                async execute({ patch }) {
                  // Basic safety checks
                  const maxBytes = Number(process.env.ACP_MAX_PATCH_BYTES) || 200 * 1024;
                  if (Buffer.byteLength(patch, 'utf8') > maxBytes) {
                    throw new Error('patch-too-large');
                  }
                  const git = new GitService();
                  const ws = context.workspacePath;
                  if (!ws) throw new Error('workspace-not-provided');
                  await git.applyPatch(ws, patch);
                  return { success: true };
                },
              }),
              writeFile: tool({
                description: 'Write a file into the repository workspace',
                inputSchema: z.object({
                  path: z.string().min(1).describe('Path to write, relative to workspace'),
                  content: z.string().describe('File content'),
                }),
                async execute({ path: relPath, content }) {
                  const ws = context.workspacePath;
                  if (!ws) throw new Error('workspace-not-provided');
                  // Normalize and prevent path traversal
                  const normalized = path.posix.normalize(relPath).replace(/^\/+/, '');
                  if (normalized.includes('..')) throw new Error('invalid-path');
                  const target = path.join(ws, normalized);
                  await fs.mkdir(path.dirname(target), { recursive: true });
                  await fs.writeFile(target, content, 'utf8');
                  return { success: true, path: normalized };
                },
              }),
            }
          : undefined;

      try {
      // 3. Stream text using Vercel AI SDK
      const result = streamText({
        model: openrouter.chat(modelName),
        prompt: prompt,
        tools,
        
        // Optional: Add providerOptions for OpenRouter-specific features
        providerOptions: {
          openrouter: {
            // Enable usage accounting (get costs in response)
            // Note: This is automatically available in providerMetadata
          },
        },
        
        // Error handling
        onError: ({ error }) => {
          console.error('[VercelOpenRouterAdapter] Stream error:', error);
          callbacks.onError?.(error);
        },
        
        // Finish callback
        onFinish: ({ text, usage }) => {
          const durationMs = Date.now() - startTime;
          callbacks.onComplete?.({
            fullText: text,
            durationMs,
          });
        },
        
        // Abort signal
        abortSignal,
      });

      // 4. Notify start
      callbacks.onStart?.({ startTime });

      // 5. Stream text chunks
      let fullText = '';
      for await (const textPart of result.textStream) {
        fullText += textPart;
        callbacks.onDelta?.({ text: textPart });

        // Check abort signal
        if (abortSignal.aborted) {
          throw new Error('aborted');
        }
      }

      // 6. Get final result (await promises for usage and metadata)
      const usage = await result.usage;
      const providerMetadata = await result.providerMetadata;

      // 7. Extract token usage (if available)
      const tokens = {
        input: usage?.inputTokens || this.estimateTokens(prompt),
        output: usage?.outputTokens || this.estimateTokens(fullText),
      };

      // 8. Optional: Log OpenRouter-specific metadata (cost tracking)
      if (providerMetadata?.openrouter) {
        const metadata = providerMetadata.openrouter as any;
        console.log('[VercelOpenRouterAdapter] Usage:', {
          cost: metadata.usage?.cost,
          totalTokens: metadata.usage?.totalTokens,
        });
      }

      return {
        fullText,
        tokens,
      };
    } catch (error) {
      // Handle errors
      if (error instanceof Error && error.message === 'aborted') {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[VercelOpenRouterAdapter] Error:', errorMessage);
      callbacks.onError?.(error);
      
      throw new Error(`openrouter_sdk_error: ${errorMessage}`);
    }
  }

  /**
   * Map your model names to OpenRouter model identifiers
   */
  private selectModel(requestedModel?: string): string {
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
      'o1': 'openai/o1',
      
      // Google models
      'gemini-2.0-flash': 'google/gemini-2.0-flash-001:free',
      'gemini-flash': 'google/gemini-2.0-flash-001:free',
      
      // Coding-specific models
      'qwen-coder': 'qwen/qwen-2.5-coder-32b-instruct',
      
      // Reasoning models
      'deepseek-r1': 'deepseek/deepseek-r1',
    };

    if (!requestedModel) {
      return 'anthropic/claude-3.5-sonnet'; // Default
    }

    // Check if it's already an OpenRouter model ID (contains /)
    if (requestedModel.includes('/')) {
      return requestedModel;
    }

    // Map to OpenRouter model ID
    return modelMap[requestedModel] || `anthropic/${requestedModel}`;
  }

  /**
   * Estimate tokens (fallback if usage not provided)
   */
  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}