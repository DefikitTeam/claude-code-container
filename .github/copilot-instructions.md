# AI Coding Agent Instructions

## CRITICAL RULES:

- When use `gemini-cli` mcp server, NEVER specify a model, only input the
  prompt, otherwise it will cause errors; Gemini can automatically determine the
  appropriate model.
- If the analysis task is very complex and requires deep reasoning and analysis,
  specify the model as `gemini-3-pro-preview`.

## Project Overview

**Claude Code Containers** is a dual-tier AI-powered GitHub automation system:

- **Worker Layer** (`src/`): Cloudflare Worker with Clean Architecture handling
  HTTP requests, webhooks, and orchestration
- **Container Layer** (`container_src/`): Node.js container running Claude Code
  SDK with ACP (Agent Client Protocol) support

**Critical Architecture Pattern**: Two-package monorepo with separate dependency
trees:

- Root `package.json` → Worker builds/deploys
- `container_src/package.json` → Container image builds independently

## Clean Architecture Structure (Worker Layer)

```
src/
├── core/          # Business logic (entities, use-cases, interfaces)
├── infrastructure/ # External integrations (Durable Objects, services)
├── api/           # HTTP layer (Hono routes, controllers, DTOs)
└── shared/        # Cross-layer utilities
```

**Key Pattern**: Dependency Injection via factory functions in `src/index.ts`:

```typescript
// Services implement core/interfaces, injected into use-cases
const cryptoService = new CryptoServiceImpl();
const registerUserUseCase = new RegisterUserUseCase(userRepository, githubService, cryptoService);
const userController = new UserController(registerUserUseCase, ...);
```

**DO NOT** import infrastructure directly into core. Always use interfaces from
`core/interfaces/`.

## Container Architecture (ACP Layer)

**Entry Point**: `container_src/src/index.ts` supports multiple modes:

- `--http-server`: HTTP server on port 8080 (default, used by Worker)
- `--http-bridge`: HTTP-to-stdio bridge for OpenHands integration
- (no flags): stdio ACP mode for direct agent communication

**Routing Stack**: Clean architecture in `container_src/src/api/http/`:

- `router.ts`: Main JSON-RPC dispatcher
- `routes/`: Handler registration (`session.routes.ts`, `cancel.routes.ts`,
  etc.)
- `middleware/`: Request validation, error handling
- `server.ts`: HTTP server bootstrap

**Critical**: The legacy HTTP server was removed. Always use the
clean-architecture stack under `api/http/`.

## Durable Objects Bindings

**Wrangler exports vs. DI naming**:

```typescript
// wrangler.jsonc bindings (UPPERCASE_SNAKE)
"bindings": [
  { "class_name": "MyContainer", "name": "MY_CONTAINER" },
  { "class_name": "UserConfigDO", "name": "USER_CONFIG" }
]

// DI code uses binding names from wrangler
const containerService = new ContainerServiceImpl(env.MY_CONTAINER);
const userRepository = new UserRepositoryDurableObjectAdapter(env.USER_CONFIG);
```

**Exported class names must match wrangler.jsonc** (e.g.,
`export { ContainerDO as MyContainer }`).

## Build & Deploy Commands

```bash
# Local development (Worker + Container)
npm run dev              # Starts wrangler dev server on :8787

# Build container independently
cd container_src && pnpm build  # Compiles TS to dist/

# Full build (called by wrangler)
npm run build:all       # Installs container deps + builds container

# Deploy
npm run deploy          # Production deployment
wrangler deploy --env production
```

**Container Dockerfile**: Multi-stage build installs deps, compiles TypeScript,
runs as non-root user (`appuser`). Memory limit: 1GB
(`--max-old-space-size=1024`) for AI SDK operations.

## Testing Strategy

**Location**: `src/test/` (Worker), `container_src/test/` (Container)

