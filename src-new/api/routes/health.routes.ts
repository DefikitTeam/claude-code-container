import { Hono } from 'hono';

export function createHealthRoutes(): Hono {
  const router = new Hono();

  router.get('/', (c) => {
    return c.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '2.0.0-clean-architecture',
    });
  });

  router.get('/ready', (c) => {
    // Add readiness checks here if needed
    return c.json({
      ready: true,
      timestamp: Date.now(),
    });
  });

  router.get('/live', (c) => {
    return c.json({
      alive: true,
      timestamp: Date.now(),
    });
  });

  return router;
}
