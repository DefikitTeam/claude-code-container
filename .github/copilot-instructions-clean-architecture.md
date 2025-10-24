## Claude Code Containers – Clean Architecture Guide

> **⚠️ FUTURE ARCHITECTURE:**
> This guide covers the **TARGET (Clean Architecture)** structure post-refactoring.
> 
> **Current monolithic version:** `.github/copilot-instructions.md`
> 
> **Comparison:** `.github/COPILOT_INSTRUCTIONS_COMPARISON.md`
> 
> Use current guide until migration complete. Use this for refactoring work.

---

Purpose: Guide AI agents to extend the refactored Clean Architecture version of this multi-tenant Cloudflare Worker system. Always cite concrete files; follow dependency rules strictly; consistency > novelty.

### 1. Architecture Layers

4 layers with strict dependency inversion:

```
API → Core ← Infrastructure
 ↓      ↓         ↓
    Shared (all can use)
```

**Rule:** Dependencies flow INWARD. Core = business logic, zero infrastructure knowledge.

**Core Layer (1,650 LOC):** `src/core/entities/*.entity.ts` (business objects), `src/core/use-cases/**/*.use-case.ts` (business logic), `src/core/interfaces/**/*.ts` (contracts for dependency inversion).

**Infrastructure Layer (3,450 LOC):** `src/infrastructure/durable-objects/*.do.ts` (implements repositories), `src/infrastructure/services/*.service.impl.ts` (implements services), `src/infrastructure/adapters/*.adapter.ts` (external API wrappers), `src/infrastructure/external/token-manager.ts` (reused from current).

**API Layer (1,770 LOC):** `src/api/controllers/*.controller.ts` (request handlers), `src/api/routes/*.routes.ts` (Hono routes), `src/api/middleware/*.middleware.ts` (auth, validation, error handling), `src/api/dto/*.dto.ts` (request validation).

**Shared Layer (500 LOC):** `src/shared/types/*.ts`, `src/shared/errors/*.error.ts`, `src/shared/utils/*.util.ts`.

**Entry:** `src/index.ts` (DI wiring + Hono app). **Container:** `container_src/` unchanged (separate package).

### 3. Data Flow

HTTP → Route (`api/routes/*.routes.ts`) → Middleware → Controller (`api/controllers/*.controller.ts`) → DTO validation → Use Case (`core/use-cases/**/*.use-case.ts`) → Interface call (`core/interfaces/**/*.ts`) → Implementation (`infrastructure/services/*.impl.ts` or `infrastructure/durable-objects/*.do.ts`) → External API/DO → Entity returned → DTO mapped → Response.

Example: Route calls controller → controller calls use case interface → use case contains business logic + calls repository/service interfaces → infrastructure implements interfaces.

### 4. Dependency Rules (Strict)

✅ **Allowed:** API → Core interfaces; Core use-case → Core interface/entity; Infrastructure → Core interface/entity; Any → Shared.

❌ **Forbidden:** Core → API; Core → Infrastructure (use interfaces); API → Infrastructure directly (inject via Core interface).

**Pattern:** Use cases depend on `IRepository`/`IService` interfaces (defined in `core/interfaces/`), never concrete implementations (in `infrastructure/`). DI wiring happens in `src/index.ts`.

### 5. Adding New Feature (Template)

1. **Define entity** (if needed): `core/entities/*.entity.ts` - business object, no infrastructure logic.
2. **Define interface**: `core/interfaces/services/*.service.ts` or `core/interfaces/repositories/*.repository.ts`.
3. **Define use case**: `core/use-cases/**/*.use-case.ts` - implement business logic, depend on interfaces.
4. **Implement infrastructure**: `infrastructure/services/*.service.impl.ts` or `infrastructure/durable-objects/*.do.ts` - implements interface.
5. **Add DTO**: `api/dto/*.dto.ts` - validate input.
6. **Add controller**: `api/controllers/*.controller.ts` - call use case, return response.
7. **Add route**: `api/routes/*.routes.ts` - map HTTP method to controller.
8. **Wire DI**: `src/index.ts` - instantiate implementations, inject into use cases, inject into controllers.

### 6. Security & Multi-Tenancy

Thread `installationId` + `userId` from request (`api/middleware/auth.middleware.ts` extracts headers) → use case validates ownership. Encryption (AES-256-GCM) handled in `infrastructure/services/crypto.service.impl.ts` (reuse existing `src/crypto.ts` logic). Secrets encrypted in Infrastructure layer only, never exposed to Core or API.

### 7. Testing

**Unit tests (Core):** Mock interfaces (not implementations). Test use cases in isolation. Target: 60% of tests.

**Integration tests (API + Infrastructure):** Test HTTP endpoints with real DOs. Target: 30% of tests.

**E2E tests:** Full system tests. Target: 10% of tests.

Follow existing patterns in `container_src/test/` (cancellation, error classification tests show structure).

### 8. Module Boundaries

**User** (1,060 LOC): `/users/*` routes, no dependencies.  
**GitHub** (1,270 LOC): `/github/*` routes, depends on User.  
**Container** (2,309 LOC): `/containers/*` routes, depends on User + GitHub. `container_src/` unchanged.  
**Deployment** (1,510 LOC): `/deployments/*` routes, depends on User.

Implement order: User → GitHub → Container → Deployment.

### 9. Migration (6 Weeks)

Week 1-2: Foundation (entities, interfaces, shared). Week 2: User module (vertical slice). Week 3: GitHub module. Week 4: Container + Deployment (parallel). Week 5-6: Incremental cutover (feature flags, gradual traffic shift). Keep old code in `src-old/` until verified. See `docs/QUICKSTART_REFACTORING.md` for details.

### 10. Common Pitfalls

Core importing Infrastructure (use interfaces); business logic in controllers (move to use cases); Core knowing about DOs (abstract behind interfaces); God objects (split into single-responsibility use cases); forgetting DI wiring in `src/index.ts`; files >200 LOC.

### 11. Canonical Commands

Dev: `npm run dev`. Generate structure: `./scripts/generate-clean-architecture.sh`. Types: `npm run cf-typegen`. Test: `npm run test:unit` (Core), `npm run test:integration` (API + Infra), `npm run test:e2e` (full). Deploy: `npm run deploy`.

### 12. Key Docs

`docs/WHY_NOT_DDD.md` (project structure). `docs/diagrams/clean-architecture/*.puml` (16 diagrams). 

### 13. Pre-Commit Sanity

No Core → Infrastructure/API imports? Use cases depend on interfaces (not implementations)? Business logic in use cases (not controllers)? DTOs validated in API layer? Multi-tenant context threaded? Tests written? Files <200 LOC? TypeScript strict passes?

---

When uncertain, check analogous module implementation (User → GitHub → Container → Deployment). Mirror existing patterns; consistency > novelty.
