# HTTP API Reference

Complete HTTP API documentation for integrating with the Claude Code Container
system.

## Base URL

```
Production: https://your-worker.com
Development: http://localhost:8787
```

## Authentication

All requests require authentication via API key:

```http
Authorization: Bearer your-anthropic-api-key
Content-Type: application/json
```

---

## Core Endpoints

### 1. Health Check

Check system status and availability.

```http
GET /health
```

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-09-17T10:30:00Z",
  "version": "1.0.0",
  "uptime": 3600
}
```

### 2. Container Health

Check container system status.

```http
GET /container/health
```

**Response:**

```json
{
  "containerStatus": "running",
  "activeContainers": 3,
  "memoryUsage": "45%",
  "cpuUsage": "23%"
}
```

---

## ACP JSON-RPC Proxy

### Primary Endpoint

```http
POST /acp/jsonrpc
```

All ACP methods are available through this JSON-RPC endpoint.

**Request Format:**

```json
{
  "jsonrpc": "2.0",
  "method": "method_name",
  "params": {
    /* method parameters */
  },
  "id": "unique_request_id"
}
```

**Response Format:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    /* method result */
  },
  "id": "unique_request_id"
}
```

**Error Response:**

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": {
      /* additional error info */
    }
  },
  "id": "unique_request_id"
}
```

---

## ACP Methods

### Initialize

Initialize ACP connection and capabilities.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": true
    }
  },
  "id": 1
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "promptCapabilities": {
        "image": true,
        "embeddedContext": true
      },
      "mcpCapabilities": {
        "http": true,
        "sse": false
      }
    },
    "authMethods": [
      {
        "description": "Run `claude /login` in the terminal",
        "name": "Log in with Claude Code",
        "id": "claude-login"
      }
    ]
  },
  "id": 1
}
```

### New Session

Create a new Claude Code session.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "session/new",
  "params": {
    "cwd": "/path/to/workspace",
    "mcpServers": []
  },
  "id": 2
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "uuid-session-id",
    "modes": {
      "currentModeId": "default",
      "availableModes": [
        {
          "id": "default",
          "name": "Always Ask",
          "description": "Prompts for permission on first use of each tool"
        },
        {
          "id": "acceptEdits",
          "name": "Accept Edits",
          "description": "Automatically accepts file edit permissions for the session"
        },
        {
          "id": "bypassPermissions",
          "name": "Bypass Permissions",
          "description": "Skips all permission prompts"
        }
      ]
    }
  },
  "id": 2
}
```

### Send Prompt

Send a prompt to Claude for processing.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "session/prompt",
  "params": {
    "sessionId": "uuid-session-id",
    "prompt": [
      {
        "type": "text",
        "text": "Create a React component for user authentication"
      },
      {
        "type": "resource",
        "resource": {
          "uri": "file:///path/to/existing-component.jsx",
          "text": "// Existing component code for context"
        }
      },
      {
        "type": "image",
        "data": "base64-encoded-image-data",
        "mimeType": "image/png"
      }
    ]
  },
  "id": 3
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "stopReason": "end_turn"
  },
  "id": 3
}
```

**Note:** During processing, you'll receive real-time notifications via the
session update mechanism.

### Set Session Mode

Change session permission mode.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "session/setMode",
  "params": {
    "sessionId": "uuid-session-id",
    "modeId": "acceptEdits"
  },
  "id": 4
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {},
  "id": 4
}
```

### Cancel Session

Cancel a running prompt in a session.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "uuid-session-id"
  },
  "id": 5
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {},
  "id": 5
}
```

---

## File System Operations

### Read Text File

