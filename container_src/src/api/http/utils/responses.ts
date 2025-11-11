import type { ServerResponse } from 'http';

export function jsonResponse(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown> | unknown,
): void {
  if (!res.headersSent) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
  }
  res.end(JSON.stringify(payload));
}
