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

  /**
   * ⭐ Solution 2: Create auth file for SDK subprocess
   * Some SDK subprocess implementations expect auth.json file even when API key is in env
   */
  private async ensureClaudeAuthFile(apiKey: string): Promise<void> {
    try {
      const home = os.homedir();
      const configDir = path.join(home, '.config', 'claude-code');
      const authFile = path.join(configDir, 'auth.json');
      
      // Check if auth file already exists
      try {
        await fs.access(authFile);
        console.log('[CLAUDE-CLIENT] ✅ Auth file already exists:', authFile);
        return;
      } catch {
        // File doesn't exist, create it
      }
      
      // Create config directory
      await fs.mkdir(configDir, { recursive: true });
      
      // Create auth file with API key
      const authData = {
        api_key: apiKey,
        user_id: 'container-user',
        created_at: new Date().toISOString(),
      };
      
      await fs.writeFile(authFile, JSON.stringify(authData, null, 2));
      console.log('[CLAUDE-CLIENT] ✅ Created auth file:', authFile);
    } catch (err) {
      console.warn('[CLAUDE-CLIENT] ⚠️ Failed to create auth file:', err);
      // Don't throw - this is a best-effort operation
    }
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

    const inFlightEntry: InFlight = {
      sessionId,
      operationId,
      abortController,
      child: null,
    };
    this.registerInFlight(inFlightEntry);

    callbacks.onStart?.({ startTime });

    // Basic token accounting
    let inputTokens = this.estimateTokens(prompt);
    let outputTokens = 0;
    let fullText = '';

    const appendText = (text?: string | null) => {
      if (!text) return;
      fullText += text;
      const deltaTokens = this.estimateTokens(text);
      outputTokens += deltaTokens;
      callbacks.onDelta?.({ text, tokens: deltaTokens });
    };

    const extractTextFromMessage = (m: any): string => {
      try {
        const content = m?.message?.content ?? m?.content;
        if (Array.isArray(content)) {
          const parts = content
            .filter(
              (p: any) =>
                p &&
                p.type === 'text' &&
                typeof p.text === 'string' &&
                p.text.trim().length > 0,
            )
            .map((p: any) => p.text as string);
          if (parts.length) return parts.join('');
        }
        if (typeof m?.text === 'string') return m.text;
        if (
          m?.type === 'result' &&
          m?.subtype === 'success' &&
          typeof m?.result === 'string'
        ) {
          return m.result;
        }
        if (typeof m === 'string') return m;
        return '';
      } catch (err) {
        console.error('[CLAUDE-CLIENT] extractTextFromMessage failed:', err);
        return '';
      }
    };

    try {
      // Fail fast if we have no API key available
      const effectiveKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!effectiveKey) {
        const diag = await this.collectClaudeDiagnostics();
        const err = new Error('anthropic_api_key_missing');
        (err as any).detail = { diagnostics: diag };
        throw err;
      }
      
      // ⭐ Solution 2: Ensure auth file exists for SDK subprocess
      // Some SDK implementations expect auth.json even with API key in env
      if (effectiveKey) {
        await this.ensureClaudeAuthFile(effectiveKey);
      }

      // If caller supplied apiKey and environment does not yet have it, set it so SDK can pick it up.
      if (effectiveKey && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = effectiveKey;
      }

      // Allow tests / callers to force-disable SDK or CLI usage for deterministic behavior
      // ⭐ CRITICAL: SDK spawns subprocess with --dangerously-skip-permissions which is
      // blocked when running as root. In container environments running as root (common
      // for isolated workloads), we MUST use HTTP API directly instead of SDK subprocess.
      const disableSdk = process.env.CLAUDE_CLIENT_DISABLE_SDK === '1';
      const disableCli = process.env.CLAUDE_CLIENT_DISABLE_CLI === '1';
      const forceHttpApi = process.env.CLAUDE_CLIENT_FORCE_HTTP_API === '1';

      // ⭐ Check if running as root - if so, skip SDK and use HTTP API directly
      const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
      
      if (runningAsRoot && !forceHttpApi) {
        console.warn('[CLAUDE-CLIENT] ⚠️ Running as root - SDK subprocess will fail.');
        console.warn('[CLAUDE-CLIENT] ⚠️ Switching to direct HTTP API mode automatically.');
        console.warn('[CLAUDE-CLIENT] ⚠️ Set CLAUDE_CLIENT_FORCE_HTTP_API=1 to suppress this warning.');
      }

      // Try SDK dynamic import (unless disabled or running as root)
      let usedSdk = false;
      const shouldTrySdk = !disableSdk && !runningAsRoot && !forceHttpApi;
      
      console.log('[CLAUDE-CLIENT] 🔍 Runtime mode selection:', {
        disableSdk,
        runningAsRoot,
        forceHttpApi,
        willTrySdk: shouldTrySdk,
      });
      
      if (shouldTrySdk) {
        try {
          console.log('[CLAUDE-CLIENT] 📦 Importing @anthropic-ai/claude-code...');
          console.log('[CLAUDE-CLIENT] 🔑 ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
          console.log('[CLAUDE-CLIENT] 🔑 effectiveKey available:', !!effectiveKey);
          
          // ✅ Set API key in environment for subprocess
          if (effectiveKey) {
            process.env.ANTHROPIC_API_KEY = effectiveKey;
          }
          
          // attempt dynamic import; not all environments will have this package
          const sdk = await import('@anthropic-ai/claude-code').catch(
            (importErr) => {
              console.error('[CLAUDE-CLIENT] ❌ Failed to import SDK:', importErr);
              return null as any;
            }
          );
          
          console.log('[CLAUDE-CLIENT] SDK import result:', {
            hasQuery: !!(sdk?.query),
            hasDefaultQuery: !!(sdk?.default?.query),
            sdkKeys: sdk ? Object.keys(sdk) : [],
          });
          
          const queryFn = sdk?.query ?? sdk?.default?.query ?? null;
          
          console.log('[CLAUDE-CLIENT] Query function found:', {
            found: !!queryFn,
            type: typeof queryFn,
          });
          
          if (queryFn && typeof queryFn === 'function') {
            console.log('[CLAUDE-CLIENT] ✅ SDK query function available, proceeding...');
            usedSdk = true;
            
            // ✅ Configure SDK options properly for container environment
            // Based on official docs: https://docs.anthropic.com/claude-code/agent-sdk
            const options: any = {
              model: opts.model ?? this.model ?? 'claude-sonnet-4-5',
              
              // ⭐ CRITICAL: Bypass all permissions in container (no interactive prompts)
              permissionMode: 'bypassPermissions',
              
              // ⭐ CRITICAL: Don't load filesystem settings in container
              // This prevents SDK from looking for .claude/commands, CLAUDE.md, etc.
              settingSources: [],
              
              // Working directory for file operations
              workingDirectory: opts.workspacePath || process.cwd(),
              
              // ⭐ CRITICAL: Ensure subprocess gets API key via environment
              // SDK spawns subprocess that needs access to ANTHROPIC_API_KEY
              env: {
                ...process.env,
                ANTHROPIC_API_KEY: effectiveKey,
                // Enable debug logging for subprocess
                ANTHROPIC_LOG: process.env.ANTHROPIC_LOG || 'info',
              },
              
              // ⭐ Use current Node.js executable for subprocess
              executable: process.execPath,
              
              // Disable interactive stderr prompts
              stderr: (msg: string) => {
                if (msg && msg.trim()) {
                  console.error('[CLAUDE-SDK-STDERR]', msg);
                }
              },
            };

            console.log('[CLAUDE-CLIENT] 🚀 Starting SDK query with options:', {
              model: options.model,
              permissionMode: options.permissionMode,
              settingSources: options.settingSources,
              workingDirectory: options.workingDirectory,
              envApiKeySet: !!effectiveKey,
              executablePath: options.executable,
              promptLength: prompt.length,
            });

            console.log('[CLAUDE-CLIENT] 📞 Calling queryFn({ prompt, options })...');
            const iterable = queryFn({ prompt, options });
            console.log('[CLAUDE-CLIENT] ✅ queryFn returned iterable:', !!iterable);

            console.log('[CLAUDE-CLIENT] 🔄 Starting to iterate over SDK messages...');
            
            for await (const msg of iterable as any) {
              console.log('[CLAUDE-CLIENT] 📨 SDK message received:', {
                type: msg?.type,
                hasContent: !!msg?.content,
                hasError: !!msg?.error,
              });
              
              if (abortController.signal.aborted) break;
              
              // ✅ Handle different message types from claude-agent-sdk
              if (msg?.type === 'assistant') {
                const textChunk = typeof msg.content === 'string' 
                  ? msg.content 
                  : extractTextFromMessage(msg);
                  
                appendText(textChunk);
              } else if (msg?.type === 'error') {
                console.error('[CLAUDE-CLIENT] SDK error message:', msg);
                throw new Error(msg?.error?.message || 'SDK error');
              } else {
                // For other message types, try extracting text
                const textChunk = extractTextFromMessage(msg);
                appendText(textChunk);
              }
            }
          }
        } catch (sdkErr) {
          // ✅ Log comprehensive SDK error details for debugging
          console.error('[CLAUDE-CLIENT] ❌ SDK execution failed:', {
            error: sdkErr,
            message: (sdkErr as Error)?.message,
            stack: (sdkErr as Error)?.stack,
            name: (sdkErr as Error)?.name,
            // ⭐ Capture subprocess-specific error details
            code: (sdkErr as any)?.code,
            signal: (sdkErr as any)?.signal,
            exitCode: (sdkErr as any)?.exitCode,
            stderr: (sdkErr as any)?.stderr,
            stdout: (sdkErr as any)?.stdout,
            // ⭐ Check for specific error patterns
            isAuthError: (sdkErr as Error)?.message?.includes('auth') || 
                        (sdkErr as Error)?.message?.includes('login') ||
                        (sdkErr as Error)?.message?.includes('API key'),
            isProcessError: (sdkErr as Error)?.message?.includes('process') || 
                           (sdkErr as Error)?.message?.includes('exit'),
          });
          
          // ⭐ Try to get diagnostics on SDK failure
          try {
            const diag = await this.collectClaudeDiagnostics();
            console.error('[CLAUDE-CLIENT] 📊 Diagnostics after SDK failure:', diag);
          } catch (diagErr) {
            console.error('[CLAUDE-CLIENT] ⚠️ Could not collect diagnostics:', diagErr);
          }
          
          // Only fall back to CLI if SDK is genuinely broken
          usedSdk = false;
        }
      }

      if (!usedSdk) {
        // ⭐ NEW: Try direct HTTP API first (especially if running as root)
        if (runningAsRoot || forceHttpApi) {
          console.log('[CLAUDE-CLIENT] 🌐 Using direct Anthropic HTTP API (root/forced mode)');
          
          try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': effectiveKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: opts.model ?? this.model ?? 'claude-sonnet-4-20241022',
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
              }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
            }

            if (!response.body) {
              throw new Error('No response body from Anthropic API');
            }

            // Stream the response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done || abortController.signal.aborted) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'event: message_start' || trimmed === 'event: message_stop') {
                  continue;
                }
                
                if (trimmed.startsWith('data:')) {
                  const jsonStr = trimmed.slice(5).trim();
                  if (jsonStr === '[DONE]') continue;
                  
                  try {
                    const data = JSON.parse(jsonStr);
                    
                    // Handle content block delta
                    if (data.type === 'content_block_delta' && data.delta?.text) {
                      appendText(data.delta.text);
                    }
                    // Handle full content block
                    else if (data.type === 'content_block_start' && data.content_block?.text) {
                      appendText(data.content_block.text);
                    }
                  } catch (parseErr) {
                    console.warn('[CLAUDE-CLIENT] Failed to parse SSE data:', jsonStr.slice(0, 100));
                  }
                }
              }
            }

            // Success - HTTP API worked
            const durationMs = Date.now() - startTime;
            callbacks.onComplete?.({ fullText, durationMs });
            return { fullText, tokens: { input: inputTokens, output: outputTokens } };
            
          } catch (httpErr) {
            console.error('[CLAUDE-CLIENT] ❌ HTTP API failed:', httpErr);
            // Fall through to CLI if HTTP API fails
          }
        }
        
        // CLI fallback (if not disabled)
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
        let cliArgs: string[];
        if (isLegacyCli) {
          cliArgs = ['query', '--stdin', '--stream'];
        } else {
          const runningAsRoot =
            typeof process.getuid === 'function' && process.getuid() === 0;
          cliArgs = [
            '--print',
            '--verbose',
            '--output-format',
            'stream-json',
            '--include-partial-messages',
            '--permission-mode',
            'bypassPermissions',
          ];
          if (runningAsRoot) {
            console.warn(
              '[CLAUDE-CLIENT] ⚠️ Running CLI fallback as root; skipping --dangerously-skip-permissions flag.',
            );
          } else {
            cliArgs.push('--dangerously-skip-permissions');
          }
          cliArgs.push(prompt);
        }

        // Spawn CLI (always pipe stdout/stderr so we can stream output)
        const child = spawn(cliResolution.command, cliArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: opts.workspacePath || process.cwd(),
        });
        // register child for cancellation
        inFlightEntry.child = child;

        if (isLegacyCli) {
          child.stdin.setDefaultEncoding('utf8');
          child.stdin.write(prompt);
          child.stdin.end();
        } else {
          // Ensure stdin closed so CLI doesn't wait for additional input
          child.stdin.end();
        }

        child.stdout.setEncoding('utf8');
        const stdoutChunks: string[] = [];
        let jsonBuffer = '';

        const processCliJsonLine = (line: string) => {
          const cleanedLine = line.endsWith('\r')
            ? line.slice(0, -1)
            : line;
          if (!cleanedLine.trim()) return;
          try {
            const parsed = JSON.parse(cleanedLine);
            if (parsed?.type === 'stream_event') {
              const event = parsed.event;
              if (event?.type === 'content_block_delta') {
                const text = event?.delta?.text;
                if (typeof text === 'string') appendText(text);
              }
            } else if (parsed?.type === 'assistant') {
              const text = extractTextFromMessage(parsed);
              if (!fullText) appendText(text);
            } else if (parsed?.type === 'result') {
              if (!fullText && typeof parsed?.result === 'string') {
                appendText(parsed.result);
              }
            } else {
              const text = extractTextFromMessage(parsed);
              appendText(text);
            }
          } catch (parseErr) {
            // Not valid JSON (possibly legacy output or partial); treat as plain text
            appendText(cleanedLine);
          }
        };

        if (isLegacyCli) {
          child.stdout.on('data', (chunk: string) => {
            if (abortController.signal.aborted) return;
            stdoutChunks.push(chunk);
            appendText(chunk);
          });
        } else {
          const flushBuffer = (force = false) => {
            let newlineIdx = jsonBuffer.indexOf('\n');
            while (newlineIdx >= 0) {
              const line = jsonBuffer.slice(0, newlineIdx);
              jsonBuffer = jsonBuffer.slice(newlineIdx + 1);
              processCliJsonLine(line);
              newlineIdx = jsonBuffer.indexOf('\n');
            }
            if (force) {
              const remaining = jsonBuffer.trim();
              jsonBuffer = '';
              if (remaining) processCliJsonLine(remaining);
            }
          };

          child.stdout.on('data', (chunk: string) => {
            if (abortController.signal.aborted) return;
            stdoutChunks.push(chunk);
            jsonBuffer += chunk;
            flushBuffer();
          });

          child.stdout.on('end', () => flushBuffer(true));
        }

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
          const stdoutPreview = stdoutChunks.join('').slice(0, 4000);
          const cliArgsForDiagnostics = cliArgs.map((arg) =>
            arg === prompt ? '[prompt omitted]' : arg,
          );
          const err = new Error(exit.stderr || `claude_cli_exit_${exit.code}`);
          (err as any).detail = {
            diagnostics: diag,
            stderr: exit.stderr,
            exitCode: exit.code,
            stdout: stdoutPreview,
            cliCommand: cliResolution.command,
            cliArgs: cliArgsForDiagnostics,
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
