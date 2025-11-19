import { IContainerService } from '../../interfaces/services/container.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface SpawnContainerDto {
  configId: string;
  installationId: string;
  userId: string;
  containerImage: string;
  environmentVariables: Record<string, string>;
  resourceLimits: {
    cpuMillis: number;
    memoryMb: number;
    timeoutSeconds: number;
  };
}

export interface SpawnContainerResult {
  containerId: string;
  status: string;
}

/**
 * Spawn Container Use Case
 * Creates and starts a new container instance
 */
export class SpawnContainerUseCase {
  constructor(private readonly containerService: IContainerService) {}

  async execute(dto: SpawnContainerDto): Promise<SpawnContainerResult> {
    if (!dto.configId || !dto.installationId || !dto.userId) {
      throw new ValidationError(
        'configId, installationId, and userId are required',
      );
    }

    const result = await this.containerService.spawn(dto);

    return {
      containerId: result.containerId,
      status: 'running',
    };
  }
}
