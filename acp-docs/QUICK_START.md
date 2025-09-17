# Quick Start Guide - External Agent Integration

Get started with Claude Code Container integration in under 5 minutes.

## 🚀 Quick Setup

### Step 1: Choose Your Integration Method

**Option A: NPM Package (Recommended)**
```bash
npm install @defikitteam/claude-acp-client
```

**Option B: Direct HTTP API**
```bash
curl -X POST https://your-worker.com/acp/jsonrpc
```

### Step 2: Get Your API Key

```bash
export ANTHROPIC_API_KEY="your-claude-api-key"
export WORKER_URL="https://your-worker.com"  # Optional for HTTP mode
```

### Step 3: Test Connection

```bash
# Test health
curl https://your-worker.com/health

# Test ACP package
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":1},"id":1}' | claude-acp-client
```

---

## 🎯 5-Minute Integration Examples

### Example 1: Simple Q&A Agent

```typescript
import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';

async function askClaude(question: string): Promise<string> {
  const client = new ClaudeHTTPClient({
    baseURL: process.env.WORKER_URL!,
    apiKey: process.env.ANTHROPIC_API_KEY!
  });
  
  // Initialize
  await client.initialize();
  
  // Create session
  const session = await client.createSession(process.cwd());
  
  // Ask question
  await client.sendPrompt(session.sessionId, question);
  
  return "Response received"; // Actual response via notifications
}

// Usage
const answer = await askClaude("How do I create a React component?");
console.log(answer);
```

### Example 2: Code Review Agent

```typescript
import fs from 'fs';

async function reviewCode(filePath: string): Promise<void> {
  const code = fs.readFileSync(filePath, 'utf8');
  
  const client = new ClaudeHTTPClient({
    baseURL: process.env.WORKER_URL!,
    apiKey: process.env.ANTHROPIC_API_KEY!
  });
  
  await client.initialize();
  const session = await client.createSession(process.cwd());
  
  const prompt = `Please review this code for best practices, bugs, and improvements:

\`\`\`typescript
${code}
\`\`\``;

  await client.sendPrompt(session.sessionId, prompt);
}

// Usage
await reviewCode('./src/components/UserAuth.tsx');
```

### Example 3: CLI Tool

```typescript
#!/usr/bin/env node

import { ClaudeHTTPClient } from '@defikitteam/claude-acp-client';
import { program } from 'commander';

program
  .command('ask <question>')
  .description('Ask Claude a question')
  .action(async (question) => {
    const client = new ClaudeHTTPClient({
      baseURL: process.env.WORKER_URL || 'https://your-worker.com',
      apiKey: process.env.ANTHROPIC_API_KEY!
    });
    
    await client.initialize();
    const session = await client.createSession(process.cwd());
    await client.sendPrompt(session.sessionId, question);
  });

program.parse();
```

```bash
# Usage
npm install -g your-claude-cli
claude-cli ask "How do I optimize this React app?"
```

---

## 📋 Integration Checklist

### ✅ Basic Setup
- [ ] Install package or setup HTTP client
- [ ] Configure API key
- [ ] Test connectivity
- [ ] Verify worker URL

### ✅ Core Integration
- [ ] Initialize ACP connection
- [ ] Create session
- [ ] Send test prompt
- [ ] Handle responses

### ✅ Error Handling
- [ ] API key validation
- [ ] Network error handling
- [ ] Rate limit handling
- [ ] Session lifecycle management

### ✅ Production Ready
- [ ] Logging setup
- [ ] Health checks
- [ ] Monitoring
- [ ] Load testing

---

## 🛠️ Common Patterns

### Pattern 1: Session Per User

```typescript
class UserClaudeSession {
  private sessions = new Map<string, string>();
  private client: ClaudeHTTPClient;
  
  constructor() {
    this.client = new ClaudeHTTPClient({
      baseURL: process.env.WORKER_URL!,
      apiKey: process.env.ANTHROPIC_API_KEY!
    });
  }
  
  async getOrCreateSession(userId: string): Promise<string> {
    if (!this.sessions.has(userId)) {
      await this.client.initialize();
      const session = await this.client.createSession('/workspace');
      this.sessions.set(userId, session.sessionId);
    }
    
    return this.sessions.get(userId)!;
  }
  
