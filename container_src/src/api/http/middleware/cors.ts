import type { Middleware } from '../types.js';

export const corsMiddleware: Middleware = async (ctx, next) => {
  const { res, method } = ctx;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    if (!res.headersSent) {
      res.statusCode = 200;
    }
    res.end();
    return;
  }

  await next();
};
