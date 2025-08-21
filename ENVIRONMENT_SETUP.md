# Environment Setup Guide

## Overview

This guide explains how to properly configure environment variables for the Claude Code Containers project, including the Worker environment and Container runtime.

## Architecture Overview

```
Worker Environment (.dev.vars)
    ↓ (passes ANTHROPIC_API_KEY)
Container Environment (Container.envVars)
    ↓ (runtime environment)
Container Process (.env for local dev only)
```

## Worker Environment Setup

### 1. Create `.dev.vars` File

Copy the example and add your API key:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:
```env
# Required: Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-api-key-here
```

### 2. Production Environment Variables

Set these in the Cloudflare Workers dashboard:

**Required:**
- `ANTHROPIC_API_KEY` - Your Claude Code API key

**Optional:**
- `ENVIRONMENT` - Set to "production", "staging", or "development"

## Container Environment Setup

### 1. Local Development

For local container development/testing:

```bash
cd container_src
cp .env.example .env
```

Edit `container_src/.env`:
```env
# Same API key as in .dev.vars
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-api-key-here
NODE_ENV=development
PORT=8080
DEBUG=claude-code-container:*
LOG_LEVEL=debug
```

### 2. Production Runtime

In production, the container environment is automatically managed by the `MyContainer` class in `src/durable-objects.ts`:

```typescript
envVars = {
  ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY || '',
  NODE_ENV: 'production',
  CONTAINER_ID: crypto.randomUUID(),
};
```

## Environment Variable Flow

### Development Mode

1. **Worker starts** with variables from `.dev.vars`
2. **Container spawned** with variables from `MyContainer.envVars`
3. **Local testing** can use `container_src/.env` for direct container development

### Production Mode

1. **Worker starts** with variables from Cloudflare dashboard
2. **Container spawned** with variables passed through `MyContainer.envVars`
3. **No .env file needed** - everything managed automatically

## Security Best Practices

### ✅ Safe Practices

- Store sensitive variables in `.dev.vars` (git-ignored)
- Use Cloudflare Workers dashboard for production secrets
- Container receives only necessary environment variables
- GitHub credentials managed by Worker, not Container

### ❌ Avoid These Mistakes

- Never commit `.dev.vars` or `.env` files with real API keys
- Don't put sensitive data in `wrangler.jsonc` or other config files
- Don't hardcode API keys in source code
- Don't log API keys or sensitive environment variables

## Variable Reference

### Worker Variables (`.dev.vars`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Claude Code API key | `sk-ant-api03-...` |
| `GITHUB_APP_ID` | ❌ No | GitHub App ID (can use config API) | `123456` |
| `GITHUB_WEBHOOK_SECRET` | ❌ No | Webhook secret (can use config API) | `your_secret` |
| `ENVIRONMENT` | ❌ No | Environment override | `development` |

### Container Variables (Auto-provided)

| Variable | Source | Description | Example |
|----------|--------|-------------|---------|
| `ANTHROPIC_API_KEY` | Worker | Passed from Worker environment | `sk-ant-api03-...` |
| `NODE_ENV` | Container | Set by Container class | `production` |
| `CONTAINER_ID` | Container | Generated UUID for container | `uuid-here` |

### Container Local Dev (`.env`)

| Variable | Purpose | Description | Example |
|----------|---------|-------------|---------|
| `PORT` | Development | Container HTTP port | `8080` |
| `DEBUG` | Development | Debug logging pattern | `claude-code-container:*` |
| `LOG_LEVEL` | Development | Logging verbosity | `debug` |

## Setup Commands

### Quick Setup

```bash
# 1. Setup Worker environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API key

# 2. Setup Container environment (for local dev)
cd container_src
cp .env.example .env
# Edit .env with your API key
cd ..

# 3. Install dependencies
npm install
cd container_src && npm install && cd ..

# 4. Start development
npm run dev
```

### Verification Commands

```bash
# Check Worker environment
curl http://localhost:8787/health

# Check Container environment
curl http://localhost:8787/container/health

# Verify API key is working
curl -X POST http://localhost:8787/container/process \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Troubleshooting

### Common Issues

1. **"Missing ANTHROPIC_API_KEY" Error**
   ```bash
   # Check .dev.vars exists and has the key
   cat .dev.vars
   # Restart the development server
   npm run dev
   ```

2. **Container Won't Start**
   ```bash
   # Check container dependencies
   cd container_src && npm install
   # Verify container build
   npm run build
   ```

3. **Environment Variables Not Loading**
   ```bash
   # Regenerate types after config changes
   npm run cf-typegen
   # Clear any cached data
   rm -rf node_modules/.cache
   ```

4. **API Key Not Working**
   - Verify API key is valid at https://console.anthropic.com/
   - Check API key has proper permissions
   - Ensure no extra spaces or characters in .dev.vars

### Debug Commands

```bash
# Enable debug mode
DEBUG=* npm run dev

# Check environment variables in Worker
curl http://localhost:8787/health

# Check container environment
curl http://localhost:8787/container/status

# View real-time logs
wrangler tail
```

## Production Deployment

### Cloudflare Workers Dashboard

1. Go to Workers & Pages → Your Worker → Settings → Variables
2. Add environment variables:
   - `ANTHROPIC_API_KEY` (encrypted)
   - `ENVIRONMENT` = "production"

3. Deploy:
   ```bash
   npm run deploy
   ```

### Environment-Specific Deployment

```bash
# Deploy to development
wrangler deploy --env development

# Deploy to staging  
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

## File Locations

- `.dev.vars` - Worker development environment (git-ignored)
- `.dev.vars.example` - Template for Worker environment
- `container_src/.env` - Container local development (git-ignored)
- `container_src/.env.example` - Template for Container environment
- `src/durable-objects.ts` - Container environment variable configuration
- `wrangler.jsonc` - Cloudflare Workers configuration (no secrets!)

---

**🔐 Remember: Never commit files containing actual API keys or secrets!**