import { ValidationError } from '../../shared/errors/validation.error';

export interface ProcessPromptDTO {
  containerId: string;
  prompt: string;
  context?: Record<string, unknown>;
}

export function parseProcessPromptDTO(
  body: unknown,
  containerId: string,
): ProcessPromptDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid prompt data: body must be an object');
  }

  const { prompt, context } = body as Record<string, unknown>;

  if (!prompt || typeof prompt !== 'string') {
    throw new ValidationError('Invalid prompt data: prompt is required');
  }

  return {
    containerId,
    prompt: prompt as string,
    context: context as Record<string, unknown>,
  };
}
