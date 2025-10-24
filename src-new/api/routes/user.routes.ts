import { Hono } from 'hono';
import type { UserController } from '../controllers/user.controller';
import { requireInstallationHeaders } from '../middleware/auth.middleware';
import { requireJsonBody } from '../middleware/validation.middleware';

export function createUserRoutes(controller: UserController): Hono {
  const router = new Hono();

  router.use('*', requireInstallationHeaders());

  router.post('/register', requireJsonBody(), (c) => controller.register(c));
  router.get('/:userId', (c) => controller.getUser(c));
  router.put('/:userId', requireJsonBody(), (c) => controller.updateUser(c));
  router.delete('/:userId', (c) => controller.deleteUser(c));

  return router;
}
