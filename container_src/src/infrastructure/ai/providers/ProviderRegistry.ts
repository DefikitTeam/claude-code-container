import { ILLMProvider, LLMProviderContext } from './ILLMProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import { LocalGLMProvider } from './LocalGLMProvider.js';

export class ProviderRegistry {
  private providers: ILLMProvider[] = [];

  register(provider: ILLMProvider): void {
    this.providers.push(provider);
  }

  select(context: LLMProviderContext): ILLMProvider | null {
    for (const provider of this.providers) {
      if (provider.canHandle(context)) {
        return provider;
      }
    }
    return null;
  }

  getAll(): ILLMProvider[] {
    return [...this.providers];
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

// Register default providers
providerRegistry.register(new LocalGLMProvider()); // Check specialized first
providerRegistry.register(new OpenRouterProvider()); // Fallback
