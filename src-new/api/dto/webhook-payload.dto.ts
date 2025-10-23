import { ValidationError } from '../../shared/errors/validation.error';

export interface WebhookPayloadDTO {
  event: string;
  action?: string;
  payload: any;
}

export function parseWebhookPayloadDTO(body: any): WebhookPayloadDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid webhook payload: body must be an object');
  }

  const event = body.event || body['x-github-event'];
  if (!event || typeof event !== 'string') {
    throw new ValidationError('Invalid webhook payload: event is required');
  }

  return {
    event,
    action: body.action,
    payload: body,
  };
}
