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

  async ensureClaudeAuthFiles(apiKey?: string): Promise<void> {
    if (!apiKey) return;
    const home = os.homedir();
    const configDir = path.join(home, '.config', 'claude-code');
    const authFile = path.join(configDir, 'auth.json');
    const legacyFile = path.join(home, '.claude.json');

    await fs.mkdir(configDir, { recursive: true });

    const auth = { anthropic_api_key: apiKey };
    try {
      const existing = await fs.readFile(authFile, 'utf8').catch(() => '');
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (parsed && parsed.anthropic_api_key === apiKey) {
            // already correct
          } else {
            await fs.writeFile(authFile, JSON.stringify(auth, null, 2), {
              mode: 0o600,
            });
          }
        } catch {
          await fs.writeFile(authFile, JSON.stringify(auth, null, 2), {
            mode: 0o600,
          });
        }
      } else {
        await fs.writeFile(authFile, JSON.stringify(auth, null, 2), {
          mode: 0o600,
        });
      }
    } catch (e) {
      // best-effort, surface on failure to caller via thrown error
      throw e;
    }

    // legacy
    try {
      await fs.writeFile(legacyFile, JSON.stringify({ ANTHROPIC_API_KEY: apiKey }), {
        mode: 0o600,
      });
    } catch {
      // ignore
    }
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
    try {
      const { stdout, stderr } = await execFileAsync('claude-code', ['--version']).catch(() => ({ stdout: null, stderr: null } as any));
      diag.claudeCodeVersion = stdout ? String(stdout).trim() : null;
      diag.claudeCodeVersionStderr = stderr ? String(stderr).trim() : null;
    } catch (e: any) {
      diag.claudeCodeVersionError = String(e?.message || e);
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
      this.inFlightByOperation.set(`${entry.sessionId}:${entry.operationId}`, entry);
    }
  }

  private unregisterInFlight(entry: InFlight) {
    const list = this.inFlightBySession.get(entry.sessionId) || [];
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length) this.inFlightBySession.set(entry.sessionId, list);
    else this.inFlightBySession.delete(entry.sessionId);
    if (entry.operationId) this.inFlightByOperation.delete(`${entry.sessionId}:${entry.operationId}`);
  }

  async cancel(sessionId: string): Promise<void> {
    const list = this.inFlightBySession.get(sessionId);
    if (!list || !list.length) return;
    for (const entry of [...list]) {
      try {
        entry.abortController.abort();
        if (entry.child && typeof entry.child.kill === 'function') {
          try { entry.child.kill('SIGINT'); } catch {}
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
        try { entry.child.kill('SIGINT'); } catch {}
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
  const operationId = opts.operationId || `op-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
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

  this.registerInFlight({ sessionId, operationId, abortController, child: null });

    callbacks.onStart?.({ startTime });

    // Basic token accounting
    const inputTokens = this.estimateTokens(prompt);
    let outputTokens = 0;
    let fullText = '';

    try {
      // Ensure auth files if apiKey provided
      if (opts.apiKey) {
        try {
          await this.ensureClaudeAuthFiles(opts.apiKey);
        } catch (e) {
          const err = new Error('auth_failed');
          (err as any).detail = { original: e };
          throw err;
        }
      }

      // Try SDK dynamic import
      let usedSdk = false;
      try {
        // attempt dynamic import; not all environments will have this package
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sdk = await import('@anthropic-ai/claude-code').catch(() => null as any);
        const queryFn = sdk?.query ?? sdk?.default?.query ?? null;
        if (queryFn && typeof queryFn === 'function') {
          usedSdk = true;
          // call query and handle possible async iterable
          const qResult = queryFn({ input: prompt, model: opts.model ?? this.model, stream: true });
          // qResult might be an async iterable
          if (qResult && typeof qResult[Symbol.asyncIterator] === 'function') {
            for await (const part of qResult) {
              if (abortController.signal.aborted) throw new Error('cancelled');
              // part may be string or object
              const text = typeof part === 'string' ? part : (part?.text ?? part?.content ?? JSON.stringify(part));
              fullText += text;
              const deltaTokens = this.estimateTokens(text);
              outputTokens += deltaTokens;
              callbacks.onDelta?.({ text, tokens: deltaTokens });
            }
          } else if (qResult && typeof qResult.then === 'function') {
            const awaited = await qResult;
            const text = String(awaited?.text ?? awaited?.content ?? awaited ?? '');
            fullText = text;
            outputTokens = this.estimateTokens(text);
            callbacks.onDelta?.({ text, tokens: outputTokens });
          } else {
            // unknown shape, stringify
            const text = String(qResult ?? '');
            fullText = text;
            outputTokens = this.estimateTokens(text);
            callbacks.onDelta?.({ text, tokens: outputTokens });
          }
        }
      } catch (sdkErr) {
        // SDK attempt failed - we'll fall back to CLI check
        usedSdk = false;
      }

      if (!usedSdk) {
        // Check for CLI presence
        try {
          await execFileAsync('claude-code', ['--version']);
        } catch (e) {
          const diag = await this.collectClaudeDiagnostics();
          const err = new Error('claude_runtime_missing');
          (err as any).detail = { diagnostics: diag, original: e };
          throw err;
        }

        // If CLI exists we would normally spawn it and stream. Because CLI argument sets
        // vary across versions, attempt a streaming invocation with a heuristic.
        // We'll try `claude-code query --stdin --stream` and fall back to a single-shot
        // `claude-code query --text '...'` call. These are best-effort.

        // First attempt: streaming via spawn with --stdin
        const child = spawn('claude-code', ['query', '--stdin', '--stream'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // register child for cancellation
  this.registerInFlight({ sessionId, operationId, abortController, child });

        child.stdin.setDefaultEncoding('utf8');
        child.stdin.write(prompt);
        child.stdin.end();

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

        const exitPromise: Promise<{ code: number | null; stderr: string }> = new Promise((resolve, reject) => {
          child.on('error', (err) => reject(err));
          child.on('close', (code) => resolve({ code, stderr: stderrChunks.join('') }));
        });

        const exit = await exitPromise;
        if (abortController.signal.aborted) throw new Error('cancelled');
        if (exit.code !== 0) {
          const diag = await this.collectClaudeDiagnostics();
          const err = new Error(exit.stderr || `claude_cli_exit_${exit.code}`);
          (err as any).detail = { diagnostics: diag, stderr: exit.stderr, exitCode: exit.code };
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
