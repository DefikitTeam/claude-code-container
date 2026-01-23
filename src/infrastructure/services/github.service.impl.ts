/**
 * GitHub Service Implementation
 * Provides GitHub API operations (repositories, branches, PR creation, etc.)
 *
 * Implements: IGitHubService
 *
 * IMPORTANT: This service NO LONGER requires GitHub App credentials.
 * It uses TokenService which calls an external provider (e.g., LumiLink) to get tokens.
 */

import { IGitHubService } from '../../core/interfaces/services/github.service';
import { ITokenService } from '../../core/interfaces/services/token.service';
import { ValidationError } from '../../shared/errors/validation.error';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error';

/**
 * GitHub API client configuration
 */
interface GitHubConfig {
  apiBaseUrl?: string;
  apiVersion?: string;
  timeout?: number;
}

/**
 * GitHub Service Implementation
 * Handles all GitHub API interactions using installation tokens
 */
export class GitHubServiceImpl implements IGitHubService {
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly timeout: number;

  constructor(
    private tokenService: ITokenService,
    config: GitHubConfig = {},
  ) {
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.github.com';
    this.apiVersion = config.apiVersion || '2022-11-28';
    this.timeout = config.timeout || 30000;
  }

  /**
   * Validate GitHub App installation is active
   * @param installationId - GitHub installation ID
   * @returns True if installation is valid and accessible
   */
  async validateInstallation(installationId: string): Promise<boolean> {
    try {
      if (!installationId || typeof installationId !== 'string') {
        throw new ValidationError('installationId must be a non-empty string');
      }

      // Get installation token - if this succeeds, the installation is valid
      const { token } =
        await this.tokenService.getInstallationToken(installationId);

      // Verify the token works by calling an installation-level endpoint
      // Note: /app/installations/{id} requires JWT auth, not installation token
      // So we use /installation/repositories which works with installation tokens
      const response = await this.githubRequest(
        'GET',
        '/installation/repositories',
        token,
      );

      console.log(
        `[GitHub] Installation ${installationId} validation: ${response.status} ${response.statusText}`,
      );
      return (
        response.ok && (response.status === 200 || response.status === 304)
      );
    } catch (error) {
      console.error(
        `[GitHub] Installation validation failed for ${installationId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Fetch all repositories accessible by installation
   * @param installationId - GitHub installation ID
   * @returns Array of repository information
   */
  async fetchRepositories(installationId: string): Promise<
    Array<{
      id: number;
      name: string;
      fullName: string;
      url: string;
    }>
  > {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    try {
      const { token } =
        await this.tokenService.getInstallationToken(installationId);
      const response = await this.githubRequest(
        'GET',
        '/installation/repositories',
        token,
      );

      if (!response.ok) {
        throw new UnauthorizedError('Failed to fetch repositories from GitHub');
      }

      const data = (await response.json()) as { repositories: Record<string, unknown>[] };
      return (data.repositories || []).map((repo) => ({
        id: repo.id as number,
        name: repo.name as string,
        fullName: repo.full_name as string,
        url: repo.html_url as string,
      }));
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new Error(
        `Failed to fetch repositories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Fetch branches for a repository
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param installationId - GitHub installation ID
   * @returns Array of branch information
   */
  async fetchBranches(
    owner: string,
    repo: string,
    installationId: string,
  ): Promise<
    Array<{
      name: string;
      commit: { sha: string };
    }>
  > {
    if (!owner || !repo || !installationId) {
      throw new ValidationError(
        'owner, repo, and installationId must be provided',
      );
    }

    try {
      const { token } =
        await this.tokenService.getInstallationToken(installationId);
      const response = await this.githubRequest(
        'GET',
        `/repos/{owner}/{repo}/branches`,
        token,
        {
          owner,
          repo,
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const branches = (await response.json()) as Record<string, unknown>[];
      return branches.map((branch) => ({
        name: branch.name as string,
        commit: { sha: (branch.commit as { sha: string }).sha },
      }));
    } catch (error) {
      throw new Error(
        `Failed to fetch branches for ${owner}/${repo}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Create a branch from a base branch
   */
  async createBranch(params: {
    owner: string;
    repo: string;
    branchName: string;
    baseBranch: string;
    installationId: string;
  }): Promise<{
    ref: string;
    node_id: string;
    url: string;
    object: {
      sha: string;
      type: string;
      url: string;
    };
  }> {
    const { owner, repo, branchName, baseBranch, installationId } = params;

    if (!owner || !repo || !branchName || !baseBranch || !installationId) {
      throw new ValidationError('All branch creation parameters are required');
    }

    try {
      const { token } =
        await this.tokenService.getInstallationToken(installationId);

      // 1. Get SHA of base branch
      const refResponse = await this.githubRequest(
        'GET',
        `/repos/{owner}/{repo}/git/ref/heads/{baseBranch}`,
        token,
        { owner, repo, baseBranch },
      );

      if (!refResponse.ok) {
        throw new Error(
          `Failed to get base branch '${baseBranch}': ${refResponse.status}`,
        );
      }

      const refData = (await refResponse.json()) as { object: { sha: string } };
      const sha = refData.object.sha;

      // 2. Create new ref
      const createResponse = await this.githubRequest(
        'POST',
        `/repos/{owner}/{repo}/git/refs`,
        token,
        {
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha,
        },
      );

      if (!createResponse.ok) {
        // If 422, it might already exist, which is fine, but we should check content
        const errText = await createResponse.text();
        throw new Error(
          `Failed to create branch: ${createResponse.status} - ${errText}`,
        );
      }

      return (await createResponse.json()) as {
        ref: string;
        node_id: string;
        url: string;
        object: { sha: string; type: string; url: string };
      };
    } catch (error) {
      throw new Error(
        `Failed to create branch ${branchName} in ${owner}/${repo}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Create a pull request
   * @param params - PR creation parameters
   * @returns PR number, URL, and title
   */
  async createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    installationId: string;
  }): Promise<{
    number: number;
    url: string;
    title: string;
  }> {
    const { owner, repo, title, body, head, base, installationId } = params;

    if (!owner || !repo || !title || !head || !base || !installationId) {
      throw new ValidationError(
        'All PR parameters (owner, repo, title, head, base, installationId) are required',
      );
    }

    try {
      const { token } =
        await this.tokenService.getInstallationToken(installationId);
      const response = await this.githubRequest(
        'POST',
        '/repos/{owner}/{repo}/pulls',
        token,
        {
          owner,
          repo,
          title,
          body,
          head,
          base,
        },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as { message?: string };
        throw new Error(
          `GitHub API error: ${errorData.message || response.status}`,
        );
      }

      const pr = (await response.json()) as { number: number; html_url: string; title: string };
      return {
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
      };
    } catch (error) {
      throw new Error(
        `Failed to create PR in ${owner}/${repo}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Create a GitHub issue
   * @param params - Issue creation parameters
   * @returns Issue number and URL
   */
  async createIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    installationId: string;
  }): Promise<{
    number: number;
    url: string;
  }> {
    const { owner, repo, title, body, installationId } = params;

    if (!owner || !repo || !title || !installationId) {
      throw new ValidationError(
        'owner, repo, title, and installationId are required',
      );
    }

    try {
      const { token } =
        await this.tokenService.getInstallationToken(installationId);
      const response = await this.githubRequest(
        'POST',
        '/repos/{owner}/{repo}/issues',
        token,
        {
          owner,
          repo,
          title,
          body,
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const issue = (await response.json()) as { number: number; html_url: string };
      return {
        number: issue.number,
        url: issue.html_url,
      };
    } catch (error) {
      throw new Error(
        `Failed to create issue in ${owner}/${repo}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Add comment to issue/PR
   * @param params - Comment parameters
   * @returns Comment ID and URL
   */
  async addComment(params: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
    installationId: string;
  }): Promise<{ id: number; url: string }> {
    const { owner, repo, issueNumber, body, installationId } = params;

    if (!owner || !repo || !issueNumber || !body || !installationId) {
      throw new ValidationError('All comment parameters are required');
    }

    try {
      const { token } =
        await this.tokenService.getInstallationToken(installationId);
      const response = await this.githubRequest(
        'POST',
        '/repos/{owner}/{repo}/issues/{issueNumber}/comments',
        token,
        {
          owner,
          repo,
          issueNumber,
          body,
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const comment = (await response.json()) as { id: number; html_url: string };
      return {
        id: comment.id,
        url: comment.html_url,
      };
    } catch (error) {
      throw new Error(
        `Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Make a GitHub API request
   * Handles path parameter substitution and common headers
   */
  private async githubRequest(
    method: string,
    path: string,
    token: string,
    params?: Record<string, string | number>,
  ): Promise<Response> {
    // Substitute path parameters
    let url = path;
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(`{${key}}`, String(value));
      }
    }

    const fullUrl = `${this.apiBaseUrl}${url}`;

    // Filter params to get body fields (not URL path params)
    const bodyFields: Record<string, unknown> = {};
    if (params && method === 'POST') {
      const pathKeys =
        path.match(/\{(\w+)\}/g)?.map((k) => k.slice(1, -1)) || [];
      for (const [key, value] of Object.entries(params)) {
        if (!pathKeys.includes(key)) {
          bodyFields[key] = value;
        }
      }
    }

    const requestInit: RequestInit = {
      method,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': this.apiVersion,
        'User-Agent': 'ClaudeCode-Container',
      },
    };

    if (method === 'POST' && Object.keys(bodyFields).length > 0) {
      requestInit.body = JSON.stringify(bodyFields);
      (requestInit.headers as Record<string, string>)['Content-Type'] =
        'application/json';
    }

    try {
      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(fullUrl, {
        ...requestInit,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      throw new Error(
        `GitHub API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
