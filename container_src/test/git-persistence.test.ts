import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import GitService from '../src/services/git/git-service';
import WorkspaceService from '../src/services/workspace/workspace-service';

const tempRoot = path.join(process.cwd(), '.tmp/git-persistence');

async function cleanupTempDir(): Promise<void> {
  try {
    await fs.rm(tempRoot, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

describe('GitService persistence support', () => {
  beforeEach(async () => {
    await cleanupTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir();
    vi.restoreAllMocks();
    delete process.env.DAYTONA_WORKSPACE_ID;
    delete process.env.WORKSPACE_ROOT;
  });

  it('pulls latest when .git exists in persistent mode', async () => {
    const gitService = new GitService();
    const repoPath = path.join(tempRoot, 'persistent-repo');
    await fs.mkdir(path.join(repoPath, '.git'), { recursive: true });

    process.env.DAYTONA_WORKSPACE_ID = 'daytona-ws';

    const runGitMock = vi
      .spyOn(gitService, 'runGit')
      .mockResolvedValue({ stdout: '', stderr: '', code: 0 });

    await gitService.ensureRepo(repoPath, {
      cloneUrl: 'https://github.com/example/repo.git',
      defaultBranch: 'main',
    });

    expect(runGitMock).toHaveBeenCalledWith(repoPath, [
      'pull',
      '--ff-only',
      'origin',
      'main',
    ]);
    expect(runGitMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['clone']),
    );
  });

  it('clones repository when no repo exists in ephemeral mode', async () => {
    const gitService = new GitService();
    const repoPath = path.join(tempRoot, 'ephemeral-repo');

    const runGitMock = vi
      .spyOn(gitService, 'runGit')
      .mockResolvedValue({ stdout: '', stderr: '', code: 0 });

    await gitService.ensureRepo(repoPath, {
      cloneUrl: 'https://github.com/example/repo.git',
      defaultBranch: 'main',
    });

    expect(runGitMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['clone', '--depth', '1']),
    );
  });
});

describe('WorkspaceService persistence detection', () => {
  afterEach(() => {
    delete process.env.DAYTONA_WORKSPACE_ID;
    delete process.env.WORKSPACE_ROOT;
  });

  it('marks workspace as non-ephemeral when DAYTONA_WORKSPACE_ID is set', async () => {
    process.env.DAYTONA_WORKSPACE_ID = 'persistent';
    process.env.WORKSPACE_ROOT = path.join(tempRoot, 'workspace-root');

    const service = new WorkspaceService();
    const desc = await service.prepare({ sessionId: 'persistent-session' });

    expect(desc.isEphemeral).toBe(false);
    expect(desc.path).toBe(process.env.WORKSPACE_ROOT);
  });
});
