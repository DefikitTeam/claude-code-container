import { IUserRepository } from '../../interfaces/repositories/user.repository';
import { ICryptoService } from '../../interfaces/services/crypto.service';
import { NotFoundError } from '../../../shared/errors/not-found.error';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface UpdateUserDto {
  userId: string;
  anthropicApiKey?: string;
  repositoryAccess?: string[];
}

export interface UpdateUserResult {
  userId: string;
  updated: number;
  message: string;
}

/**
 * Update User Use Case
 * Updates user API key and/or repository access
 */
export class UpdateUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly cryptoService: ICryptoService,
  ) {}

  async execute(dto: UpdateUserDto): Promise<UpdateUserResult> {
    if (!dto.userId) {
      throw new ValidationError('userId is required');
    }

    // Fetch current user
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw NotFoundError.user(dto.userId);
    }

    let updatedUser = user;

    // Update API key if provided
    if (dto.anthropicApiKey) {
      updatedUser = updatedUser.updateApiKey(dto.anthropicApiKey);
    }

    // Update repository access if provided
    if (dto.repositoryAccess && dto.repositoryAccess.length > 0) {
      updatedUser = updatedUser.updateRepositoryAccess(dto.repositoryAccess);
    }

    // Save updated user
    await this.userRepository.save(updatedUser);

    return {
      userId: updatedUser.userId,
      updated: updatedUser.updated,
      message: 'User updated successfully',
    };
  }
}
