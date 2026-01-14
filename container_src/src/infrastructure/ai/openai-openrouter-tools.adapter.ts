/**
 * OpenAI SDK adapter for OpenRouter with FULL TOOL SUPPORT
 *
 * This is the production-ready adapter that provides:
 * - ✅ File system tools (writeFile, readFile, listDirectory)
 * - ✅ Bash execution tool (executeBash)
 * - ✅ Automatic tool call loop (like Vercel SDK but more efficient)
 * - ✅ Native OpenAI SDK (no Vercel overhead)
 * - ✅ Streaming support with tool execution
 *
 * Key advantages over Vercel SDK:
 * - Direct API access, less overhead
 * - Native OpenAI runTools() helper (battle-tested)
 * - Simpler architecture, easier to debug
 * - Better performance for coding tasks
 */

import OpenAI from 'openai';
import type { RunnableToolFunction } from 'openai/lib/RunnableFunction';
import { getWorkspaceSystemPrompt } from './system-prompts.js';
import type { ClaudeAdapter, ClaudeRuntimeContext } from '../claude/adapter.js';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const FORCED_OPENROUTER_MODEL = 'x-ai/grok-code-fast-1' as const;

// Lightweight logger scoped to this adapter
const logger = {
  error: (...args: unknown[]) => console.error('[OpenAIToolsAdapter]', ...args),
  warn: (...args: unknown[]) => console.warn('[OpenAIToolsAdapter]', ...args),
  info: (...args: unknown[]) => console.info('[OpenAIToolsAdapter]', ...args),
  debug: (...args: unknown[]) => console.debug('[OpenAIToolsAdapter]', ...args),
};

/**
 * Configuration for OpenAI OpenRouter adapter with tools
 */
export interface OpenAIOpenRouterToolsConfig {
  baseURL?: string;
  apiKey?: string;
  defaultModel?: string;
  httpReferer?: string;
  siteName?: string;
  timeout?: number;
  maxRetries?: number;
}

const DEFAULT_CONFIG: Required<Omit<OpenAIOpenRouterToolsConfig, 'apiKey'>> = {
  baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  defaultModel: FORCED_OPENROUTER_MODEL,
  httpReferer:
    process.env.OPENROUTER_HTTP_REFERER ||
    'https://github.com/DefikitTeam/claude-code-container',
  siteName: process.env.OPENROUTER_SITE_NAME || 'Claude Code Container',
  timeout: Number(process.env.OPENROUTER_TIMEOUT || 300000),
  maxRetries: Number(process.env.OPENROUTER_MAX_RETRIES || 2),
};

/**
 * OpenAI SDK adapter with full tool support (PRIMARY ADAPTER)
 */
export class OpenAIOpenRouterToolsAdapter implements ClaudeAdapter {
  readonly name = 'http-api' as const;
  readonly adapterId = 'openai-openrouter-tools' as const;

  private config: Required<Omit<OpenAIOpenRouterToolsConfig, 'apiKey'>> & {
    apiKey?: string;
  };

