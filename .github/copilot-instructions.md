# Claude Code Containers – AI Agent Guide

> **Multi-tenant GitHub automation system powered by Claude Code, Cloudflare Workers, and containerized execution**

This guide provides essential knowledge for AI coding agents to be immediately productive in this codebase. Always cite concrete files and existing patterns—never invent endpoints or config fields.

---

## 🏗️ Architecture Overview

### System Flow
```
GitHub Issue/Webhook → Worker (Hono + Durable Objects) → Container (Claude Code SDK) → GitHub PR/Comments
```

**Key principles:**
- **Worker layer** (`src/`): Routing, auth, multi-tenant config, token management
- **Container layer** (`container_src/`): Isolated Node.js runtime with Claude Code SDK, git operations, GitHub API calls
- **State**: Durable Objects for encrypted credentials, user configs, session state
- **Security**: AES-256-GCM encryption, webhook signature verification, per-user credential isolation

### Dual Package Architecture

**Critical: Two separate `package.json` files with distinct purposes**

```bash
# Root package.json - Worker runtime (TypeScript, Hono, Cloudflare APIs)
npm install <worker-dependency>

# Container package.json - Container runtime (Claude SDK, Octokit, git, Node.js tools)
cd container_src && npm install <container-dependency>
```

**Wrong layer = 404 at runtime.** Check existing files to determine correct location.

---

## 📂 Core File Map

### Worker Layer (`src-new/` - Clean Architecture)

**🎯 Entry Point**
- **`index.ts`**: Dependency injection setup, route registration, Hono app creation

**🧠 Core Layer** (`core/`)
- **`entities/`**: Domain entities with validation (User, Installation, ContainerConfig, Deployment)
- **`use-cases/`**: Business logic organized by feature
  - `user/`: RegisterUser, GetUser, UpdateUser, DeleteUser
  - `github/`: ProcessWebhook, FetchRepositories, FetchBranches, CreatePullRequest
  - `container/`: SpawnContainer, ProcessPrompt, GetLogs, TerminateContainer
  - `deployment/`: DeployWorker, GetStatus, Rollback, ValidateConfig
- **`interfaces/`**: Abstract contracts for repositories and services

**🔌 Infrastructure Layer** (`infrastructure/`)
- **`durable-objects/`**: DO implementations (UserConfigDO, GitHubAppConfigDO, ContainerDO, ACPSessionDO)
- **`services/`**: Service implementations (GitHub, Crypto, Token, Deployment, Container, ACP)
- **`repositories/`**: Data access implementations
- **`adapters/`**: External API wrappers (Cloudflare API, Wrangler, DO adapters)

**🌐 API Layer** (`api/`)
- **`controllers/`**: Request handlers calling use cases (User, GitHub, Container, Deployment, Installation, ACP)
- **`routes/`**: Route definitions with validation
- **`middleware/`**: Auth, CORS, error handling, validation, rate limiting
- **`dto/`**: Data Transfer Objects with parsing/validation
- **`responses/`**: Standardized response formats

**🔧 Shared** (`shared/`)
- **`types/`**: Common TypeScript interfaces
- **`errors/`**: Custom error classes (BaseError, ValidationError, NotFoundError, UnauthorizedError)
- **`utils/`**: Crypto utilities, GitHub token helpers

### Legacy Layer (`src/` - Being Migrated)
⚠️ **Note**: This is the old monolithic structure. New features should use `src-new/` clean architecture.
- See `src-new/README.md` for migration status and `src-new/IMPLEMENTATION_CHECKLIST.md` for progress

### Container Layer (`container_src/src/`)
- **`api/http/server.ts`**: HTTP server (port 8080), route registration
- **`api/http/router.ts`**: Request routing, middleware composition
- **`handlers/`**: Process handlers for different request types
- **`services/`**: GitHub automation, workspace management, error classification
- **`core/entities/`**: Domain entities (workspace, session, prompt)

### Configuration
- **`wrangler.jsonc`**: Cloudflare Workers config, DO bindings, environments
  - **Main entry**: Points to `src-new/index.ts` (clean architecture)
  - **Durable Objects**: MY_CONTAINER, GITHUB_APP_CONFIG, USER_CONFIG, ACP_SESSION
  - **Container**: `./Dockerfile`, max 10 instances
- **Root `package.json`**: Worker build scripts, deployment commands
- **`container_src/package.json`**: Container dependencies, build scripts
- **`src-new/tsconfig.json`**: TypeScript config for clean architecture

---

## 🔐 Multi-Tenant Security Model

