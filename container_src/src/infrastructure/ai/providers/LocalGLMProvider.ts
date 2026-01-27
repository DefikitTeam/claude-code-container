import OpenAI from 'openai';
import { ILLMProvider, LLMProviderConfig, LLMProviderContext } from './ILLMProvider.js';

export class LocalGLMProvider implements ILLMProvider {
  canHandle(context: LLMProviderContext): boolean {
    return context.provider === 'local-glm';
  }

  async *chat(
    messages: any[],
    tools: any[],
    config: LLMProviderConfig
  ): AsyncIterable<any> {
    // Use LUMILINK_JWT_TOKEN from container's environment
    // This is the same JWT used for GitHub authentication
    const jwtToken = process.env.LUMILINK_JWT_TOKEN || '';

    const openai = new OpenAI({
      apiKey: 'dummy', // Not used, auth via headers
      baseURL: config.baseURL || 'https://llm.defikit.net/v1',
      defaultHeaders: {
        authorization: `Bearer ${jwtToken}`,
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
