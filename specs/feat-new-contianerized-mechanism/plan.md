# Implementation Plan: Migrate to Daytona Sandboxes

**Branch**: `feat/new-contianerized-mechanism` | **Date**: 2025-11-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/feat-new-contianerized-mechanism/spec.md`

## Summary

Migrate from Cloudflare Workers Containers to Daytona Sandboxes to overcome infrastructure limitations (30s CPU timeouts, throttling, non-standard environment). The implementation follows a parallel approach with feature flags, enabling gradual rollout while maintaining the existing container system as fallback.

**Technical Approach**: Create `DaytonaSandboxService` implementing a generic sandbox interface, using the `@daytonaio/sdk` from a Cloudflare Worker with `nodejs_compat` flag. The service will interact with Daytona's pre-configured language environments.

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022 target)
**Primary Dependencies**: Daytona SDK (`@daytonaio/sdk` npm), Cloudflare Workers, Hono
**Storage**: Durable Objects (SQLite) for session tracking, ephemeral sandbox filesystem
**Testing**: Vitest for unit/integration, manual E2E with Daytona
**Target Platform**: Cloudflare Workers (edge), Daytona Sandboxes (cloud VMs)
**Project Type**: Dual-tier monorepo (Worker + Container)
**Performance Goals**: <2s sandbox cold start, <200ms latency for command execution
**Constraints**: Daytona API rate limits, 24hr max sandbox lifetime, Cloudflare Worker CPU limits
**Scale/Scope**: 10-100 concurrent sandboxes initially, 1000+ at scale

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Check | Status | Notes |
|-------|--------|-------|
| Clean Architecture Compliance | ✅ PASS | New service implements existing interface in infrastructure layer |
| Test-First Approach | ✅ PASS | Plan includes unit tests before implementation |
| Dependency Direction | ✅ PASS | Core depends on interface, not Daytona SDK directly |
| No Premature Optimization | ✅ PASS | Feature flag enables gradual rollout |
| Observability | ✅ PASS | Logging and metrics planned |

## Project Structure

### Documentation (this feature)

```text
specs/feat-new-contianerized-mechanism/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Research on Daytona
├── data-model.md        # Entity definitions for Daytona
├── quickstart.md        # Setup guide for Daytona
├── contracts/
│   └── daytona-sandbox-service.openapi.yaml
└── tasks.md             # Detailed task breakdown
```

### Source Code Changes

```text
# Worker Layer (src/)
src/
├── core/
│   └── interfaces/
│       └── services/
│           └── daytona-sandbox.service.ts    # NEW: Interface definition
├── infrastructure/
│   └── services/
│       ├── container.service.impl.ts       # EXISTING: Keep as fallback
│       └── daytona-sandbox.service.impl.ts   # NEW: Daytona implementation
├── shared/
│   └── errors/
│       └── daytona.errors.ts                 # NEW: Daytona-specific errors
└── index.ts                                # MODIFY: Add feature flag & DI

# Container Layer (container_src/) - No changes needed

# Configuration
wrangler.jsonc                              # MODIFY: Add USE_DAYTONA_SANDBOXES var

