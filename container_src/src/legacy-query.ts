// Legacy Claude Code prompt processing extracted from prior HTTP REST flow (main.ts)
// Provides a simpler, more battle-tested execution path as a fallback when the ACP integrated
// processPromptWithClaudeCode encounters persistent failures (exit code 1 scenarios).
//
// This module purposefully avoids direct GitHub side-effects (branch, commit, PR) and focuses
// solely on executing a Claude Code query with a provided prompt within an existing workspace.
//
// Usage:
//   import { runLegacyClaudeFlow } from './legacy-query.js';
//   const { messages, summary } = await runLegacyClaudeFlow({ prompt, workspacePath });
//
// Environment expectations:
//   - ANTHROPIC_API_KEY must be set (or apiKey passed explicitly)
//   - git available if repository interactions occur (not required here beyond potential future use)
//
// Returns:
//   { success: boolean; messages?: SDKMessage[]; summary?: string; error?: string }

import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);

export interface LegacyFlowOptions {
  prompt: string;
  workspacePath?: string; // If provided, chdir before running
  apiKey?: string; // Optional explicit apiKey override
  modelHint?: string; // Optional model override
  timeoutMs?: number; // Soft timeout for iteration
  collectDiagnostics?: boolean; // If true, includes runtime diagnostics
}

export interface LegacyFlowResult {
  success: boolean;
  messages?: SDKMessage[];
  summary?: string;
  error?: string;
  diagnostics?: Record<string, any>;
}

function extractMessageText(message: SDKMessage): string {
  // Attempt multiple fields based on SDK variability
  // @ts-ignore
  if (typeof message.text === 'string') return message.text;
  // @ts-ignore - SDK message shape varies
  if (typeof (message as any).content === 'string')
    return (message as any).content;
  // @ts-ignore - SDK message shape varies
  if (Array.isArray((message as any).content))
    return (message as any).content
      .map((c: any) => c.text || JSON.stringify(c))
      .join('\n');
  return JSON.stringify(message);
}

async function runtimeDiagnostics(): Promise<Record<string, any>> {
  const diag: Record<string, any> = {
    node: process.version,
    cwd: process.cwd(),
    apiKey: !!process.env.ANTHROPIC_API_KEY,
    hasAuthFile: false,
    hasLegacyFile: false,
    gitVersion: null as string | null,
    claudeVersion: null as string | null,
  };
  const home = os.homedir();
  const authFile = path.join(home, '.config', 'claude-code', 'auth.json');
  const legacyFile = path.join(home, '.claude.json');
  try {
    await fs.access(authFile);
    diag.hasAuthFile = true;
  } catch {}
  try {
    await fs.access(legacyFile);
    diag.hasLegacyFile = true;
  } catch {}
  try {
    const { stdout } = await pExecFile('git', ['--version']);
    diag.gitVersion = stdout.trim();
  } catch {}
  try {
    const { stdout } = await pExecFile('claude', ['--version']);
    diag.claudeVersion = stdout.trim();
  } catch {}
  return diag;
}

export async function runLegacyClaudeFlow(
  options: LegacyFlowOptions,
): Promise<LegacyFlowResult> {
  const {
    prompt,
    workspacePath,
    apiKey,
    modelHint,
    timeoutMs = 120000,
    collectDiagnostics,
  } = options;
  const messages: SDKMessage[] = [];
  const originalCwd = process.cwd();
  let timeoutHandle: NodeJS.Timeout | null = null;
  let aborted = false;

  if (!prompt || !prompt.trim()) {
    return { success: false, error: 'Prompt is empty' };
  }

  if (workspacePath) {
    try {
      process.chdir(workspacePath);
    } catch (e) {
      console.warn(
        '[LegacyFlow] Failed to chdir workspace:',
        (e as Error).message,
      );
    }
  }

  const restoreEnv: Record<string, string | undefined> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_LOG: process.env.ANTHROPIC_LOG,
  };

  if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey;
  if (!process.env.ANTHROPIC_LOG) process.env.ANTHROPIC_LOG = 'debug';

  const diagnostics: Record<string, any> = collectDiagnostics
    ? await runtimeDiagnostics()
    : {};

  try {
    console.log('[LegacyFlow] Starting Claude Code query (fallback path)');
    const iterable = query({
      prompt,
      options: {
        permissionMode: 'bypassPermissions',
        model:
          modelHint ||
          process.env.CLAUDE_CODE_MODEL ||
          'claude-3-5-sonnet-20240620',
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        aborted = true;
        reject(new Error(`Legacy flow timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });

    const iteratePromise = (async () => {
      for await (const m of iterable) {
        messages.push(m as SDKMessage);
      }
    })();

    await Promise.race([iteratePromise, timeoutPromise]);

    if (messages.length === 0) {
      return {
        success: false,
        error: 'No messages received from Claude Code',
        diagnostics,
      };
    }

    const summary = extractMessageText(messages[messages.length - 1]).substring(
      0,
      2000,
    );
    return { success: true, messages, summary, diagnostics };
  } catch (err: any) {
    diagnostics.errorMessage = err?.message;
    diagnostics.errorStack = err?.stack;
    diagnostics.aborted = aborted;
    console.error('[LegacyFlow] Error:', err?.message);
    return { success: false, error: err?.message || String(err), diagnostics };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    process.chdir(originalCwd);
    if (restoreEnv.ANTHROPIC_API_KEY !== undefined)
      process.env.ANTHROPIC_API_KEY = restoreEnv.ANTHROPIC_API_KEY;
    else delete process.env.ANTHROPIC_API_KEY;
    if (restoreEnv.ANTHROPIC_LOG !== undefined)
      process.env.ANTHROPIC_LOG = restoreEnv.ANTHROPIC_LOG;
    else delete process.env.ANTHROPIC_LOG;
  }
}