Read contents of a text file.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "fs/readTextFile",
  "params": {
    "path": "/path/to/file.js",
    "limit": 1000,
    "line": 50
  },
  "id": 6
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": "// File contents here...",
    "path": "/path/to/file.js"
  },
  "id": 6
}
```

### Write Text File

Write content to a text file.

```http
POST /acp/jsonrpc
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "fs/writeTextFile",
  "params": {
    "path": "/path/to/file.js",
    "content": "// New file content..."
  },
  "id": 7
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {},
  "id": 7
}
```

---

## Direct Prompt Processing

Alternative endpoint for direct prompt processing without ACP protocol.

### Process Prompt

```http
POST /process-prompt
```

**Request:**

```json
{
  "userId": "user-123",
  "prompt": "Add authentication to the user service",
  "repository": "myorg/myrepo",
  "sessionConfig": {
    "cwd": "/workspace",
    "permissionMode": "acceptEdits"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Pull request created",
  "pullRequestUrl": "https://github.com/myorg/myrepo/pull/123",
  "sessionId": "uuid-session-id",
  "logs": [
    "Processing prompt...",
    "Creating feature branch...",
    "Implementing changes...",
    "Creating pull request..."
  ]
}
```

---

## WebSocket Support (Future)

Real-time bidirectional communication for enhanced interactivity.

### Connection

```javascript
const ws = new WebSocket('wss://your-worker.com/ws');

ws.on('open', () => {
  // Send initialize
  ws.send(
    JSON.stringify({
      type: 'initialize',
      clientCapabilities: {
        /* ... */
      },
    }),
  );
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  // Handle real-time updates
});
```

---

## Error Codes

### Standard JSON-RPC Errors

| Code   | Message          | Description                 |
| ------ | ---------------- | --------------------------- |
| -32700 | Parse error      | Invalid JSON received       |
| -32600 | Invalid Request  | JSON-RPC request is invalid |
| -32601 | Method not found | Method does not exist       |
| -32602 | Invalid params   | Invalid method parameters   |
| -32603 | Internal error   | Internal JSON-RPC error     |

### Custom Error Codes

| Code  | Message                 | Description                  |
| ----- | ----------------------- | ---------------------------- |
| -1001 | Authentication required | Missing or invalid API key   |
| -1002 | Session not found       | Invalid session ID           |
| -1003 | Permission denied       | Insufficient permissions     |
| -1004 | Rate limit exceeded     | Too many requests            |
| -1005 | Worker unavailable      | Container system unavailable |

---

## Rate Limits

| Endpoint          | Limit         | Window     |
| ----------------- | ------------- | ---------- |
| `/acp/jsonrpc`    | 100 requests  | per minute |
| `/process-prompt` | 10 requests   | per minute |
| `/health`         | 1000 requests | per minute |

**Rate Limit Headers:**

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

---

## Request/Response Examples

### cURL Examples

**Initialize:**

```bash
curl -X POST https://your-worker.com/acp/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": 1,
      "clientCapabilities": {
        "fs": {"readTextFile": true, "writeTextFile": true},
        "terminal": true
      }
    },
    "id": 1
  }'
```

**Create Session:**

```bash
curl -X POST https://your-worker.com/acp/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "session/new",
    "params": {
      "cwd": "/workspace",
      "mcpServers": []
    },
    "id": 2
  }'
```

**Send Prompt:**

```bash
curl -X POST https://your-worker.com/acp/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "session/prompt",
    "params": {
      "sessionId": "your-session-id",
      "prompt": [
        {
          "type": "text",
          "text": "Create a React component for a todo list"
        }
      ]
    },
    "id": 3
  }'
```

### JavaScript/TypeScript Examples

**Fetch API:**

```typescript
async function callClaudeAPI(method: string, params: any) {
  const response = await fetch('https://your-worker.com/acp/jsonrpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    }),
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(`API Error: ${result.error.message}`);
  }

  return result.result;
}

// Usage
const initResult = await callClaudeAPI('initialize', {
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
});

const sessionResult = await callClaudeAPI('session/new', {
  cwd: '/workspace',
  mcpServers: [],
});

