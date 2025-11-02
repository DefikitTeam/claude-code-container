import { Hono } from 'hono';
import { DeploymentController } from '../controllers/deployment.controller';
import { requireInstallationHeaders, requireJsonBody } from '../middleware/validation.middleware';

export function createDeploymentRoutes(controller: DeploymentController): Hono {
  const router = new Hono();

  // POST /deploy - Deploy worker
  router.post(
    '/deploy',
    requireInstallationHeaders(),
    requireJsonBody(),
    (c) => controller.deployWorker(c),
  );

  // GET /:deploymentId/status - Get deployment status
  router.get(
    '/:deploymentId/status',
    (c) => controller.getStatus(c),
  );

  // POST /:deploymentId/rollback - Rollback deployment
  router.post(
    '/:deploymentId/rollback',
    (c) => controller.rollback(c),
  );

  // POST /validate - Validate deployment config
  router.post(
    '/validate',
    requireJsonBody(),
    (c) => controller.validateConfig(c),
  );

  return router;
}
