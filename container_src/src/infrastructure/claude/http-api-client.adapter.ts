import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import type { ClaudeAdapter, ClaudeRuntimeContext } from './adapter.js';

export class HTTPAPIClientAdapter implements ClaudeAdapter {
  readonly name = 'http-api' as const;

  canHandle(_context: ClaudeRuntimeContext): boolean {
    return true;
  }

  async run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: runOptions.model ?? context.model ?? 'claude-sonnet-4-20241022',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`anthropic_http_error_${response.status}`);
      (error as any).detail = {
        status: response.status,
        body: errorBody,
      };
      throw error;
    }

    if (!response.body) {
      throw new Error('anthropic_http_missing_body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (abortSignal.aborted) {
        throw new Error('aborted');
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed === 'event: message_start' ||
          trimmed === 'event: message_stop'
        ) {
          continue;
        }

        if (trimmed === 'data: [DONE]') {
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(payload);
            const text = this.extractText(data);
            if (text) {
              fullText += text;
              callbacks.onDelta?.({ text });
            }
          } catch {
            // Ignore malformed chunks; treat as plain text fallback.
          }
        }
      }
    }

    // Flush remaining buffer.
    const trailing = buffer.trim();
    if (trailing) {
      try {
        const data = JSON.parse(trailing.replace(/^data:\s*/, ''));
        const text = this.extractText(data);
        if (text) {
          fullText += text;
          callbacks.onDelta?.({ text });
        }
      } catch {
        // Ignore residual noise.
      }
    }

    return { fullText };
  }

  private extractText(message: any): string {
    if (!message) {
      return '';
    }

    if (
      message.type === 'content_block_delta' &&
      typeof message.delta?.text === 'string'
    ) {
      return message.delta.text;
    }

    if (
      message.type === 'content_block_start' &&
      typeof message.content_block?.text === 'string'
    ) {
      return message.content_block.text;
    }

    if (typeof message === 'string') {
      return message;
    }

    return '';
  }
}

export default HTTPAPIClientAdapter;
