// TODO: Implement RegisterUserUseCase (120 LOC)
// Dependencies:
// - IUserRepository
// - IGitHubService
// - ICryptoService

import { IUserRepository } from '../../interfaces/repositories/user.repository';
import { IGitHubService } from '../../interfaces/services/github.service';
import { ICryptoService } from '../../interfaces/services/crypto.service';

export interface RegisterUserDto {
  userId: string;
  installationId: string;
  anthropicApiKey: string;
  repositoryAccess?: string[];
}

export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly githubService: IGitHubService,
    private readonly cryptoService: ICryptoService
  ) {}

  async execute(dto: RegisterUserDto): Promise<any> {
    // TODO: Implement
    // 1. Validate installation via IGitHubService
    // 2. Encrypt API key via ICryptoService
    // 3. Create UserEntity
    // 4. Save via IUserRepository
    throw new Error('Not implemented');
  }
}
