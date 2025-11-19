import { Hono } from 'hono';
import type { UserController } from '../controllers/user.controller';
import { requireInstallationHeaders } from '../middleware/auth.middleware';
import { requireJsonBody } from '../middleware/validation.middleware';
import { DEFAULT_USER_CONFIG_STUB } from '../../infrastructure/adapters/user-repository.do-adapter';

export function createUserRoutes(controller: UserController): Hono {
  const router = new Hono();

  router.use('*', requireInstallationHeaders());

  router.post('/register', requireJsonBody(), (c) => controller.register(c));

  // Debug endpoint to test DO directly (MUST be before /:userId to match)
  router.get('/debug/:userId', async (c) => {
    const userId = c.req.param('userId');
    const env = c.env as any;
    const id = env.USER_CONFIG.idFromName(DEFAULT_USER_CONFIG_STUB);
    const stub = env.USER_CONFIG.get(id);

    const response = await stub.fetch(
      new Request(`http://localhost/user?userId=${userId}`),
    );

    const data = await response.json();
    return c.json({
      debug: true,
      doResponse: data,
      responseStatus: response.status,
    });
  });

  router.get('/:userId', (c) => controller.getUser(c));
  router.put('/:userId', requireJsonBody(), (c) => controller.updateUser(c));
  router.delete('/:userId', (c) => controller.deleteUser(c));

  return router;
}
