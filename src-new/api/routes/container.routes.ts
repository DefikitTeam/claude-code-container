import { Hono } from 'hono';
import { ContainerController } from '../controllers/container.controller';
import { requireInstallationHeaders, requireJsonBody } from '../middleware/validation.middleware';

export function createContainerRoutes(controller: ContainerController): Hono {
  const router = new Hono();

  // POST /spawn - Spawn a new container
  router.post(
    '/spawn',
    requireInstallationHeaders(),
    requireJsonBody(),
    (c) => controller.spawnContainer(c),
  );

  // POST /:containerId/prompt - Process prompt in container
  router.post(
    '/:containerId/prompt',
    requireJsonBody(),
    (c) => controller.processPrompt(c),
  );

  // GET /:containerId/logs - Get container logs
  router.get(
    '/:containerId/logs',
    (c) => controller.getLogs(c),
  );

  // DELETE /:containerId - Terminate container
  router.delete(
    '/:containerId',
    (c) => controller.terminateContainer(c),
  );

  return router;
}
