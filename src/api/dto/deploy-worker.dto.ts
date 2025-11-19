import { ValidationError } from '../../shared/errors/validation.error';

export interface DeployWorkerDTO {
  version: string;
  configHash: string;
  installationId: string;
  workerCode: string;
}

export function parseDeployWorkerDTO(
  body: any,
  installationId: string,
): DeployWorkerDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError(
      'Invalid deployment data: body must be an object',
    );
  }

  const { version, configHash, workerCode } = body;

  if (!version || typeof version !== 'string') {
    throw new ValidationError('Invalid deployment data: version is required');
  }

  if (!workerCode || typeof workerCode !== 'string') {
    throw new ValidationError(
      'Invalid deployment data: workerCode is required',
    );
  }

  // Generate configHash if not provided
  const hash = configHash || `hash_${Date.now()}`;

  return {
    version,
    configHash: hash,
    installationId,
    workerCode,
  };
}
