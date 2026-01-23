import { Context } from 'hono';
import { SpawnContainerUseCase } from '../../core/use-cases/container/spawn-container.use-case';
import { ProcessPromptUseCase } from '../../core/use-cases/container/process-prompt.use-case';
import { GetLogsUseCase } from '../../core/use-cases/container/get-logs.use-case';
import { TerminateContainerUseCase } from '../../core/use-cases/container/terminate-container.use-case';
import { parseSpawnContainerDTO } from '../dto/spawn-container.dto';
import { parseProcessPromptDTO } from '../dto/process-prompt.dto';
import {
  successResponse,
  createdResponse,
} from '../responses/success.response';
import { errorResponse } from '../responses/error.response';

export class ContainerController {
  constructor(
    private spawnContainerUseCase: SpawnContainerUseCase,
    private processPromptUseCase: ProcessPromptUseCase,
    private getLogsUseCase: GetLogsUseCase,
    private terminateContainerUseCase: TerminateContainerUseCase,
  ) {}

  async spawnContainer(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id')!;
      const userId = c.req.header('x-user-id')!;
      const body = await c.req.json();
      const containerData = parseSpawnContainerDTO(
        body,
        installationId,
        userId,
      );

      const result = await this.spawnContainerUseCase.execute(containerData);

      return createdResponse(c, result);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async processPrompt(c: Context) {
    try {
      const containerId = c.req.param('containerId');
      const body = await c.req.json();
      const promptData = parseProcessPromptDTO(body, containerId);

      const result = await this.processPromptUseCase.execute(promptData);

      return successResponse(c, result, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async getLogs(c: Context) {
    try {
      const containerId = c.req.param('containerId');

      if (!containerId) {
        return errorResponse(c, new Error('Container ID is required'));
      }

      const result = await this.getLogsUseCase.execute({ containerId });

      return successResponse(c, result, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async terminateContainer(c: Context) {
    try {
      const containerId = c.req.param('containerId');

      if (!containerId) {
        return errorResponse(c, new Error('Container ID is required'));
      }

      const result = await this.terminateContainerUseCase.execute({
        containerId,
      });

      return successResponse(c, result, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }
}