  constructor(config?: OpenAIOpenRouterToolsConfig) {
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

  canHandle(context: ClaudeRuntimeContext): boolean {
    // Check if we have an API key
    const hasApiKey = !!(
      this.config.apiKey ??
      context.apiKey ??
      process.env.OPENROUTER_API_KEY
    );

    logger.debug('can handle', { hasApiKey });

    // Can handle if we have API key (workspace is required for tools but will be validated in run())
    return hasApiKey;
  }

  /**
   * Run prompt with full tool support using OpenAI SDK's runTools() helper
   */
  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    const startTime = Date.now();
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Resolve API key
      const apiKey =
        this.config.apiKey ?? context.apiKey ?? process.env.OPENROUTER_API_KEY;

      if (!apiKey) {
        throw new Error(
          '[OpenAIToolsAdapter] missing API key - set OPENROUTER_API_KEY environment variable',
        );
      }

      // Resolve model with mapping
      const requestedModel =
        runOptions.model ?? context.model ?? this.config.defaultModel;
      const model = this.selectModel(requestedModel);

      logger.info('🚀 OpenAI Tools Adapter SELECTED and STARTING', {
        requestedModel,
        model,
        promptLength: prompt.length,
        hasWorkspace: !!context.workspacePath,
        workspacePath: context.workspacePath,
        streaming: true,
        hasHistory: !!(runOptions.messages && Array.isArray(runOptions.messages)),
        historyLength: runOptions.messages ? runOptions.messages.length : 0,
      });

      // Notify start
      callbacks.onStart?.({ startTime });

      // Create OpenAI client
      const client = new OpenAI({
        apiKey,
        baseURL: this.config.baseURL,
        defaultHeaders: {
          'HTTP-Referer': this.config.httpReferer,
          'X-Title': this.config.siteName,
        },
        timeout: this.config.timeout,
        maxRetries: this.config.maxRetries,
      });

      // CRITICAL: Prepare file system tools (REQUIRED for coding tasks)
      const tools = this.prepareTools(context);

      if (!tools || tools.length === 0) {
        throw new Error(
          '[OpenAIToolsAdapter] No workspace path provided - tools cannot be initialized. Workspace is required for file operations.',
        );
      }

      logger.debug('tools prepared', {
        count: tools.length,
        toolNames: tools.map((t: any) => t.function.name),
      });

      // Prepare system prompt for coding assistant behavior
      const systemPrompt = getWorkspaceSystemPrompt({
        workspacePath: context.workspacePath,
      });

      // IMPORTANT: OpenAI SDK's runTools() helper may not be available in all versions
      // We'll implement manual tool calling loop for maximum compatibility
      // This follows the pattern from OpenAI docs but with manual loop control


      let conversationMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];

      // CRITICAL FIX: Replay history with FULL tool usage information
      // The history can be in two formats:
      // 1. Legacy: ContentBlock[][] (text-only, no tool info) - needs backward compatibility
      // 2. New: OpenAI message format with tool_calls and tool results
      if (runOptions.messages && Array.isArray(runOptions.messages)) {
        logger.debug('replaying history', {
          historyLength: runOptions.messages.length,
          firstItemType: typeof runOptions.messages[0],
          firstItemKeys: runOptions.messages[0] && typeof runOptions.messages[0] === 'object'
            ? Object.keys(runOptions.messages[0]).join(',')
            : 'N/A'
        });

        runOptions.messages.forEach((item: any, index: number) => {
          // NEW FORMAT: If item has 'role' property, it's already in OpenAI format
          // This is the new format that includes tool_calls and tool results
          if (item && typeof item === 'object' && 'role' in item) {
            // OpenAI message format - use directly
            conversationMessages.push(item as OpenAI.Chat.ChatCompletionMessageParam);
            logger.debug(`history[${index}]: role=${item.role}, hasToolCalls=${!!item.tool_calls}`);
          }
          // LEGACY FORMAT: ContentBlock[] - convert to text-only message
          else if (Array.isArray(item)) {
            const role = index % 2 === 0 ? 'user' : 'assistant';
            const text = item
              .filter((b: any) => b && b.type === 'text')
              .map((b: any) => b.text || b.content || '')
              .join('\n');

            if (text) {
              conversationMessages.push({ role, content: text });
              logger.debug(`history[${index}]: role=${role} (legacy format), textLength=${text.length}`);
            }
          }
          // UNKNOWN FORMAT: Log warning and skip
          else {
            logger.warn(`history[${index}]: unknown format, skipping`, { type: typeof item });
          }
        });
      }

      // Add current user prompt
      conversationMessages.push({ role: 'user', content: prompt });

