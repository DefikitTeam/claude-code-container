# 🤝 Agent Client Protocol (ACP) Integration Guide

## Overview

This guide demonstrates how to integrate the **Agent Client Protocol (ACP)** into your Claude Code container system, enabling any ACP-compatible editor (Zed, VS Code, etc.) to communicate with your Claude Code agent.

## 🏗️ Architecture

```
External Editor (Zed/VS Code/etc.)
    ↓ (ACP over HTTP or stdio)
Cloudflare Worker (ACP Bridge)
    ↓ (Container API)
Container (ACP Agent + Claude Code SDK)
    ↓ (SDK query)
Claude Code AI Service
```

## 🚀 Integration Benefits

### **For External Editors:**
- ✅ **Standardized Protocol** - Use ACP instead of custom APIs
- ✅ **Portable Agents** - Works with any ACP-compatible editor
- ✅ **Rich Capabilities** - Code generation, analysis, file operations
- ✅ **Session Management** - Persistent workspace sessions

### **For Your System:**
- ✅ **Wider Ecosystem** - Compatible with Zed, VS Code extensions
- ✅ **Future-Proof** - Adopts emerging industry standard
- ✅ **Flexible Deployment** - Both stdio and HTTP modes
- ✅ **Secure Isolation** - Container-based execution

## 📦 Implementation Options

### **Option A: Container-Based ACP Agent (Recommended)**

**Best for**: Production deployments, complex workflows

```typescript
// Your system exposes Claude Code via ACP
External Editor → ACP → Worker Bridge → Container Agent → Claude Code
```

**Advantages:**
- Full filesystem access for workspaces
- Secure container isolation
- Complete Claude Code SDK capabilities
- Scalable container instances

### **Option B: Direct Worker ACP Agent**

**Best for**: Simple integrations, lightweight operations

```typescript
// Simpler but limited functionality
External Editor → ACP → Worker Agent → Claude Code (limited)
```

**Advantages:**
- Lower latency
- Simpler deployment
- No container overhead

## 🛠️ Implementation Steps

### **Step 1: Install Dependencies**

```bash
# Container dependencies
cd container_src
npm install @zed-industries/agent-client-protocol
```

### **Step 2: Use the Provided ACP Agent**

The integration includes several ready-to-use components:

#### **Full ACP Agent** (`container_src/src/acp-agent.ts`)
- Complete ACP implementation with Claude Code SDK
- Session management and workspace isolation
- File operations and project analysis
- Code generation and issue fixing

#### **Simple Example** (`container_src/src/examples/example-agent.ts`)
- Minimal ACP agent for testing
- Great starting point for custom implementations
- Demonstrates basic ACP patterns

#### **HTTP Bridge** (`src/acp-bridge.ts`)
- Cloudflare Worker endpoints for ACP communication
- Bridges HTTP requests to container agents
- RESTful API for external systems

### **Step 3: Configure Zed Editor**

Create a Zed configuration to connect to your ACP agent:

```json
// ~/.config/zed/agents.json
{
  "claude-code-container": {
    "command": "curl",
    "args": [
      "-X", "POST",
      "https://your-worker.workers.dev/acp/initialize",
      "-H", "Content-Type: application/json",
      "-d", "{\"clientInfo\":{\"name\":\"zed\",\"version\":\"1.0.0\"}}"
    ]
  }
}
```

### **Step 4: Test Integration**

#### **Test Simple Agent (stdio mode)**
```bash
cd container_src
npm run build
npm run acp:example
```

#### **Test HTTP Bridge**
```bash
# Initialize ACP connection
curl -X POST https://your-worker.workers.dev/acp/initialize \
  -H "Content-Type: application/json" \
  -d '{"clientInfo":{"name":"test-client","version":"1.0.0"}}'

# Create session
curl -X POST https://your-worker.workers.dev/acp/session/create \
  -H "Content-Type: application/json" \
  -d '{}'

# Execute task
curl -X POST https://your-worker.workers.dev/acp/task/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-123",
    "task": {
      "type": "analyze_code",
      "data": {
        "description": "Analyze this TypeScript project"
      }
    }
  }'
```

## 🔧 Configuration

### **Environment Variables**

```bash
# Required for Claude Code SDK
ANTHROPIC_API_KEY=your_anthropic_key

# Optional ACP configuration
ACP_TIMEOUT=30000
ACP_MAX_SESSIONS=10
ACP_SESSION_TIMEOUT=1800000  # 30 minutes
```

### **Zed Agent Configuration**

```json
{
  "agents": {
    "claude-code": {
      "command": "curl",
      "args": [
        "-X", "POST",
        "https://your-worker.workers.dev/acp/task/execute",
        "-H", "Content-Type: application/json",
        "-d", "@-"
      ],
      "env": {
        "ACP_SESSION_ID": "zed-session-1"
      }
    }
  }
}
```

## 📊 API Reference

### **ACP HTTP Endpoints**

#### **Initialize Connection**
```http
POST /acp/initialize
Content-Type: application/json

{
  "clientInfo": {
    "name": "zed",
    "version": "1.0.0"
  }
}
```

