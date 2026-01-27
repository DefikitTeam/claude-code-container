
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { providerRegistry } from '../src/infrastructure/ai/providers/ProviderRegistry';
import { OpenRouterProvider } from '../src/infrastructure/ai/providers/OpenRouterProvider';
import { LocalGLMProvider } from '../src/infrastructure/ai/providers/LocalGLMProvider';
import { OpenAIOpenRouterToolsAdapter } from '../src/infrastructure/ai/openai-openrouter-tools.adapter';
import type { LLMProviderContext } from '../src/infrastructure/ai/providers/ILLMProvider';

describe('Provider Abstraction', () => {
  beforeEach(() => {
    // Reset registry if needed, or assume clean state
  });

  describe('ProviderRegistry', () => {
    it('should select LocalGLMProvider when criteria match', () => {
      const context: LLMProviderContext = {
        provider: 'local-glm',
        jwtToken: 'sometoken'
      };
      const provider = providerRegistry.select(context);
      expect(provider).toBeInstanceOf(LocalGLMProvider);
    });

    it('should select OpenRouterProvider when provider is openrouter', () => {
      const context: LLMProviderContext = {
        provider: 'openrouter'
      };
      const provider = providerRegistry.select(context);
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    });

    it('should fallback to OpenRouterProvider when no provider specified', () => {
      const context: LLMProviderContext = {};
      const provider = providerRegistry.select(context);
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    });
  });

  describe('OpenAIOpenRouterToolsAdapter Integration', () => {
    it('should be instantiated', () => {
      const adapter = new OpenAIOpenRouterToolsAdapter();
      expect(adapter).toBeDefined();
    });

    // Mocking run() context is complex, so we verify structure here.
    // Real integration test would require complete runtime context.
  });
});
