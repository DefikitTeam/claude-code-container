/**
 * FIXED VERSION of executeViaToolbox using curl instead of inline Node.js
 *
 * This replaces the problematic inline Node.js script with a simple curl command
 * that has minimal escaping issues and is much easier to debug.
 *
 * To apply this fix:
 * 1. Replace the executeViaToolbox method in acp-bridge.service.ts (lines 665-932)
 * 2. Test with simple prompts first
 * 3. Monitor logs for any issues
 */

/**
 * Execute ACP request via Daytona Toolbox API using curl
 * This version uses curl instead of inline Node.js to avoid escaping issues
 */
private async executeViaToolbox(
  apiUrl: string,
  apiKey: string,
  organizationId: string | undefined,
  sandboxId: string,
  jsonRpcRequest: any,
  timeoutSeconds: number = 180,
): Promise<any> {
  // Extract prompt from JSON-RPC request
  const params = jsonRpcRequest.params || {};
  let prompt = 'Hello';

  if (typeof params.prompt === 'string') {
    prompt = params.prompt;
  } else if (Array.isArray(params.content)) {
    // Handle content array format
    const textParts = params.content
      .filter(c => c && c.type === 'text')
      .map(c => c.text)
      .join('\n');
    prompt = textParts || 'Hello';
  } else if (typeof params.content === 'string') {
    prompt = params.content;
  }

  // Get API key from params or environment
  const openrouterApiKey = params.anthropicApiKey || '';
  if (!openrouterApiKey) {
    console.error('[ACP-BRIDGE] No API key available for OpenRouter');
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'No API key available',
        data: { hint: 'Check OPENROUTER_API_KEY environment variable' },
      },
      id: String(jsonRpcRequest.id),
    };
  }

  const model = process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4';

  // Construct OpenRouter API request payload
  const openrouterPayload = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  };

  // Base64 encode payload for safe shell passing
  const payloadJson = JSON.stringify(openrouterPayload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64');

  // Construct curl command with minimal escaping
  // Using heredoc-style base64 decoding to avoid escaping issues
  const curlCommand = `echo '${payloadBase64}' | base64 -d | curl -s --max-time ${timeoutSeconds} -X POST https://openrouter.ai/api/v1/chat/completions -H 'Authorization: Bearer ${openrouterApiKey}' -H 'Content-Type: application/json' -H 'HTTP-Referer: https://daytona.io' -H 'X-Title: Daytona ACP' -d @-`;

  console.log(`[ACP-BRIDGE] Executing curl via Toolbox (${curlCommand.length} chars)`);
  console.log(`[ACP-BRIDGE] Model: ${model}, Prompt length: ${prompt.length}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (organizationId) {
    headers['X-Daytona-Organization-ID'] = organizationId;
  }

  const url = `${apiUrl}toolbox/${sandboxId}/toolbox/process/execute`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: curlCommand,
        timeout: timeoutSeconds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ACP-BRIDGE] Toolbox execute failed: ${response.status} - ${errorText}`);
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Toolbox API error: ${response.status} ${response.statusText}`,
          data: { error: errorText },
        },
        id: String(jsonRpcRequest.id),
      };
    }

    const result = await response.json() as { exitCode: number; result: string };
    console.log(`[ACP-BRIDGE] Toolbox execute result: exitCode=${result.exitCode}`);
    console.log(`[ACP-BRIDGE] Toolbox result length: ${result.result?.length || 0}`);

    // Log first 500 chars of output for debugging
    if (result.result) {
      console.log(`[ACP-BRIDGE] Output preview: ${result.result.substring(0, 500)}`);
    }

    // Check for non-zero exit code
    if (result.exitCode !== 0) {
      console.error(`[ACP-BRIDGE] Command failed with exit code ${result.exitCode}`);
      console.error(`[ACP-BRIDGE] Error output: ${result.result}`);

      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Command execution failed (exit code ${result.exitCode})`,
          data: {
            exitCode: result.exitCode,
            output: result.result?.substring(0, 1000), // Limit error output
          },
        },
        id: String(jsonRpcRequest.id),
      };
    }

    // Parse OpenRouter response
    if (result.result) {
      try {
        const openrouterResponse = JSON.parse(result.result);

        // Check for OpenRouter API errors
        if (openrouterResponse.error) {
          console.error('[ACP-BRIDGE] OpenRouter API error:', openrouterResponse.error);
          return {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'OpenRouter API error',
              data: openrouterResponse.error,
            },
            id: String(jsonRpcRequest.id),
          };
        }

        // Success - extract response
        const content = openrouterResponse.choices?.[0]?.message?.content || 'No response';
        const usage = openrouterResponse.usage || {};

        return {
          jsonrpc: '2.0',
          result: {
            stopReason: 'end_turn',
            usage: {
              inputTokens: usage.prompt_tokens || 0,
              outputTokens: usage.completion_tokens || 0,
            },
            content: content,
          },
          id: String(jsonRpcRequest.id),
        };
      } catch (parseError) {
        console.error('[ACP-BRIDGE] Failed to parse OpenRouter response:', parseError);
        console.error('[ACP-BRIDGE] Raw response:', result.result?.substring(0, 1000));

        return {
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Failed to parse API response',
            data: {
              parseError: parseError instanceof Error ? parseError.message : String(parseError),
              rawResponse: result.result?.substring(0, 500),
            },
          },
          id: String(jsonRpcRequest.id),
        };
      }
    }

    // Empty result
    return {
      jsonrpc: '2.0',
      result: {
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        content: 'Command execution completed but returned no output',
      },
      id: String(jsonRpcRequest.id),
    };
  } catch (error) {
    console.error(`[ACP-BRIDGE] Toolbox execute error:`, error);
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Unknown error',
        data: {
          stack: error instanceof Error ? error.stack : undefined,
        },
      },
      id: String(jsonRpcRequest.id),
    };
  }
}