### User Registration Flow
1. User installs GitHub App → gets `installationId`
2. User calls `POST /register-user` with `installationId` + `anthropicApiKey`
3. System creates `UserConfig` in `UserConfigDO` (encrypted)
4. Each user gets isolated credentials, token cache, repository access

### Credential Handling
- **Encryption**: All secrets encrypted with AES-256-GCM in `crypto.ts`
- **Token Manager**: Per-user installation tokens cached with expiry validation
- **Container Isolation**: Only decrypted subset passed to container at runtime
- **Never log secrets**: Redact in responses, errors, logs

### Multi-Registration Support
- One GitHub installation can support multiple user projects
- Thread `userId` + `installationId` through all operations
- Explicit conflict resolution (409) when ambiguous—no silent fallbacks
- See `docs/MULTI_REGISTRATION.md` for details

---

## 🛠️ Development Workflows

### Local Development
```bash
# Start worker (auto-reloads)
npm run dev

# Start container watch (separate terminal)
cd container_src && npm run dev

# Build container after changes
cd container_src && npm run build

# Regenerate Cloudflare types after DO/route changes
npm run cf-typegen
```

### Testing
```bash
# Root tests (worker layer)
npm test

# Container tests (unit, integration, e2e)
cd container_src && npm test

# Health checks
curl http://localhost:8787/health
curl http://localhost:8787/container/health
```

### Deployment
```bash
# Deploy to production
npm run deploy

# Deploy to specific environment
wrangler deploy --env staging

# View logs
wrangler tail
```

---

## 🔄 Adding New Features (Clean Architecture)

### Template: New Feature Implementation

**Follow Clean Architecture layers from inside out:**

#### 1. **Define Entity** (`src-new/core/entities/`)
```typescript
// my-feature.entity.ts
export class MyFeatureEntity {
  private constructor(
    public readonly id: string,
    public readonly data: string,
    public readonly createdAt: number
  ) {}

  static create(id: string, data: string): MyFeatureEntity {
    if (!id || !data) {
      throw new ValidationError('id and data are required');
    }
    return new MyFeatureEntity(id, data, Date.now());
  }
}
```

#### 2. **Define Interface** (`src-new/core/interfaces/`)
```typescript
// services/my-feature.service.ts
export interface IMyFeatureService {
  processFeature(id: string, data: string): Promise<void>;
}
```

#### 3. **Create Use Case** (`src-new/core/use-cases/my-feature/`)
```typescript
// process-my-feature.use-case.ts
export class ProcessMyFeatureUseCase {
  constructor(
    private readonly myFeatureService: IMyFeatureService,
    private readonly userRepository: IUserRepository
  ) {}

  async execute(dto: ProcessMyFeatureDto): Promise<MyFeatureResult> {
    // Business logic here
    const entity = MyFeatureEntity.create(dto.id, dto.data);
    await this.myFeatureService.processFeature(entity.id, entity.data);
    return { success: true, id: entity.id };
  }
}
```

#### 4. **Implement Service** (`src-new/infrastructure/services/`)
```typescript
// my-feature.service.impl.ts
export class MyFeatureServiceImpl implements IMyFeatureService {
  async processFeature(id: string, data: string): Promise<void> {
    // Infrastructure implementation
  }
}
```

#### 5. **Create DTO** (`src-new/api/dto/`)
```typescript
// process-my-feature.dto.ts
export interface ProcessMyFeatureDto {
  id: string;
  data: string;
}

export function parseProcessMyFeatureDto(body: any): ProcessMyFeatureDto {
  if (!body.id || !body.data) {
    throw new ValidationError('id and data are required');
  }
  return { id: body.id, data: body.data };
}
```

#### 6. **Create Controller** (`src-new/api/controllers/`)
```typescript
// my-feature.controller.ts
export class MyFeatureController {
  constructor(
    private readonly processMyFeatureUseCase: ProcessMyFeatureUseCase
  ) {}

  async process(c: Context): Promise<Response> {
    const body = await c.req.json();
    const dto = parseProcessMyFeatureDto(body);
    const result = await this.processMyFeatureUseCase.execute(dto);
    return successResponse(c, result);
  }
}
```

#### 7. **Define Routes** (`src-new/api/routes/`)
```typescript
// my-feature.routes.ts
export function createMyFeatureRoutes(controller: MyFeatureController) {
  const app = new Hono();
  app.post('/my-feature', (c) => controller.process(c));
  return app;
}
```

