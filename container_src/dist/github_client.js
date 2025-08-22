import { Octokit } from '@octokit/rest';
export class ContainerGitHubClient {
    constructor(token, owner, repo) {
        this.octokit = new Octokit({ auth: token, userAgent: 'Claude-Code-Container/1.0.0' });
        this.owner = owner;
        this.repo = repo;
        logWithContext('GITHUB_CLIENT', 'GitHub client initialized', { owner, repo, hasToken: !!token });
    }
    async createComment(issueNumber, body) {
        try {
            logWithContext('GITHUB_CLIENT', 'Creating comment', { issueNumber, bodyLength: body.length });
            await this.octokit.rest.issues.createComment({ owner: this.owner, repo: this.repo, issue_number: issueNumber, body });
            logWithContext('GITHUB_CLIENT', 'Comment created successfully', { issueNumber });
        }
        catch (error) {
            logWithContext('GITHUB_CLIENT', 'Failed to create comment', { error: error.message, issueNumber });
            throw error;
        }
    }
    async createPullRequest(title, body, head, base = 'main') {
        try {
            logWithContext('GITHUB_CLIENT', 'Creating pull request', { title, head, base, bodyLength: body.length });
            const response = await this.octokit.rest.pulls.create({ owner: this.owner, repo: this.repo, title, body, head, base });
            logWithContext('GITHUB_CLIENT', 'Pull request created successfully', { number: response.data.number, url: response.data.html_url });
            return { number: response.data.number, html_url: response.data.html_url };
        }
        catch (error) {
            logWithContext('GITHUB_CLIENT', 'Failed to create pull request', { error: error.message, title, head, base });
            throw error;
        }
    }
    async getRepository() {
        try {
            const response = await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
            return { default_branch: response.data.default_branch };
        }
        catch (error) {
            logWithContext('GITHUB_CLIENT', 'Failed to get repository info', { error: error.message });
            throw error;
        }
    }
    async pushBranch(_branchName) {
        logWithContext('GITHUB_CLIENT', 'Branch push requested', { branchName: _branchName });
    }
}
function logWithContext(context, message, data) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${context}] ${message}`;
    if (data)
        console.log(logMessage, JSON.stringify(data, null, 2));
    else
        console.log(logMessage);
}
