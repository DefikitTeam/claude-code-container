import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAutomationService } from '../src/infrastructure/github/github-automation.service.js';
import type { GitService } from '../src/services/git/git-service.js';
import type { Octokit } from '@octokit/rest';

function createGitServiceMock(overrides: Partial<GitService> = {}): GitService {
  const runGit = vi.fn(async (_path: string, args: string[]) => {
    const key = args.join(' ');
    if (key === 'status --porcelain') {
      return { stdout: ' M README.md\n', stderr: '', code: 0 };
    }
    if (key === 'diff --cached --name-only') {
      return { stdout: 'README.md\n', stderr: '', code: 0 };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { stdout: 'deadbeefdeadbeef\n', stderr: '', code: 0 };
    }
    if (args[0] === 'remote' && args[1] === 'get-url') {
      return {
        stdout: 'https://github.com/org/repo.git\n',
        stderr: '',
        code: 0,
      };
    }
    if (args[0] === 'ls-remote') {
      return {
        stdout: 'deadbeefdeadbeef\trefs/heads/branch\n',
        stderr: '',
        code: 0,
      };
    }
    return { stdout: '', stderr: '', code: 0 };
  });

  const gitService: Partial<GitService> = {
    ensureRepo: vi.fn(async () => {}),
    runGit,
    createBranch: vi.fn(async () => {}),
    checkoutBranch: vi.fn(async () => {}),
    hasUncommittedChanges: vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true),
  };

  return { ...gitService, ...overrides } as GitService;
}

function createOctokitMock() {
  const issuesCreate = vi.fn(async () => ({
    data: {
      id: 123,
      number: 42,
      html_url: 'https://github.com/org/repo/issues/42',
      title: 'Automated change request',
    },
  }));
  const issuesComment = vi.fn(async () => ({}));
  const pullsCreate = vi.fn(async () => ({
    data: {
      number: 77,
      html_url: 'https://github.com/org/repo/pull/77',
      draft: false,
    },
  }));

  const octokit = {
    rest: {
      issues: {
        create: issuesCreate,
        createComment: issuesComment,
      },
      pulls: {
        create: pullsCreate,
      },
    },
  } as unknown as Octokit;

  return { octokit, issuesCreate, issuesComment, pullsCreate };
}

describe('GitHubAutomationService', () => {
  let gitService: GitService;
  let octokitMock: ReturnType<typeof createOctokitMock>;
  let service: GitHubAutomationService;
  const now = new Date('2025-09-25T12:34:56Z');

  beforeEach(() => {
    gitService = createGitServiceMock();
    octokitMock = createOctokitMock();
    service = new GitHubAutomationService({
      gitService,
      octokitFactory: () => octokitMock.octokit,
      now: () => new Date(now),
    });
  });

  it('creates issue, commits changes, and opens PR on success', async () => {
    const context = {
      sessionId: 'session-abc',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/org/repo.git',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Update README with new badge.',
      },
      summaryMarkdown: 'Adds automation badge to README.',
    } as const;

    const result = await service.execute(context);

    expect(result.status).toBe('success');
    expect(result.issue?.number).toBe(42);
    expect(result.pullRequest?.number).toBe(77);
    expect(result.branch).toMatch(/claude-code\/issue-42-/);
    expect(result.commit?.sha).toBe('deadbeefdeadbeef');
    expect(octokitMock.issuesCreate).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      title: expect.any(String),
      body: expect.stringContaining('Original Request'),
      labels: ['automated', 'claude-prompt'],
    });
    expect(octokitMock.pullsCreate).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      base: 'main',
      head: result.branch,
      title: expect.any(String),
      body: expect.stringContaining('Fixes #42'),
      draft: false,
    });
    expect(octokitMock.issuesComment).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      issue_number: 42,
      body: expect.stringContaining('Created PR'),
    });
  });

  it('skips when automation disabled by intent', async () => {
    const context = {
      sessionId: 'session-xyz',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Do nothing',
      },
      intent: {
        disabled: true,
        reason: 'Feature flag off',
      },
    } as const;

    const result = await service.execute(context);
    expect(result.status).toBe('skipped');
    expect(result.skippedReason).toBe('Feature flag off');
  });

  it('returns error when git push fails', async () => {
    const failingGit = createGitServiceMock({
      runGit: vi.fn(async (_path: string, args: string[]) => {
        if (args[0] === 'push') {
          return { stdout: '', stderr: 'permission denied', code: 1 };
        }
        if (args[0] === 'status' && args[1] === '--porcelain') {
          return { stdout: ' M README.md\n', stderr: '', code: 0 };
        }
        if (args[0] === 'diff' && args[1] === '--cached') {
          return { stdout: 'README.md\n', stderr: '', code: 0 };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'deadbeefdeadbeef\n', stderr: '', code: 0 };
        }
        if (args[0] === 'remote' && args[1] === 'get-url') {
          return {
            stdout: 'https://github.com/org/repo.git\n',
            stderr: '',
            code: 0,
          };
        }
        return { stdout: '', stderr: '', code: 0 };
      }),
    });

    const failingService = new GitHubAutomationService({
      gitService: failingGit,
      octokitFactory: () => octokitMock.octokit,
      now: () => new Date(now),
    });

    const context = {
      sessionId: 'session-abc',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Update README with new badge.',
      },
    } as const;

    const result = await failingService.execute(context);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('git-push-failed');
  });

  it('derives commit message from prompt body when title is missing', async () => {
    const context = {
      sessionId: 'session-no-title',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Refactor the login component to use hooks.',
      },
      intent: {
        mode: 'commit-only',
      },
      allowEmptyCommit: true,
    } as const;

    const result = await service.execute(context);

    expect(result.commit?.message).toBe(
      'Refactor the login component to use hooks.',
    );
  });

  it('uses summary for commit message when available', async () => {
    const context = {
      sessionId: 'session-summary',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Do some work',
      },
      summaryMarkdown:
        'I have successfully implemented the registration page with new styles.',
      intent: {
        mode: 'commit-only',
      },
      allowEmptyCommit: true,
    } as const;

    const result = await service.execute(context);

    expect(result.commit?.message).toBe(
      'Successfully implemented the registration page with new styles.',
    );
  });

  it('cleans up "I have" prefixes from summary', async () => {
    const context = {
      sessionId: 'session-clean',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Do some work',
      },
      summaryMarkdown: 'I have updated the API endpoints.',
      intent: {
        mode: 'commit-only',
      },
      allowEmptyCommit: true,
    } as const;

    const result = await service.execute(context);

    expect(result.commit?.message).toBe('Updated the API endpoints.');
  });

  it('does not use streaming narration as commit message', async () => {
    const context = {
      sessionId: 'session-narration',
      workspacePath: '/tmp/workspace',
      repository: {
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
      },
      auth: {
        installationToken: 'token123',
      },
      prompt: {
        body: 'Do some work',
      },
      summaryMarkdown:
        "Now I'll improve the UI of the registration page.\n\n- Add gradient background\n- Update RegistrationActivity\n",
      intent: {
        mode: 'commit-only',
      },
      allowEmptyCommit: true,
    } as const;

    const result = await service.execute(context);

    // It should fall back to a meaningful non-narration line.
    expect(result.commit?.message).toBe('Add gradient background');
  });
});
