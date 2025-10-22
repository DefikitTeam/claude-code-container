import { ValidationError } from '../../shared/errors/validation.error';

export type DeploymentStatus = 'pending' | 'in-progress' | 'success' | 'failed' | 'rolled-back';

export interface DeploymentProps {
  deploymentId: string;
  installationId: string;
  version: string;
  status: DeploymentStatus;
  configHash: string;
  previousVersion?: string;
  created: number;
  updated: number;
  deployedAt?: number;
  failureReason?: string;
}

/**
 * Deployment Entity - Represents a worker deployment
 * Tracks deployment history and status
 */
export class DeploymentEntity {
  private props: DeploymentProps;

  constructor(props: DeploymentProps) {
    this.validate(props);
    this.props = props;
  }

  private validate(props: DeploymentProps): void {
    if (!props.deploymentId || typeof props.deploymentId !== 'string') {
      throw new ValidationError('deploymentId must be a non-empty string');
    }

    if (!props.installationId || typeof props.installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    if (!props.version || typeof props.version !== 'string') {
      throw new ValidationError('version must be a non-empty string');
    }

    const validStatuses: DeploymentStatus[] = ['pending', 'in-progress', 'success', 'failed', 'rolled-back'];
    if (!validStatuses.includes(props.status)) {
      throw new ValidationError('status must be one of: pending, in-progress, success, failed, rolled-back');
    }

    if (!props.configHash || typeof props.configHash !== 'string') {
      throw new ValidationError('configHash must be a non-empty string');
    }

    if (typeof props.created !== 'number' || props.created <= 0) {
      throw new ValidationError('created must be a positive number');
    }

    if (typeof props.updated !== 'number' || props.updated <= 0) {
      throw new ValidationError('updated must be a positive number');
    }
  }

  // Getters
  get deploymentId(): string { return this.props.deploymentId; }
  get installationId(): string { return this.props.installationId; }
  get version(): string { return this.props.version; }
  get status(): DeploymentStatus { return this.props.status; }
  get configHash(): string { return this.props.configHash; }
  get previousVersion(): string | undefined { return this.props.previousVersion; }
  get created(): number { return this.props.created; }
  get updated(): number { return this.props.updated; }
  get deployedAt(): number | undefined { return this.props.deployedAt; }
  get failureReason(): string | undefined { return this.props.failureReason; }

  /**
   * Create a new deployment
   */
  static create(
    deploymentId: string,
    installationId: string,
    version: string,
    configHash: string,
    previousVersion?: string
  ): DeploymentEntity {
    const now = Date.now();
    return new DeploymentEntity({
      deploymentId,
      installationId,
      version,
      status: 'pending',
      configHash,
      previousVersion,
      created: now,
      updated: now,
    });
  }

  /**
   * Mark deployment as in-progress
   */
  markInProgress(): DeploymentEntity {
    return new DeploymentEntity({
      ...this.props,
      status: 'in-progress',
      updated: Date.now(),
    });
  }

  /**
   * Mark deployment as successful
   */
  markSuccess(): DeploymentEntity {
    return new DeploymentEntity({
      ...this.props,
      status: 'success',
      deployedAt: Date.now(),
      updated: Date.now(),
    });
  }

  /**
   * Mark deployment as failed
   */
  markFailed(reason: string): DeploymentEntity {
    return new DeploymentEntity({
      ...this.props,
      status: 'failed',
      failureReason: reason,
      updated: Date.now(),
    });
  }

  /**
   * Mark deployment as rolled back
   */
  markRolledBack(): DeploymentEntity {
    return new DeploymentEntity({
      ...this.props,
      status: 'rolled-back',
      updated: Date.now(),
    });
  }

  /**
   * Check if deployment is complete
   */
  isComplete(): boolean {
    return this.props.status === 'success' || this.props.status === 'failed' || this.props.status === 'rolled-back';
  }

  /**
   * Get props for storage/serialization
   */
  getProps(): DeploymentProps {
    return { ...this.props };
  }
}
