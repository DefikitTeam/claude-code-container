/**
 * Cost Calculator for OpenRouter LLM API calls
 * 
 * This utility calculates the cost of LLM API calls based on OpenRouter pricing.
 * Pricing is per million tokens (input and output are priced separately).
 * 
 * Pricing data source: https://openrouter.ai/api/v1/models
 * Last updated: 2026-02-02
 */

/**
 * Pricing structure for OpenRouter models
 * - input: cost per million input tokens (USD)
 * - output: cost per million output tokens (USD)
 * - cacheRead: cost per million cache read tokens (USD) - optional
 */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
}

/**
 * OpenRouter model pricing table
 * Prices are in USD per million tokens
 * 
 * Note: Free models have pricing of 0
 */
export const OPENROUTER_PRICING: Record<string, ModelPricing> = {
  // OpenAI Models
  'openai/gpt-5.2-codex': {
    input: 1.75,
    output: 14.0,
    cacheRead: 0.175,
  },
  'openai/gpt-5': {
    input: 1.0,
    output: 5.0,
  },
  'openai/gpt-5-mini': {
    input: 0.15,
    output: 0.6,
  },
  'openai/gpt-4o': {
    input: 2.5,
    output: 10.0,
  },
  'openai/gpt-4': {
    input: 30.0,
    output: 60.0,
  },
  'openai/gpt-audio': {
    input: 2.5,
    output: 10.0,
  },
  'openai/gpt-audio-mini': {
    input: 0.6,
    output: 2.4,
  },

  // Google Models (Free)
  'google/gemini-2.0-flash-lite-001': {
    input: 0,
    output: 0,
  },
  'google/gemini-2.0-flash': {
    input: 0,
    output: 0,
  },
  'google/gemini-flash': {
    input: 0,
    output: 0,
  },

  // Anthropic Models
  'anthropic/claude-sonnet-4': {
    input: 3.0,
    output: 15.0,
  },
  'anthropic/claude-3.5-sonnet': {
    input: 3.0,
    output: 15.0,
  },
  'anthropic/claude-3.7-sonnet:thinking': {
    input: 3.0,
    output: 15.0,
  },

  // X.AI Models
  'x-ai/grok-code-fast-1': {
    input: 0.5,
    output: 1.5,
  },

  // MoonshotAI Models
  'moonshotai/kimi-k2.5': {
    input: 0.5,
    output: 2.8,
  },

  // Writer Models
  'writer/palmyra-x5': {
    input: 0.6,
    output: 6.0,
  },

  // Z.AI Models
  'z-ai/glm-4.7-flash': {
    input: 0.07,
    output: 0.4,
    cacheRead: 0.01,
  },

  // ByteDance Seed Models
  'bytedance-seed/seed-1.6-flash': {
    input: 0.075,
    output: 0.3,
  },
  'bytedance-seed/seed-1.6': {
    input: 0.4,
    output: 1.2,
  },

  // AllenAI Models
  'allenai/olmo-3.1-32b-instruct': {
    input: 0.2,
    output: 0.6,
  },

  // MiniMax Models
  'minimax/minimax-m2-her': {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.03,
  },

  // Free Models
  'openrouter/free': {
    input: 0,
    output: 0,
  },
  'stepfun/step-3.5-flash:free': {
    input: 0,
    output: 0,
  },
  'arcee-ai/trinity-large-preview:free': {
    input: 0,
    output: 0,
  },
  'upstage/solar-pro-3:free': {
    input: 0,
    output: 0,
  },
  'liquid/lfm-2.5-1.2b-thinking:free': {
    input: 0,
    output: 0,
  },
  'liquid/lfm-2.5-1.2b-instruct:free': {
    input: 0,
    output: 0,
  },
  'allenai/molmo-2-8b:free': {
    input: 0,
    output: 0,
  },
};

/**
 * Cost calculation result
 */
export interface CostCalculation {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheReadCostUsd: number;
  totalCostUsd: number;
}

/**
 * Calculate the cost of an LLM API call
 * 
 * @param model - The OpenRouter model identifier (e.g., 'openai/gpt-5-mini')
 * @param promptTokens - Number of input/prompt tokens
 * @param completionTokens - Number of output/completion tokens
 * @param cacheReadTokens - Number of cache read tokens (optional)
 * @returns Cost breakdown in USD
 * 
 * @example
 * ```typescript
 * const cost = calculateCost('openai/gpt-5-mini', 1000, 500);
 * console.log(cost.totalCostUsd); // 0.00045 (1000/1M * 0.15 + 500/1M * 0.6)
 * ```
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number = 0,
): CostCalculation {
  const pricing = OPENROUTER_PRICING[model];

  // If model pricing not found, return zero cost
  // This handles unknown or custom models gracefully
  if (!pricing) {
    console.warn(`[CostCalculator] No pricing data for model: ${model}`);
    return {
      inputCostUsd: 0,
      outputCostUsd: 0,
      cacheReadCostUsd: 0,
      totalCostUsd: 0,
    };
  }

  // Calculate costs: (tokens / 1 million) * price per million
  const inputCostUsd = (promptTokens / 1_000_000) * pricing.input;
  const outputCostUsd = (completionTokens / 1_000_000) * pricing.output;
  const cacheReadCostUsd = pricing.cacheRead
    ? (cacheReadTokens / 1_000_000) * pricing.cacheRead
    : 0;

  const totalCostUsd = inputCostUsd + outputCostUsd + cacheReadCostUsd;

  return {
    inputCostUsd,
    outputCostUsd,
    cacheReadCostUsd,
    totalCostUsd,
  };
}

/**
 * Get pricing information for a specific model
 * 
 * @param model - The OpenRouter model identifier
 * @returns Pricing information or undefined if not found
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  return OPENROUTER_PRICING[model];
}

/**
 * Check if a model is free (no cost for input/output tokens)
 * 
 * @param model - The OpenRouter model identifier
 * @returns true if the model is free, false otherwise
 */
export function isFreeModel(model: string): boolean {
  const pricing = OPENROUTER_PRICING[model];
  return pricing ? pricing.input === 0 && pricing.output === 0 : false;
}

/**
 * Format cost as USD string with appropriate precision
 * 
 * @param costUsd - Cost in USD
 * @returns Formatted string (e.g., "$0.0045" or "$0.00")
 */
export function formatCost(costUsd: number): string {
  if (costUsd === 0) {
    return '$0.00';
  }
  if (costUsd < 0.0001) {
    return `$${costUsd.toFixed(6)}`;
  }
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}
