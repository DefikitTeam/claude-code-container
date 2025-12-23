# Daytona Sandbox Network Configuration Request

## Executive Summary

The LumiLink integration with Daytona Sandbox is blocked due to network/proxy limitations. We need DevOps to configure **SSL wildcard proxy** to enable HTTP access to sandbox containers, similar to how Cloudflare Containers work.

---

## Current Problem

### Architecture Overview

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   LumiLink   │────▶│ Cloudflare      │────▶│ Daytona Sandbox  │
│   Frontend   │     │ Worker (API)    │     │ (Container)      │
└──────────────┘     └─────────────────┘     └──────────────────┘
                              │                       │
                              ▼                       ▼
                     Needs to call HTTP      Needs to call HTTPS
                     into sandbox            to OpenRouter API
```

### What's Not Working

| Issue                         | Description                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **No HTTP access to sandbox** | Worker cannot call HTTP endpoints inside the sandbox directly                                            |
| **Toolbox API limitations**   | Using `execute` command API as workaround, but it has timeout issues and doesn't support complex scripts |
| **No outbound HTTPS**         | Sandbox cannot make HTTPS requests to external APIs (OpenRouter)                                         |

### Current Workaround (Failed)

We attempted to use Daytona Toolbox API's `/process/execute` endpoint to run commands inside the sandbox. This approach failed because:

1. Commands timeout (`exitCode=-1`) even for simple operations
2. Shell redirection (`>`, `|`) doesn't work reliably
3. Cannot run long-running processes (like an HTTP server)
4. Debugging is impossible (SSH access also times out)

---

## Requested Solution

### Option A: Wildcard SSL Proxy (Preferred)

Configure Nginx/proxy to expose sandbox ports via wildcard subdomain:

```
https://{sandbox-id}-{port}.sandbox.daytona.defikit.net
    ↓
Forward to sandbox internal port
```

**Example:**

```
https://83792513-cd9e-428f-99c0-63c63bc7739c-3000.sandbox.daytona.defikit.net
    ↓
Forwards to sandbox 83792513-cd9e-428f-99c0-63c63bc7739c, port 3000
```

**Nginx Config Example:**

```nginx
server {
    listen 443 ssl;
    server_name ~^(?<sandbox_id>[a-f0-9-]+)-(?<port>\d+)\.sandbox\.daytona\.defikit\.net$;

    ssl_certificate /path/to/wildcard.crt;
    ssl_certificate_key /path/to/wildcard.key;

    location / {
        proxy_pass http://${sandbox_id}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option B: Outbound HTTPS Access

Allow sandbox containers to make outbound HTTPS requests to:

- `https://openrouter.ai/api/v1/*`
- `https://api.anthropic.com/*`
- `https://api.github.com/*`

This is needed if the container itself needs to call external APIs.

---

## Expected Outcome

After configuration, the architecture will work as follows:

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   LumiLink   │────▶│ Cloudflare      │────▶│ Daytona Sandbox  │
│   Frontend   │     │ Worker          │     │ Port 3000        │
└──────────────┘     └─────────────────┘     └──────────────────┘
                              │                       │
                              │ HTTP POST             │ HTTPS
                              ▼                       ▼
                     sandbox-id-3000.              openrouter.ai
                     sandbox.daytona.              api.github.com
                     defikit.net
```

### Benefits

1. **Simple architecture** - Direct HTTP calls, no Toolbox API workarounds
2. **Reliable** - Standard HTTP/HTTPS, no command execution hacks
3. **Debuggable** - Can curl endpoints directly for testing
4. **Scalable** - Works with any number of sandboxes

---

## Testing After Configuration

Once configured, we can verify with:

```bash
# Test 1: Check if proxy URL is accessible
curl -I https://83792513-cd9e-428f-99c0-63c63bc7739c-3000.sandbox.daytona.defikit.net

# Test 2: Test from inside sandbox (if Option B enabled)
# Via Toolbox API execute:
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4","messages":[{"role":"user","content":"Hello"}]}'
```

---

## Contact

For questions about this request, please contact the LumiLink development team.

**Priority:** High - Blocking production deployment
**Estimated Impact:** Enables full AI coding assistant functionality
