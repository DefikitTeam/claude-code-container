import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerErrorMiddleware } from '../../api/middleware/error.middleware';
import { ValidationError } from '../../shared/errors/validation.error';
import { BaseError } from '../../shared/errors/base.error';

function buildApp() {
  const app = new Hono();
  registerErrorMiddleware(app);

  app.get('/validation', () => {
    throw new ValidationError('missing header');
  });

  app.get('/custom', () => {
    throw new BaseError('custom failure', 'CUSTOM_FAILURE', 422);
  });

  app.get('/generic', () => {
    throw new Error('unexpected');
  });

  return app;
}

describe('API: Error middleware', () => {
  it('serializes validation errors with 400 status', async () => {
    const app = buildApp();
    const response = await app.request('/validation');
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toContain('missing header');
  });

  it('respects BaseError metadata such as status and code', async () => {
    const app = buildApp();
    const response = await app.request('/custom');
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error.code).toBe('CUSTOM_FAILURE');
  });

  it('wraps unknown errors into internal error payload', async () => {
    const app = buildApp();
    const response = await app.request('/generic');
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns structured not found response for missing routes', async () => {
    const app = buildApp();
    const response = await app.request('/missing');
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe('NOT_FOUND');
  });
});