# Tests
src/test/
├── daytona-sandbox.service.test.ts         # NEW: Unit tests
└── daytona-sandbox.integration.test.ts     # NEW: Integration tests
```

**Structure Decision**: Single-project option with infrastructure service addition. The Daytona sandbox runs the exact same `container_src` code.

## Complexity Tracking

| Item | Justification | Simpler Alternative |
|------|---------------|---------------------|
| Parallel implementation | Risk mitigation during migration | Full cutover rejected - too risky |
| Feature flag | Gradual rollout capability | Hard switch rejected - no rollback |

---

## Implementation Phases

### Phase 1: Foundation (Days 1-2)

#### 1.1 Install Daytona SDK & Configure
- Add `@daytonaio/sdk` package to root `package.json`
- Add `DAYTONA_API_KEY` to `.dev.vars` and Cloudflare secrets
- Add `USE_DAYTONA_SANDBOXES` feature flag to `wrangler.jsonc`
- Verify SDK works with Cloudflare Workers `nodejs_compat`

#### 1.2 Create Daytona Interface
- Define `IDaytonaSandboxService` in `src/core/interfaces/services/`
- Map operations to existing container service methods
- Define Daytona-specific error types in `src/shared/errors/`

### Phase 2: Core Implementation (Days 3-6)

#### 2.1 Implement DaytonaSandboxService
```typescript
// src/infrastructure/services/daytona-sandbox.service.impl.ts
export class DaytonaSandboxServiceImpl implements IDaytonaSandboxService {
  async create(config: SandboxConfig): Promise<SandboxInfo>;
  async executeCommand(sandboxId: string, command: string): Promise<CommandResult>;
  async delete(sandboxId: string): Promise<void>;
  async getStatus(sandboxId: string): Promise<SandboxStatus>;
}
```

#### 2.2 Wire Feature Flag in DI
```typescript
// src/index.ts - setupDI modification
const sandboxService = env.USE_DAYTONA_SANDBOXES === 'true'
  ? new DaytonaSandboxServiceImpl(env.DAYTONA_API_KEY)
  : new ContainerServiceImpl(env.MY_CONTAINER);
```

#### 2.3 Unit Tests
- Test `create` with mocked Daytona SDK
- Test error handling scenarios
- Test timeout configurations

### Phase 3: Integration & Testing (Days 7-9)

#### 3.1 Integration Tests
- End-to-end sandbox lifecycle (create → execute → delete)
- Command execution round-trip
- Error scenarios (quota, timeout, network)

#### 3.2 Load Testing
- Creation latency benchmarks
- Concurrent sandbox limits
- Memory/CPU usage under load

#### 3.3 Staging Deployment
- Deploy to staging with `USE_DAYTONA_SANDBOXES=true`
- Manual testing with real GitHub issues
- Monitor logs and metrics

### Phase 4: Production Rollout (Days 10-14)

#### 4.1 Gradual Rollout
- Enable for 5% of requests initially
- Monitor error rates and latency
- Expand to 25%, 50%, 100%

#### 4.2 Documentation
- Update README with Daytona configuration
- Add runbooks for Daytona-specific issues
- Document rollback procedure

#### 4.3 Cleanup (Post-Rollout)
- Remove Cloudflare Containers config if stable
- Clean up feature flag code
- Archive old container.service.impl.ts

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Daytona API downtime | Low | High | Feature flag rollback to CF Containers |
| Quota exceeded | Medium | Medium | Monitor usage, implement rate limiting |
| SDK incompatibility | Low | High | Test thoroughly in staging first |
| Cold start latency | Medium | Medium | Monitor metrics, explore pre-warming if needed |
| Cost overruns | Medium | Medium | Usage monitoring, per-user quotas |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Sandbox creation success rate | >99% | Logs/metrics |
| Cold start latency | <3s p95 | Timing logs |
| Command execution latency | <500ms p95 | Request timing |
| Long task completion | >95% (vs current ~50%) | Task success logs |
| Error rate | <1% | Error logs |

---

## Dependencies

| Dependency | Status | Owner |
|------------|--------|-------|
| Daytona API Key | ⬜ Required | Team Lead |
| Cloudflare secrets update | ⬜ Required | DevOps |
| Staging environment | ✅ Available | - |

---

## Generated Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Research Document | `specs/feat-new-contianerized-mechanism/research.md` | ⬜ To be updated |
| Data Model | `specs/feat-new-contianerized-mechanism/data-model.md` | ✅ Complete |
| API Contracts | `specs/feat-new-contianerized-mechanism/contracts/daytona-sandbox-service.openapi.yaml` | ⬜ To be created |
| Quickstart Guide | `specs/feat-new-contianerized-mechanism/quickstart.md` | ⬜ To be updated |
| Tasks Document | `specs/feat-new-contianerized-mechanism/tasks.md` | ⬜ To be updated |

---

## Next Steps

1. **Obtain Daytona API Key**
2. **Run `/speckit.tasks`** - Generate detailed task breakdown for Daytona migration
3. **Implement Phase 1** - Foundation setup
