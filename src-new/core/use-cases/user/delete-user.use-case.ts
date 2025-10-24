import { IUserRepository } from '../../interfaces/repositories/user.repository';
import { NotFoundError } from '../../../shared/errors/not-found.error';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface DeleteUserDto {
  userId: string;
}

export interface DeleteUserResult {
  userId: string;
  message: string;
}

/**
 * Delete User Use Case
 * Deactivates and removes a user from the system
 */
export class DeleteUserUseCase {
  constructor(private readonly userRepository: IUserRepository) {}

  async execute(dto: DeleteUserDto): Promise<DeleteUserResult> {
    if (!dto.userId) {
      throw new ValidationError('userId is required');
    }

    // Fetch user to verify existence
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundError(`User ${dto.userId} not found`);
    }

    // Delete user
    await this.userRepository.delete(dto.userId);

    return {
      userId: dto.userId,
      message: 'User deleted successfully',
    };
  }
}
