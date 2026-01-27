import OpenAI from 'openai';
import { ILLMProvider, LLMProviderConfig, LLMProviderContext } from './ILLMProvider';

export class LocalGLMProvider implements ILLMProvider {
  canHandle(context: LLMProviderContext): boolean {
    return context.provider === 'local-glm' && !!context.jwtToken;
  }

  async *chat(
    messages: any[],
    tools: any[],
    config: LLMProviderConfig
  ): AsyncIterable<any> {
    const openai = new OpenAI({
      apiKey: 'dummy', // Not used, auth via headers
      baseURL: config.baseURL || 'https://llm.defikit.net/v1',
      defaultHeaders: {
        authorization: `Bearer ${config.headers?.authorization || ''}`, // Token passed in config or handled by caller
        origin: 'https://llm.defikit.net',
        referer: 'https://llm.defikit.net/',
        'user-agent': 'LumiLink-CodingMode/1.0',
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...config.headers,
      },
    });

    const stream = await openai.chat.completions.create({
      model: config.model || 'glm-4.7',
      messages,
      tools,
      stream: true,
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  getName(): string {
    return 'Local GLM-4.7';
  }
}
