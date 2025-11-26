# Quickstart: Daytona Migration

**Feature**: migrate-to-daytona
**Branch**: `feat/new-contianerized-mechanism`

## Overview

This guide covers setting up the development environment for Daytona sandbox integration.

## Prerequisites

- Node.js 22+
- pnpm 8+
- Daytona API Key ([Get one here](https://www.daytona.io/))
- Anthropic API Key
- GitHub App credentials (for full flow testing)

## 1. Install Daytona CLI (Optional)

The CLI can be useful for managing workspaces manually.

```bash
# Installation instructions for Daytona CLI would go here if available
# For now, we will rely on the SDK
```

## 2. Add Daytona SDK to Worker

```bash
cd /Users/duwm/Documents/LumiLink/move-to-e2b
pnpm add @daytonaio/sdk
```

## 3. Environment Variables

Create/update `.dev.vars`:

```env
# Existing
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
ENCRYPTION_KEY=...

# New for Daytona
DAYTONA_API_KEY=dt-....
```

## 4. Quick Integration Test

```typescript
// test/daytona-sandbox-quick-test.ts
import { Daytona } from '@daytonaio/sdk';

async function testDaytonaSandbox() {
  console.log('Creating Daytona sandbox...');
  
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
  
  const sandbox = await daytona.create({
    language: 'python',
  });
  
  console.log(`Sandbox created: ${sandbox.id}`);
  
  // Test command execution
  const result = await sandbox.process.executeCommand('echo "Hello from Daytona"');
  console.log('Command output:', result.result);
  
  // Test file operations
  await sandbox.fs.uploadFile(Buffer.from('Hello World'), '/tmp/test.txt');
  // Note: Daytona SDK might have a different method for reading files, assuming one exists.
  // const content = await sandbox.fs.readFile('/tmp/test.txt');
  // console.log('File content:', content);
  
  // Cleanup
  await sandbox.delete();
  console.log('Sandbox deleted');
}

testDaytonaSandbox().catch(console.error);
```

Run:
```bash
npx tsx test/daytona-sandbox-quick-test.ts
```

## 5. Create Daytona Service Interface

```typescript
// src/core/interfaces/services/daytona-sandbox.service.ts
export interface IDaytonaSandboxService {
  create(config: SandboxConfig): Promise<SandboxInfo>;
  executeCommand(sandboxId: string, command: string): Promise<CommandResult>;
  delete(sandboxId: string): Promise<void>;
  getStatus(sandboxId: string): Promise<SandboxStatus>;
}

export interface SandboxConfig {
  userId: string;
  installationId?: string;
  language?: 'python' | 'typescript' | 'go';
  envVars: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface SandboxInfo {
  sandboxId: string;
  status: 'running' | 'deleted' | 'error';
}
```

## 6. Feature Flag Setup

Add to `wrangler.jsonc`:
```jsonc
{
  "vars": {
    "ENVIRONMENT": "development",
    "USE_DAYTONA_SANDBOXES": "false"  // Toggle to enable Daytona
  }
}
```

## 7. Run Local Development

```bash
# Start Worker
npm run dev

# In another terminal - test health
curl http://localhost:8787/health
```

## Directory Structure After Setup

```
/Users/duwm/Documents/LumiLink/move-to-e2b/
├── .dev.vars                   # Updated with DAYTONA_API_KEY
├── src/
│   ├── core/
│   │   └── interfaces/
│   │       └── services/
│   │           └── daytona-sandbox.service.ts  # (NEW)
│   └── infrastructure/
│       └── services/
│           ├── container.service.impl.ts     # Existing
│           └── daytona-sandbox.service.impl.ts # (NEW)
└── test/
    └── daytona-sandbox-quick-test.ts # (NEW)
```

## Next Steps

1. ✅ SDK installed
2. ⬜ Implement `DaytonaSandboxService`
3. ⬜ Wire up with feature flag
4. ⬜ Integration tests
5. ⬜ Production rollout

## Troubleshooting

### "DAYTONA_API_KEY not set"
Ensure `.dev.vars` has `DAYTONA_API_KEY=dt-...`

### "Sandbox creation failed"
Check your Daytona API key and quota.

### "Worker can't reach Daytona"
Check `nodejs_compat` flag in `wrangler.jsonc`.

## Resources

- [Daytona Documentation](https://www.daytona.io/docs)
- [Daytona SDK Reference](https://www.daytona.io/docs/sdk)
- [Current Container Implementation](../src/infrastructure/services/container.service.impl.ts)
