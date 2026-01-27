import OpenAI from 'openai';
import { ILLMProvider, LLMProviderConfig, LLMProviderContext } from './ILLMProvider.js';

export class OpenRouterProvider implements ILLMProvider {
  canHandle(context: LLMProviderContext): boolean {
    return !context.provider || context.provider === 'openrouter';
  }

  async *chat(
    messages: any[],
    tools: any[],
    config: LLMProviderConfig
  ): AsyncIterable<any> {
    const openai = new OpenAI({
      apiKey: config.apiKey || process.env.OPENROUTER_API_KEY,
      baseURL: config.baseURL || 'https://openrouter.ai/api/v1',
    });

    const stream = await openai.chat.completions.create({
      model: config.model || 'mistralai/devstral-2512:free',
      messages,
      tools,
      stream: true,
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  getName(): string {
    return 'OpenRouter';
  }
}
