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

    console.debug('[LocalGLMProvider] Initialized OpenAI client', {
        baseURL: openai.baseURL,
        hasJwt: !!jwtToken
    });

    // Workaround for GLM-4 server-side template error ("Unknown argument ensure_ascii")
    // We manually format tools into the system prompt and disable native tool passing
    
    let finalMessages = [...messages];

    // Native tool support is now enabled on the backend model
    // No need for XML hacks or stop tokens anymore

    const stream = await openai.chat.completions.create({
      model: config.model || 'GLM-4.7-Flash',
      messages: finalMessages,
      tools: tools && tools.length > 0 ? tools : undefined,
      stream: true,
      // No stop token needed for native tools
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  getName(): string {
    return 'Local GLM-4.7';
  }
}
