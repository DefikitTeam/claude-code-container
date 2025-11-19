/**
 * Unit tests for OpenAI OpenRouter Adapter
 *
 * Tests the OpenAI SDK integration with OpenRouter API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIOpenRouterAdapter } from '../src/infrastructure/ai/openai-openrouter.adapter.js';
import type { ClaudeRuntimeContext } from '../src/infrastructure/claude/adapter.js';
import type {
  RunOptions,
  ClaudeCallbacks,
} from '../src/core/interfaces/services/claude.service.js';

describe('OpenAIOpenRouterAdapter', () => {
  let adapter: OpenAIOpenRouterAdapter;

  beforeEach(() => {
    adapter = new OpenAIOpenRouterAdapter();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(adapter.name).toBe('http-api');
      expect(adapter.adapterId).toBe('openai-openrouter');
    });

    it('should accept custom config', () => {
      const customAdapter = new OpenAIOpenRouterAdapter({
        baseURL: 'https://custom.url',
        defaultModel: 'custom-model',
      });

      expect(customAdapter.name).toBe('http-api');
      expect(customAdapter.adapterId).toBe('openai-openrouter');
    });
  });

  describe('canHandle', () => {
    it('should return true when API key is available in context', () => {
      const context: ClaudeRuntimeContext = {
        apiKey: 'test-key',
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      expect(adapter.canHandle(context)).toBe(true);
    });

    it('should return true when API key is in environment', () => {
      const originalKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-env-key';

      const context: ClaudeRuntimeContext = {
        apiKey: '',
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      expect(adapter.canHandle(context)).toBe(true);

      // Cleanup
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    });

    it('should return false when no API key is available', () => {
      const originalKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const context: ClaudeRuntimeContext = {
        apiKey: '',
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      expect(adapter.canHandle(context)).toBe(false);

      // Cleanup
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      }
    });

    it('should return false when explicitly disabled', () => {
      const originalDisable =
        process.env.CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER;
      process.env.CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER = '1';

      const context: ClaudeRuntimeContext = {
        apiKey: 'test-key',
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      expect(adapter.canHandle(context)).toBe(false);

      // Cleanup
      if (originalDisable) {
        process.env.CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER = originalDisable;
      } else {
        delete process.env.CLAUDE_CLIENT_DISABLE_OPENAI_OPENROUTER;
      }
    });
  });

  describe('run', () => {
    it('should throw error when API key is missing', async () => {
      const originalKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const context: ClaudeRuntimeContext = {
        apiKey: '',
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      const runOptions: RunOptions = {
        sessionId: 'test-session',
      };

      const callbacks: ClaudeCallbacks = {};
      const abortSignal = new AbortController().signal;

      await expect(
        adapter.run('test prompt', runOptions, context, callbacks, abortSignal),
      ).rejects.toThrow('missing API key');

      // Cleanup
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      }
    });

    it('should throw error when aborted', async () => {
      const context: ClaudeRuntimeContext = {
        apiKey: 'test-key',
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      const runOptions: RunOptions = {
        sessionId: 'test-session',
      };

      const callbacks: ClaudeCallbacks = {};
      const abortController = new AbortController();
      abortController.abort(); // Abort immediately

      await expect(
        adapter.run(
          'test prompt',
          runOptions,
          context,
          callbacks,
          abortController.signal,
        ),
      ).rejects.toThrow('aborted');
    });
  });

  describe('integration tests', () => {
    it.skip('should successfully complete a real request', async () => {
      // This test requires a real OPENROUTER_API_KEY
      // Run with: OPENROUTER_API_KEY=xxx pnpm test -- openai-openrouter.adapter.test.ts

      if (!process.env.OPENROUTER_API_KEY) {
        console.log('Skipping integration test - no OPENROUTER_API_KEY');
        return;
      }

      const context: ClaudeRuntimeContext = {
        apiKey: process.env.OPENROUTER_API_KEY,
        runningAsRoot: false,
        disableSdk: false,
        disableCli: false,
        forceHttpApi: false,
        env: {},
      };

      const runOptions: RunOptions = {
        sessionId: 'test-session',
        model: 'anthropic/claude-sonnet-4',
      };

      let deltaCount = 0;
      let fullText = '';

      const callbacks: ClaudeCallbacks = {
        onStart: ({ startTime }) => {
          expect(startTime).toBeGreaterThan(0);
        },
        onDelta: ({ text }) => {
          if (text) {
            deltaCount++;
            fullText += text;
          }
        },
        onComplete: ({ fullText: final, durationMs }) => {
          expect(final).toBe(fullText);
          expect(durationMs).toBeGreaterThan(0);
        },
      };

      const abortSignal = new AbortController().signal;

      const result = await adapter.run(
        'Say "Hello, World!" and nothing else.',
        runOptions,
        context,
        callbacks,
        abortSignal,
      );

      expect(result.fullText).toContain('Hello');
      expect(result.tokens?.input).toBeGreaterThan(0);
      expect(result.tokens?.output).toBeGreaterThan(0);
      expect(deltaCount).toBeGreaterThan(0);
    });
  });
});