      // DIAGNOSTIC: Log conversation structure to help debug history issues
      logger.info('📋 Conversation structure before execution:', {
        totalMessages: conversationMessages.length,
        breakdown: conversationMessages.reduce((acc: Record<string, number>, msg: any) => {
          const key = msg.role + ((msg as any).tool_calls ? '+tools' : '');
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        hasToolCalls: conversationMessages.some((m: any) => (m as any).tool_calls),
        lastAssistantHadTools: (() => {
          const lastAssistant = conversationMessages
            .slice()
            .reverse()
            .find((m: any) => m.role === 'assistant');
          return lastAssistant ? !!(lastAssistant as any).tool_calls : false;
        })(),
      });

      const maxToolLoops = 10; // Prevent infinite loops
      let loopCount = 0;
      // Variables for tracking progress (declared outside try for error handling access)
      fullText = '';
      inputTokens = this.estimateTokens(prompt + systemPrompt);
      outputTokens = 0;

      while (loopCount < maxToolLoops) {
        loopCount++;

        // Check abort signal
        if (abortSignal.aborted) {
          throw new Error('aborted');
        }

        logger.info(`🔄 Tool loop iteration ${loopCount}/${maxToolLoops}`, {
          messagesCount: conversationMessages.length,
          lastMessageRole:
            conversationMessages[conversationMessages.length - 1]?.role,
        });

        // Create streaming completion
        logger.info(
          `📡 Making API call to OpenRouter (iteration ${loopCount})...`,
        );
        const stream = await client.chat.completions.create({
          model,
          messages: conversationMessages,
          tools: tools as any,
          stream: true,
          max_tokens: 15600, // Reasonable limit to prevent credit exhaustion
        });
        logger.info(
          `✅ API call started successfully (iteration ${loopCount})`,
        );

        let currentMessage = '';
        let currentToolCalls: any[] = [];
        let currentToolCallsMap = new Map<
          number,
          { id: string; name: string; arguments: string }
        >();

        // Process stream chunks
        for await (const chunk of stream) {
          if (abortSignal.aborted) {
            throw new Error('aborted');
          }

          const delta = chunk.choices[0]?.delta;

          // Handle content delta
          if (delta?.content) {
            currentMessage += delta.content;
            fullText += delta.content;
            const tokens = this.estimateTokens(delta.content);
            outputTokens += tokens;
            callbacks.onDelta?.({ text: delta.content, tokens });
          }

          // Handle tool call deltas - CRITICAL: capture IDs from stream
          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index;
              const existing = currentToolCallsMap.get(index) || {
                id: '',
                name: '',
                arguments: '',
              };

              // Capture the tool call ID (required for matching with tool responses)
              if (toolCall.id) {
                existing.id = toolCall.id;
              }
              if (toolCall.function?.name) {
                existing.name = toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                existing.arguments += toolCall.function.arguments;
              }

              currentToolCallsMap.set(index, existing);
            }
          }

          // Check finish reason
          const finishReason = chunk.choices[0]?.finish_reason;
          if (finishReason === 'tool_calls') {
            // Convert map to array with proper IDs
            currentToolCalls = Array.from(currentToolCallsMap.entries()).map(
              ([index, data]) => ({
                id: data.id,
                type: 'function' as const,
                function: {
                  name: data.name,
                  arguments: data.arguments,
                },
              }),
            );
          }
        }

        // If we got content and no tool calls, we're done
        if (currentMessage && currentToolCalls.length === 0) {
          // Heuristic: If model is "planning" but not "doing" (common in smaller models), bounce back
          // check for phrases like "Let me check", "I will", "I need to", "I'll", "checking"
          const planningPhrases = /Let me check|I will|I'll|I need to|checking|verify|examine/i;
          
          // Enhanced hallucination detection: catch JSON that looks like tool results or raw JSON output
          // Matches:
          // 1. Starts with optional text/whitespace then {"success":...
          // 2. Starts with "Assistant:" then optional text then {"success":...
          // 3. Contains "content":"..." and "path":"..." (common in file operations)
          const jsonHallucinationRegex = /^\s*(?:Assistant:\s*)?\{.*"success"\s*:\s*/s;
          const looksLikeFileContent = /"path"\s*:\s*".*"\s*,\s*"content"\s*:/s;
          
          const isHallucinatedToolResult = 
            jsonHallucinationRegex.test(currentMessage) || 
            (currentMessage.includes('{') && looksLikeFileContent.test(currentMessage));

          if (isHallucinatedToolResult) {
            logger.warn('⚠️ Model hallucinated tool result. Forcing retry.');
             conversationMessages.push({ 
               role: 'assistant', 
               content: currentMessage 
             });
             conversationMessages.push({ 
               role: 'user', 
               content: 'STOP! You are Hallucinating. You manually wrote the tool output instead of calling the tool. DO NOT write JSON. Call the function "readFile" or "writeFile" using the PROPER TOOL CALL SYNTAX.' 
             });
             continue;
          }

          if (loopCount < 3 && planningPhrases.test(currentMessage) && currentMessage.length < 300) {
             logger.warn('⚠️ Model discussed action but used no tools. Forcing retry with instruction.');
             
             conversationMessages.push({ 
               role: 'assistant', 
               content: currentMessage 
             });
             conversationMessages.push({ 
               role: 'user', 
               content: 'Do not describe the plan. Use the tools IMMEDIATELY to perform the action. Do not simulate the action.' 
             });
             continue;
          }

          logger.debug('completion finished - no tool calls');
          break;
        }

        // If we have tool calls, execute them
        if (currentToolCalls.length > 0) {
          logger.info(
            `🔧 Model requested ${currentToolCalls.length} tool calls`,
            {
              tools: currentToolCalls.map((tc) => tc.function.name),
            },
          );

          // Add assistant message with tool calls to conversation
          conversationMessages.push({
            role: 'assistant',
            content: currentMessage || (null as any),
            tool_calls: currentToolCalls as any,
          });

          // Execute each tool and add results to conversation
          for (const toolCall of currentToolCalls) {
            const toolCallId = toolCall.id;
            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;

            logger.debug('executing tool', { name: toolName, id: toolCallId });

            // Find matching tool
            const tool = tools.find((t: any) => t.function.name === toolName);
            if (!tool) {
              logger.error('tool not found', { name: toolName });
              conversationMessages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify({
                  success: false,
                  error: 'Tool not found',
                }),
              });
              continue;
            }

            try {
              // Parse arguments and execute tool
              const parseFn = (tool.function as any).parse || JSON.parse;
              const args = parseFn(toolArgs);
              const execFn = (tool.function as any).function;
              const result = await execFn(args);
              const resultStr =
                typeof result === 'string' ? result : JSON.stringify(result);

              logger.debug('tool executed successfully', {
                name: toolName,
                resultLength: resultStr.length,
              });

              conversationMessages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: resultStr,
              });
            } catch (error: any) {
              logger.error('tool execution failed', {
                name: toolName,
                error: error.message,
              });

              conversationMessages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify({
                  success: false,
                  error: error.message,
                }),
              });
            }
          }

          logger.info(
            `✅ All ${currentToolCalls.length} tools executed, continuing loop to send results back to model...`,
          );

          // Continue loop to get model's response after tool execution
          continue;
        }

        // No content and no tool calls - something went wrong
        logger.warn('unexpected completion state');
        break;
      }

      if (loopCount >= maxToolLoops) {
        logger.warn('max tool loops reached', { maxToolLoops });
      }

      const durationMs = Date.now() - startTime;

      logger.info('completion succeeded with tools', {
        durationMs,
        outputLength: fullText.length,
        inputTokens,
        outputTokens,
        toolLoops: loopCount,
      });

      callbacks.onComplete?.({ fullText, durationMs });

      const toolUses = conversationMessages
        .filter(m => m.role === 'assistant' && (m as any).tool_calls)
        .flatMap(m => (m as any).tool_calls || [])
        .map((tc: any) => ({ name: tc.function.name }));

      return {
        fullText,
        tokens: {
          input: inputTokens,
          output: outputTokens,
        },
        stopReason: 'stop',
        toolUse: toolUses,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      logger.error('completion failed', {
        durationMs,
        errorMessage: error.message,
        errorType: error.constructor.name,
      });

      // Classify and re-throw with better error messages
      if (abortSignal.aborted || error.message === 'aborted') {
        const abortError = new Error('aborted');
        callbacks.onError?.(abortError);
        throw abortError;
      }

      if (error instanceof OpenAI.APIError) {
        const apiError = new Error(
          `openrouter_api_error_${error.status || 'unknown'}: ${error.message}`,
        );
        (apiError as any).detail = {
          status: error.status,
          type: error.type,
          code: error.code,
          message: error.message,
        };
        callbacks.onError?.(apiError);
        throw apiError;
      }

      // Handle timeouts gracefully by returning explanatory text instead of throwing
      if (error instanceof OpenAI.APIConnectionTimeoutError || 
          (error.code === 'ETIMEDOUT') || 
          error.message?.includes('timeout')) {
        
        const timeoutMessage = "\n\n⚠️ **Task Timeout**: This task took longer than 5 minutes to complete. The model may be struggling with the size or complexity of the request.\n\n**Recommendation:**\nPlease split this task into smaller, more manageable sub-tasks and try again.";
        
        logger.warn('request timed out, sending advice to user');
        
        // Return partial result with warning
        callbacks.onDelta?.({ text: timeoutMessage, tokens: 0 });
        callbacks.onComplete?.({ fullText: fullText + timeoutMessage, durationMs: Date.now() - startTime });
        
        return {
          fullText: fullText + timeoutMessage,
          tokens: {
            input: inputTokens,
            output: outputTokens,
          },
          stopReason: 'timeout',
          toolUse: [],
        };
      }

      callbacks.onError?.(error);
      throw error;
    }
  }

  /**
   * Prepare file system tools in native OpenAI SDK format
   */
  private prepareTools(
    context: ClaudeRuntimeContext,
  ): RunnableToolFunction<any>[] | null {
    if (!context.workspacePath) {
      logger.warn('no workspace path - tools disabled');
      return null;
    }

    const workspacePath = context.workspacePath;
    const allowedCommands = [
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
    ];
    const maxFileSize = 10 * 1024 * 1024; // 10MB

    /**
     * Resolve and validate file path within workspace
     */
    function resolvePath(relativePath: string): string {
      const resolved = path.resolve(workspacePath, relativePath);
      if (!resolved.startsWith(workspacePath)) {
        throw new Error(`Path ${relativePath} is outside workspace`);
      }
      return resolved;
    }

    const tools: RunnableToolFunction<any>[] = [
      // Tool: Read File
      {
        type: 'function',
        function: {
          name: 'readFile',
          description: `Read the contents of a file from the workspace. Always read a file before modifying it to understand its current state.`,
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description:
                  'Path to the file relative to workspace root (e.g., "src/app.ts")',
              },
            },
            required: ['path'],
          },
          function: async (args: { path: string }) => {
            try {
              const fullPath = resolvePath(args.path);
              const stats = await fs.stat(fullPath);

              if (stats.size > maxFileSize) {
                return {
                  success: false,
                  error: `File too large: ${stats.size} bytes (max: ${maxFileSize})`,
                };
              }

              const content = await fs.readFile(fullPath, 'utf-8');
              return {
                success: true,
                path: args.path,
                content,
                size: stats.size,
              };
            } catch (error: any) {
              return {
                success: false,
                error: error.message,
              };
            }
          },
          parse: JSON.parse,
        },
      },

      // Tool: Write File
      {
        type: 'function',
        function: {
          name: 'writeFile',
          description: `Write complete file contents to the workspace. This REPLACES the entire file. Creates parent directories automatically.`,
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file relative to workspace root',
              },
              content: {
                type: 'string',
                description:
                  'Complete file content to write (must provide FULL file content)',
              },
            },
            required: ['path', 'content'],
          },
          function: async (args: { path: string; content: string }) => {
            try {
              const fullPath = resolvePath(args.path);
              const dir = path.dirname(fullPath);

              // Create parent directories
              await fs.mkdir(dir, { recursive: true });

              // Write file
              await fs.writeFile(fullPath, args.content, 'utf-8');

              const stats = await fs.stat(fullPath);
              return {
                success: true,
                path: args.path,
                size: stats.size,
              };
            } catch (error: any) {
              return {
                success: false,
                error: error.message,
              };
            }
          },
          parse: JSON.parse,
        },
      },

      // Tool: List Directory
      {
        type: 'function',
        function: {
          name: 'listDirectory',
          description: `List files and directories in the workspace. Use this to explore the codebase structure.`,
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description:
                  'Path to directory relative to workspace root (use "." for root)',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to list subdirectories recursively',
              },
            },
            required: ['path', 'recursive'],
          },
          function: async (args: { path: string; recursive: boolean }) => {
            try {
              const fullPath = resolvePath(args.path);

              const listFiles = async (
                dir: string,
                base: string = '',
              ): Promise<string[]> => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const files: string[] = [];

                for (const entry of entries) {
                  const relativePath = path.join(base, entry.name);
                  if (entry.isDirectory()) {
                    files.push(relativePath + '/');
                    if (args.recursive) {
                      const subFiles = await listFiles(
                        path.join(dir, entry.name),
                        relativePath,
                      );
                      files.push(...subFiles);
                    }
                  } else {
                    files.push(relativePath);
                  }
                }

                return files;
              };

              const files = await listFiles(fullPath);
              return {
                success: true,
                path: args.path,
                files,
                count: files.length,
              };
            } catch (error: any) {
              return {
                success: false,
                error: error.message,
              };
            }
          },
          parse: JSON.parse,
        },
      },

      // Tool: Execute Bash
      {
        type: 'function',
        function: {
          name: 'executeBash',
          description: `Execute bash commands for testing, building, and git operations. Allowed commands: ${allowedCommands.join(', ')}`,
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: `Bash command to execute (must start with: ${allowedCommands.join(', ')})`,
              },
            },
            required: ['command'],
          },
          function: async (args: { command: string }) => {
            try {
              // Security: Validate command starts with allowed prefix
              const commandStart = args.command.trim().split(/\s+/)[0];
              if (!allowedCommands.includes(commandStart)) {
                return {
                  success: false,
                  error: `Command not allowed. Must start with: ${allowedCommands.join(', ')}`,
                };
              }

              const { stdout, stderr } = await execAsync(args.command, {
                cwd: workspacePath,
                timeout: 30000, // 30 second timeout
                maxBuffer: 1024 * 1024, // 1MB max output
              });

              return {
                success: true,
                command: args.command,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
              };
            } catch (error: any) {
              return {
                success: false,
                command: args.command,
                error: error.message,
                stdout: error.stdout?.trim() || '',
                stderr: error.stderr?.trim() || '',
              };
            }
          },
          parse: JSON.parse,
        },
      },
    ];

    return tools;
  }

  /**
   * Map model names to OpenRouter model identifiers
   */
  private selectModel(requestedModel?: string): string {
    void requestedModel;

    // Hard-force a single OpenRouter model.
    return FORCED_OPENROUTER_MODEL;

    /*
    const modelMap: Record<string, string> = {
      'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
      'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
      'claude-sonnet-4': 'anthropic/claude-sonnet-4',
      'claude-sonnet-4-5': 'anthropic/claude-sonnet-4',
      'claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet:thinking',
      'gpt-4o': 'openai/gpt-4o',
      'gpt-4': 'openai/gpt-4',
      'gpt-5': 'openai/gpt-5',
      'gpt-5-mini': 'openai/gpt-5-mini',
      'o1': 'openai/o1',
      'gemini-2.0-flash': 'google/gemini-2.0-flash-001:free',
      'gemini-flash': 'google/gemini-2.0-flash-001:free',
      'qwen-coder': 'qwen/qwen-2.5-coder-32b-instruct',
      'deepseek-r1': 'deepseek/deepseek-r1',
    };

    if (!requestedModel) {
      return 'x-ai/grok-code-fast-1';
    }

    if (requestedModel.includes('/')) {
      return requestedModel;
    }

    return modelMap[requestedModel] || `anthropic/${requestedModel}`;
    */
  }

  /**
   * Estimate token count from text
   */
  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
