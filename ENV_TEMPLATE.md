# Environment Variables for Claude Code Container

## Required for Deployment

Copy these values when deploying via the Cloudflare deploy button:

### ANTHROPIC_API_KEY
```
sk-ant-api03-...your-key-here...
```
**Get yours at:** https://console.anthropic.com/

### ENCRYPTION_KEY
```
$(openssl rand -hex 32)
```
**Generate with:** `openssl rand -hex 32`

## Optional (can be set after deployment)

### GITHUB_APP_PRIVATE_KEY
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
...your-github-app-private-key...
...
-----END PRIVATE KEY-----
```

### GITHUB_APP_ID
```
123456
```

### GITHUB_WEBHOOK_SECRET
```
your-webhook-secret-here
```

## Environment Setup Instructions

1. **ANTHROPIC_API_KEY**: Required for deployment - get from Anthropic Console
2. **ENCRYPTION_KEY**: Required for deployment - generate with OpenSSL
3. **GitHub variables**: Can be added after deployment via Cloudflare dashboard

## After Deployment

1. Visit: `https://your-worker-name.workers.dev/install`
2. Follow GitHub App setup wizard
3. Update environment variables in Cloudflare dashboard with GitHub App credentials

## Production vs Development

The deploy button creates a production deployment. For development:
- Use `wrangler dev` locally
- Environment variables loaded from `.dev.vars` file
- See [development setup guide](./README.md#development-setup)
