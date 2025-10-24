import { UserEntity } from '../../core/entities/user.entity';
import { IUserRepository } from '../../core/interfaces/repositories/user.repository';

export class InMemoryUserRepository implements IUserRepository {
  private readonly users = new Map<string, UserEntity>();

  async save(user: UserEntity): Promise<void> {
    this.users.set(user.userId, user);
  }

  async findById(userId: string): Promise<UserEntity | null> {
    return this.users.get(userId) ?? null;
  }

  async findByInstallationId(installationId: string): Promise<UserEntity[]> {
    return Array.from(this.users.values()).filter((user) => user.installationId === installationId);
  }

  async delete(userId: string): Promise<void> {
    this.users.delete(userId);
  }

  async listByInstallation(installationId: string): Promise<UserEntity[]> {
    return (await this.findByInstallationId(installationId)).filter((user) => user.isActive);
  }
}
