import { IGitHubService } from '../../interfaces/services/github.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface FetchRepositoriesDto {
  installationId: string;
}

export interface FetchRepositoriesResult {
  repositories: Array<{ id: number; name: string; fullName: string; url: string }>;
  count: number;
}

/**
 * Fetch Repositories Use Case
 * Retrieves accessible repositories for an installation
 */
export class FetchRepositoriesUseCase {
  constructor(private readonly githubService: IGitHubService) {}

  async execute(dto: FetchRepositoriesDto): Promise<FetchRepositoriesResult> {
    if (!dto.installationId) {
      throw new ValidationError('installationId is required');
    }

    const repositories = await this.githubService.fetchRepositories(dto.installationId);

    return {
      repositories,
      count: repositories.length,
    };
  }
}
