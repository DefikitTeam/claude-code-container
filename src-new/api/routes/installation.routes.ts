import { Hono } from 'hono';
import { InstallationController } from '../controllers/installation.controller';
import { requireInstallationHeaders, requireJsonBody } from '../middleware/validation.middleware';

export function createInstallationRoutes(controller: InstallationController): Hono {
  const router = new Hono();

  // GET / - Get installation info
  router.get(
    '/',
    requireInstallationHeaders(),
    (c) => controller.getInstallation(c),
  );

  // PUT / - Update installation
  router.put(
    '/',
    requireInstallationHeaders(),
    requireJsonBody(),
    (c) => controller.updateInstallation(c),
  );

  return router;
}
