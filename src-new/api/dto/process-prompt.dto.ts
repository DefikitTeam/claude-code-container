import { ValidationError } from '../../shared/errors/validation.error';

export interface ProcessPromptDTO {
  containerId: string;
  prompt: string;
  context?: Record<string, any>;
}

export function parseProcessPromptDTO(body: any, containerId: string): ProcessPromptDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid prompt data: body must be an object');
  }

  const { prompt, context } = body;

  if (!prompt || typeof prompt !== 'string') {
    throw new ValidationError('Invalid prompt data: prompt is required');
  }

  return {
    containerId,
    prompt,
    context,
  };
}
