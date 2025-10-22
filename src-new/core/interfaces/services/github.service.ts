// TODO: Define IGitHubService interface (25 LOC)
export interface IGitHubService {
  validateInstallation(installationId: string): Promise<boolean>;
  fetchRepositories(installationId: string): Promise<any[]>;
  fetchBranches(repo: string, installationId: string): Promise<any[]>;
  createPullRequest(params: any): Promise<any>;
}
