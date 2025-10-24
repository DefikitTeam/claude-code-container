import { IContainerService } from '../../interfaces/services/container.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface TerminateContainerDto {
  containerId: string;
}

export interface TerminateContainerResult {
  containerId: string;
  status: string;
  message: string;
}

/**
 * Terminate Container Use Case
 * Stops and removes a container instance
 */
export class TerminateContainerUseCase {
  constructor(private readonly containerService: IContainerService) {}

  async execute(dto: TerminateContainerDto): Promise<TerminateContainerResult> {
    if (!dto.containerId) {
      throw new ValidationError('containerId is required');
    }

    await this.containerService.terminate(dto.containerId);

    return {
      containerId: dto.containerId,
      status: 'terminated',
      message: 'Container terminated successfully',
    };
  }
}
