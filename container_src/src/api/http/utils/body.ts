import type * as http from 'http';

export async function readRequestBody(
  req: http.IncomingMessage,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function parseJsonBody<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = new Error('invalid_json_body');
    (err as any).detail = { rawSnippet: raw.slice(0, 256) };
    throw err;
  }
}