const promptResult = await callClaudeAPI('session/prompt', {
  sessionId: sessionResult.sessionId,
  prompt: [{ type: 'text', text: 'Help me create a login form' }],
});
```

**Axios Example:**

```typescript
import axios from 'axios';

const claudeAPI = axios.create({
  baseURL: 'https://your-worker.com',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
  },
});

async function sendJSONRPC(method: string, params: any) {
  const response = await claudeAPI.post('/acp/jsonrpc', {
    jsonrpc: '2.0',
    method,
    params,
    id: Date.now(),
  });

  if (response.data.error) {
    throw new Error(response.data.error.message);
  }

  return response.data.result;
}
```

---

## SDKs and Libraries

### Official JavaScript/TypeScript SDK

```bash
npm install @defikitteam/claude-acp-client
```

```typescript
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

const client = new ClaudeHTTPClient({
  baseURL: 'https://your-worker.com',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Use the client
const session = await client.createSession('/workspace');
const response = await client.sendPrompt(
  session.sessionId,
  'Create a React component',
);
```

### Community SDKs

- **Python**: `pip install claude-acp-python`
- **Go**: `go get github.com/defikit/claude-acp-go`
- **Rust**: `cargo add claude-acp-rust`
- **Java**: Available on Maven Central

---

## Monitoring and Observability

### Health Monitoring

```bash
# Check overall system health
curl https://your-worker.com/health

# Check specific container health
curl https://your-worker.com/container/health

# Check API endpoint availability
curl -I https://your-worker.com/acp/jsonrpc
```

### Metrics Endpoints

```http
GET /metrics
```

**Response:**

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="POST",endpoint="/acp/jsonrpc"} 1234

# HELP session_duration_seconds Session duration in seconds
# TYPE session_duration_seconds histogram
session_duration_seconds_bucket{le="1"} 100
session_duration_seconds_bucket{le="5"} 450
session_duration_seconds_bucket{le="10"} 800
```

### Logging

Request/response logging for debugging:

```bash
# Enable debug logging
DEBUG=claude-acp:* node your-app.js

# Request logging format
[2025-09-17T10:30:00Z] INFO: Request POST /acp/jsonrpc - method: session/prompt
[2025-09-17T10:30:05Z] INFO: Response 200 - duration: 5.2s
```

---

## Testing

### Test Endpoints

```bash
# Test connectivity
curl https://your-worker.com/health

# Test authentication
curl -H "Authorization: Bearer test-key" https://your-worker.com/acp/jsonrpc \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# Load testing
ab -n 100 -c 10 -H "Authorization: Bearer your-key" \
  -p test-payload.json https://your-worker.com/acp/jsonrpc
```

### Mock Server

For testing without hitting production:

```javascript
// Mock server for testing
const mockServer = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: {
      /* ... */
    },
  }),
  'session/new': () => ({
    sessionId: 'mock-session-id',
  }),
  'session/prompt': () => ({
    stopReason: 'end_turn',
  }),
};
```

---

## Migration Guide

### From Direct Container to HTTP API

**Before (Direct Container):**

```typescript
import { processIssue } from './container';

const result = await processIssue(issueContext, githubToken);
```

**After (HTTP API):**

```typescript
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

const client = new ClaudeHTTPClient({
  baseURL: 'https://your-worker.com',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const session = await client.createSession('/workspace');
const result = await client.sendPrompt(session.sessionId, 'Process this issue');
```

### Batch Migration Script

```bash
#!/bin/bash
# Migration script for updating integrations

# Update package dependencies
npm uninstall claude-code-container
npm install @defikitteam/claude-acp-client

# Update environment variables
echo "WORKER_URL=https://your-worker.com" >> .env

# Update code (using sed/awk)
find . -name "*.ts" -exec sed -i 's/import.*claude-code-container/import { ClaudeHTTPClient } from "@defikitteam\/claude-acp-client"/g' {} \;
```
