import { Hono } from 'hono';
import type { SessionController } from '../controllers/session.controller';
import { requireInstallationHeaders } from '../middleware/auth.middleware';
import { requireJsonBody } from '../middleware/validation.middleware';

/**
 * Session routes for persistent branch code mode
 */
import { Env } from '../../index';

export function createSessionRoutes(controller: SessionController): Hono<{ Bindings: Env }> {
  const router = new Hono<{ Bindings: Env }>();

  router.use('*', requireInstallationHeaders());

  // Enable coding mode on a session
  router.post('/:sessionId/coding-mode', requireJsonBody(), (c) =>
    controller.enableCodingMode(c as any),
  );

  // Process a prompt (creates a commit)
  router.post('/:sessionId/prompt', requireJsonBody(), (c) =>
    controller.processPrompt(c as any),
  );

  // Create a PR from the working branch
  router.post('/:sessionId/pull-request', requireJsonBody(), (c) =>
    controller.createPullRequest(c as any),
  );

  // Get session status and branch info
  router.get('/:sessionId/status', (c) => controller.getSessionStatus(c as any));

  // Update PR tracking (called by Lumi BE after creating PR)
  router.patch('/:sessionId/pr-tracking', requireJsonBody(), (c) =>
    controller.updatePRTracking(c as any),
  );

  return router;
}
