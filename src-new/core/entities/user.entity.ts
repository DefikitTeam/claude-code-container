// TODO: Implement UserEntity (80 LOC)
// - Validation logic
// - Business methods (updateApiKey, deactivate, etc.)
// - Getters for properties

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

export class UserEntity {
  private props: UserProps;

  constructor(props: UserProps) {
    this.validate(props);
    this.props = props;
  }

  private validate(props: UserProps): void {
    // TODO: Implement validation
    if (!props.userId) {
      throw new Error('userId is required');
    }
  }

  // TODO: Add getters
  get userId(): string { return this.props.userId; }
  
  // TODO: Add business methods
}
