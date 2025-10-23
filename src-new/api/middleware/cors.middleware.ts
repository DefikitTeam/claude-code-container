import type { Hono } from 'hono';
import { cors } from 'hono/cors';

export function registerCors(app: Hono, allowedOrigins?: string): void {
  const origins = parseOrigins(allowedOrigins);

  app.use(
    '*',
    cors({
      origin: origins.length > 0 ? origins : '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Installation-ID', 'X-User-ID'],
      maxAge: 86400,
      credentials: true,
    }),
  );
}

function parseOrigins(raw?: string): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
