# Claude Code Containers - AI Agent Instructions

## Architecture Overview

This is a **multi-tier AI-powered GitHub automation system** built on Cloudflare
Workers with containerized execution and multi-agent capabilities:

```
GitHub Webhooks → Worker (Hono Router) → Container (Node.js + Claude Code) → GitHub API
        ↓               ↓                       ↓
   Agent-to-Agent    Durable Objects      Multi-Agent System
   Communication    (Encrypted Storage)   (Specialized Agents)
```

**Key Components:**

- **Worker** (`src/index.ts`): Webhook processing, routing, credential
  management via Hono framework
- **Container** (`container_src/src/main.ts`): HTTP server (port 8080) running
  Claude Code SDK + git operations
- **Durable Objects**: `GitHubAppConfigDO` (AES-256-GCM encrypted credentials),
  `MyContainer` (lifecycle management), `UserConfigDO` (multi-tenant support)
- **Multi-Agent System**: RouterAgent, CoordinatorAgent, and specialized agents
  (Design, Frontend, Backend, Security, etc.)

## Critical Development Patterns

### Multi-Tenant Architecture

- **User Registration**: `/register-user` endpoint for user+Installation ID+API
  key
- **Per-User Configuration**: Each user has isolated GitHub App installation
  tokens
- **Container Isolation**: Containers created per-request using unique naming:
  `install-{installationId}-issue-{issueNumber}`
- **API Key Management**: User-specific Anthropic API keys passed securely to
  containers

### Agent-to-Agent Communication

**External agents can communicate with this Claude Code system via:**

- **`/process-prompt` endpoint**: POST requests to create GitHub issues and
  trigger automated processing
- **Multi-tenant support**: Each external agent uses their own Installation ID
  and API key
- **A2A Authentication**: GitHub App installation tokens for server-to-server
  authentication

```typescript
// External agent communication pattern
POST /process-prompt
{
  "userId": "user-123",
  "prompt": "Add authentication to the user service",
  "repository": "myorg/myrepo"
}
```

### Specialized Agent System

The system supports multiple specialized agents with distinct roles:

- **RouterAgent**: Routes tasks to appropriate specialized agents
- **CoordinatorAgent**: Manages multi-agent workflows and communication
- **DesignAgent**: UI/UX design, wireframing, user experience optimization
- **FrontendAgent**: React, Vue, Angular, CSS, responsive design
- **BackendAgent**: APIs, databases, server architecture, performance
- **SecurityAgent**: Authentication, authorization, vulnerability assessment
- **BlockchainAgent**: Smart contracts, Web3, DeFi protocols
- **DatabaseAgent**: Schema design, queries, performance optimization
- **TestingAgent**: Unit tests, integration tests, test automation
- **DevOpsAgent**: CI/CD, deployment, monitoring, infrastructure

### Dual Package Architecture

- **Root** (`package.json`): Cloudflare Worker dependencies (Hono, crypto,
  Durable Objects)
- **Container** (`container_src/package.json`): Node.js runtime dependencies
  (Claude Code SDK, Octokit, git)

**Always install dependencies in the correct location:**

```bash
# Worker dependencies
npm install <package>

# Container dependencies
cd container_src && npm install <package>
```

### Environment Variable Flow

- `.dev.vars` → Worker → Container via `MyContainer.envVars`
- **Never** put secrets in `container_src/.env` (development only)
- Container environment managed by `src/durable-objects.ts:MyContainer`
- **User-specific API keys**: Passed per-request to containers for multi-tenant
  isolation

### Encryption-First Security

All GitHub credentials stored encrypted in `GitHubAppConfigDO`:

- Private keys, webhook secrets, installation tokens encrypted with AES-256-GCM
- Access via `/config` endpoint with proper JSON structure
- Token refresh handled automatically with 5-minute expiry buffer
- **Multi-tenant security**: Each user's credentials isolated and encrypted
  separately

## Development Workflow Commands

```bash
# Start development (both Worker and Container)
npm run dev

# Container development only
cd container_src && npm run dev

# Deploy to production
npm run deploy

# Build and test container locally
cd container_src && npm run build && npm start

# Generate TypeScript types after config changes
npm run cf-typegen

# Check container health
curl http://localhost:8787/container/health

# Debug with container logs
wrangler tail
```

## Container Communication Pattern

Worker-to-Container HTTP requests follow this structure:

```typescript
// Worker sends to Container (port 8080)
const request = {
  type: 'process_issue',
  payload: githubIssuePayload,
  config: decryptedGitHubConfig
}

// Container responds with
const response = {
  success: boolean,
  message: string,
  pullRequestUrl?: string,
  logs?: string[]
}
```

## Claude Code Integration Specifics

Container uses `@anthropic-ai/claude-code` SDK with workspace management:

