import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sessionNewHandler } from '../src/handlers/session-new-handler.js';
import { sessionLoadHandler } from '../src/handlers/session-load-handler.js';
import { sessionPromptHandler } from '../src/handlers/session-prompt-handler.js';
import { cancelHandler } from '../src/handlers/cancel-handler.js';
import { acpState } from '../src/handlers/acp-state.js';
import { getContainer, resetContainer } from '../src/config/container.config.js';
import type { RequestContext } from '../src/services/stdio-jsonrpc.js';
import type { ACPSession } from '../src/types/acp-session.js';
import type { SessionPromptResponse } from '../src/types/acp-messages.js';

describe('handler integration (clean architecture)', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.stubEnv('USE_CLEAN_ARCH', '1');
    vi.stubEnv('ROLLBACK_CLEAN_ARCH', '0');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-sessions-'));
    vi.stubEnv('ACP_SESSION_STORAGE_DIR', tempDir);
    resetContainer();
    for (const session of acpState.getAllSessions()) {
      acpState.deleteSession(session.sessionId);
    }
    acpState.setInitialized(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    for (const session of acpState.getAllSessions()) {
      acpState.deleteSession(session.sessionId);
    }
  });

  function buildContext(): RequestContext {
    return {
      requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      metadata: {},
    };
  }

  function buildSession(overrides: Partial<ACPSession> = {}): ACPSession {
    const now = Date.now();
    return {
      sessionId: overrides.sessionId ?? `session-${Math.random().toString(36).slice(2, 8)}`,
      workspaceUri: overrides.workspaceUri,
      mode: overrides.mode ?? 'development',
      state: overrides.state ?? 'active',
      createdAt: overrides.createdAt ?? now,
      lastActiveAt: overrides.lastActiveAt ?? now,
      messageHistory: overrides.messageHistory ?? [],
      sessionOptions: overrides.sessionOptions,
    };
  }

  it('persists new sessions via container session store', async () => {
    const ctx = buildContext();
    const container = getContainer();
    const saveSpy = vi.spyOn(container.sessionStore, 'save');

    const result = await sessionNewHandler({}, ctx);

    expect(result.sessionId).toMatch(/^session-/);
    const stored = await container.sessionStore.load(result.sessionId);
    expect(stored?.sessionId).toBe(result.sessionId);
    expect(saveSpy).toHaveBeenCalled();
  });

  it('loads sessions from container session store when not cached', async () => {
    const ctx = buildContext();
    const container = getContainer();

    const { sessionId } = await sessionNewHandler({}, ctx);
    acpState.deleteSession(sessionId); // force load from persistence

    const loadSpy = vi.spyOn(container.sessionStore, 'load');
    const response = await sessionLoadHandler({ sessionId, includeHistory: true }, ctx);

    expect(loadSpy).toHaveBeenCalledWith(sessionId);
    expect(response.sessionInfo.sessionId).toBe(sessionId);
    expect(response.historyAvailable).toBe(false);
  });

  it('delegates prompt processing to container prompt processor', async () => {
    const ctx = buildContext();
    const container = getContainer();
    const session = buildSession();

    await container.sessionStore.save(session);
    acpState.deleteSession(session.sessionId);

    const loadSpy = vi.spyOn(container.sessionStore, 'load');
    loadSpy.mockResolvedValue(session);

    const promptSpy = vi
      .spyOn(container.promptProcessor, 'processPrompt')
      .mockResolvedValue({ stopReason: 'completed' } as SessionPromptResponse['result']);

    const result = await sessionPromptHandler(
      {
        sessionId: session.sessionId,
        content: [{ type: 'text', text: 'Hello' }],
      },
      ctx,
    );

    expect(loadSpy).toHaveBeenCalledWith(session.sessionId);
    expect(promptSpy).toHaveBeenCalled();
    expect(result.stopReason).toBe('completed');
  });

  it('invokes container claude client during cancellation', async () => {
    const ctx = buildContext();
    const container = getContainer();
    const session = buildSession();
    acpState.setSession(session.sessionId, session);
    acpState.startOperation(session.sessionId, 'op-1');

    const cancelSpy = vi
      .spyOn(container.claudeClient, 'cancelOperation')
      .mockResolvedValue();

    const response = await cancelHandler(
      { sessionId: session.sessionId, operationId: 'op-1' } as any,
      ctx,
    );

    expect(cancelSpy).toHaveBeenCalledWith(session.sessionId, 'op-1');
    expect(response.cancelled).toBe(true);
  });
});