  async askQuestion(userId: string, question: string): Promise<void> {
    const sessionId = await this.getOrCreateSession(userId);
    await this.client.sendPrompt(sessionId, question);
  }
}
```

### Pattern 2: Request Queue

```typescript
class ClaudeQueue {
  private queue: Array<{prompt: string, resolve: Function}> = [];
  private processing = false;
  
  async addToQueue(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.queue.push({ prompt, resolve });
      this.processQueue();
    });
  }
  
  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const { prompt, resolve } = this.queue.shift()!;
    
    // Process with Claude
    const response = await this.client.sendPrompt(this.sessionId, prompt);
    resolve(response);
    
    this.processing = false;
    this.processQueue(); // Process next item
  }
}
```

### Pattern 3: Context Management

```typescript
class ContextAwareClaude {
  private context: string[] = [];
  
  addContext(type: string, content: string) {
    this.context.push(`[${type}] ${content}`);
    
    // Keep only last 10 context items
    if (this.context.length > 10) {
      this.context.shift();
    }
  }
  
  async askWithContext(question: string): Promise<void> {
    const contextPrompt = `
Context:
${this.context.join('\n')}

Question: ${question}
    `.trim();
    
    await this.client.sendPrompt(this.sessionId, contextPrompt);
  }
}

// Usage
const claude = new ContextAwareClaude();
claude.addContext('file', 'User is working on auth.tsx');
claude.addContext('error', 'Getting TypeScript errors');
await claude.askWithContext('How do I fix these TypeScript errors?');
```

---

## 🔧 Configuration Templates

### Environment Variables

```bash
# .env file
ANTHROPIC_API_KEY=your-api-key-here
WORKER_URL=https://your-worker.com
DEBUG=claude-acp:*

# Optional configurations
CLAUDE_TIMEOUT=30000
CLAUDE_RETRY_COUNT=3
CLAUDE_BATCH_SIZE=5
```

### Package.json Scripts

```json
{
  "scripts": {
    "claude:test": "node test-claude-integration.js",
    "claude:local": "claude-acp-client",
    "claude:remote": "claude-acp-client --http-bridge",
    "claude:health": "curl $WORKER_URL/health"
  }
}
```

### Docker Configuration

```dockerfile
# Dockerfile for your agent
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

ENV ANTHROPIC_API_KEY=""
ENV WORKER_URL="https://your-worker.com"

CMD ["node", "your-agent.js"]
```

---

## 🐛 Troubleshooting

### Quick Fixes

| Problem | Quick Fix |
|---------|-----------|
| **401 Unauthorized** | Check `ANTHROPIC_API_KEY` |
| **Connection refused** | Verify `WORKER_URL` |
| **Timeout errors** | Increase timeout, check network |
| **Session not found** | Create new session |
| **Rate limited** | Implement backoff |

### Debug Commands

```bash
# Test API key
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" https://your-worker.com/health

# Test ACP locally
echo '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' | DEBUG=* claude-acp-client

# Test HTTP endpoint
curl -v -X POST https://your-worker.com/acp/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":1},"id":1}'
```

---

## 📊 Performance Tips

### 1. **Connection Reuse**
```typescript
// Good: Reuse client instance
const client = new ClaudeHTTPClient(config);

// Bad: Create new client for each request
const client = new ClaudeHTTPClient(config); // Don't do this repeatedly
```

### 2. **Session Management**
```typescript
// Good: Long-lived sessions
const sessionId = await client.createSession('/workspace');
// Use sessionId for multiple prompts

// Bad: New session per prompt
await client.createSession('/workspace'); // Don't do this for each prompt
```

### 3. **Batch Requests**
```typescript
// Good: Batch multiple prompts
const prompts = ['Question 1', 'Question 2', 'Question 3'];
const promises = prompts.map(prompt => client.sendPrompt(sessionId, prompt));
await Promise.all(promises);
```

---

## 📚 Next Steps

1. **Read Full Documentation**: [CLIENT_INTEGRATION_GUIDE.md](./CLIENT_INTEGRATION_GUIDE.md)
2. **API Reference**: [HTTP_API_REFERENCE.md](./HTTP_API_REFERENCE.md)
3. **Examples Repository**: [GitHub Examples](https://github.com/DefikitTeam/claude-acp-examples)
4. **Join Community**: [Discussions](https://github.com/DefikitTeam/claude-code-container/discussions)

Happy coding! 🎉