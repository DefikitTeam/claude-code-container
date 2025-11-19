import { describe, it, expect, vi } from 'vitest';
import type { ACPSession } from '../src/types/acp-session.js';
import type { ContentBlock } from '../src/types/acp-messages.js';
import { SessionEntity } from '../src/core/entities/session.entity.js';
import { PromptEntity } from '../src/core/entities/prompt.entity.js';
import { WorkspaceEntity } from '../src/core/entities/workspace.entity.js';

function createSession(overrides: Partial<ACPSession> = {}): ACPSession {
  const base: ACPSession = {
    sessionId: 'sess-123',
    workspaceUri: 'file:///tmp/workspace',
    mode: 'development',
    state: 'active',
    createdAt: Date.now() - 10,
    lastActiveAt: Date.now() - 5,
    messageHistory: [],
    sessionOptions: {
      persistHistory: true,
      enableGitOps: true,
      contextFiles: [],
    },
    agentContext: {
      requestingAgent: 'tester',
    },
  };
  return { ...base, ...overrides };
}

describe('SessionEntity', () => {
  it('validates and clones session data', () => {
    const session = createSession();
    const entity = SessionEntity.fromPlain(session);
    const snapshot = entity.toJSON();
    expect(snapshot).not.toBe(session);
    expect(snapshot.sessionId).toBe(session.sessionId);
  });

  it('merges agent contexts with automation payloads', () => {
    const session = createSession({
      agentContext: {
        automation: { branch: 'main', reviewers: ['alice'] },
        requestingAgent: 'tester',
      },
    });
    const entity = SessionEntity.fromPlain(session);
    const merged = entity.mergeAgentContext({
      automation: { reviewers: ['bob'], title: 'Update' },
      userRequest: 'Help',
    });
    const context = merged.agentContext;
    expect(context).toBeDefined();
    expect(context?.automation).toMatchObject({
      branch: 'main',
      reviewers: ['bob'],
      title: 'Update',
    });
    expect(context?.userRequest).toBe('Help');
  });

  it('appends message history immutably', () => {
    const session = createSession();
    const entity = SessionEntity.fromPlain(session);
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const updated = entity.appendMessageHistory(
      [{ type: 'text', text: 'hello world' } as ContentBlock],
      now,
    );
    vi.useRealTimers();
    expect(updated.messageHistory.length).toBe(1);
    expect(entity.messageHistory.length).toBe(0);
    expect(updated.lastActiveAt).toBeGreaterThanOrEqual(now);
  });
});

describe('PromptEntity', () => {
  it('builds prompt text and token estimate', () => {
    const session = createSession();
    const entity = PromptEntity.create(
      { content: [{ type: 'text', text: 'hello' }] as ContentBlock[] },
      session,
    );
    expect(entity.text).toContain('hello');
    expect(entity.tokenEstimate).toBeGreaterThan(0);
  });
});

describe('WorkspaceEntity', () => {
  it('normalizes workspace descriptors', () => {
    const workspace = WorkspaceEntity.fromDescriptor({
      sessionId: 'sess-123',
      path: '/tmp/workspace',
      isEphemeral: true,
      createdAt: Date.now(),
      gitInfo: {
        currentBranch: 'main',
        hasUncommittedChanges: true,
      },
    }).toJSON();
    expect(workspace.gitInfo?.currentBranch).toBe('main');
  });
});
