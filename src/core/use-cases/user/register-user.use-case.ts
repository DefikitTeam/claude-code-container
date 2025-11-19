import { IUserRepository } from '../../interfaces/repositories/user.repository';
import { IGitHubService } from '../../interfaces/services/github.service';
import { ICryptoService } from '../../interfaces/services/crypto.service';
import { UserEntity } from '../../entities/user.entity';
import { ValidationError } from '../../../shared/errors/validation.error';
import { NotFoundError } from '../../../shared/errors/not-found.error';

export interface RegisterUserDto {
  userId: string;
  installationId: string;
  anthropicApiKey?: string; // Optional - worker uses its own OPENROUTER_API_KEY
  repositoryAccess?: string[];
  projectLabel?: string;
}

export interface RegisterUserResult {
  userId: string;
  installationId: string;
  projectLabel?: string | null;
  created: number;
}

/**
 * Register User Use Case
 * Creates a new user for a GitHub installation
 *
 * Flow:
 * 1. Validate GitHub installation is active
 * 2. Determine repository access (user-provided or fetch from GitHub)
 * 3. Encrypt API key
 * 4. Create and save UserEntity
 */
export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly githubService: IGitHubService,
    private readonly cryptoService: ICryptoService,
  ) {}

  async execute(dto: RegisterUserDto): Promise<RegisterUserResult> {
    if (!dto.userId || !dto.installationId) {
      throw new ValidationError('userId and installationId are required');
    }

    // TODO: Enable GitHub validation when installation tokens are properly configured
    // const isValidInstallation = await this.githubService.validateInstallation(dto.installationId);
    // if (!isValidInstallation) {
    //   throw new NotFoundError('Installation', dto.installationId, 'GitHub installation not found or inactive');
    // }

    let repositoryAccess = dto.repositoryAccess || [];

    // TODO: Fetch repositories from GitHub when token management is enabled
    // if (repositoryAccess.length === 0) {
    //   const repos = await this.githubService.fetchRepositories(dto.installationId);
    //   repositoryAccess = repos.map(r => r.fullName);
    // }

    // Use placeholder API key - worker will use its own OPENROUTER_API_KEY from environment
    const apiKey = dto.anthropicApiKey || 'WORKER_MANAGED';

    const user = UserEntity.create(
      dto.userId,
      dto.installationId,
      apiKey,
      repositoryAccess,
      dto.projectLabel,
    );

    await this.userRepository.save(user);

    return {
      userId: user.userId,
      installationId: user.installationId,
      projectLabel: user.projectLabel,
      created: user.created,
    };
  }
}
