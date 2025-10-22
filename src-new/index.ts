// TODO: Implement entry point with DI (150 LOC)
import { Hono } from 'hono';

export interface Env {
  // TODO: Define Env
}

const app = new Hono<{ Bindings: Env }>();

// TODO: Setup dependency injection
// TODO: Register routes
// TODO: Setup middleware

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
