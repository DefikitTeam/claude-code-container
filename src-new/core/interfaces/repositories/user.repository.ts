/**
 * User Repository Interface
 * Defines contract for user persistence
 */

import { UserEntity } from '../../entities/user.entity';

export interface IUserRepository {
  /**
   * Save or update a user
   */
  save(user: UserEntity): Promise<void>;

  /**
   * Find a user by ID
   */
  findById(userId: string): Promise<UserEntity | null>;

  /**
   * Find all users for an installation
   */
  findByInstallationId(installationId: string): Promise<UserEntity[]>;

  /**
   * Delete a user
   */
  delete(userId: string): Promise<void>;

  /**
   * List all active users for an installation
   */
  listByInstallation(installationId: string): Promise<UserEntity[]>;
}
