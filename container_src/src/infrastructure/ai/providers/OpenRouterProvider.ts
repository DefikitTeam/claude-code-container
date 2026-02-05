import OpenAI from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers';
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
    // Wrap OpenAI client with LangSmith for automatic tracing
    const openai = wrapOpenAI(
      new OpenAI({
        apiKey: config.apiKey || process.env.OPENROUTER_API_KEY,
        baseURL: config.baseURL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      }),
    );

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
