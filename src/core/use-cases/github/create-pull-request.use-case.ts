import { IGitHubService } from '../../interfaces/services/github.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface CreatePullRequestDto {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  installationId: string;
}

export interface CreatePullRequestResult {
  number: number;
  url: string;
  title: string;
}

/**
 * Create Pull Request Use Case
 * Creates a pull request in a GitHub repository
 */
export class CreatePullRequestUseCase {
  constructor(private readonly githubService: IGitHubService) {}

  async execute(dto: CreatePullRequestDto): Promise<CreatePullRequestResult> {
    if (!dto.owner || !dto.repo || !dto.title || !dto.head || !dto.base || !dto.installationId) {
      throw new ValidationError('owner, repo, title, head, base, and installationId are required');
    }

    const result = await this.githubService.createPullRequest(dto);

    return {
      number: result.number,
      url: result.url,
      title: result.title,
    };
  }
}