#### 8. **Wire Up DI** (`src-new/index.ts`)
```typescript
// In setupDependencyInjection():
const myFeatureService = new MyFeatureServiceImpl();
const processMyFeatureUseCase = new ProcessMyFeatureUseCase(
  myFeatureService,
  userRepository
);
const myFeatureController = new MyFeatureController(processMyFeatureUseCase);

// In createApp():
const myFeatureRoutes = createMyFeatureRoutes(controllers.myFeatureController);
app.route('/api', myFeatureRoutes);
```

#### 9. **Add Tests** (`src-new/test/`)
```typescript
// Test use case with mocked dependencies
describe('ProcessMyFeatureUseCase', () => {
  it('should process feature successfully', async () => {
    const mockService = { processFeature: vi.fn() };
    const useCase = new ProcessMyFeatureUseCase(mockService, mockUserRepo);
    
    const result = await useCase.execute({ id: '1', data: 'test' });
    
    expect(result.success).toBe(true);
    expect(mockService.processFeature).toHaveBeenCalledWith('1', 'test');
  });
});
```

### Key Principles
- **Dependency Direction**: Core → Infrastructure → API (never reverse)
- **Interfaces First**: Define contracts before implementations
- **Use Case = Business Logic**: Keep controllers thin, use cases fat
- **DTO Validation**: Parse and validate at API boundary
- **Test Use Cases**: Mock interfaces, test business logic in isolation

---

## ⚠️ Common Pitfalls & Rules

### ❌ Never Do
- **Break dependency rules**: Never import Infrastructure/API into Core layer
- **Add business logic to controllers**: Controllers call use cases, don't implement logic
- **Skip interface definitions**: Always define contracts in `core/interfaces/` first
- **Bypass DTO validation**: All API inputs must be validated via DTOs
- **Put use cases in infrastructure**: Use cases belong in `core/use-cases/`
- **Install dependencies in wrong layer**: Check existing file imports (worker vs container)
- **Duplicate token logic**: Reuse existing services (e.g., `TokenServiceImpl`)
- **Silent fallbacks**: Throw explicit errors (use custom error classes from `shared/errors/`)
- **Leak secrets**: Redact in logs, errors, responses
- **Clone repos without `--depth 1`**: Performance regression
- **Add features to `src/`**: Use `src-new/` clean architecture for new code
- **Rename existing contracts**: Additive changes only

### ✅ Always Do
- **Follow Clean Architecture layers**: Core (entities, use cases) → Infrastructure (services, DOs) → API (controllers, routes)
- **Define interfaces first**: Create contracts in `core/interfaces/` before implementations
- **Validate at API boundary**: Use DTOs in `api/dto/` to parse and validate inputs
- **Keep controllers thin**: Business logic belongs in use cases, not controllers
- **Thread `installationId` + `userId`**: Through all multi-tenant operations
- **Return structured responses**: Use `successResponse()` and `errorResponse()` helpers
- **Test use cases**: Mock dependencies, test business logic in isolation
### Test Structure

**Clean Architecture Tests** (`src-new/test/`)
- **Use case tests**: Mock interfaces, test business logic
- **Entity tests**: Validate domain rules and factory methods
- **Integration tests**: Test layer boundaries (DOs, services)
- **E2E tests**: Full request flow through all layers

**Legacy Tests** (`test/`)
### Patterns

**Clean Architecture Testing**
```typescript
// Test use case with mocked dependencies
import { vi, describe, it, expect } from 'vitest';
import { RegisterUserUseCase } from './register-user.use-case';

describe('RegisterUserUseCase', () => {
  it('should create user successfully', async () => {
    // Mock dependencies (interfaces)
    const mockUserRepo = {
      save: vi.fn(),
      findById: vi.fn()
    };
    const mockGitHubService = {
      validateInstallation: vi.fn().mockResolvedValue(true)
    };
    const mockCryptoService = {
      encrypt: vi.fn().mockReturnValue('encrypted')
    };

    const useCase = new RegisterUserUseCase(
      mockUserRepo,
      mockGitHubService,
      mockCryptoService
    );

    const result = await useCase.execute({
      userId: 'user1',
      installationId: 'inst1',
      anthropicApiKey: 'key'
    });

    expect(result.userId).toBe('user1');
    expect(mockUserRepo.save).toHaveBeenCalled();
    expect(mockCryptoService.encrypt).toHaveBeenCalledWith('key');
  });
});
```

