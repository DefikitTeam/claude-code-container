import { IGitHubService } from '../../interfaces/services/github.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface FetchBranchesDto {
  owner: string;
  repo: string;
  installationId: string;
}

export interface FetchBranchesResult {
  branches: Array<{ name: string; commit: { sha: string } }>;
  count: number;
}

/**
 * Fetch Branches Use Case
 * Retrieves branches for a repository
 */
export class FetchBranchesUseCase {
  constructor(private readonly githubService: IGitHubService) {}

  async execute(dto: FetchBranchesDto): Promise<FetchBranchesResult> {
    if (!dto.owner || !dto.repo || !dto.installationId) {
      throw new ValidationError('owner, repo, and installationId are required');
    }

    const branches = await this.githubService.fetchBranches(
      dto.owner,
      dto.repo,
      dto.installationId,
    );

    return {
      branches,
      count: branches.length,
    };
  }
}
