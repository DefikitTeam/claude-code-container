import { ValidationError } from '../../shared/errors/validation.error';

export interface UserProps {
  userId: string;
  installationId: string;
  anthropicApiKey: string;
  repositoryAccess: string[];
  isActive: boolean;
  created: number;
  updated: number;
  projectLabel?: string | null;
}

/**
 * User Entity - Represents a registered user with GitHub installation context
 * Enforces invariants: userId and installationId are immutable
 */
export class UserEntity {
  private props: UserProps;

  constructor(props: UserProps) {
    this.validate(props);
    this.props = props;
  }

  private validate(props: UserProps): void {
    if (!props.userId || typeof props.userId !== 'string') {
      throw new ValidationError('userId must be a non-empty string');
    }

    if (!props.installationId || typeof props.installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    if (!props.anthropicApiKey || typeof props.anthropicApiKey !== 'string') {
      throw new ValidationError('anthropicApiKey must be a non-empty string');
    }

    if (!Array.isArray(props.repositoryAccess) || props.repositoryAccess.length === 0) {
      throw new ValidationError('repositoryAccess must be a non-empty array');
    }

    if (typeof props.created !== 'number' || props.created <= 0) {
      throw new ValidationError('created must be a positive number');
    }

    if (typeof props.updated !== 'number' || props.updated <= 0) {
      throw new ValidationError('updated must be a positive number');
    }

    if (typeof props.isActive !== 'boolean') {
      throw new ValidationError('isActive must be a boolean');
    }
  }

  // Getters
  get userId(): string { return this.props.userId; }
  get installationId(): string { return this.props.installationId; }
  get anthropicApiKey(): string { return this.props.anthropicApiKey; }
  get repositoryAccess(): string[] { return this.props.repositoryAccess; }
  get isActive(): boolean { return this.props.isActive; }
  get created(): number { return this.props.created; }
  get updated(): number { return this.props.updated; }
  get projectLabel(): string | null | undefined { return this.props.projectLabel; }

  /**
   * Create a new user
   */
  static create(userId: string, installationId: string, anthropicApiKey: string, repositoryAccess: string[], projectLabel?: string | null): UserEntity {
    const now = Date.now();
    return new UserEntity({
      userId,
      installationId,
      anthropicApiKey,
      repositoryAccess,
      created: now,
      updated: now,
      isActive: true,
      projectLabel,
    });
  }

  /**
   * Update user API key
   */
  updateApiKey(newApiKey: string): UserEntity {
    if (!newApiKey || typeof newApiKey !== 'string') {
      throw new ValidationError('newApiKey must be a non-empty string');
    }
    return new UserEntity({
      ...this.props,
      anthropicApiKey: newApiKey,
      updated: Date.now(),
    });
  }

  /**
   * Update repository access
   */
  updateRepositoryAccess(repos: string[]): UserEntity {
    if (!Array.isArray(repos) || repos.length === 0) {
      throw new ValidationError('repos must be a non-empty array');
    }
    return new UserEntity({
      ...this.props,
      repositoryAccess: repos,
      updated: Date.now(),
    });
  }

  /**
   * Deactivate user
   */
  deactivate(): UserEntity {
    return new UserEntity({
      ...this.props,
      isActive: false,
      updated: Date.now(),
    });
  }

  /**
   * Check if user has access to a repository
   */
  hasAccessTo(repo: string): boolean {
    return this.props.repositoryAccess.includes('*') || this.props.repositoryAccess.includes(repo);
  }

  /**
   * Get props for storage/serialization
   */
  getProps(): UserProps {
    return { ...this.props };
  }
}