**Legacy Testing**
```typescript
// Mock GitHub calls at client boundary
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => ({
    repos: { createPullRequest: vi.fn() }
  }))
}));
``` Patterns
```typescript
// Mock GitHub calls at client boundary
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => ({
    repos: { createPullRequest: vi.fn() }
  }))
}));

// Use deterministic offline tests
describe('ProcessPrompt', () => {
  it('creates issue and PR', async () => {
    // Mock GitHub, test logic
  });
});
```

---

## 🚀 Performance Best Practices

- **Git clones**: Always `--depth 1` for shallow clones
- **Workspaces**: `/tmp/workspaces/{uuid}`, cleanup on success + error
- **Logs**: Stream incremental diagnostics, avoid large diff dumps
- **Token caching**: 5-minute expiry buffer, per-user cache keys
- **Container limits**: Max 10 instances (configurable in `wrangler.jsonc`)

---

## 📖 Architecture Documentation

### Key Documents
- **`CLAUDE.md`**: High-level implementation guide, DO/DON'T rules
- **`docs/PROJECT_STRUCTURE.md`**: Detailed file structure, LOC metrics
- **`docs/WHY_NOT_DDD.md`**: Architecture decisions (why not Domain-Driven Design)
- **`README.md`**: User-facing setup, API docs, deployment guide
- **`specs/`**: Feature specifications (005-multi-user, 006-openhands-sdk, etc.)

### Key Contracts

**Clean Architecture Contracts**
- **Use Case Input**: DTO with validated data (defined in `api/dto/`)
- **Use Case Output**: Result object with typed response
- **Repository Interface**: CRUD operations (defined in `core/interfaces/repositories/`)
- **Service Interface**: Business capabilities (defined in `core/interfaces/services/`)
- **Controller Response**: Use `successResponse()` or `errorResponse()` helpers

**Legacy Contracts**
- **Container request**: `{ type, payload, config }`
- **Container response**: `{ success, message, pullRequestUrl?, logs? }`
- **User config**: `{ userId, installationId, anthropicApiKey, repositoryAccess }`
- **Token cache key**: `(installationId, userId)`ECKLIST.md` for progress
- **Why Not DDD**: Domain too simple for full DDD patterns (see `docs/WHY_NOT_DDD.md`)
- **Container isolation**: Ephemeral, stateless containers for security + scalability
- **Token management**: Cached with retry logic, per-user isolation
## 🔍 When Stuck

### Finding Patterns in Clean Architecture
1. **Look at similar use cases**: Check `src-new/core/use-cases/` for analogous features
2. **Follow the layers**:
   - Start with entities in `core/entities/`
   - Check interfaces in `core/interfaces/`
   - Find implementations in `infrastructure/`
   - See controller patterns in `api/controllers/`
3. **Check tests**: `src-new/test/` shows how to mock dependencies and test use cases
4. **Read existing DTOs**: `src-new/api/dto/` shows validation patterns
5. **Study DI setup**: `src-new/index.ts` shows how components are wired together

### Legacy Code
- **Old patterns**: `src/` contains legacy monolithic code
- **Migration guide**: See `src-new/README.md` and `IMPLEMENTATION_CHECKLIST.md`
- **Container layer**: Still uses `container_src/` (unchanged)
- **Specs**: `specs/` directory for feature requirements/types/` show contracts
3. **Follow existing patterns**: Consistency > novelty
4. **Read tests**: `test/*.test.ts` and `container_src/test/*.test.ts` show usage
5. **Check specs**: `specs/` directory for feature requirements

---

## 📝 Quick Reference

### Essential Commands
```bash
npm run dev                      # Start worker
cd container_src && npm run dev  # Watch container
npm run deploy                   # Deploy to prod
npm run cf-typegen               # Regenerate types
wrangler tail                    # View logs
npm test                         # Run all tests
```

### Key Contracts
- **Container request**: `{ type, payload, config }`
- **Container response**: `{ success, message, pullRequestUrl?, logs? }`
- **User config**: `{ userId, installationId, anthropicApiKey, repositoryAccess }`
- **Token cache key**: `(installationId, userId)`

### Environment Variables
- `ANTHROPIC_API_KEY`: Claude API (worker env)
- `FIXED_GITHUB_APP_ID/PRIVATE_KEY/WEBHOOK_SECRET`: Service-level GitHub App
- `ALLOWED_ORIGINS`: CORS config (comma-separated)
- `ENVIRONMENT`: `development` | `staging` | `production`

---

**Remember**: This is a multi-tenant system. Every operation requires `installationId` (and `userId` when ambiguous). Never assume defaults or create silent fallbacks.
