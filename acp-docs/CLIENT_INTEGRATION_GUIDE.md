# Client Integration Guide - Claude ACP Agent Communication

This guide shows how external agents and context systems can integrate with our Claude Code container system using the lightweight ACP client.

## 🎯 Overview

Our system provides **agent-to-agent communication** through multiple interfaces:

```
┌─────────────────┐    ACP/HTTP    ┌─────────────────┐    HTTP/JSON    ┌─────────────────┐
│ External Agent  │ ────────────── │ Lightweight     │ ─────────────── │ Remote Worker   │
│ (Your System)   │                │ ACP Client      │                 │ (Our Container) │
└─────────────────┘                └─────────────────┘                 └─────────────────┘
```

**Two Integration Approaches:**
1. **Direct ACP Integration** - Use our client as ACP subprocess
2. **HTTP API Integration** - Call our worker endpoints directly

---

## 🚀 Quick Start

### Option 1: NPM Package Integration

```bash
# Install lightweight ACP client
npm install @defikitteam/claude-acp-client

# Use programmatically
import { LightweightClaudeAcpAgent } from '@defikitteam/claude-acp-client';
```

### Option 2: Direct HTTP API

```bash
# Call worker endpoints directly
curl -X POST https://your-worker.com/acp/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"jsonrpc":"2.0","method":"session/prompt","params":{"sessionId":"123","prompt":[{"type":"text","text":"Create a React component"}]},"id":1}'
```

---

## 📖 Integration Methods

### Method 1: ACP Subprocess Integration

Best for: **IDE extensions, editors, development tools**

```typescript
import { spawn } from 'child_process';

class ClaudeAcpIntegration {
  private acpProcess: any;
  
  async initialize() {
    // Spawn our ACP client as subprocess
    this.acpProcess = spawn('claude-acp-client', [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Send ACP initialize request
    const initRequest = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true
        }
      },
      id: 1
    };
    
    this.acpProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    
    // Listen for responses
    this.acpProcess.stdout.on('data', (data) => {
      const response = JSON.parse(data.toString());
      console.log('ACP Response:', response);
    });
  }
  
  async createSession(cwd: string) {
    const request = {
      jsonrpc: '2.0',
      method: 'session/new',
      params: {
        cwd: cwd,
        mcpServers: []
      },
      id: 2
    };
    
    this.acpProcess.stdin.write(JSON.stringify(request) + '\n');
  }
  
  async sendPrompt(sessionId: string, prompt: string) {
    const request = {
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [
          { type: 'text', text: prompt }
        ]
      },
      id: Date.now()
    };
    
    this.acpProcess.stdin.write(JSON.stringify(request) + '\n');
  }
}

// Usage
const claude = new ClaudeAcpIntegration();
await claude.initialize();
await claude.createSession('/path/to/project');
await claude.sendPrompt('session-id', 'Create a login component');
```

### Method 2: HTTP Bridge Integration

Best for: **Web applications, services, cloud systems**

```typescript
class ClaudeHttpIntegration {
  constructor(
    private workerUrl: string,
    private apiKey: string
  ) {}
  
  async sendJsonRpc(method: string, params: any): Promise<any> {
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    };
    
    const response = await fetch(`${this.workerUrl}/acp/jsonrpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(request)
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(`Claude API Error: ${result.error.message}`);
    }
    
    return result.result;
  }
  
  async initialize() {
    return this.sendJsonRpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true
      }
    });
  }
  
  async createSession(cwd: string) {
    return this.sendJsonRpc('session/new', {
      cwd,
      mcpServers: []
    });
  }
  
  async sendPrompt(sessionId: string, prompt: string) {
    return this.sendJsonRpc('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: prompt }]
    });
  }
}

// Usage
const claude = new ClaudeHttpIntegration(
  'https://your-worker.com',
  'your-api-key'
);

const initResult = await claude.initialize();
const session = await claude.createSession('/workspace');
const response = await claude.sendPrompt(session.sessionId, 'Help me debug this code');
```

### Method 3: Hybrid Integration

Best for: **Complex systems needing both local and remote capabilities**

```typescript
class ClaudeHybridIntegration {
  constructor(
    private useRemote: boolean = false,
    private workerUrl?: string,
    private apiKey?: string
  ) {}
  
  async createAgent(): Promise<ClaudeAcpIntegration | ClaudeHttpIntegration> {
    if (this.useRemote && this.workerUrl && this.apiKey) {
      // Use HTTP bridge to remote worker
      return new ClaudeHttpIntegration(this.workerUrl, this.apiKey);
    } else {
      // Use local ACP subprocess
      return new ClaudeAcpIntegration();
    }
  }
  
