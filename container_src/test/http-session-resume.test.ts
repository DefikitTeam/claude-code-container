
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionNewHandler } from '../src/handlers/session-new-handler.js';
import { acpState } from '../src/handlers/acp-state.js';
import { getRuntimeServices } from '../src/config/runtime-services.js';

// Mock dependencies
vi.mock('../src/handlers/acp-state.js', () => ({
  acpState: {
    ensureInitialized: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    setSession: vi.fn(),
    getSessionCount: vi.fn().mockReturnValue(0),
  },
}));

const mockSessionStore = {
  save: vi.fn(),
};

vi.mock('../src/config/runtime-services.js', () => ({
  getRuntimeServices: vi.fn(() => ({
    sessionStore: mockSessionStore,
  })),
}));

// Mock fs to avoid errors in createWorkspaceInfo
vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn().mockResolvedValue(undefined),
    constants: { R_OK: 1, W_OK: 2 },
  },
}));

describe('sessionNewHandler - Resume Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should inject initialContext summary into messageHistory', async () => {
    const summary = 'User was building a React app.';
    const params = {
      workspaceUri: 'file:///tmp/test',
      initialContext: {
        contextSummary: summary,
      },
    };

    const result = await sessionNewHandler(params as any, {} as any);

    expect(result.sessionId).toBeDefined();

    // Verify session was saved with correct history
    expect(mockSessionStore.save).toHaveBeenCalledTimes(1);
    const savedSession = mockSessionStore.save.mock.calls[0][0];
    
    expect(savedSession.messageHistory).toBeDefined();
    expect(savedSession.messageHistory.length).toBe(1);
    expect(savedSession.messageHistory[0].content).toContain('System Restoration: Previous Session Context Summary');
    expect(savedSession.messageHistory[0].content).toContain(summary);
  });

  it('should inject openFiles into messageHistory', async () => {
    const openFiles = ['src/main.ts', 'src/utils.ts'];
    const params = {
      workspaceUri: 'file:///tmp/test',
      resumeState: {
        openFiles,
      },
    };

    const result = await sessionNewHandler(params as any, {} as any);

    expect(result.sessionId).toBeDefined();

    // Verify session was saved with correct history
    expect(mockSessionStore.save).toHaveBeenCalledTimes(1);
    const savedSession = mockSessionStore.save.mock.calls[0][0];
    
    expect(savedSession.messageHistory).toBeDefined();
    expect(savedSession.messageHistory.length).toBe(1);
    expect(savedSession.messageHistory[0].content).toContain('The user has the following files open');
    expect(savedSession.messageHistory[0].content).toContain('src/main.ts, src/utils.ts');
  });

  it('should inject both summary and openFiles in correct order', async () => {
    const summary = 'Context summary';
    const openFiles = ['file1.ts'];
    const params = {
        workspaceUri: 'file:///tmp/test',
        initialContext: { contextSummary: summary },
        resumeState: { openFiles }
    };

    await sessionNewHandler(params as any, {} as any);

    const savedSession = mockSessionStore.save.mock.calls[0][0];
    expect(savedSession.messageHistory.length).toBe(2);
    // Summary first
    expect(savedSession.messageHistory[0].content).toContain(summary);
    // Open files second
    expect(savedSession.messageHistory[1].content).toContain('files open');
  });

  it('should support Backend-compatible format (nested agentContext)', async () => {
    const summary = 'Backend summary';
    const openFiles = ['backend/file.ts'];
    // Backend sends sessionMetadata as a JSON string
    const sessionMetadata = JSON.stringify({ openFiles });
    
    const params = {
      workspaceUri: 'file:///tmp/test',
      agentContext: {
        contextSummary: summary,
        sessionMetadata: sessionMetadata
      }
    };

    const result = await sessionNewHandler(params as any, {} as any);

    expect(result.sessionId).toBeDefined();

    const savedSession = mockSessionStore.save.mock.calls[0][0];
    expect(savedSession.messageHistory.length).toBe(2);
    expect(savedSession.messageHistory[0].content).toContain(summary);
    expect(savedSession.messageHistory[1].content).toContain('backend/file.ts');
  });
});
