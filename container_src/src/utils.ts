import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Load managed settings from configuration files
 * Similar to Zed's managed settings pattern
 */
export function loadManagedSettings(): Record<string, string> | null {
  try {
    // Look for managed settings in common locations
    const configPaths = [
      path.join(os.homedir(), '.claude.json'),
      path.join(process.cwd(), '.claude.json'),
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);
        return config.managedSettings || null;
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to load managed settings:', error);
    return null;
  }
}

/**
 * Apply environment settings from managed configuration
 */
export function applyEnvironmentSettings(settings: Record<string, string>): void {
  if (!settings) return;

  Object.keys(settings).forEach(key => {
    if (settings[key] && !process.env[key]) {
      process.env[key] = settings[key];
    }
  });
}

/**
 * Pushable stream implementation for ACP communication
 * Similar to Zed's utils but simplified
 */
export class Pushable<T> {
  private items: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
      } else if (this.closed) {
        break;
      } else {
        const result = await new Promise<IteratorResult<T>>(resolve => {
          this.resolvers.push(resolve);
        });
        if (result.done) break;
        yield result.value;
      }
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) {
      return { value: this.items.shift()!, done: false };
    } else if (this.closed) {
      return { value: undefined as any, done: true };
    } else {
      return new Promise<IteratorResult<T>>(resolve => {
        this.resolvers.push(resolve);
      });
    }
  }
}

/**
 * Convert Node.js readable stream to Web API ReadableStream
 */
export function nodeToWebReadable(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err) => {
        controller.error(err);
      });
    }
  });
}

/**
 * Convert Node.js writable stream to Web API WritableStream
 */
export function nodeToWebWritable(nodeStream: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        nodeStream.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        nodeStream.end(() => resolve());
      });
    }
  });
}

/**
 * Unreachable function for exhaustive type checking
 */
export function unreachable(value: never): never {
  throw new Error(`Unreachable code reached with value: ${JSON.stringify(value)}`);
}

/**
 * HTTP client for communicating with remote worker
 */
export class WorkerHttpClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  async sendJsonRpc(method: string, params: any, id: string | number): Promise<any> {
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/acp/jsonrpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(`JSON-RPC error: ${result.error.message}`);
      }

      return result.result;
    } catch (error) {
      console.error('Worker HTTP client error:', error);
      throw error;
    }
  }
}