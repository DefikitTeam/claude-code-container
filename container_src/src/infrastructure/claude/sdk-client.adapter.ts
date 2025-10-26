import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import type {
  ClaudeAdapter,
  ClaudeRuntimeContext,
} from './adapter.js';
import { ensureClaudeAuthFile } from './auth-helper.js';

function extractTextFromMessage(message: any): string {
  try {
    const content = message?.message?.content ?? message?.content;
    if (Array.isArray(content)) {
      const parts = content
        .filter(
          (item: any) =>
            item &&
            item.type === 'text' &&
            typeof item.text === 'string' &&
            item.text.trim().length > 0,
        )
        .map((item: any) => item.text as string);

      if (parts.length) {
        return parts.join('');
      }
    }

    if (typeof message?.text === 'string') {
      return message.text;
    }

    if (
      message?.type === 'result' &&
      message?.subtype === 'success' &&
      typeof message?.result === 'string'
    ) {
      return message.result;
    }

    if (typeof message === 'string') {
      return message;
    }

    return '';
  } catch (error) {
    console.error('[sdk-client.adapter] Failed to parse SDK message', error);
    return '';
  }
}

export class SDKClientAdapter implements ClaudeAdapter {
  readonly name = 'sdk' as const;

  canHandle(context: ClaudeRuntimeContext): boolean {
    if (context.disableSdk) {
      return false;
    }

    if (context.forceHttpApi) {
      return false;
    }

    // SDK subprocess cannot run safely as root in most container environments.
    if (context.runningAsRoot) {
      return false;
    }

    return true;
  }

  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    await ensureClaudeAuthFile(context.apiKey);

    // Ensure subprocess inherits API key.
    if (!process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = context.apiKey;
    }

    // Dynamic import of SDK is best-effort; bubble up if unavailable.
    const sdk = await import('@anthropic-ai/claude-code').catch((error) => {
      throw new Error(`claude_sdk_import_failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    const query = (sdk as any)?.query ?? (sdk as any)?.default?.query;
    if (typeof query !== 'function') {
      throw new Error('claude_sdk_query_unavailable');
    }

    const options: Record<string, unknown> = {
      model: runOptions.model ?? context.model ?? 'claude-sonnet-4-5',
      permissionMode: 'bypassPermissions',
      settingSources: [],
      workingDirectory: runOptions.workspacePath || process.cwd(),
      env: {
        ...context.env,
        ANTHROPIC_API_KEY: context.apiKey,
      },
      executable: process.execPath,
      stderr: (message: string) => {
        if (message && message.trim()) {
          console.error('[claude-sdk stderr]', message);
        }
      },
    };

    let fullText = '';

    const iterator = query({ prompt, options });
    for await (const message of iterator as AsyncIterable<any>) {
      if (abortSignal.aborted) {
        throw new Error('aborted');
      }

      const text = extractTextFromMessage(message);
      if (text) {
        fullText += text;
        callbacks.onDelta?.({ text });
      } else if (message?.type === 'error') {
        throw new Error(message?.error?.message || 'claude_sdk_error');
      }
    }

    return { fullText };
  }
}

export default SDKClientAdapter;
