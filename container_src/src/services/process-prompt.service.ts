/**
 * Process Prompt Service
 * Handles prompt execution with persistent branch commits
 */

import type { GitService } from './git/git-service.js';
import type { IClaudeService } from '../core/interfaces/services/claude.service.js';
import { logWithContext } from '../api/http/utils/logger.js';

export interface ProcessPromptRequest {
  sessionId: string;
  taskId: number;
  prompt: string;
  repository: {
    url: string;
    baseBranch: string;
    workingBranch: string;
  };
  githubToken: string;
  workspacePath?: string;
}

export interface ProcessPromptResult {
  commitSha: string;
  commitUrl: string;
  commitMessage: string;
  filesChanged: Array<{ path: string; status: string }>;
}

export interface ProcessPromptServiceOptions {
  gitService: GitService;
  claudeService: IClaudeService;
  apiKey: string;
  model?: string;
}

export class ProcessPromptService {
  private readonly git: GitService;
  private readonly claude: IClaudeService;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: ProcessPromptServiceOptions) {
    this.git = options.gitService;
    this.claude = options.claudeService;
    this.apiKey = options.apiKey;
    this.model = options.model || 'mistralai/devstral-2512:free';
  }

  async execute(request: ProcessPromptRequest): Promise<ProcessPromptResult> {
    const { sessionId, repository, prompt, githubToken, workspacePath } = request;
    const repoDir = workspacePath || '/workspace/repo';

    logWithContext('PROCESS-PROMPT', `Processing prompt on branch: ${repository.workingBranch}`, {
      sessionId,
      workingBranch: repository.workingBranch,
    });

    try {
      // 1. Clone or ensure repository exists
      await this.ensureRepository(repoDir, repository, githubToken);

      // 2. Configure git identity
      await this.configureGitIdentity(repoDir);

      // 3. Checkout working branch (or create if first time)
      await this.checkoutWorkingBranch(repoDir, repository);

      // 4. Execute prompt with Claude Code SDK
      logWithContext('PROCESS-PROMPT', `Executing prompt`, {
        sessionId,
        promptPreview: prompt.substring(0, 50) + '...',
      });

      await this.claude.runPrompt(prompt, {
        sessionId,
        operationId: `task-${request.taskId}`,
        workspacePath: repoDir,
        apiKey: this.apiKey,
        model: this.model,
      });

      logWithContext('PROCESS-PROMPT', `Execution complete`, { sessionId });

      // 5. Get changed files
      const filesChanged = await this.git.listChangedFiles(repoDir);
      if (filesChanged.length === 0) {
        logWithContext('PROCESS-PROMPT', 'No changes detected, skipping commit', { sessionId });
        throw new Error('No changes detected after prompt execution');
      }

      // 6. Stage all changes
      await this.git.stageFiles(repoDir, ['.']);

      // 7. Generate commit message
      const commitMessage = this.generateCommitMessage(prompt, filesChanged);
      logWithContext('PROCESS-PROMPT', `Commit message generated`, {
        sessionId,
        message: commitMessage.split('\n')[0],
      });

      // 8. Commit changes
      await this.git.commit(repoDir, commitMessage);

      // 9. Get commit SHA
      const commitSha = await this.getCommitSha(repoDir);
      const commitUrl = this.buildCommitUrl(repository.url, commitSha);

      // 10. Get detailed files changed with status
      const filesWithStatus = await this.getFilesChangedWithStatus(repoDir);

      logWithContext('PROCESS-PROMPT', `Committed ${commitSha.substring(0, 7)} with ${filesWithStatus.length} file(s)`, {
        sessionId,
        commitSha,
      });

      // 11. Push to remote
      await this.pushToRemote(repoDir, repository, githubToken);

      logWithContext('PROCESS-PROMPT', `Pushed to remote`, {
        sessionId,
        branch: repository.workingBranch,
      });

      return {
        commitSha,
        commitUrl,
        commitMessage,
        filesChanged: filesWithStatus,
      };
    } catch (error) {
      logWithContext('PROCESS-PROMPT', `Error processing prompt`, {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async ensureRepository(
    repoDir: string,
    repository: ProcessPromptRequest['repository'],
    githubToken: string
  ): Promise<void> {
    const cloneUrl = this.buildAuthenticatedUrl(repository.url, githubToken);

    logWithContext('PROCESS-PROMPT', `Cloning repository`, {
      url: repository.url,
      baseBranch: repository.baseBranch,
    });

    await this.git.ensureRepo(repoDir, {
      cloneUrl,
      defaultBranch: repository.baseBranch,
    });
  }

  private async configureGitIdentity(repoDir: string): Promise<void> {
    await this.git.runGit(repoDir, ['config', 'user.name', 'LumiLink AI']);
    await this.git.runGit(repoDir, ['config', 'user.email', 'ai@lumilink.io']);
  }

  private async checkoutWorkingBranch(
    repoDir: string,
    repository: ProcessPromptRequest['repository']
  ): Promise<void> {
    try {
      // Try to fetch and checkout existing branch
      logWithContext('PROCESS-PROMPT', `Fetching branch ${repository.workingBranch}`);

      const fetchResult = await this.git.runGit(repoDir, [
        'fetch',
        'origin',
        repository.workingBranch,
      ]);

      if (fetchResult.code === 0) {
        await this.git.checkoutBranch(repoDir, repository.workingBranch);
        logWithContext('PROCESS-PROMPT', `Checked out existing branch: ${repository.workingBranch}`);
      } else {
        // Branch doesn't exist on remote, create from base branch
        await this.createWorkingBranch(repoDir, repository);
      }
    } catch (error) {
      // Branch doesn't exist, create from base branch
      await this.createWorkingBranch(repoDir, repository);
    }
  }

  private async createWorkingBranch(
    repoDir: string,
    repository: ProcessPromptRequest['repository']
  ): Promise<void> {
    logWithContext('PROCESS-PROMPT', `Creating new branch ${repository.workingBranch} from ${repository.baseBranch}`);

    // Ensure we're on base branch first
    await this.git.checkoutBranch(repoDir, repository.baseBranch);

    // Create new working branch
    await this.git.createBranch(repoDir, repository.workingBranch, repository.baseBranch);
    await this.git.checkoutBranch(repoDir, repository.workingBranch);

    logWithContext('PROCESS-PROMPT', `Created new branch: ${repository.workingBranch}`);
  }

  private generateCommitMessage(prompt: string, filesChanged: string[]): string {
    // Detect commit type from changes
    const hasTests = filesChanged.some(
      (f) => f.includes('.test.') || f.includes('__tests__')
    );
    const hasStyles = filesChanged.some(
      (f) => f.endsWith('.css') || f.endsWith('.scss') || f.endsWith('.sass')
    );
    const isRefactor = prompt.toLowerCase().includes('refactor');
    const isFix = prompt.toLowerCase().includes('fix') || prompt.toLowerCase().includes('bug');
    const isDocs = filesChanged.some((f) => f.endsWith('.md') || f.includes('docs/'));

    let type = 'feat';
    if (hasTests) type = 'test';
    else if (hasStyles) type = 'style';
    else if (isDocs) type = 'docs';
    else if (isRefactor) type = 'refactor';
    else if (isFix) type = 'fix';

    // Extract scope (optional)
    const scopeMatch = prompt.match(/\b(auth|ui|api|db|admin|user|component|service)\b/i);
    const scope = scopeMatch ? scopeMatch[1].toLowerCase() : null;

    // Generate summary (max 50 chars)
    const summary = prompt
      .toLowerCase()
      .replace(/^(add|create|implement|fix|update|refactor)\s+/i, '')
      .substring(0, 50)
      .trim();

    return `${type}${scope ? `(${scope})` : ''}: ${summary}\n\n${prompt}`;
  }

  private async getCommitSha(repoDir: string): Promise<string> {
    const result = await this.git.runGit(repoDir, ['rev-parse', 'HEAD']);
    if (result.code !== 0) {
      throw new Error(`Failed to get commit SHA: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  private buildCommitUrl(repositoryUrl: string, commitSha: string): string {
    const cleanUrl = repositoryUrl.replace(/\.git$/, '');
    return `${cleanUrl}/commit/${commitSha}`;
  }

  private async getFilesChangedWithStatus(
    repoDir: string
  ): Promise<Array<{ path: string; status: string }>> {
    const result = await this.git.runGit(repoDir, [
      'diff',
      '--name-status',
      'HEAD~1',
      'HEAD',
    ]);

    if (result.code !== 0 || !result.stdout.trim()) {
      return [];
    }

    return result.stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [status, filePath] = line.split('\t');
        return {
          path: filePath,
          status: status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted',
        };
      });
  }

  private async pushToRemote(
    repoDir: string,
    repository: ProcessPromptRequest['repository'],
    githubToken: string
  ): Promise<void> {
    logWithContext('PROCESS-PROMPT', `Pushing to ${repository.workingBranch}`);

    // Set remote URL with authentication
    const authenticatedUrl = this.buildAuthenticatedUrl(repository.url, githubToken);
    await this.git.runGit(repoDir, ['remote', 'set-url', 'origin', authenticatedUrl]);

    // Push with --force-with-lease for safety
    const pushResult = await this.git.runGit(repoDir, [
      'push',
      'origin',
      repository.workingBranch,
      '--force-with-lease',
    ]);

    if (pushResult.code !== 0) {
      throw new Error(`Failed to push to remote: ${pushResult.stderr}`);
    }
  }

  private buildAuthenticatedUrl(url: string, token: string): string {
    // Convert https://github.com/owner/repo to https://x-access-token:TOKEN@github.com/owner/repo
    const cleanUrl = url.replace(/^https:\/\//, '').replace(/\.git$/, '');
    return `https://x-access-token:${token}@${cleanUrl}`;
  }
}
