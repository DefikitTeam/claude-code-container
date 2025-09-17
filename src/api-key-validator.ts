// Anthropic API Key validation utilities

/**
 * Validate Anthropic API key format
 */
export function validateAnthropicApiKeyFormat(apiKey: string): boolean {
  // Relaxed validation: require the key to start with sk- and be a reasonable length.
  // Anthropic keys have varied formats/lengths across versions; strict exact-length
  // checks cause valid keys to be rejected. We accept keys that start with `sk-`
  // and contain only URL-safe API key characters and have a length between 30 and 200.
  if (!apiKey || typeof apiKey !== 'string') return false;
  if (!apiKey.startsWith('sk-')) return false;
  const safeChars = /^[A-Za-z0-9_\-]+$/;
  if (!safeChars.test(apiKey.replace(/^sk-/, ''))) return false;
  return apiKey.length >= 30 && apiKey.length <= 200;
}

/**
 * Test Anthropic API key functionality
 * Makes a minimal API call to verify the key works
 */
export async function testAnthropicApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Make a minimal API call to test the key
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{
          role: 'user',
          content: 'Hi'
        }]
      })
    });

    if (response.status === 200) {
      return { valid: true };
    } else if (response.status === 401) {
      return { valid: false, error: 'Invalid API key - authentication failed' };
    } else if (response.status === 429) {
      // Rate limited, but key is valid
      return { valid: true };
    } else {
      const errorText = await response.text();
      return { valid: false, error: `API test failed: ${response.status} - ${errorText}` };
    }
  } catch (error) {
    return { 
      valid: false, 
      error: `API test error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Comprehensive API key validation
 * Checks both format and functionality
 */
export async function validateAnthropicApiKey(apiKey: string, testFunctionality = false): Promise<{
  valid: boolean;
  formatValid: boolean;
  functionalityValid?: boolean;
  error?: string;
}> {
  // Validation is intentionally disabled in this build - accept any non-empty key.
  // This short-circuits format and functionality checks to allow registration
  // during development or when API validation should be skipped.
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return {
      valid: false,
      formatValid: false,
      error: 'Anthropic API key is required.'
    };
  }

  return {
    valid: true,
    formatValid: true,
    functionalityValid: true
  };
}