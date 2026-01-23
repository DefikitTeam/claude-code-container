import { ValidationError } from '../../shared/errors/validation.error';

export interface WebhookPayloadDTO {
  event: string;
  action?: string;
  payload: unknown;
}

export function parseWebhookPayloadDTO(body: unknown): WebhookPayloadDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError(
      'Invalid webhook payload: body must be an object',
    );
  }

  const b = body as Record<string, unknown>;
  const event = b.event || b['x-github-event'];
  if (!event || typeof event !== 'string') {
    throw new ValidationError('Invalid webhook payload: event is required');
  }

  return {
    event,
    action: b.action as string | undefined,
    payload: b,
  };
}
