import { ValidationError } from '../../shared/errors/validation.error';

export interface ContainerConfigProps {
  configId: string;
  installationId: string;
  containerImage: string;
  environmentVariables: Record<string, string>;
  resourceLimits: {
    cpuMillis: number;
    memoryMb: number;
    timeoutSeconds: number;
  };
  created: number;
  updated: number;
  isActive: boolean;
}

/**
 * Container Config Entity - Represents container execution configuration
 * Defines resource limits, environment, and image specifications
 */
export class ContainerConfigEntity {
  private props: ContainerConfigProps;

  constructor(props: ContainerConfigProps) {
    this.validate(props);
    this.props = props;
  }

  private validate(props: ContainerConfigProps): void {
    if (!props.configId || typeof props.configId !== 'string') {
      throw new ValidationError('configId must be a non-empty string');
    }

    if (!props.installationId || typeof props.installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    if (!props.containerImage || typeof props.containerImage !== 'string') {
      throw new ValidationError('containerImage must be a non-empty string');
    }

    if (
      !props.environmentVariables ||
      typeof props.environmentVariables !== 'object'
    ) {
      throw new ValidationError('environmentVariables must be an object');
    }

    if (!props.resourceLimits || typeof props.resourceLimits !== 'object') {
      throw new ValidationError('resourceLimits must be an object');
    }

    const { cpuMillis, memoryMb, timeoutSeconds } = props.resourceLimits;
    if (typeof cpuMillis !== 'number' || cpuMillis <= 0) {
      throw new ValidationError('cpuMillis must be a positive number');
    }
    if (typeof memoryMb !== 'number' || memoryMb <= 0) {
      throw new ValidationError('memoryMb must be a positive number');
    }
    if (typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0) {
      throw new ValidationError('timeoutSeconds must be a positive number');
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
  get configId(): string {
    return this.props.configId;
  }
  get installationId(): string {
    return this.props.installationId;
  }
  get containerImage(): string {
    return this.props.containerImage;
  }
  get environmentVariables(): Record<string, string> {
    return { ...this.props.environmentVariables };
  }
  get resourceLimits() {
    return { ...this.props.resourceLimits };
  }
  get created(): number {
    return this.props.created;
  }
  get updated(): number {
    return this.props.updated;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }

  /**
   * Create a new container config
   */
  static create(
    configId: string,
    installationId: string,
    containerImage: string,
    environmentVariables: Record<string, string>,
    resourceLimits: {
      cpuMillis: number;
      memoryMb: number;
      timeoutSeconds: number;
    },
  ): ContainerConfigEntity {
    const now = Date.now();
    return new ContainerConfigEntity({
      configId,
      installationId,
      containerImage,
      environmentVariables,
      resourceLimits,
      created: now,
      updated: now,
      isActive: true,
    });
  }

  /**
   * Update environment variables
   */
  updateEnvironmentVariables(
    vars: Record<string, string>,
  ): ContainerConfigEntity {
    if (!vars || typeof vars !== 'object') {
      throw new ValidationError('vars must be an object');
    }
    return new ContainerConfigEntity({
      ...this.props,
      environmentVariables: vars,
      updated: Date.now(),
    });
  }

  /**
   * Update resource limits
   */
  updateResourceLimits(limits: {
    cpuMillis?: number;
    memoryMb?: number;
    timeoutSeconds?: number;
  }): ContainerConfigEntity {
    return new ContainerConfigEntity({
      ...this.props,
      resourceLimits: {
        cpuMillis: limits.cpuMillis ?? this.props.resourceLimits.cpuMillis,
        memoryMb: limits.memoryMb ?? this.props.resourceLimits.memoryMb,
        timeoutSeconds:
          limits.timeoutSeconds ?? this.props.resourceLimits.timeoutSeconds,
      },
      updated: Date.now(),
    });
  }

  /**
   * Deactivate configuration
   */
  deactivate(): ContainerConfigEntity {
    return new ContainerConfigEntity({
      ...this.props,
      isActive: false,
      updated: Date.now(),
    });
  }

  /**
   * Get props for storage/serialization
   */
  getProps(): ContainerConfigProps {
    return { ...this.props };
  }
}
