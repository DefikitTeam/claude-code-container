import { ValidationError } from '../../shared/errors/validation.error';

export interface SpawnContainerDTO {
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

export function parseSpawnContainerDTO(
  body: any,
  installationId: string,
  userId: string,
): SpawnContainerDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid container data: body must be an object');
  }

  const { configId, containerImage, environmentVariables, resourceLimits } =
    body;

  if (!configId || typeof configId !== 'string') {
    throw new ValidationError('Invalid container data: configId is required');
  }

  if (!containerImage || typeof containerImage !== 'string') {
    throw new ValidationError(
      'Invalid container data: containerImage is required',
    );
  }

  return {
    configId,
    installationId,
    userId,
    containerImage,
    environmentVariables: environmentVariables || {},
    resourceLimits: resourceLimits || {
      cpuMillis: 1000,
      memoryMb: 512,
      timeoutSeconds: 900,
    },
  };
}
