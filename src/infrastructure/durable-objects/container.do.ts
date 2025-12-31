/**
 * Real Cloudflare Workers Container for Claude Code processing
 * Ported from src/durable-objects.ts - Uses actual @cloudflare/containers
 */

import { Container } from '@cloudflare/containers';

/**
 * ContainerDO - Real container execution using Cloudflare Workers Containers
 *
 * This extends Container from @cloudflare/containers package which provides
 * actual isolated container workloads on Cloudflare infrastructure.
 *
 * Unlike traditional Durable Objects, this handles the container lifecycle
 * and forwards requests to the containerized application running inside.
 */
export class ContainerDO extends Container<any> {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;

  // Time before container sleeps due to inactivity (allow time for GitHub issue processing)
  sleepAfter = '5m'; // 5 minutes - enough for most GitHub issue processing

  // Environment variables passed to the container
  // Note: ANTHROPIC_API_KEY and other sensitive data are provided per-request in fetch() env parameter
  envVars = {
    NODE_ENV: 'production',
    CONTAINER_ID: crypto.randomUUID(),
    PORT: '8080',
    ACP_MODE: 'http-server',
  };

  // Specify the command to run in the container
  cmd = ['npm', 'start'];

  /**
   * Override fetch to handle errors gracefully
   * This is the main entry point for all container requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestBody =
      request.method === 'POST' ? await request.clone().text() : null;

    // Check if this is a streaming request - DON'T buffer these!
    const isStreaming =
      url.searchParams.get('stream') === 'true' ||
      request.headers.get('X-ACP-Streaming') === 'true';

    console.log(`[ContainerDO] ========================================`);
    console.log(
      `[ContainerDO] Incoming request: ${request.method} ${url.pathname} (streaming=${isStreaming})`,
    );
    console.log(
      `[ContainerDO] Request body length: ${requestBody?.length || 0}`,
    );
    if (requestBody && requestBody.length < 500) {
      console.log(`[ContainerDO] Request body: ${requestBody}`);
    }

    try {
      const response = await super.fetch(request);

      // For streaming requests, return response directly WITHOUT buffering
      if (isStreaming) {
        console.log(
          `[ContainerDO] Streaming response: ${response.status} ${response.statusText} for ${url.pathname}`,
        );
        return response; // Return raw response - body will stream to caller
      }

      // Log response status and BODY for debugging (non-streaming only)
      const clonedResponse = response.clone();
      const body = await clonedResponse.text();

      console.log(
        `[ContainerDO] Response: ${response.status} ${response.statusText} for ${url.pathname}`,
      );
      console.log(`[ContainerDO] Response body length: ${body.length}`);
      console.log(`[ContainerDO] Response body: ${body.substring(0, 1000)}`);

      // Return a new response with the same body since we consumed it
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      console.error('[ContainerDO] Container fetch error:', error);
      console.error('[ContainerDO] Request details:', {
        method: request.method,
        path: url.pathname,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Container request failed',
          error: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  }

  /**
   * Lifecycle method called when container shuts down
   * Override this method to handle Container stopped events gracefully
   */
  onStop(params: { exitCode: number; reason: string }) {
    try {
      console.log('Container stopped gracefully:', {
        exitCode: params.exitCode,
        reason: params.reason,
        timestamp: new Date().toISOString(),
      });
      // Don't throw errors here - just log the shutdown
    } catch (error) {
      console.error('Error in onStop (non-fatal):', error);
      // Swallow the error to prevent the repeated error messages
    }
  }

  /**
   * Lifecycle method called when container encounters an error
   * Override this method to handle container errors gracefully
   */
  onError(error: Error) {
    try {
      console.error('Container error:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      // Don't rethrow - just log the error
    } catch (logError) {
      console.error('Error logging container error (non-fatal):', logError);
    }
  }
}