**Vitest patterns**:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('ServiceName', () => {
  it('should handle specific scenario', () => {
    const mock = vi.fn().mockResolvedValue(result);
    // Test implementation
  });
});
```

**Run tests**:

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

**Test categories**:

- `*.test.ts`: Unit tests (services, use-cases)
- `*.e2e.test.ts`: End-to-end flows (deployment, GitHub webhooks)
- `*.integration.test.ts`: Cross-layer integration

## Environment Variables

**Worker** (`.dev.vars`, git-ignored):

```env
ANTHROPIC_API_KEY=sk-ant-...
ENCRYPTION_KEY=<32-byte hex from: openssl rand -hex 32>
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
```

**Container**: Inherits from Worker via `env` parameter in container spawn
requests.

**wrangler.jsonc vars** (non-secret config):

```jsonc
"vars": {
  "ENVIRONMENT": "development",
  "ENABLE_DEEP_REASONING": "false"
}
```

## GitHub Integration Flow

1. **Webhook** → `POST /api/github/webhook` → `GitHubController.handleWebhook()`
2. **Use Case** → `ProcessWebhookUseCase` validates signature, extracts issue
   data
3. **Container Spawn** → `ContainerServiceImpl` creates container instance via
   Durable Object stub
4. **HTTP Request** → Worker sends JSON-RPC to container
   `:8080/api/acp/session/prompt`
5. **Claude Processing** → Container runs `ClaudeClient.sendMessage()` with
   workspace context
6. **Git Operations** → Container commits changes, creates branch
7. **PR Creation** → `GitHubAutomationService` creates pull request via Octokit

**Critical Files**:

- `src/api/routes/github.routes.ts`: Webhook endpoint registration
- `container_src/src/handlers/session-prompt-handler.ts`: Prompt processing
  logic
- `container_src/src/services/github/github-automation.service.ts`: PR creation

## Common Patterns

### Adding a New Use Case

1. Create entity in `src/core/entities/` (if needed)
2. Define interface in `src/core/interfaces/services/`
3. Implement use case in `src/core/use-cases/<domain>/`
4. Create implementation in `src/infrastructure/services/`
5. Wire in DI: `src/index.ts` → `setupDI()`
6. Create controller in `src/api/controllers/`
7. Define routes in `src/api/routes/`
8. Add tests in `src/test/`

### Adding Container Endpoint

1. Create handler in `container_src/src/handlers/`
2. Register route in `container_src/src/api/http/routes/`
3. Update `router.ts` to include route registration
4. Add types to `container_src/src/api/http/types.ts`
5. Test via `curl localhost:8080/api/<endpoint>`

### Error Handling Pattern

```typescript
// Use core/errors for domain errors
import { ValidationError, NotFoundError } from '@/core/errors';

// Infrastructure wraps external errors
try {
  await externalService.call();
} catch (error) {
  throw new InfrastructureError('Service failed', { cause: error });
}
```

**Container error classification**:
`container_src/src/core/errors/error-classifier.ts` categorizes errors
(retryable vs. terminal).

## Security Notes

- **All GitHub credentials encrypted** using `CryptoServiceImpl` (AES-256-GCM)
- **Webhook signatures verified** via HMAC-SHA256 before processing
- **Installation tokens cached** with 55-minute expiry (GitHub tokens last 60
  min)
- **Container runs as non-root** (`USER appuser` in Dockerfile)

## Migration Status

**Old structure removed**: References to `src-new/` in comments are outdated.
Current structure is `src/` (Clean Architecture, production-ready).

**IMPORTANT**: Do NOT create new code in non-existent directories like
`src-new/`. All development happens in `src/` and `container_src/`.

## Debugging Tips

```bash
# Watch Worker logs
wrangler tail

# Container logs (when running locally)
docker logs <container-id>

# Test GitHub webhook locally
curl -X POST http://localhost:8787/api/github/webhook \
  -H "X-GitHub-Event: issues" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d @webhook-payload.json

# Test container HTTP endpoint
curl http://localhost:8080/health
```

**Common issues**:

- `Error: Cannot find module '@/core/...'`: Check `tsconfig.json` paths config
  matches Clean Architecture
- `Durable Object not found`: Verify exports in `src/index.ts` match
  wrangler.jsonc class names
- Container OOM (exit 137): Increase `--max-old-space-size` in Dockerfile CMD

## Key Files Reference

| File                                   | Purpose                                         |
| -------------------------------------- | ----------------------------------------------- |
| `src/index.ts`                         | Worker entry, DI setup, Hono app initialization |
| `wrangler.jsonc`                       | Cloudflare config (bindings, migrations, build) |
| `container_src/src/index.ts`           | Container entry, mode detection                 |
| `container_src/src/api/http/router.ts` | JSON-RPC request dispatcher                     |
| `Dockerfile`                           | Container image definition (Node 22 Alpine)     |
| `src/core/use-cases/`                  | Business logic implementation                   |
| `src/infrastructure/durable-objects/`  | Persistent state management                     |

## Do's and Don'ts

✅ **DO**:

- Follow Clean Architecture layers (core → infrastructure → api)
- Use dependency injection for all services
- Write tests alongside new features
- Keep container handlers under 200 LOC (enforced by `check:lines`)
- Update wrangler migrations when adding Durable Objects

❌ **DON'T**:

- Import infrastructure into core layer
- Hardcode secrets (use env vars)
- Skip webhook signature validation
- Create legacy HTTP server code (removed in cleanup)
- Reference `src-new/` directory (doesn't exist)
