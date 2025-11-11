import { IContainerService } from '../../interfaces/services/container.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface GetLogsDto {
  containerId: string;
}

export interface GetLogsResult {
  logs: string[];
  count: number;
}

/**
 * Get Logs Use Case
 * Retrieves container execution logs
 */
export class GetLogsUseCase {
  constructor(private readonly containerService: IContainerService) {}

  async execute(dto: GetLogsDto): Promise<GetLogsResult> {
    if (!dto.containerId) {
      throw new ValidationError('containerId is required');
    }

    const logs = await this.containerService.getLogs(dto.containerId);

    return {
      logs,
      count: logs.length,
    };
  }
}
