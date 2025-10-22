// TODO: Define IUserRepository interface (20 LOC)
import { UserEntity } from '../../entities/user.entity';

export interface IUserRepository {
  save(user: UserEntity): Promise<void>;
  findById(userId: string): Promise<UserEntity | null>;
  findByInstallationId(installationId: string): Promise<UserEntity | null>;
  delete(userId: string): Promise<void>;
}
