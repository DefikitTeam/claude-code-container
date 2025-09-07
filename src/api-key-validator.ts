// Anthropic API Key validation utilities

/**
 * Validate Anthropic API key format
 */
export function validateAnthropicApiKeyFormat(apiKey: string): boolean {
  // Anthropic API keys follow the format: sk-ant-api03-...
  const anthropicKeyRegex = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{95}AA$/;
  return anthropicKeyRegex.test(apiKey);
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
  // Check format first
  const formatValid = validateAnthropicApiKeyFormat(apiKey);
  
  if (!formatValid) {
    return {
      valid: false,
      formatValid: false,
      error: 'Invalid API key format. Expected format: sk-ant-api03-...'
    };
  }

  // If format is valid but we don't need to test functionality
  if (!testFunctionality) {
    return {
      valid: true,
      formatValid: true
    };
  }

  // Test functionality
  const functionTest = await testAnthropicApiKey(apiKey);
  
  return {
    valid: functionTest.valid,
    formatValid: true,
    functionalityValid: functionTest.valid,
    error: functionTest.error
  };
}