import { IUserRepository } from '../../interfaces/repositories/user.repository';
import { UserEntity } from '../../entities/user.entity';
import { NotFoundError } from '../../../shared/errors/not-found.error';

export interface GetUserDto {
  userId: string;
}

export interface GetUserResult {
  userId: string;
  installationId: string;
  repositoryAccess: string[];
  isActive: boolean;
  created: number;
  updated: number;
  projectLabel?: string | null;
}

/**
 * Get User Use Case
 * Retrieves user details by ID
 */
export class GetUserUseCase {
  constructor(private readonly userRepository: IUserRepository) {}

  async execute(dto: GetUserDto): Promise<GetUserResult> {
    const user = await this.userRepository.findById(dto.userId);
    
    if (!user) {
      throw NotFoundError.user(dto.userId);
    }

    return {
      userId: user.userId,
      installationId: user.installationId,
      repositoryAccess: user.repositoryAccess,
      isActive: user.isActive,
      created: user.created,
      updated: user.updated,
      projectLabel: user.projectLabel,
    };
  }
}