#### **Create Session**
```http
POST /acp/session/create
Content-Type: application/json

{}
```

#### **Execute Task**
```http
POST /acp/task/execute
Content-Type: application/json

{
  "sessionId": "session-id",
  "task": {
    "type": "analyze_code|generate_code|fix_issue|review_code",
    "data": {
      "description": "Task description",
      "requirements": ["requirement1", "requirement2"]
    }
  }
}
```

### **Task Types**

#### **Code Analysis**
```typescript
{
  "type": "analyze_code",
  "data": {
    "description": "Analyze the codebase",
    "specific_files": ["src/main.ts", "src/utils.ts"],
    "analysis_type": "security|performance|quality"
  }
}
```

#### **Code Generation**
```typescript
{
  "type": "generate_code",
  "data": {
    "requirements": "Create a REST API endpoint",
    "language": "typescript",
    "framework": "hono",
    "patterns": ["async/await", "error-handling"]
  }
}
```

#### **Issue Fixing**
```typescript
{
  "type": "fix_issue",
  "data": {
    "issue_description": "Fix authentication bug",
    "error_message": "TypeError: Cannot read property 'user'",
    "steps_to_reproduce": "1. Login 2. Navigate to profile",
    "expected_behavior": "Profile should load",
    "actual_behavior": "Error thrown"
  }
}
```

#### **Code Review**
```typescript
{
  "type": "review_code",
  "data": {
    "description": "Review pull request changes",
    "focus_areas": ["security", "performance", "maintainability"]
  }
}
```

## 🔐 Security Considerations

### **Container Isolation**
- Each session runs in isolated workspace
- File operations limited to workspace directory
- No access to host filesystem outside workspace

### **API Authentication**
- Consider adding API key authentication for production
- Implement rate limiting for external requests
- Validate all input parameters

### **Session Management**
- Automatic session cleanup after timeout
- Resource limits per session
- Memory usage monitoring

## 🚀 Deployment Guide

### **Development Environment**
```bash
# Start local development
npm run dev

# Test ACP endpoints
npm run test:acp
```

### **Production Deployment**
```bash
# Deploy to Cloudflare
npm run deploy:prod

# Verify ACP endpoints
curl https://your-worker.workers.dev/acp/status
```

### **Container Configuration**
```dockerfile
# Ensure ACP dependencies are installed
RUN npm install @zed-industries/agent-client-protocol

# Expose ACP port if needed
EXPOSE 3000
```

## 🔍 Troubleshooting

### **Common Issues**

#### **"ACP agent not available"**
- Check container health: `GET /container/health`
- Verify ANTHROPIC_API_KEY is set
- Check container startup logs

#### **"Session not found"**
- Sessions timeout after 30 minutes
- Create new session with `POST /acp/session/create`
- Check session ID in requests

#### **"Task execution failed"**
- Verify task type is supported
- Check Claude Code SDK logs
- Ensure proper workspace setup

### **Debug Mode**
```bash
# Enable ACP debug logging
DEBUG=acp:* npm start

# Enable Claude Code debug logging
DEBUG=claude-code:* npm start
```

## 🌟 Advanced Features

### **Custom Task Types**
Extend the ACP agent with custom task types:

```typescript
// Add to acp-agent.ts
private async handleCustomTask(data: any, session: ClaudeCodeSession): Promise<any> {
  // Your custom logic here
  return {
    type: 'custom_result',
    data: 'Custom task completed'
  };
}
```

### **Multi-Agent Coordination**
```typescript
// Coordinate multiple agents
const results = await Promise.all([
  agent1.executeTask(task1),
  agent2.executeTask(task2),
  agent3.executeTask(task3)
]);
```

### **Streaming Responses**
```typescript
// Enable streaming for long-running tasks
this.connection.sendNotification('task_progress', {
  sessionId: session.id,
  progress: 50,
  message: 'Halfway complete'
});
```

## 📚 Resources

### **Official Documentation**
- [Agent Client Protocol Specification](https://agentclientprotocol.com)
- [Zed ACP Integration Guide](https://zed.dev/docs/ai/external-agents)
- [TypeScript ACP Library](https://www.npmjs.com/package/@zed-industries/agent-client-protocol)

### **Example Implementations**
- [Gemini CLI (Reference Implementation)](https://github.com/google-gemini/gemini-cli)
- [Qodo ACP Adapter](https://github.com/mshirlaw/qodo-acp-adapter)
- [Claude Code Examples](./container_src/src/examples/)

### **Community**
- [ACP GitHub Repository](https://github.com/zed-industries/agent-client-protocol)
- [Zed Community Discord](https://discord.gg/zed)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)

## 🎯 Next Steps

1. **Deploy the integration** to your Cloudflare Worker
2. **Configure Zed** to connect to your ACP endpoints
3. **Test the integration** with sample tasks
4. **Customize task types** for your specific needs
5. **Monitor performance** and optimize as needed

Your Claude Code system is now ACP-compatible and ready to work with any ACP-enabled editor! 🎉