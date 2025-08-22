import { Octokit } from '@octokit/rest';

export class ContainerGitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: token, userAgent: 'Claude-Code-Container/1.0.0' });
    this.owner = owner;
    this.repo = repo;

    logWithContext('GITHUB_CLIENT', 'GitHub client initialized', { owner, repo, hasToken: !!token });
  }

  async createComment(issueNumber: number, body: string): Promise<void> {
    try {
      logWithContext('GITHUB_CLIENT', 'Creating comment', { issueNumber, bodyLength: body.length });
      await this.octokit.rest.issues.createComment({ owner: this.owner, repo: this.repo, issue_number: issueNumber, body });
      logWithContext('GITHUB_CLIENT', 'Comment created successfully', { issueNumber });
    } catch (error: any) {
      logWithContext('GITHUB_CLIENT', 'Failed to create comment', { error: error.message, issueNumber });
      throw error;
    }
  }

  async createPullRequest(title: string, body: string, head: string, base = 'main'): Promise<{ number: number; html_url: string }> {
    try {
      logWithContext('GITHUB_CLIENT', 'Creating pull request', { title, head, base, bodyLength: body.length });
      const response = await this.octokit.rest.pulls.create({ owner: this.owner, repo: this.repo, title, body, head, base });
      logWithContext('GITHUB_CLIENT', 'Pull request created successfully', { number: response.data.number, url: response.data.html_url });
      return { number: response.data.number, html_url: response.data.html_url };
    } catch (error: any) {
      logWithContext('GITHUB_CLIENT', 'Failed to create pull request', { error: error.message, title, head, base });
      throw error;
    }
  }

  async getRepository(): Promise<{ default_branch: string }> {
    try {
      const response = await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
      return { default_branch: response.data.default_branch };
    } catch (error: any) {
      logWithContext('GITHUB_CLIENT', 'Failed to get repository info', { error: error.message });
      throw error;
    }
  }

  async pushBranch(_branchName: string): Promise<void> {
    logWithContext('GITHUB_CLIENT', 'Branch push requested', { branchName: _branchName });
  }
}

function logWithContext(context: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${context}] ${message}`;
  if (data) console.log(logMessage, JSON.stringify(data, null, 2)); else console.log(logMessage);
}
