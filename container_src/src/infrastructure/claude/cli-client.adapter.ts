import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';
import type {
  ClaudeAdapter,
  ClaudeRuntimeContext,
} from './adapter.js';
import { resolveClaudeCli } from './cli-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractTextFromMessage(message: any): string {
  try {
    if (!message) return '';

    if (typeof message === 'string') {
      return message;
    }

    if (message?.type === 'stream_event') {
      const event = message.event;
      if (event?.type === 'content_block_delta') {
        return typeof event?.delta?.text === 'string' ? event.delta.text : '';
      }
    }

    const content = message?.content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter(
          (part: any) =>
            part &&
            part.type === 'text' &&
            typeof part.text === 'string' &&
            part.text.trim().length > 0,
        )
        .map((part: any) => part.text as string);

      if (textParts.length) {
        return textParts.join('');
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

    return '';
  } catch (error) {
    console.error('[cli-client.adapter] Failed to parse CLI message', error);
    return '';
  }
}

export class CLIClientAdapter implements ClaudeAdapter {
  readonly name = 'cli' as const;

  canHandle(context: ClaudeRuntimeContext): boolean {
    return !context.disableCli;
  }

  async run(
    prompt: string,
    runOptions: RunOptions,
    _context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult> {
    const resolution = await resolveClaudeCli();
    if (!resolution) {
      throw new Error('claude_cli_not_found');
    }

    const isLegacyCli = resolution.command === 'claude-code';
    const workingDirectory = runOptions.workspacePath || process.cwd();

    const args: string[] = [];
    if (isLegacyCli) {
      args.push('query', '--stdin', '--stream');
    } else {
      args.push(
        '--print',
        '--verbose',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--permission-mode',
        'bypassPermissions',
      );
      args.push(prompt);
    }

    const child = spawn(resolution.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: workingDirectory,
    });

    abortSignal.addEventListener(
      'abort',
      () => {
        try {
          child.kill('SIGINT');
        } catch (error) {
          console.warn('[cli-client.adapter] Failed to abort CLI process', error);
        }
      },
      { once: true },
    );

    if (isLegacyCli) {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.write(prompt);
    }
    child.stdin.end();

    let fullText = '';
    const stdoutChunks: string[] = [];

    if (isLegacyCli) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (abortSignal.aborted) {
          return;
        }
        stdoutChunks.push(chunk);
        fullText += chunk;
        callbacks.onDelta?.({ text: chunk });
      });
    } else {
      child.stdout.setEncoding('utf8');
      let buffer = '';

      child.stdout.on('data', (chunk: string) => {
        if (abortSignal.aborted) {
          return;
        }

        stdoutChunks.push(chunk);
        buffer += chunk;

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            try {
              const message = JSON.parse(line);
              const text = extractTextFromMessage(message);
              if (text) {
                fullText += text;
                callbacks.onDelta?.({ text });
              }
            } catch {
              // Fall back to treating line as plain text.
              fullText += line;
              callbacks.onDelta?.({ text: line });
            }
          }

          newlineIndex = buffer.indexOf('\n');
        }
      });

      child.stdout.on('end', () => {
        const remaining = buffer.trim();
        if (remaining) {
          try {
            const message = JSON.parse(remaining);
            const text = extractTextFromMessage(message);
            if (text) {
              fullText += text;
              callbacks.onDelta?.({ text });
            }
          } catch {
            fullText += remaining;
            callbacks.onDelta?.({ text: remaining });
          }
        }
      });
    }

    const stderrChunks: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
    });

    const exitCode: number | null = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    if (abortSignal.aborted) {
      throw new Error('aborted');
    }

    if (exitCode !== 0) {
      const error = new Error('claude_cli_exit_error');
      (error as any).detail = {
        exitCode,
        stderr: stderrChunks.join(''),
        stdout: stdoutChunks.join(''),
        command: resolution.command,
        args,
      };
      throw error;
    }

    return { fullText };
  }
}

export default CLIClientAdapter;