  async intelligentRouting(task: string): Promise<any> {
    // Route based on task complexity
    const isComplexTask = task.includes('github') || task.includes('deploy');
    
    if (isComplexTask) {
      // Use remote worker for complex tasks
      const remoteAgent = new ClaudeHttpIntegration(this.workerUrl!, this.apiKey!);
      return remoteAgent.sendPrompt('session-id', task);
    } else {
      // Use local client for simple tasks
      const localAgent = new ClaudeAcpIntegration();
      await localAgent.initialize();
      return localAgent.sendPrompt('session-id', task);
    }
  }
}
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="your-claude-api-key"

# Optional for HTTP bridge mode
export WORKER_URL="https://your-worker.com"
export DEBUG="claude-acp:*"  # Enable verbose logging
```

### Package.json Setup

```json
{
  "dependencies": {
    "@defikitteam/claude-acp-client": "^0.1.0"
  },
  "scripts": {
    "claude:local": "claude-acp-client",
    "claude:remote": "claude-acp-client --http-bridge --worker-url https://your-worker.com"
  }
}
```

---

## 📋 API Reference

### ACP Methods

| Method | Description | Parameters |
|--------|-------------|------------|
| `initialize` | Initialize ACP connection | `protocolVersion`, `clientCapabilities` |
| `session/new` | Create new session | `cwd`, `mcpServers` |
| `session/prompt` | Send prompt to Claude | `sessionId`, `prompt` |
| `session/cancel` | Cancel running prompt | `sessionId` |
| `session/setMode` | Set session permission mode | `sessionId`, `modeId` |
| `fs/readTextFile` | Read file content | `path`, `limit?`, `line?` |
| `fs/writeTextFile` | Write file content | `path`, `content` |

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/acp/jsonrpc` | POST | JSON-RPC ACP proxy |
| `/process-prompt` | POST | Direct prompt processing |
| `/health` | GET | System health check |
| `/container/health` | GET | Container status |

### Request/Response Format

**ACP JSON-RPC Request:**
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
          "uri": "file:///path/to/context.js",
          "text": "// existing code context"
        }
      }
    ]
  },
  "id": 123
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "stopReason": "end_turn"
  },
  "id": 123
}
```

---

## 🎮 Usage Examples

### Example 1: IDE Extension Integration

```typescript
// VS Code extension integrating with our ACP client
export class ClaudeCodeExtension {
  private claude: ClaudeAcpIntegration;
  
  async activate(context: vscode.ExtensionContext) {
    this.claude = new ClaudeAcpIntegration();
    await this.claude.initialize();
    
    // Register command
    const disposable = vscode.commands.registerCommand(
      'extension.askClaude',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        const selection = editor.document.getText(editor.selection);
        const prompt = `Explain this code:\n\n${selection}`;
        
        await this.claude.sendPrompt('session-id', prompt);
      }
    );
    
    context.subscriptions.push(disposable);
  }
}
```

### Example 2: Web Application Integration

```typescript
// React component using HTTP integration
function ClaudeChat() {
  const [claude] = useState(() => new ClaudeHttpIntegration(
    process.env.REACT_APP_WORKER_URL,
    process.env.REACT_APP_API_KEY
  ));
  
  const [session, setSession] = useState<string>();
  
  useEffect(() => {
    claude.initialize().then(() => {
      return claude.createSession('/workspace');
    }).then((sessionResult) => {
      setSession(sessionResult.sessionId);
    });
  }, []);
  
  const askClaude = async (question: string) => {
    if (!session) return;
    
    const response = await claude.sendPrompt(session, question);
    return response;
  };
  
  return (
    <div>
      <ChatInterface onSend={askClaude} />
    </div>
  );
}
```

### Example 3: CLI Tool Integration

```typescript
#!/usr/bin/env node
// CLI tool using our package

import { ClaudeHttpIntegration } from './claude-integration.js';

class ClaudeCLI {
  private claude: ClaudeHttpIntegration;
  
  constructor() {
    this.claude = new ClaudeHttpIntegration(
      process.env.WORKER_URL!,
      process.env.ANTHROPIC_API_KEY!
    );
  }
  
  async run() {
    const args = process.argv.slice(2);
    const command = args[0];
    const prompt = args.slice(1).join(' ');
    
    await this.claude.initialize();
    const session = await this.claude.createSession(process.cwd());
    
    switch (command) {
      case 'ask':
        const response = await this.claude.sendPrompt(session.sessionId, prompt);
        console.log(response);
        break;
        
      case 'review':
        const reviewPrompt = `Please review this codebase: ${prompt}`;
        const review = await this.claude.sendPrompt(session.sessionId, reviewPrompt);
        console.log(review);
        break;
        
      default:
        console.log('Usage: claude-cli ask "your question"');
    }
  }
}

new ClaudeCLI().run().catch(console.error);
```

---

## 🔐 Authentication & Security

### API Key Management

```typescript
// Secure API key handling
class SecureClaudeIntegration {
  private apiKey: string;
  
