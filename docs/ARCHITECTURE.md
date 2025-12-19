# Architecture & Configuration

This document covers the system architecture and configuration options for
Claude Code Containers.

## System Architecture

This system uses a **multi-tier architecture** built on Cloudflare's edge
infrastructure:

```
GitHub Webhooks → Worker (Hono Router) → Container (Node.js + Claude Code) → GitHub API
                      ↓
                 Durable Objects (Encrypted Storage)
```

### Components

| Component           | Path                        | Description                                                                       |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| **Worker**          | `src/index.ts`              | Webhook processing, routing, credential management via Hono framework             |
| **Container**       | `container_src/src/main.ts` | HTTP server (port 8080) running Claude Code SDK + git operations                  |
| **Durable Objects** | -                           | `GitHubAppConfigDO` (encrypted credentials), `MyContainer` (lifecycle management) |

### Container Provider Abstraction

- **`IContainerService`** (`src/core/interfaces/services/container.service.ts`)
  defines the contract for acquiring containers, executing commands, and
  fetching diagnostics.
- **`CloudflareContainerService`**
  (`src/infrastructure/services/cloudflare-container.service.ts`) implements
  that interface and handles Cloudflare Durable Object-backed containers.

## Environment Variables

### Core Configuration

| Variable                | Required | Description                                                                     |
| ----------------------- | -------- | ------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`        | ✅       | 256-bit hex key for encrypting user data. Generate with: `openssl rand -hex 32` |
| `OPENROUTER_API_KEY`    | ✅       | Your OpenRouter API key for Claude/OpenRouter integration                       |
| `GITHUB_APP_ID`         | ⚠️       | GitHub App ID (can be set via `/config` endpoint)                               |
| `GITHUB_WEBHOOK_SECRET` | ⚠️       | Webhook secret (can be set via `/config` endpoint)                              |
| `ENVIRONMENT`           | ❌       | Environment name (default: `development`)                                       |
| `ENABLE_DEEP_REASONING` | ❌       | Enable advanced reasoning (default: `false`)                                    |

### Container Provider Configuration

| Variable             | Required | Description                                                             |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `CONTAINER_PROVIDER` | ❌       | `cloudflare` (default) or `daytona`. **Choose once and stick with it!** |

### Daytona Provider (only if `CONTAINER_PROVIDER=daytona`)

| Variable                  | Required | Description                  |
| ------------------------- | -------- | ---------------------------- |
| `DAYTONA_API_KEY`         | ✅       | Your Daytona API token       |
| `DAYTONA_ORGANIZATION_ID` | ✅       | Your Daytona organization ID |

> **Note:** `DAYTONA_API_URL` is automatically configured by LumiLink
> infrastructure.

### LumiLink Integration (Optional)

| Variable             | Required | Description                                   |
| -------------------- | -------- | --------------------------------------------- |
| `LUMILINK_API_URL`   | ❌       | LumiLink API base URL                         |
| `LUMILINK_JWT_TOKEN` | ❌       | User's JWT token from LumiLink authentication |

## GitHub App Setup

1. **Create a GitHub App** at `https://github.com/settings/developers`
2. **Set permissions:**
   - Issues: Read & Write
   - Pull Requests: Read & Write
   - Contents: Read & Write
   - Metadata: Read
3. **Install the app** on your repositories
4. **Configure via API:**

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/config \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "your-app-id",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "webhookSecret": "your-webhook-secret",
    "installationId": "your-installation-id"
  }'
```
