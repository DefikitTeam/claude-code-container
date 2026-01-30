export interface LLMProviderContext {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  provider?: 'openrouter' | 'local-glm';
  headers?: Record<string, string>;
  // Note: JWT for Local GLM is read from LUMILINK_JWT_TOKEN environment variable
  jwtToken?: string;
}

export interface LLMProviderConfig {
  provider: 'openrouter' | 'local-glm';
  baseURL?: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface ILLMProvider {
  /**
   * Identifies if this provider can handle the request
   * @param context - Execution context with provider config
   */
  canHandle(context: LLMProviderContext): boolean;

  /**
   * Execute chat completion with tools
   * @param messages - Chat messages
   * @param tools - Available tools
   * @param config - Provider-specific configuration
   * @returns AsyncIterable of response chunks
   */
  chat(
    messages: any[],
    tools: any[],
    config: LLMProviderConfig
  ): AsyncIterable<any>;

  /**
   * Get provider name for logging
   */
  getName(): string;
}