  constructor() {
    // Load from secure sources
    this.apiKey = process.env.ANTHROPIC_API_KEY || 
                  this.loadFromVault() || 
                  this.promptForKey();
  }
  
  private loadFromVault(): string | null {
    // Integration with password managers, key vaults, etc.
    return null;
  }
  
  private promptForKey(): string {
    // Secure input for API key
    return require('readline-sync').question('Enter API key: ', {
      hideEchoBack: true
    });
  }
}
```

### Rate Limiting & Error Handling

```typescript
class ResilientClaudeIntegration {
  private retryCount = 3;
  private backoffMs = 1000;
  
  async sendWithRetry(method: string, params: any): Promise<any> {
    for (let i = 0; i < this.retryCount; i++) {
      try {
        return await this.claude.sendJsonRpc(method, params);
      } catch (error) {
        if (i === this.retryCount - 1) throw error;
        
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, this.backoffMs * Math.pow(2, i))
        );
      }
    }
  }
}
```

---

## 📊 Performance Optimization

### Batch Operations

```typescript
class BatchClaudeIntegration {
  private batchSize = 5;
  private queue: Array<{method: string, params: any, resolve: Function}> = [];
  
  async batchRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve) => {
      this.queue.push({ method, params, resolve });
      
      if (this.queue.length >= this.batchSize) {
        this.processBatch();
      }
    });
  }
  
  private async processBatch() {
    const batch = this.queue.splice(0, this.batchSize);
    
    // Process requests in parallel
    const promises = batch.map(({ method, params }) => 
      this.claude.sendJsonRpc(method, params)
    );
    
    const results = await Promise.all(promises);
    
    // Resolve promises
    batch.forEach(({ resolve }, index) => {
      resolve(results[index]);
    });
  }
}
```

### Connection Pooling

```typescript
class PooledClaudeIntegration {
  private pool: ClaudeHttpIntegration[] = [];
  private maxPoolSize = 5;
  
  async getConnection(): Promise<ClaudeHttpIntegration> {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    
    // Create new connection if pool is empty
    const claude = new ClaudeHttpIntegration(this.workerUrl, this.apiKey);
    await claude.initialize();
    return claude;
  }
  
  async releaseConnection(claude: ClaudeHttpIntegration) {
    if (this.pool.length < this.maxPoolSize) {
      this.pool.push(claude);
    }
  }
}
```

---

## 🐛 Troubleshooting

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| **Connection Timeout** | Network/Worker issues | Check worker health, implement retry logic |
| **Auth Errors** | Invalid API key | Verify `ANTHROPIC_API_KEY` environment variable |
| **ACP Parse Errors** | Malformed JSON-RPC | Validate request format against ACP spec |
| **Session Not Found** | Invalid session ID | Create new session or check session lifecycle |
| **Permission Denied** | Missing capabilities | Update `clientCapabilities` in initialize |

### Debug Mode

```bash
# Enable verbose logging
DEBUG=claude-acp:* node your-app.js

# Test HTTP endpoints
curl -v https://your-worker.com/health

# Test ACP locally
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":1},"id":1}' | claude-acp-client
```

### Health Checks

```typescript
class ClaudeHealthChecker {
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.workerUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
  
  async checkAcpConnection(): Promise<boolean> {
    try {
      const result = await this.claude.initialize();
      return !!result.protocolVersion;
    } catch {
      return false;
    }
  }
}
```

---

## 📚 Best Practices

### 1. **Session Management**
- Create sessions per user/project
- Implement session cleanup
- Handle session expiration gracefully

### 2. **Error Handling**
- Always implement retry logic
- Log errors for debugging
- Provide fallback mechanisms

### 3. **Performance**
- Use connection pooling for high-traffic
- Implement request batching
- Cache responses when appropriate

### 4. **Security**
- Never log API keys
- Use environment variables for secrets
- Implement rate limiting

### 5. **Testing**
- Mock ACP responses for unit tests
- Test both local and remote modes
- Validate error scenarios

---

## 🔗 Integration Examples Repository

Find complete working examples at:
- **GitHub**: [DefikitTeam/claude-acp-examples](https://github.com/DefikitTeam/claude-acp-examples)
- **VS Code Extension**: [examples/vscode-extension/](examples/vscode-extension/)
- **React App**: [examples/react-app/](examples/react-app/)
- **CLI Tool**: [examples/cli-tool/](examples/cli-tool/)
- **Node.js Service**: [examples/nodejs-service/](examples/nodejs-service/)

---

## 🆘 Support & Community

- **Issues**: [GitHub Issues](https://github.com/DefikitTeam/claude-code-container/issues)
- **Discussions**: [GitHub Discussions](https://github.com/DefikitTeam/claude-code-container/discussions)
- **Documentation**: [Full Docs](https://docs.defikit.team/claude-acp)
- **Examples**: [Integration Examples](https://github.com/DefikitTeam/claude-acp-examples)

Happy coding with Claude! 🎉