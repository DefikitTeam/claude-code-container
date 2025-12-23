# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an automated GitHub issue processing system built on Cloudflare Workers with containerized Claude Code execution. The system receives GitHub webhooks, spawns containers running Claude Code SDK, analyzes issues, generates code changes, and creates pull requests automatically.

**Key Technologies:**
- TypeScript 5.8.3, Node.js 22+
- Cloudflare Workers, Durable Objects, Containers
- Hono web framework
- Vercel AI SDK, OpenRouter OpenAI SDK, Anthropic Claude Code SDK
- Vitest for testing

## Development Commands

### Local Development
```bash
# Start local dev server (port 8788)
pnpm dev

# Generate TypeScript types from wrangler.jsonc
pnpm cf-typegen

# Install all dependencies (worker + container)
pnpm install:all

# Build everything (worker + container)
pnpm build:all
```

### Testing
```bash
# Run all tests
pnpm test

# Watch mode for TDD
pnpm test:watch

# Test with coverage
pnpm test -- --coverage
```

### Container Development
```bash
# Work on container code in container_src/
cd container_src

# Build container
pnpm build

# Run container locally (requires .dev.vars)
pnpm dev
```

### Deployment
```bash
# Deploy to development
wrangler deploy --env development

# Deploy to staging
wrangler deploy --env staging

# Deploy to production
pnpm deploy:prod
```

## Architecture Overview

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────┐
│  API Layer (Hono Router)                        │
│  - Controllers, Routes, Middleware, DTOs        │
│  - src/api/                                     │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Core Layer (Business Logic)                    │
│  - Use Cases, Entities, Interfaces              │
│  - src/core/                                    │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Infrastructure Layer                           │
│  - Durable Objects, Services, Adapters          │
│  - src/infrastructure/                          │
└─────────────────────────────────────────────────┘
```

### Key Components

**Worker** (`src/index.ts`): Main entry point, DI setup, routing
**Container** (`container_src/src/index.ts`): Claude Code SDK execution environment
**Durable Objects** (`src/infrastructure/durable-objects/`):
  - `UserConfigDO`: User settings and credentials (encrypted)
  - `GitHubAppConfigDO`: GitHub App configuration (encrypted)
  - `ACPSessionDO`: Agent Communication Protocol sessions
  - `ContainerDO`: Container lifecycle management
  - `AsyncJobDO`: Background job tracking

**Container Providers** (`src/infrastructure/services/`):
  - `CloudflareContainerService`: Uses Cloudflare Containers (default)
  - `DaytonaContainerService`: Uses Daytona cloud development environments
  - Abstracted via `IContainerService` interface

### Clean Architecture Pattern

This project follows Clean Architecture with dependency inversion:

1. **Core layer** (`src/core/`) - No dependencies on infrastructure
   - `entities/` - Domain models
   - `use-cases/` - Application business rules
   - `interfaces/` - Contracts (repositories, services)

2. **Infrastructure layer** (`src/infrastructure/`) - Implements core interfaces
   - `services/` - External service implementations
   - `repositories/` - Data persistence implementations
   - `durable-objects/` - Cloudflare DO storage
   - `adapters/` - Third-party API wrappers

3. **API layer** (`src/api/`) - HTTP interface
   - `controllers/` - Request/response handling
   - `routes/` - Route definitions
   - `middleware/` - Cross-cutting concerns
   - `dto/` - Data transfer objects with Zod validation

### Container Provider Abstraction

The system supports pluggable container providers via `IContainerService`:

```typescript
// Core interface (src/core/interfaces/services/container.service.ts)
interface IContainerService {
  acquireContainer(userId: string, config: ContainerConfig): Promise<Container>
  executeCommand(containerId: string, command: string): Promise<CommandResult>
  getContainerDiagnostics(containerId: string): Promise<Diagnostics>
  terminateContainer(containerId: string): Promise<void>
}

// Implementations
- CloudflareContainerService (Durable Object backed)
- DaytonaContainerService (Daytona API backed)
```

Set via `CONTAINER_PROVIDER` environment variable in `wrangler.jsonc`.

## Environment Configuration

### Required Variables

Create `.dev.vars` file (git-ignored) for local development:

```env
ANTHROPIC_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
ENCRYPTION_KEY=generate_with_openssl_rand_hex_32
```

### Container Provider Selection

In `wrangler.jsonc`:
```json
"vars": {
  "CONTAINER_PROVIDER": "cloudflare"  // or "daytona"
}
```

**IMPORTANT**: Choose once and stick with it - switching causes context loss!

### Daytona-Specific Variables

Only needed if `CONTAINER_PROVIDER=daytona`:
```env
DAYTONA_API_KEY=your_daytona_key
DAYTONA_ORGANIZATION_ID=your_org_id
```

## Code Organization Rules

### File Placement
- **Use cases**: `src/core/use-cases/{domain}/{action}.use-case.ts`
- **Services**: `src/infrastructure/services/{name}.service.impl.ts`
- **Controllers**: `src/api/controllers/{domain}.controller.ts`
- **Tests**: Mirror source structure in `src/test/` or `test/`

### Naming Conventions
- Use cases: `VerbNounUseCase` (e.g., `ProcessWebhookUseCase`)
- Services: `NounServiceImpl` (e.g., `GitHubServiceImpl`)
- Controllers: `NounController` (e.g., `UserController`)
- DTOs: `action-noun.dto.ts` (e.g., `process-prompt.dto.ts`)
- Interfaces: `INounService` (e.g., `IContainerService`)

### Dependency Injection

All dependencies are wired in `src/index.ts`:
1. Instantiate services and repositories
2. Inject into use cases
3. Inject use cases into controllers
4. Register routes with controllers

Example:
```typescript
// 1. Create service
const githubService = new GitHubServiceImpl(tokenService);

