/**
 * GitHub Service Interface
 * Defines contract for GitHub API operations
 */

export interface IGitHubService {
  /**
   * Validate GitHub App installation is active
   */
  validateInstallation(installationId: string): Promise<boolean>;

  /**
   * Fetch all repositories accessible by installation
   */
  fetchRepositories(installationId: string): Promise<
    Array<{
      id: number;
      name: string;
      fullName: string;
      url: string;
    }>
  >;

  /**
   * Fetch branches for a repository
   */
  fetchBranches(
    owner: string,
    repo: string,
    installationId: string,
  ): Promise<
    Array<{
      name: string;
      commit: { sha: string };
    }>
  >;

  /**
   * Create a branch from a base branch
   */
  createBranch(params: {
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
  }>;

  /**
   * Create a pull request
   */
  createPullRequest(params: {
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
  }>;

  /**
   * Create a GitHub issue
   */
  createIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    installationId: string;
  }): Promise<{
    number: number;
    url: string;
  }>;

  /**
   * Add comment to issue/PR
   */
  addComment(params: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
    installationId: string;
  }): Promise<{ id: number; url: string }>;
}
