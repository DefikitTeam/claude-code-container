import { streamText, tool, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import GitService from '../..//services/git/git-service.js';
import { createFileTools } from '../claude/file-tools.js';
import { getWorkspaceSystemPrompt } from './system-prompts.js';
import type { ClaudeAdapter, ClaudeRuntimeContext } from '../claude/adapter.js';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import { calculateCost } from './utils/cost-calculator.js';
import { costTracker } from './services/cost-tracker.service.js';

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

    // 3. Prepare file system tools (ALWAYS enabled for file operations)
    console.error(
      '[VercelOpenRouterAdapter] Creating file tools with workspace:',
      {
        workspacePath: context.workspacePath,
        hasWorkspace: !!context.workspacePath,
      },
    );

    const fileTools = context.workspacePath
      ? createFileTools({
          workspacePath: context.workspacePath,
          allowedCommands: [
            'ls',
            'cat',
            'grep',
            'find',
            'git',
            'npm',
            'pnpm',
            'node',
            'python',
            'pip',
            'echo',
            'pwd',
            'which',
          ],
          maxFileSize: 10 * 1024 * 1024, // 10MB
        })
      : null;

    // Combine all tools
    const tools = fileTools
      ? {
          ...fileTools,
          // Add git patch tool for efficient diff-based updates
          applyPatch: tool({
            description:
              'Apply a unified-diff patch to the repository workspace. Use this for applying multiple file changes efficiently.',
            inputSchema: z.object({
              patch: z.string().min(1).describe('Unified diff patch to apply'),
            }),
            async execute({ patch }) {
              const maxBytes =
                Number(process.env.ACP_MAX_PATCH_BYTES) || 200 * 1024;
              if (Buffer.byteLength(patch, 'utf8') > maxBytes) {
                return { success: false, error: 'patch-too-large' };
              }
              const git = new GitService();
              const ws = context.workspacePath;
              if (!ws)
                return { success: false, error: 'workspace-not-provided' };
              try {
                await git.applyPatch(ws, patch);
                return { success: true };
              } catch (error: unknown) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
              }
            },
          }),
        }
      : undefined;

    try {
      // 4. Prepare system instructions for coding assistant behavior
      const systemPrompt = getWorkspaceSystemPrompt({
        workspacePath: context.workspacePath,
      });

      // 5. Stream text using Vercel AI SDK with file tools and system instructions
      const result = streamText({
        model: openrouter.chat(modelName),
        system: systemPrompt, // ✅ Critical: System instructions for coding assistant behavior
        prompt: prompt,
        tools, // File system tools now available to Claude!

        // ⚠️ CRITICAL: stopWhen allows AI to make multiple tool calls in sequence
        // Without this, the stream ends after the first tool call!
        // stopWhen: stepCountIs(N) means: allow up to N steps of tool calls
        // Each step: AI thinks → calls tool → gets result → thinks again → ...
        // We need multiple steps so AI can: list files → analyze → write files → verify
        stopWhen: stepCountIs(10), // Allow up to 10 reasoning steps

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

      // 6. Notify start
      callbacks.onStart?.({ startTime });

      // 7. Stream text chunks AND handle tool calls
      // CRITICAL: Must use fullStream to get both text AND tool call execution
      // textStream only gives text responses, not tool calls!
      let fullText = '';
      let toolCallCount = 0;
      let toolExecutionCount = 0;

      for await (const part of result.fullStream) {
        // Check abort signal
        if (abortSignal.aborted) {
          throw new Error('aborted');
        }

        // Handle different part types from the stream
        if (part.type === 'text-delta') {
          // Text chunk from AI
          const delta = part.text;
          fullText += delta;
          callbacks.onDelta?.({ text: delta });
        } else if (part.type === 'tool-call') {
          // AI is calling a tool
          toolCallCount++;
          console.error('[VercelOpenRouterAdapter] Tool call:', {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: 'input' in part ? part.input : undefined,
          });
        } else if (part.type === 'tool-result') {
          // Tool execution completed
          toolExecutionCount++;
          console.error('[VercelOpenRouterAdapter] Tool result:', {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: 'output' in part ? part.output : undefined,
          });
        } else if (part.type === 'finish') {
          // Stream finished
          console.error('[VercelOpenRouterAdapter] Stream finished:', {
            finishReason: part.finishReason,
            totalUsage: part.totalUsage,
          });
        }
      }

      console.error('[VercelOpenRouterAdapter] Stream complete:', {
        textLength: fullText.length,
        toolCallsMade: toolCallCount,
        toolsExecuted: toolExecutionCount,
      });

      // 8. Get final result (await promises for usage and metadata)
      const usage = await result.usage;
      const providerMetadata = await result.providerMetadata;

      // 9. Extract token usage from Vercel SDK (including cache tokens)
      const promptTokens = usage?.inputTokens || 0;
      const completionTokens = usage?.outputTokens || 0;
      const totalTokens = usage?.totalTokens || promptTokens + completionTokens;
      
      // Extract cache tokens if available (Vercel SDK may expose this)
      const cacheReadTokens = (usage as any)?.cacheReadTokens || 
                             (usage as any)?.cache_read_tokens || 
                             0;

      const tokens = {
        input: promptTokens,
        output: completionTokens,
        cache_read: cacheReadTokens,
        total: totalTokens,
      };

      // 10. Calculate cost using OpenRouter pricing (including cache cost)
      const costCalculation = calculateCost(
        modelName,
        promptTokens,
        completionTokens,
        cacheReadTokens,
      );

      // 11. Log usage and cost (OpenRouter-specific metadata is also available)
      console.log('[VercelOpenRouterAdapter] Usage:', {
        model: modelName,
        tokens: {
          input: promptTokens,
          output: completionTokens,
          total: totalTokens,
        },
        cost: {
          input: `$${costCalculation.inputCostUsd.toFixed(6)}`,
          output: `$${costCalculation.outputCostUsd.toFixed(6)}`,
          total: `$${costCalculation.totalCostUsd.toFixed(6)}`,
        },
        toolCalls: toolCallCount,
        toolExecutions: toolExecutionCount,
      });

      // OpenRouter metadata (optional, for debugging)
      if (providerMetadata?.openrouter) {
        const metadata = providerMetadata.openrouter as {
          usage?: { cost?: number; totalTokens?: number };
        };
        console.log('[VercelOpenRouterAdapter] OpenRouter metadata:', {
          reportedCost: metadata.usage?.cost,
          reportedTokens: metadata.usage?.totalTokens,
        });
      }

      // Track cost for monitoring
      costTracker.trackCall(runOptions.sessionId || 'unknown', {
        model: modelName,
        promptTokens,
        completionTokens,
        totalCostUsd: costCalculation.totalCostUsd,
        inputCostUsd: costCalculation.inputCostUsd,
        outputCostUsd: costCalculation.outputCostUsd,
        metadata: {
          toolCalls: toolCallCount,
          toolExecutions: toolExecutionCount,
        },
      });

      return {
        fullText,
        tokens,
        cost: {
          inputUsd: costCalculation.inputCostUsd,
          outputUsd: costCalculation.outputCostUsd,
          totalUsd: costCalculation.totalCostUsd,
        },
      };
    } catch (error) {
      // Handle errors
      if (error instanceof Error && error.message === 'aborted') {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('[VercelOpenRouterAdapter] Error:', errorMessage);
      callbacks.onError?.(error);

      throw new Error(`openrouter_sdk_error: ${errorMessage}`);
    }
  }

  /**
   * Map your model names to OpenRouter model identifiers
   */
  private selectModel(requestedModel?: string): string {
    void requestedModel;

    // Hard-force a single OpenRouter model.
    // return 'x-ai/grok-code-fast-1';
    return 'mistralai/devstral-2512:free';

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
      o1: 'openai/o1',

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
    */
  }
}
