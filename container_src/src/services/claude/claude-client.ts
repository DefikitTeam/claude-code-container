/**
 * Refactor Placeholder (Phase 5: Claude Client Adapter)
 * --------------------------------------------------
 * Wraps current Claude interaction (streaming query) behind a stable interface supporting
 * callbacks for streaming events. Future strategies (different model backends) can implement
 * the same contract.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLAUDE_CLI_CANDIDATES = ['claude-code', 'claude'] as const;

type CliResolution = {
  command: string;
  versionStdout?: string | null;
  versionStderr?: string | null;
  versionError?: string | null;
};

async function resolveClaudeCli(): Promise<CliResolution | null> {
  for (const candidate of CLAUDE_CLI_CANDIDATES) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ['--version']);
      return {
        command: candidate,
        versionStdout: stdout ? String(stdout).trim() : null,
        versionStderr: stderr ? String(stderr).trim() : null,
      };
    } catch (err: any) {
      const code = err?.code;
      if (code === 'ENOENT' || code === 'ENOTFOUND') {
        continue; // try next candidate
      }
      return {
        command: candidate,
        versionStdout: err?.stdout ? String(err.stdout).trim() : null,
        versionStderr: err?.stderr ? String(err.stderr).trim() : null,
        versionError:
          typeof err?.message === 'string' ? err.message : String(err),
      };
    }
  }
  return null;
}

export interface ClaudeRunCallbacks {
  onStart?: (meta: { startTime: number }) => void;
  onDelta?: (data: { text?: string; tokens?: number }) => void;
  onComplete?: (result: { fullText: string; durationMs: number }) => void;
  onError?: (err: unknown) => void;
}

export interface IClaudeClient {
  runPrompt(
    prompt: string,
    opts: {
      sessionId: string;
      operationId?: string;
      workspacePath?: string;
      apiKey?: string;
      abortSignal?: AbortSignal;
      model?: string;
    },
    callbacks?: ClaudeRunCallbacks,
  ): Promise<{ fullText: string; tokens?: { input: number; output: number } }>;
  cancel(sessionId: string): Promise<void>;
  cancelOperation(sessionId: string, operationId: string): Promise<void>;
}

type InFlight = {
  abortController: AbortController;
  child?: ReturnType<typeof spawn> | null;
  sessionId: string;
  operationId?: string;
};

export class ClaudeClient implements IClaudeClient {
  private inFlightBySession: Map<string, InFlight[]> = new Map();
  private inFlightByOperation: Map<string, InFlight> = new Map();
  private model: string | undefined;
  private timeoutMs: number | undefined;

  constructor(_deps?: { model?: string; timeoutMs?: number }) {
    this.model = _deps?.model;
    this.timeoutMs = _deps?.timeoutMs;
  }

  async collectClaudeDiagnostics(): Promise<Record<string, any>> {
    const home = os.homedir();
    const configDir = path.join(home, '.config', 'claude-code');
    const authFile = path.join(configDir, 'auth.json');
    const legacyFile = path.join(home, '.claude.json');
    const diag: Record<string, any> = {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      hasApiKeyEnv: !!process.env.ANTHROPIC_API_KEY,
      paths: { authFile, legacyFile },
    };
    const cliResolution = await resolveClaudeCli();
    if (cliResolution) {
      diag.claudeCliCommand = cliResolution.command;
      if (cliResolution.versionStdout) {
        diag.claudeCliVersion = cliResolution.versionStdout;
        diag.claudeCodeVersion = cliResolution.versionStdout;
      }
      if (cliResolution.versionStderr) {
        diag.claudeCliVersionStderr = cliResolution.versionStderr;
        diag.claudeCodeVersionStderr = cliResolution.versionStderr;
      }
      if (cliResolution.versionError) {
        diag.claudeCliVersionError = cliResolution.versionError;
        diag.claudeCodeVersionError = cliResolution.versionError;
      }
    } else {
      diag.claudeCliCommand = null;
    }
    return diag;
  }

  // (Deprecated) Previously had classifyClaudeError; removed to centralize error categorization.
  // Client intentionally minimal: surfaces raw errors + diagnostics only.

  estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private registerInFlight(entry: InFlight) {
    const list = this.inFlightBySession.get(entry.sessionId) || [];
    list.push(entry);
    this.inFlightBySession.set(entry.sessionId, list);
    if (entry.operationId) {
      this.inFlightByOperation.set(
        `${entry.sessionId}:${entry.operationId}`,
        entry,
      );
    }
  }

  private unregisterInFlight(entry: InFlight) {
    const list = this.inFlightBySession.get(entry.sessionId) || [];
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length) this.inFlightBySession.set(entry.sessionId, list);
    else this.inFlightBySession.delete(entry.sessionId);
    if (entry.operationId)
      this.inFlightByOperation.delete(
        `${entry.sessionId}:${entry.operationId}`,
      );
  }

  async cancel(sessionId: string): Promise<void> {
    const list = this.inFlightBySession.get(sessionId);
    if (!list || !list.length) return;
    for (const entry of [...list]) {
      try {
        entry.abortController.abort();
        if (entry.child && typeof entry.child.kill === 'function') {
          try {
            entry.child.kill('SIGINT');
          } catch {}
        }
      } finally {
        this.unregisterInFlight(entry);
      }
    }
  }

  async cancelOperation(sessionId: string, operationId: string): Promise<void> {
    const entry = this.inFlightByOperation.get(`${sessionId}:${operationId}`);
    if (!entry) return;
    try {
      entry.abortController.abort();
      if (entry.child && typeof entry.child.kill === 'function') {
        try {
          entry.child.kill('SIGINT');
        } catch {}
      }
    } finally {
      this.unregisterInFlight(entry);
    }
  }

  /**
   * Run prompt using available runtime: try SDK first, fall back to CLI presence check.
   * If neither is available, throw a classified error with diagnostics.
   */
  async runPrompt(
    prompt: string,
    opts: {
      sessionId: string;
      operationId?: string;
      workspacePath?: string;
      apiKey?: string;
      abortSignal?: AbortSignal;
      model?: string;
    },
    callbacks: ClaudeRunCallbacks = {},
  ): Promise<{ fullText: string; tokens?: { input: number; output: number } }> {
    const sessionId = opts.sessionId || `session-${Date.now()}`;
    const operationId =
      opts.operationId ||
      `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    // Use an internal abort controller if caller didn't provide one, but respect caller's signal
    const abortController = new AbortController();
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        throw new Error('aborted');
      }
      const onAbort = () => abortController.abort();
      opts.abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    this.registerInFlight({
      sessionId,
      operationId,
      abortController,
      child: null,
    });

    callbacks.onStart?.({ startTime });

    // Basic token accounting
    const inputTokens = this.estimateTokens(prompt);
    let outputTokens = 0;
    let fullText = '';

    try {
      // Fail fast if we have no API key available
      const effectiveKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!effectiveKey) {
        const diag = await this.collectClaudeDiagnostics();
        const err = new Error('anthropic_api_key_missing');
        (err as any).detail = { diagnostics: diag };
        throw err;
      }
      // Ensure auth files if apiKey provided
      // if (opts.apiKey) {
      //   try {
      //     await this.ensureClaudeAuthFiles(opts.apiKey);
      //   } catch (e) {
      //     const err = new Error('auth_failed');
      //     (err as any).detail = { original: e };
      //     throw err;
      //   }
      // }

      // If caller supplied apiKey and environment does not yet have it, set it so SDK can pick it up.
      if (opts.apiKey && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = opts.apiKey;
      }

      // Allow tests / callers to force-disable SDK or CLI usage for deterministic behavior
      // Prefer SDK by default in all environments; callers can set CLAUDE_CLIENT_DISABLE_SDK=1 to force CLI path
      const disableSdk = process.env.CLAUDE_CLIENT_DISABLE_SDK === '1';
      const disableCli = process.env.CLAUDE_CLIENT_DISABLE_CLI === '1';

      // Try SDK dynamic import (unless disabled)
      let usedSdk = false;
      if (!disableSdk) {
        try {
          // attempt dynamic import; not all environments will have this package
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const sdk = await import('@anthropic-ai/claude-code').catch(
            () => null as any,
          );
          const queryFn = sdk?.query ?? sdk?.default?.query ?? null;
          if (queryFn && typeof queryFn === 'function') {
            usedSdk = true;
            // Correct SDK usage: pass { prompt, options } and consume the async iterator
            const options: any = {};
            const model = opts.model ?? this.model;
            if (model) options.model = model;
            // Default to bypassing permissions inside containers
            options.permissionMode = 'bypassPermissions';

            const iterable = queryFn({ prompt, options });

            const extractTextFromSdkMessage = (m: any): string => {
              try {
                // Assistant/user message with content array
                const content = m?.message?.content;
                if (Array.isArray(content)) {
                  const parts = content
                    .filter(
                      (p: any) =>
                        p && p.type === 'text' && typeof p.text === 'string',
                    )
                    .map((p: any) => p.text as string);
                  if (parts.length) return parts.join('');
                }
                // Direct text field
                if (typeof m?.text === 'string') return m.text as string;
                // Result success with string result
                if (
                  m?.type === 'result' &&
                  m?.subtype === 'success' &&
                  typeof m?.result === 'string'
                ) {
                  return m.result as string;
                }
                // Fallback: empty string (avoid noisy JSON dumps)
                return '';
              } catch {
                return '';
              }
            };

            for await (const msg of iterable as any) {
              if (abortController.signal.aborted) break;
              const textChunk = extractTextFromSdkMessage(msg);
              if (textChunk) {
                fullText += textChunk;
                const deltaTokens = this.estimateTokens(textChunk);
                outputTokens += deltaTokens;
                callbacks.onDelta?.({ text: textChunk, tokens: deltaTokens });
              }
            }
          }
        } catch (sdkErr) {
          // SDK attempt failed - we'll fall back to CLI check
          usedSdk = false;
        }
      }

      if (!usedSdk) {
        if (disableCli) {
          const diag = await this.collectClaudeDiagnostics();
          const err = new Error('claude_runtime_missing');
          (err as any).detail = { diagnostics: diag, original: 'cli_disabled' };
          throw err;
        }
        // Check for CLI presence (unless disabled above)
        const cliResolution = await resolveClaudeCli();
        if (!cliResolution) {
          const diag = await this.collectClaudeDiagnostics();
          const err = new Error('claude_runtime_missing');
          (err as any).detail = {
            diagnostics: diag,
            original: 'cli_not_found',
          };
          throw err;
        }

        // If CLI exists we would normally spawn it and stream. Because CLI argument sets
        // vary across versions, attempt to choose args based on detected command.
        const isLegacyCli = cliResolution.command === 'claude-code';
        const cliArgs = isLegacyCli
          ? ['query', '--stdin', '--stream']
          : ['-p', prompt];

        // Spawn CLI (always pipe stdout/stderr so we can stream output)
        const child = spawn(cliResolution.command, cliArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: opts.workspacePath || process.cwd(),
        });
        // register child for cancellation
        this.registerInFlight({
          sessionId,
          operationId,
          abortController,
          child,
        });

        if (isLegacyCli) {
          child.stdin.setDefaultEncoding('utf8');
          child.stdin.write(prompt);
          child.stdin.end();
        } else {
          // Ensure stdin closed so CLI doesn't wait for additional input
          child.stdin.end();
        }

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          if (abortController.signal.aborted) return;
          fullText += chunk;
          const deltaTokens = this.estimateTokens(chunk);
          outputTokens += deltaTokens;
          callbacks.onDelta?.({ text: chunk, tokens: deltaTokens });
        });

        const stderrChunks: string[] = [];
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (c: string) => stderrChunks.push(c));

        const exitPromise: Promise<{ code: number | null; stderr: string }> =
          new Promise((resolve, reject) => {
            child.on('error', (err) => reject(err));
            child.on('close', (code) =>
              resolve({ code, stderr: stderrChunks.join('') }),
            );
          });

        const exit = await exitPromise;
        if (abortController.signal.aborted) throw new Error('cancelled');
        if (exit.code !== 0) {
          const diag = await this.collectClaudeDiagnostics();
          const err = new Error(exit.stderr || `claude_cli_exit_${exit.code}`);
          (err as any).detail = {
            diagnostics: diag,
            stderr: exit.stderr,
            exitCode: exit.code,
          };
          throw err;
        }
      }

      const durationMs = Date.now() - startTime;
      callbacks.onComplete?.({ fullText, durationMs });

      return { fullText, tokens: { input: inputTokens, output: outputTokens } };
    } catch (err: any) {
      callbacks.onError?.(err);
      throw err;
    } finally {
      // Remove all entries matching operation (should only be one)
      const key = `${sessionId}:${operationId}`;
      const entry = this.inFlightByOperation.get(key);
      if (entry) this.unregisterInFlight(entry);
    }
  }
}

// Simple optional singleton export for handler convenience. Handlers may replace
// this with DI wiring later; kept lightweight and side-effect free.
export const claudeClientSingleton = new ClaudeClient();
export default ClaudeClient;