// 2. Create use case
const processWebhookUseCase = new ProcessWebhookUseCase(githubService, containerService);

// 3. Create controller
const githubController = new GitHubController(processWebhookUseCase);

// 4. Register routes
app.route('/webhook', createGitHubRoutes(githubController));
```

## Container Development

### Container Structure

The container (`container_src/`) is a separate Node.js application that:
- Runs HTTP server on port 8080
- Integrates Claude Code SDK (`@anthropic-ai/claude-code`)
- Handles git operations via `simple-git`
- Communicates with GitHub API via `@octokit/rest`
- Supports ACP (Agent Communication Protocol) for streaming

### Container Entry Points

**Main**: `container_src/src/index.ts` - CLI entry with HTTP bridge mode
**HTTP Server**: `container_src/src/http-server.ts` - Express-like server
**ACP Agent**: `container_src/src/acp-agent.ts` - Streaming agent implementation

### Container API Endpoints

- `POST /process-issue` - Process GitHub issue with Claude Code
- `POST /execute-prompt` - Execute arbitrary prompt
- `GET /health` - Health check with uptime
- `GET /status` - Container status and metrics

## Testing Strategy

### Test Structure

```
test/
├── agent-communication/     # ACP protocol tests
├── integration/             # Cross-component tests
├── mocks/                   # Test doubles
├── stubs/                   # Cloudflare API stubs
└── shared-layer.test.ts     # Shared utilities tests
```

### Running Specific Tests

```bash
# Run single test file
pnpm test src/test/api/github.routes.test.ts

# Run tests matching pattern
pnpm test -- --grep "webhook"

# Run with debugging
pnpm test -- --inspect-brk
```

### Writing Tests

Use Vitest with Cloudflare Workers stubs:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('MyUseCase', () => {
  let useCase: MyUseCase;

  beforeEach(() => {
    const mockService = createMockService();
    useCase = new MyUseCase(mockService);
  });

  it('should handle expected input', async () => {
    const result = await useCase.execute({ data: 'test' });
    expect(result).toBeDefined();
  });
});
```

## Durable Objects Pattern

All Durable Objects follow this pattern:

```typescript
export class MyDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/get') {
      const value = await this.state.storage.get<string>('key');
      return Response.json({ value });
    }

    if (url.pathname === '/set') {
      const { value } = await request.json();
      await this.state.storage.put('key', value);
      return Response.json({ success: true });
    }

    return new Response('Not Found', { status: 404 });
  }
}
```

Access pattern from worker:

```typescript
const id = env.MY_DO.idFromName(uniqueKey);
const stub = env.MY_DO.get(id);
const response = await stub.fetch('http://do/get');
```

## Critical Development Rules

### Security
- **NEVER** commit API keys or secrets
- **ALWAYS** encrypt sensitive data in Durable Objects (use `CryptoServiceImpl`)
- **ALWAYS** validate webhook signatures from GitHub
- **NEVER** log sensitive data (API keys, private keys, tokens)

### Container Provider
- **DO NOT** switch `CONTAINER_PROVIDER` after deployment (causes context loss)
- **TEST** provider changes thoroughly in development first
- **DOCUMENT** any provider-specific behavior in code comments

### Error Handling
- **NEVER** create fallback cases for graceful degradation unless specified
- **ALWAYS** propagate errors to API layer for proper HTTP status codes
- **LOG** errors with context for debugging

### TypeScript
- **ALWAYS** run `pnpm cf-typegen` after modifying `wrangler.jsonc`
- **USE** strict TypeScript settings (already configured)
- **AVOID** `any` type - use `unknown` and narrow with type guards

### Testing
- **WRITE** tests for new use cases and services
- **MOCK** external dependencies (GitHub API, Anthropic API)
- **TEST** error paths, not just happy paths

### Code Quality
- **NO** debugging statements or commented code in commits
- **NO** hardcoded values - use constants or environment variables
- **FOLLOW** existing patterns in each layer (API, Core, Infrastructure)

## Troubleshooting

### Container Won't Start
```bash
# Check Wrangler logs
wrangler tail

# Verify container build
cd container_src && pnpm build

# Check dependencies
pnpm list --depth=0
```

### GitHub Webhook Failing
```bash
# Test webhook locally
curl -X POST http://localhost:8788/webhook/github \
  -H "X-GitHub-Event: ping" \
  -d '{"zen": "test"}'
```

### Type Errors After Config Changes
```bash
# Regenerate types
pnpm cf-typegen

# Restart TypeScript server in your editor
```

### Durable Object Migration Issues
Migrations are defined in `wrangler.jsonc`. New DO classes require new migration tags:
```json
{
  "new_sqlite_classes": ["NewDO"],
  "tag": "v5"
}
```

## Key Files Reference

- `src/index.ts` - Worker entry point, DI container
- `wrangler.jsonc` - Cloudflare configuration
- `container_src/src/index.ts` - Container entry point
- `tsconfig.json` - TypeScript configuration
- `vitest.config.ts` - Test configuration
- `.dev.vars` - Local environment variables (git-ignored)

## Documentation

- `README.md` - Quick start and overview
- `docs/ARCHITECTURE.md` - Detailed architecture and configuration
- `docs/API.md` - API endpoint reference
- `docs/DEVELOPMENT.md` - Development setup guide
- `docs/CONTAINER_PROVIDERS.md` - Container provider comparison
- `DEPLOYMENT_GUIDE.md` - Deployment instructions
