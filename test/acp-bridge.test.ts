import { describe, it, expect, vi } from 'vitest';
import { __acpBridgeInternals } from '../src/acp-bridge';
import type {
  ACPSessionPromptResult,
  Env,
  GitHubAutomationResult,
} from '../src/types';

const { sanitizeGitHubAutomation, handleSessionPromptSideEffects } =
  __acpBridgeInternals;

describe('acp-bridge automation propagation', () => {
  const baseAutomation: GitHubAutomationResult = {
    status: 'success',
    issue: {
      id: 42,
      number: 108,
      url: 'https://github.com/example/repo/issues/108',
      title: 'Fix bug',
    },
    pullRequest: {
      number: 7,
      url: 'https://github.com/example/repo/pull/7',
      branch: 'acp/session-branch',
      draft: false,
    },
    branch: 'acp/session-branch',
    commit: {
      sha: 'abcdef1234567890',
      message:
        'This is a long commit message produced by automation that should be truncated to protect excessive detail and avoid leaking sensitive information in durable object logs.',
    },
    diagnostics: {
      durationMs: 1234,
      attempts: 2,
      logs: ['git status', 'git commit'],
      errorCode: undefined,
      startTimestamp: new Date().toISOString(),
      endTimestamp: new Date().toISOString(),
    },
    metadata: {
      rawDiff: 'diff --git a/file b/file',
    },
  };

  it('sanitizes automation payload for audit logging', () => {
    const sanitized = sanitizeGitHubAutomation(baseAutomation);

    expect(sanitized).toBeDefined();
    expect(sanitized?.status).toBe('success');
    expect(sanitized?.issue?.number).toBe(108);
    expect(sanitized?.pullRequest?.branch).toBe('acp/session-branch');
    expect(sanitized?.commitSha).toBe('abcdef1234567890');
    expect(sanitized?.commitMessage).toMatch(/…$/);
    expect((sanitized?.commitMessage ?? '').length).toBeLessThanOrEqual(160);
    expect(sanitized?.diagnostics?.logCount).toBe(2);
    expect(sanitized?.diagnostics).toMatchObject({
      durationMs: 1234,
      attempts: 2,
    });
  });

  it('records sanitized automation result via durable object', async () => {
    let recordedBody: SessionDurableRecord | undefined;

    const fetchMock = vi.fn(async (request: Request) => {
      recordedBody = await request.clone().json();
      return new Response('{}', { status: 200 });
    });

    const namespace = {
      idFromName: vi.fn(() => ({
        toString: () => 'stub-id',
      })),
      get: vi.fn(() => ({ fetch: fetchMock })),
    } as any;

    const env = {
      ACP_SESSION: namespace,
    } as unknown as Env;

    const sessionResult: ACPSessionPromptResult = {
      stopReason: 'completed',
      usage: { inputTokens: 12, outputTokens: 34 },
      githubAutomation: baseAutomation,
      meta: {
        githubAutomationVersion: '1.0.0',
        workspace: {
          sessionId: 'session-123',
          path: '/tmp/workspace',
          isEphemeral: true,
        },
      },
    };

    await handleSessionPromptSideEffects({
      env,
      sessionId: 'session-123',
      result: sessionResult,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recordedBody).toBeDefined();
    expect(recordedBody?.sessionId).toBe('session-123');
    expect(recordedBody?.githubAutomation?.diagnostics?.logCount).toBe(2);
    expect(recordedBody?.githubAutomationVersion).toBe('1.0.0');
    expect(
      'logs' in (recordedBody?.githubAutomation?.diagnostics ?? {}),
    ).toBe(false);
  });
});

type SessionDurableRecord = {
  sessionId: string;
  githubAutomationVersion?: string;
  githubAutomation?: {
    diagnostics?: {
      logCount?: number;
    };
  };
};