- Creates isolated `/tmp/workspaces/{uuid}` for each request
- Clones repository with `--depth 1` for performance
- Uses `query()` function directly (not class instance)
- Automatic cleanup after processing

## Key File Responsibilities

- `src/index.ts`: Hono router, webhook validation, Durable Object coordination
- `src/durable-objects.ts`: Container lifecycle, encrypted credential storage
- `src/crypto.ts`: AES-256-GCM encryption utilities
- `container_src/src/main.ts`: HTTP server, request routing, workspace
  management
- `container_src/src/github_client.ts`: GitHub API interactions, PR creation
- `src/types.ts`: TypeScript interfaces and type definitions
- `src/installation-endpoints.ts`: GitHub App installation flow handling
- `src/user-endpoints.ts`: Multi-tenant user management endpoints

## Common Integration Points

**GitHub App Setup:**

- Requires Issues (R/W), Pull Requests (R/W), Contents (R/W), Metadata (R)
  permissions
- Installation ID from URL after app installation
- Store config via `POST /config` with complete JSON structure

**Debugging Container Issues:**

- Check `wrangler tail` for Worker logs
- Container logs via `GET /container/logs/{containerId}`
- Health check: `GET /health`

**Webhook Signature Validation:**

- Uses `X-Hub-Signature-256` header with stored webhook secret
- Crypto.subtle.verify for constant-time comparison
- Required for all `/webhook/github` requests

## Extension Guidelines

When adding new features:

1. **Worker changes**: Update `src/index.ts` routes and `src/types.ts`
   interfaces
2. **Container changes**: Add to `container_src/src/main.ts` request handlers
3. **New credentials**: Extend `GitHubAppConfig` type and encryption/decryption
   logic
4. **Environment vars**: Update both `.dev.vars` and `MyContainer.envVars`

Use TypeScript strictly in Worker code, JavaScript with JSDoc in Container for
Node.js compatibility.

## Multi-Agent Development Patterns

### Agent Communication Flow

```typescript
// Router Agent directs incoming requests
const routerDecision = await RouterAgent.analyze(userPrompt);

// Coordinator Agent manages workflow
const workflow = await CoordinatorAgent.createWorkflow(routerDecision);

// Specialized agents execute tasks
const results = await Promise.all([
  FrontendAgent.processUIChanges(workflow.frontend),
  BackendAgent.processAPIChanges(workflow.backend),
  SecurityAgent.validateChanges(workflow.security),
]);
```

### Specialized Agent Prompts

Each agent type has specific system prompts optimized for their domain:

- **DesignAgent**: "You are a UI/UX design specialist focused on user
  experience..."
- **SecurityAgent**: "You are a security expert focused on identifying
  vulnerabilities..."
- **DevOpsAgent**: "You are a DevOps engineer focused on deployment and
  infrastructure..."

### Container Naming Conventions

For multi-agent workflows:

- Single issue: `install-{installationId}-issue-{issueNumber}`
- Multi-agent coordination: `install-{installationId}-workflow-{workflowId}`
- Agent-specific tasks: `install-{installationId}-agent-{agentType}-{taskId}`

## API Endpoint Reference

### Core Endpoints

- `GET /` - System status and configuration summary
- `POST /webhook/github` - GitHub webhook handler (multi-tenant)
- `POST /process-prompt` - External agent communication
- `GET /health` - Container health check

### User Management (Multi-Tenant)

- `POST /register-user` - Register new user with Installation ID
- `GET /user-config/:userId` - Retrieve user configuration
- `PUT /user-config/:userId` - Update user configuration
- `DELETE /user-config/:userId` - Remove user configuration
- `GET /users` - List all registered users (admin)

### Installation Management

- `GET /install` - GitHub App installation UI
- `GET /install/github-app` - Get installation URL
- `GET /install/callback` - Handle installation callback

### Configuration Management

- `POST /config` - Store encrypted GitHub App configuration
- `GET /config` - Retrieve decrypted configuration
- `DELETE /config` - Clear configuration

## Troubleshooting Guide

### Container Issues

- **503 Service Unavailable**: Container not provisioned - run `npm run deploy`
- **Container timeout**: Increase `PROCESSING_TIMEOUT` and `CLAUDE_CODE_TIMEOUT`
- **Memory issues**: Monitor container resource usage in Cloudflare dashboard

### Authentication Issues

- **Invalid installation token**: Check installation ID and private key format
- **Webhook validation failed**: Verify webhook secret configuration
- **Multi-tenant auth errors**: Ensure user is registered with correct
  Installation ID

### Development Issues

- **Build failures**: Ensure dependencies installed in correct package
  directories
- **Type errors**: Run `npm run cf-typegen` after Worker configuration changes
- **Container connection**: Verify container is built and running on port 8080

```

```
