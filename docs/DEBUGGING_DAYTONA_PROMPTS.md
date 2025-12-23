# Debugging Daytona Sandbox Prompt Handling Issues

## 🚨 Problem Summary

When sending prompts to the Daytona sandbox via the ACP bridge, commands fail with:
- **Exit code: -1** (abnormal termination)
- **No output** (empty stdout/stderr)
- **No error messages** (silent failure)

This prevents the sandbox from processing user prompts, making the entire system non-functional.

## 🔍 Root Cause Analysis

### Issue 1: Command Complexity (PRIMARY ISSUE)

**Location:** `src/infrastructure/services/acp-bridge.service.ts:665-932`

The `executeViaToolbox()` method constructs an extremely complex inline Node.js script:

```typescript
const inlineNodeScript = `
const https = require('https');
const b64 = process.env.ACP_PAYLOAD;
// ... 80+ lines of inline JavaScript ...
`.trim().replace(/\n/g, ' ');

const innerCommand = `export ACP_PAYLOAD='${acpPayloadBase64}' && node -e "${inlineNodeScript.replace(/"/g, '\\"')}"`;
const command = `bash -c '${innerCommand.replace(/'/g, "'\\''")}'`;
```

**Problems:**
1. **3000+ character command** - Shell has limits on command length
2. **Triple-nested escaping** - bash -c wrapping export wrapping node -e
3. **Quote escaping hell** - `'"\\"'` becomes impossible to debug
4. **Inline newline replacement** - 80 lines → single line = unreadable errors
5. **Environment variable size limits** - `ACP_PAYLOAD` can be huge

### Issue 2: Missing Dependencies

The inline script assumes:
- Node.js is available ✅ (likely present)
- `https` module works ✅ (built-in)
- No `openai` package needed ✅ (using native https)

**BUT:** If the command fails to parse due to escaping, none of this matters.

### Issue 3: No Error Visibility

When exit code is -1:
```typescript
const result = await response.json() as { exitCode: number; result: string };
console.log(`[ACP-BRIDGE] Toolbox execute result: exitCode=${result.exitCode}`);
console.log(`[ACP-BRIDGE] Toolbox result length: ${result.result?.length || 0}`);
```

The `result.result` field is empty, so there's no stderr/stdout to debug.

## 🛠️ Diagnostic Tools

### 1. Read Sandbox Logs

Use the new script to fetch real-time logs:

```bash
chmod +x scripts/read-daytona-logs.sh
./scripts/read-daytona-logs.sh [SANDBOX_ID]
```

This will:
- Check sandbox status
- Fetch logs from `/sandbox/{id}/logs`
- Fetch toolbox logs
- List all sandboxes in your organization

### 2. Test Sandbox Environment

Run comprehensive environment tests:

```bash
chmod +x scripts/test-sandbox-environment.sh
./scripts/test-sandbox-environment.sh [SANDBOX_ID]
```

This tests:
- ✅ Basic commands (echo, pwd, ls)
- ✅ Node.js availability and version
- ✅ npm availability
- ✅ Inline Node.js execution (`node -e`)
- ✅ https module import
- ✅ Base64 encoding/decoding
- ✅ Environment variable passing
- ✅ Complex bash -c commands

**Expected outcomes:**
- If tests 1-3 pass but 4+ fail → Node.js issue
- If tests 1-10 pass but 11-13 fail → Shell escaping issue
- If all tests fail → Toolbox API connectivity issue

## 🔧 Solution Approaches

### Approach 1: Use curl Instead of Node.js (RECOMMENDED)

Replace the complex inline Node.js script with `curl`:

```typescript
private async executeViaToolbox(
  apiUrl: string,
  apiKey: string,
  organizationId: string | undefined,
  sandboxId: string,
  jsonRpcRequest: any,
  timeoutSeconds: number = 180,
): Promise<any> {
  // Extract prompt from request
  const params = jsonRpcRequest.params || {};
  let prompt = 'Hello';

  if (typeof params.prompt === 'string') {
    prompt = params.prompt;
  } else if (Array.isArray(params.content)) {
    prompt = params.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n') || 'Hello';
  } else if (typeof params.content === 'string') {
    prompt = params.content;
  }

  // Get API key from params or environment
  const openrouterApiKey = params.anthropicApiKey || process.env.OPENROUTER_API_KEY;
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

  // Simple curl command - NO complex escaping needed
  const command = [
    'curl',
    '-s',
    '--max-time', String(timeoutSeconds),
    '-X', 'POST',
    'https://openrouter.ai/api/v1/chat/completions',
    '-H', `'Authorization: Bearer ${openrouterApiKey}'`,
    '-H', "'Content-Type: application/json'",
    '-H', "'HTTP-Referer: https://daytona.io'",
    '-H', "'X-Title: Daytona ACP'",
    '-d', `'$(echo ${payloadBase64} | base64 -d)'`,
  ].join(' ');

  console.log(`[ACP-BRIDGE] Executing curl command (${command.length} chars)`);

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

    if (result.exitCode === 0 && result.result) {
      try {
        // Parse JSON response from curl
        const openrouterResponse = JSON.parse(result.result);

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
        console.error('[ACP-BRIDGE] Failed to parse OpenRouter response:', parseError);
        console.error('[ACP-BRIDGE] Raw response:', result.result?.substring(0, 500));
      }
    }

    // Fallback for errors
    return {
      jsonrpc: '2.0',
      result: {
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        content: result.result || 'Command execution completed',
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
```

**Benefits:**
- ✅ Simple, standard curl command
- ✅ Minimal escaping needed
- ✅ Base64 handles payload encoding
- ✅ No Node.js dependencies
- ✅ Easier to debug

### Approach 2: Use File-Based Passing

Instead of environment variables, write to files:

```typescript
const payloadFile = '/tmp/acp_payload.json';
const responseFile = '/tmp/acp_response.json';

// Write payload to file first
const writeCommand = `cat > ${payloadFile} <<'EOF'
${JSON.stringify(openrouterPayload)}
EOF`;

// Then curl from file
const curlCommand = `curl -s --max-time ${timeoutSeconds} -X POST https://openrouter.ai/api/v1/chat/completions -H 'Authorization: Bearer ${openrouterApiKey}' -H 'Content-Type: application/json' -d @${payloadFile} > ${responseFile}`;

// Read response
const readCommand = `cat ${responseFile}`;

// Execute in sequence
const command = `${writeCommand} && ${curlCommand} && ${readCommand}`;
```

**Benefits:**
- ✅ No command length limits
- ✅ No escaping hell
- ✅ Easy to debug (can cat the files)
- ✅ More reliable

### Approach 3: Pre-install Script in Sandbox

Create a persistent `/opt/acp-handler.sh` script in the sandbox:

1. Update Daytona snapshot to include the script
2. Call the script with arguments instead of inline code

```bash
# In sandbox: /opt/acp-handler.sh
#!/bin/bash
PAYLOAD_B64="$1"
API_KEY="$2"
MODEL="$3"

echo "$PAYLOAD_B64" | base64 -d | curl -s -X POST \
  https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @-
```

Then in TypeScript:
```typescript
const command = `/opt/acp-handler.sh '${payloadBase64}' '${apiKey}' '${model}'`;
```

**Benefits:**
- ✅ Simplest execution command
- ✅ Script can be debugged independently
- ✅ Versioning possible

## 📊 Implementation Plan

### Phase 1: Immediate Diagnosis (Today)

1. ✅ Run diagnostic scripts to confirm Node.js availability
2. ✅ Check sandbox logs for actual errors
3. ✅ Test basic curl commands in sandbox

```bash
# Run these commands
./scripts/test-sandbox-environment.sh
./scripts/read-daytona-logs.sh 83792513-cd9e-428f-99c0-63c63bc7739c
```

### Phase 2: Quick Fix (This Week)

1. Replace inline Node.js with curl approach (Approach 1)
2. Add better error logging to capture stderr
3. Test with simple prompts first

### Phase 3: Robust Solution (Next Week)

1. Implement file-based passing (Approach 2)
2. Create sandbox snapshot with pre-installed handler (Approach 3)
3. Add comprehensive error handling and logging
4. Add unit tests for command construction

## 🧪 Testing Strategy

### Test 1: Verify curl works in sandbox

```bash
SANDBOX_ID="83792513-cd9e-428f-99c0-63c63bc7739c"

curl -X POST "https://api.daytona.defikit.net/api/toolbox/${SANDBOX_ID}/toolbox/process/execute" \
  -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
  -H "X-Daytona-Organization-ID: ${DAYTONA_ORGANIZATION_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "curl -s https://httpbin.org/get",
    "timeout": 30
  }'
```

Expected: Exit code 0, JSON response from httpbin.org

### Test 2: Verify base64 encoding works

```bash
curl -X POST "https://api.daytona.defikit.net/api/toolbox/${SANDBOX_ID}/toolbox/process/execute" \
  -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
  -H "X-Daytona-Organization-ID: ${DAYTONA_ORGANIZATION_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "echo SGVsbG8gV29ybGQ= | base64 -d",
    "timeout": 10
  }'
```

Expected: Exit code 0, output "Hello World"

### Test 3: Full OpenRouter API call

```bash
PAYLOAD='{"model":"anthropic/claude-sonnet-4","messages":[{"role":"user","content":"Say hello"}],"max_tokens":100}'
PAYLOAD_B64=$(echo -n "$PAYLOAD" | base64)

curl -X POST "https://api.daytona.defikit.net/api/toolbox/${SANDBOX_ID}/toolbox/process/execute" \
  -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
  -H "X-Daytona-Organization-ID: ${DAYTONA_ORGANIZATION_ID}" \
  -H "Content-Type: application/json" \
  -d "{
    \"command\": \"echo $PAYLOAD_B64 | base64 -d | curl -s -X POST https://openrouter.ai/api/v1/chat/completions -H 'Authorization: Bearer $OPENROUTER_API_KEY' -H 'Content-Type: application/json' -d @-\",
    \"timeout\": 60
  }"
```

Expected: Exit code 0, OpenRouter JSON response with chat completion

## 📝 Next Steps

1. **Run diagnostics NOW** to understand sandbox environment:
   ```bash
   ./scripts/test-sandbox-environment.sh 83792513-cd9e-428f-99c0-63c63bc7739c
   ```

2. **Check logs** for any error messages:
   ```bash
   ./scripts/read-daytona-logs.sh 83792513-cd9e-428f-99c0-63c63bc7739c
   ```

3. **Based on results**, implement the appropriate fix:
   - If curl works → Use Approach 1 (curl-based)
   - If files work → Use Approach 2 (file-based)
   - If need persistence → Use Approach 3 (pre-installed script)

## 🔗 Related Files

- **Main issue:** `src/infrastructure/services/acp-bridge.service.ts:665-932`
- **Daytona service:** `src/infrastructure/services/daytona-container.service.ts:122-181`
- **Test scripts:** `scripts/test-sandbox-environment.sh`, `scripts/read-daytona-logs.sh`

## 📚 References

- [Daytona Toolbox API Documentation](https://docs.daytona.io/api/toolbox)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [Bash Command Length Limits](https://www.gnu.org/software/bash/manual/html_node/Command-Line-Editing.html)
