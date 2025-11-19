/**
 * ACP Routes
 * Agent Communication Protocol endpoints
 */

import { Hono } from 'hono';
import { ACPController } from '../controllers/acp.controller';
import { requireJsonBody } from '../middleware/validation.middleware';

export function createACPRoutes(controller: ACPController): Hono {
  const router = new Hono();

  // ACP v0.3.1 method endpoints - all route to enhanced container handlers

  // POST /initialize - Initialize method
  router.post('/initialize', requireJsonBody(), (c) =>
    controller.initialize(c),
  );

  // POST /session/new - Create new session
  router.post('/session/new', requireJsonBody(), (c) =>
    controller.sessionNew(c),
  );

  // POST /session/prompt - Send prompt to session
  router.post('/session/prompt', requireJsonBody(), (c) =>
    controller.sessionPrompt(c),
  );

  // GET /job/:jobId - Get async job status
  router.get('/job/:jobId', (c) => controller.getJobStatus(c));

  // POST /session/load - Load existing session
  router.post('/session/load', requireJsonBody(), (c) =>
    controller.sessionLoad(c),
  );

  // POST /cancel - Cancel operation
  router.post('/cancel', requireJsonBody(), (c) => controller.cancel(c));

  // POST /:method - Generic ACP method handler (catch-all for any other ACP methods)
  router.post('/:method', requireJsonBody(), (c) => controller.handleMethod(c));

  // POST /task/execute - Backward compatibility - legacy task execute endpoint
  router.post('/task/execute', requireJsonBody(), (c) =>
    controller.taskExecute(c),
  );

  // GET /status - Status and health endpoints
  router.get('/status', (c) => controller.getStatus(c));

  return router;
}