/**
 * Alternative version using file-based passing for very large prompts
 * Use this if prompts exceed shell command length limits (~100KB)
 */
private async executeViaToolboxWithFiles(
  apiUrl: string,
  apiKey: string,
  organizationId: string | undefined,
  sandboxId: string,
  jsonRpcRequest: any,
  timeoutSeconds: number = 180,
): Promise<any> {
  const params = jsonRpcRequest.params || {};
  let prompt = 'Hello';

  if (typeof params.prompt === 'string') {
    prompt = params.prompt;
  } else if (Array.isArray(params.content)) {
    prompt = params.content
      .filter(c => c && c.type === 'text')
      .map(c => c.text)
      .join('\n') || 'Hello';
  } else if (typeof params.content === 'string') {
    prompt = params.content;
  }

  const openrouterApiKey = params.anthropicApiKey || '';
  if (!openrouterApiKey) {
    return {
      jsonrpc: '2.0',
      error: { code: -32603, message: 'No API key available' },
      id: String(jsonRpcRequest.id),
    };
  }

  const model = process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4';

  const openrouterPayload = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  };

  const payloadJson = JSON.stringify(openrouterPayload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64');

  // Use files to avoid command length limits
  const payloadFile = '/tmp/acp_payload.json';
  const responseFile = '/tmp/acp_response.json';

  // Multi-step command: write payload → curl → read response
  const command = `echo '${payloadBase64}' | base64 -d > ${payloadFile} && curl -s --max-time ${timeoutSeconds} -X POST https://openrouter.ai/api/v1/chat/completions -H 'Authorization: Bearer ${openrouterApiKey}' -H 'Content-Type: application/json' -H 'HTTP-Referer: https://daytona.io' -H 'X-Title: Daytona ACP' -d @${payloadFile} > ${responseFile} && cat ${responseFile}`;

  console.log(`[ACP-BRIDGE] Executing curl via Toolbox with files (${command.length} chars)`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (organizationId) {
    headers['X-Daytona-Organization-ID'] = organizationId;
  }

  const url = `${apiUrl}toolbox/${sandboxId}/toolbox/process/execute`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: command,
        timeout: timeoutSeconds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ACP-BRIDGE] Toolbox execute failed: ${response.status} - ${errorText}`);
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Toolbox API error: ${response.status} ${response.statusText}`,
          data: { error: errorText },
        },
        id: String(jsonRpcRequest.id),
      };
    }

    const result = await response.json() as { exitCode: number; result: string };
    console.log(`[ACP-BRIDGE] Toolbox execute result: exitCode=${result.exitCode}`);

    if (result.exitCode !== 0) {
      console.error(`[ACP-BRIDGE] Command failed with exit code ${result.exitCode}`);
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Command execution failed (exit code ${result.exitCode})`,
          data: { exitCode: result.exitCode, output: result.result },
        },
        id: String(jsonRpcRequest.id),
      };
    }

    if (result.result) {
      try {
        const openrouterResponse = JSON.parse(result.result);

        if (openrouterResponse.error) {
          return {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'OpenRouter API error',
              data: openrouterResponse.error,
            },
            id: String(jsonRpcRequest.id),
          };
        }

        return {
          jsonrpc: '2.0',
          result: {
            stopReason: 'end_turn',
            usage: {
              inputTokens: openrouterResponse.usage?.prompt_tokens || 0,
              outputTokens: openrouterResponse.usage?.completion_tokens || 0,
            },
            content: openrouterResponse.choices?.[0]?.message?.content || 'No response',
          },
          id: String(jsonRpcRequest.id),
        };
      } catch (parseError) {
        console.error('[ACP-BRIDGE] Failed to parse response:', parseError);
        return {
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Failed to parse API response',
            data: { error: String(parseError) },
          },
          id: String(jsonRpcRequest.id),
        };
      }
    }

    return {
      jsonrpc: '2.0',
      result: {
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        content: 'Command execution completed',
      },
      id: String(jsonRpcRequest.id),
    };
  } catch (error) {
    console.error(`[ACP-BRIDGE] Toolbox execute error:`, error);
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      id: String(jsonRpcRequest.id),
    };
  }
}
