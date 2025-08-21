# Claude Code Containers - AI Agent Instructions

## Architecture Overview

This is a **multi-tier AI-powered GitHub automation system** built on Cloudflare Workers with containerized execution:

```
GitHub Webhooks → Worker (Hono Router) → Container (Node.js + Claude Code) → GitHub API
                      ↓
                 Durable Objects (Encrypted Storage)
```

**Key Components:**
- **Worker** (`src/index.ts`): Webhook processing, routing, credential management via Hono framework
- **Container** (`container_src/src/main.js`): HTTP server (port 8080) running Claude Code SDK + git operations
- **Durable Objects**: `GitHubAppConfigDO` (AES-256-GCM encrypted credentials), `MyContainer` (lifecycle management)

## Critical Development Patterns

### Dual Package Architecture
- **Root** (`package.json`): Cloudflare Worker dependencies (Hono, crypto, Durable Objects)
- **Container** (`container_src/package.json`): Node.js runtime dependencies (Claude Code SDK, Octokit, git)

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

### Encryption-First Security
All GitHub credentials stored encrypted in `GitHubAppConfigDO`:
- Private keys, webhook secrets, installation tokens encrypted with AES-256-GCM
- Access via `/config` endpoint with proper JSON structure
- Token refresh handled automatically with 5-minute expiry buffer

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
- `container_src/src/main.js`: HTTP server, request routing, workspace management
- `container_src/src/claude-code-processor.js`: Claude Code analysis and git operations  
- `container_src/src/github-service.js`: GitHub API interactions, PR creation

## Common Integration Points

**GitHub App Setup:**
- Requires Issues (R/W), Pull Requests (R/W), Contents (R/W), Metadata (R) permissions
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
1. **Worker changes**: Update `src/index.ts` routes and `src/types.ts` interfaces
2. **Container changes**: Add to `container_src/src/main.js` request handlers
3. **New credentials**: Extend `GitHubAppConfig` type and encryption/decryption logic
4. **Environment vars**: Update both `.dev.vars` and `MyContainer.envVars`

Use TypeScript strictly in Worker code, JavaScript with JSDoc in Container for Node.js compatibility.
