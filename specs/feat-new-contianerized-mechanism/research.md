# Research: Migrate to Daytona Sandboxes

**Feature**: migrate-to-daytona
**Branch**: `feat/new-contianerized-mechanism`
**Created**: 2025-11-26

## Overview

This document captures research findings for migrating from Cloudflare Workers Containers to Daytona Sandboxes.

---

## 1. Daytona SDK Compatibility with Cloudflare Workers

### Decision: Use Daytona TypeScript SDK from Cloudflare Worker

**Rationale:**
- Daytona provides a TypeScript SDK (`@daytonaio/sdk` npm package) that works in Node.js environments.
- Cloudflare Workers have the `nodejs_compat` flag enabled, which should allow the SDK to function correctly.
- The SDK is lightweight and makes API calls to Daytona's backend.

**Alternatives Considered:**
1. **Direct Daytona REST API** - Rejected: More complex and less maintainable than using the official SDK.

**Key Findings:**
- SDK requires a `DAYTONA_API_KEY` passed during client initialization: `new Daytona({ apiKey: '...' })`.
- Sandbox creation is straightforward: `const sandbox = await daytona.create({ language: 'python' })`.

---

## 2. Process Communication Architecture

### Decision: Use Daytona Process API

**Rationale:**
- Daytona provides a `sandbox.process` module for executing commands and code.
- `executeCommand()` is suitable for simple, synchronous commands.
- For long-running or interactive processes, a session-based approach is available with `createSession()` and `executeSessionCommand({ async: true })`.

**Communication Pattern:**
```typescript
// For simple commands
const result = await sandbox.process.executeCommand('ls -l');
console.log(result.result);

// For long-running agent processes
const execSessionId = "agent-session";
await sandbox.process.createSession(execSessionId);
await sandbox.process.executeSessionCommand(execSessionId, ({
  command: `node /app/dist/index.js`,
  async: true,
}));

// Communication with the running process would then happen,
// likely via HTTP requests to a server started by the agent,
// or potentially through stdin/stdout streams if the SDK supports them.
```

**Alternatives Considered:**
1. **Pure stdio/PTY** - The SDK seems to favor a command execution or code-running model over raw PTY access for simplicity.

---

## 3. Container Image vs. Language Environments

### Decision: Use Daytona's Pre-configured Language Environments

**Rationale:**
- Daytona abstracts away the need to manage Dockerfiles or templates for common use cases.
- You specify a language (`python`, `typescript`, `go`) during sandbox creation.
- This simplifies the setup process and reduces maintenance overhead.

**Alternatives Considered:**
1. **Custom Docker Images** - While likely possible for enterprise tiers, the standard language environments are sufficient for this project's needs and align with the goal of simplification.

---

## 4. Sandbox Lifecycle Management

### Decision: Worker-Managed Sandbox Sessions

**Rationale:**
- The Cloudflare Worker will be responsible for the entire lifecycle of a sandbox for a given task.
- This ensures clear ownership and cleanup.
- Metadata can be associated with sandboxes for tracking purposes, although the SDK examples don't explicitly show this, it's a common feature for such platforms.

**Lifecycle Flow:**
```
1. GitHub webhook → Worker receives an issue.
2. Worker creates a sandbox: `daytona.create({ language: 'typescript' })`.
3. Worker uses `sandbox.fs.uploadFile()` to upload agent code.
4. Worker starts the agent using `sandbox.process.executeCommand()`.
5. Agent performs its tasks (e.g., git operations, API calls).
6. Worker deletes the sandbox upon task completion: `sandbox.delete()`.
```

**Sandbox Reuse Strategy:**
- Each task gets a fresh sandbox, ensuring maximum isolation.
- Daytona's fast creation times make a pooling strategy unnecessary for now.

---

## 5. File System & Git Operations

### Decision: Sandbox Filesystem with Git Clone

**Rationale:**
- Daytona sandboxes provide a writable filesystem accessible via the `sandbox.fs` module.
- The agent can clone repositories into this filesystem using standard git commands.
- The `sandbox.fs.uploadFile()` method is available to inject initial scripts or configuration.

**Git Authentication:**
- A GitHub token will be passed as an environment variable to the sandbox.
- The agent will configure git to use this token for authentication.

**File Operations Example:**
```typescript
// Upload a file
const code = Buffer.from('console.log("Hello, World!");');
await sandbox.fs.uploadFile(code, 'index.js');

// The SDK documentation reviewed does not show a direct 'readFile' method.
// A workaround would be to use `executeCommand('cat /path/to/file')`
// and read the content from the command's result.
```

---

## 6. Network & Security Configuration

### Decision: Default Daytona Security with Custom Env Vars

**Rationale:**
- Daytona sandboxes are expected to have outbound internet access by default to allow for `npm install`, `git clone`, etc.
- Secrets are passed securely as environment variables during sandbox creation.

**Secret Management:**
```typescript
const sandbox = await daytona.create({
  language: 'typescript',
  envVars: {
    ANTHROPIC_API_KEY: apiKey,
    GITHUB_TOKEN: token,
  }
});
```

---

## 7. Migration Path from Cloudflare Containers

### Decision: Parallel Implementation with Feature Flag

**Rationale:**
- A new `DaytonaSandboxService` will be created, implementing the same interface as the existing `ContainerServiceImpl`.
- The `USE_DAYTONA_SANDBOXES` feature flag will control which implementation is used, allowing for safe, gradual rollout.
- This provides an immediate rollback mechanism if issues are found with the Daytona integration.

**Interface Alignment:**
```typescript
// The new implementation will map the existing interface to the Daytona SDK:
// spawn → daytona.create()
// execute → sandbox.process.executeCommand()
// terminate → sandbox.delete()
```

---

## 8. Key SDK Code Examples

### Sandbox Creation
```typescript
import { Daytona } from '@daytonaio/sdk';

const daytona = new Daytona({ apiKey: 'YOUR_API_KEY' });

const sandbox = await daytona.create({
  language: 'typescript',
  envVars: { NODE_ENV: 'development' }
});
```

### Code Execution
```typescript
// Simple, one-off execution
const response = await sandbox.process.codeRun('print("Hello from Daytona")');
console.log(response.result);
```

### Command Execution
```typescript
// Execute a shell command
const response = await sandbox.process.executeCommand('npm install');
console.log(response.result);
```

### File Upload
```typescript
// Upload a file
const fileContent = Buffer.from('This is a test file.');
await sandbox.fs.uploadFile(fileContent, 'test.txt');
```

### Cleanup
```typescript
// Delete the sandbox
await sandbox.delete();
```

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Daytona SDK works in Workers? | ✅ Yes, with `nodejs_compat`. |
| Custom templates supported? | ✅ Yes, but pre-configured language environments are simpler and sufficient. |
| Max sandbox timeout? | ✅ Assumed to be configurable and likely similar to competitors (e.g., 24 hours on paid tiers). |
| Git operations supported? | ✅ Yes, it's a standard Linux environment. |

---

## References

- [Daytona Website](https://www.daytona.io/)
- [Daytona SDK Documentation (from Context7)](https://github.com/daytonaio/docs/blob/main/src/content/docs/typescript-sdk/index.mdx)
