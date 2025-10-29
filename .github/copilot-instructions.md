## Claude Code Containers – Focused AI Working Guide

> **⚠️ MIGRATION NOTICE:**
> This guide covers the **CURRENT (monolithic)** architecture.
> 
> **NEW Clean Architecture version available:** `.github/copilot-instructions-clean-architecture.md`
> 
> **Comparison guide:** `.github/COPILOT_INSTRUCTIONS_COMPARISON.md`
> 
> Use this guide for current codebase work. Use Clean Architecture guide for refactoring.

---

Purpose: Equip an AI agent to extend or modify this multi-tenant Cloudflare
Worker + Container automation system safely and fast. Always cite concrete
files; never invent endpoints or config fields.

### 1. Runtime Data Flow

Issue / Prompt → `src/index.ts` (Hono router) → Durable Objects
(`GitHubAppConfigDO`, `UserConfigDO`, `MyContainer`) → Ephemeral container
(`container_src/src/*`) → GitHub (PR / comments). Secrets never persist inside
container code; only decrypted runtime subset passed.

### 2. Dual Package Boundary

Root `package.json`: Worker (TypeScript). `container_src/package.json`:
execution environment (Claude SDK, git, Octokit). Install deps in the right
layer or runtime will 404 modules.

### 3. Security & Credentials

Encryption: AES-256-GCM (`src/crypto.ts`). To add a secret: extend
`GitHubAppConfig` + DO encrypt/decrypt logic; keep GET views redacted. Webhook
signature (`X-Hub-Signature-256`) verified before processing. Anthropic API key
passed per request (do not store).

### 4. Multi-Tenant Rules

Every new feature threads `installationId` (and `userId` if user-scoped) from
request → DO lookup → container payload. No silent fallbacks—explicit structured
errors like existing patterns in `token-manager.ts`.

### 5. Core File Map

`src/index.ts` routes; add new endpoint + update `src/types.ts`.  
`src/durable-objects.ts` container lifecycle/env wiring.  
`src/token-manager.ts` GitHub installation token refresh (reuse).  
`container_src/src/http-server.ts` / `main.ts` dispatch on `type`.  
`container_src/src/github_client.ts` PR/branch ops abstraction.  
`container_src/src/tools.ts` adds AI tool surface.

### 6. Container Contract

Inbound: `{ type:string; payload:{...}; config:DecryptedGitHubConfig }`.
Outbound:
`{ success:boolean; message:string; pullRequestUrl?; logs?:string[] }`. Additive
changes only—append optional fields; never rename existing keys.

### 7. Specs & Automation

Workflow generation driven by `.github/prompts/*.prompt.md` +
`.specify/scripts/*`. New automation should follow: script emits JSON paths →
prompt consumes → writes artifact with absolute paths (no relative assumptions).

### 8. Canonical Commands

Dev: `npm run dev`. Container watch: `cd container_src && npm run dev`. Deploy:
`npm run deploy`. Types after routing/DO changes: `npm run cf-typegen`. Health:
`curl http://localhost:8787/health` & `/container/health`. Logs:
`wrangler tail`.

### 9. Common Pitfalls

Wrong dependency layer; duplicating token logic (use `token-manager.ts`);
forgetting type updates; leaking secrets to container logs; silent catch
returning success; cloning without `--depth 1` (performance regression).

### 10. Adding a New Processing Type (Template)

1 Add union entry in `src/types.ts`. 2 Route or hook trigger in `src/index.ts`.
3 Pass through DO spawn call. 4 Implement switch case in container server. 5
Reuse git/PR helpers. 6 Add integration test under `test/` mirroring existing
cancellation or prompt tests.

### 11. Testing Notes

Prefer deterministic offline tests; mock GitHub calls at client boundary.
Cancellation & error classification tests in `container_src/test` show expected
structure.

### 12. Performance Practices

Shallow clone (`--depth 1`), workspace path `/tmp/workspaces/{uuid}`; always
cleanup (success & error). Stream incremental diagnostic lines into `logs`
array—avoid dumping large diffs.

### 13. Extending Config

Backward compatible: treat new field as optional; migration path = feature
detection (undefined → default). Document new field inline in types + README if
externally surfaced.

### 14. Style & Rules

Worker: strict TS. Container: TS or JS with JSDoc (match existing). No
speculative fallbacks (explicitly disallowed). Maintain precise, user-actionable
error messages.

### 15. Pre-Commit Sanity

Types updated? Secret handling unchanged? Handler reachable? Response shape
stable? Tests pass? No cross-layer dependency bleed? Clone still shallow?

---

When uncertain, search for an analogous `type:` implementation and mirror
structure; consistency > novelty.
