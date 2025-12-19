# Local API Flow Testing (curl & Postman Friendly)

Use this guide to exercise the **clean-architecture Worker** (`src-new/`) locally and walk through realistic flows including user registration, container management, ACP protocol, and GitHub webhook processing.

## 🎉 **Recent Critical Fixes (Oct 29, 2025)**

**Complete fix for "No workspace changes detected" issue!** All three components now working together:

1. ✅ **GitHub App Auto-Authentication**: Automatic installation token generation from App ID + Private Key
2. ✅ **File System Tools**: Claude can read/write files using Vercel AI SDK tool calling
3. ✅ **Auto-Construct Clone URL**: Just provide `"owner/repo"` - system builds HTTPS URL with auth automatically!

**Result**: Simplest API format ever - just provide `installationId` and `"owner/repo"`, get full PR automation!

See [`COMPLETE-FIX-SUMMARY.md`](../COMPLETE-FIX-SUMMARY.md) for detailed technical explanation.

## ✅ **Clean Architecture Status**

The new `src-new/` implementation has **100% feature parity** with the old `src/` code:
- ✅ **Real Containers**: Uses `@cloudflare/containers` with actual container execution
- ✅ **ACP Bridge**: Full JSON-RPC 2.0 protocol support
- ✅ **Multi-tenant GitHub**: Real JWT + Installation Token authentication with **auto-token generation**
- ✅ **Webhook Processing**: Complete GitHub event handling with container routing
- ✅ **Container Registry Auth**: Cloudflare deployment authentication
- ✅ **File System Tools**: Comprehensive file operations for Claude (readFile, writeFile, executeBash, etc.)
- ✅ **Auto Clone URL**: Automatic HTTPS clone URL construction from owner/name

## 1. Prep the runtime

**Prerequisites:**
- Node.js 22+ and npm installed (container requires Node 22+)
- Wrangler CLI (`npm install -g wrangler`)
- Docker Desktop running (required for container builds)
- Real GitHub App credentials (App ID, Private Key, Installation ID)
- Real Anthropic API key

**Install dependencies:**
```bash
npm install && (cd container_src && npm install)
```

**Create `.dev.vars` file in project root:**
```bash
# .dev.vars - Local development environment variables
ENCRYPTION_KEY="your-32-character-encryption-key-here-12345678"
GITHUB_APP_ID="1812798"
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
YOUR_REAL_PRIVATE_KEY_HERE
-----END PRIVATE KEY-----"
ANTHROPIC_API_KEY="sk-ant-api03-your-real-key-here"
```

**🚨 CRITICAL: Build the container image BEFORE starting the worker:**
```bash
# Build the container_src application
npm run build:container

# This compiles TypeScript in container_src/ and prepares it for Docker
# Without this, container spawning will fail with "port not found" errors
```

**Start the Worker:**
```bash
npm run dev
```
The worker will start on `http://127.0.0.1:8787`

> ⚠️ **Common Issue**: If you see "connection refused: container port not found" errors, you forgot to run `npm run build:container` first!

> 💡 **Tip**: Postman users can create a collection pointing at `http://127.0.0.1:8787`; the same headers/bodies below apply.

## 2. Health Check (Optional)

Verify the worker is running:
```bash
curl http://127.0.0.1:8787/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-23T10:30:00.000Z",
  "version": "clean-architecture-v1.0",
  "environment": "development"
}
```

## 3. Register a User

Every API call expects the installation ID header. Create a user record using **your real GitHub App installation ID and Anthropic API key**:

```bash
curl -X POST http://127.0.0.1:8787/api/users/register \
  -H 'Content-Type: application/json' \
  -H 'X-Installation-ID: 85955072' \
  -d '{
        "installationId": "85955072",
        "anthropicApiKey": "sk-ant-api03-YOUR_REAL_KEY_HERE",
        "projectLabel": "Local Demo"
      }'
```

> ⚠️ **Replace with your real credentials:**
> - `85955072` → Your GitHub App installation ID
> - `sk-ant-api03-YOUR_REAL_KEY_HERE` → Your Anthropic API key

> 💡 **Note**: `userId` is **optional**. If not provided, the system auto-generates one as `user-{installationId}-{timestamp}`

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-85955072-1730217600000",
    "installationId": "85955072",
    "projectLabel": "Local Demo",
    "created": 1730217600000
  },
  "timestamp": 1730217600500,
  "requestId": "be0b0f7a-faf7-4e3d-813b-555911f04113"
}
```

**What happens:**
- Worker validates the installation ID with GitHub (real API call)
- User config stored in `UserConfigDO` (Durable Object)
- Anthropic API key encrypted with AES-256-GCM
- Installation validated and repository access confirmed

**📋 Save the returned `userId`** - you'll need it for subsequent API calls!

## 4. Spawn a Container Session

Use the installation header plus the user header for multi-tenant routing:

```bash
# Replace with your actual userId from step 3
USER_ID="user-85955072-1730217600000"

curl -X POST http://127.0.0.1:8787/api/containers/spawn \
  -H 'Content-Type: application/json' \
  -H 'X-Installation-ID: 85955072' \
  -H 'X-User-ID: '"$USER_ID"'' \
  -d '{
        "configId": "cfg-local-demo",
        "containerImage": "node:18",
        "environmentVariables": { "NODE_ENV": "development" },
        "resourceLimits": { 
          "cpuMillis": 500, 
          "memoryMb": 256, 
          "timeoutSeconds": 120 
        }
      }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "containerId": "ctr_cfg-local-demo_a1b2c3d4"
  },
  "timestamp": 1730217700000,
  "requestId": "uuid-here"
}
```

**✅ Container Implementation:**
- Uses **real Cloudflare Workers Container** (`@cloudflare/containers`)
- `ContainerDO` extends `Container<any>` from the package
- Container runs the `container_src/` application with Node.js
- Full lifecycle management (fetch, onStop, onError)

**📋 Copy the `containerId`** from the response; you'll use it for prompts, logs, and teardown.

## 5. Run a Prompt Inside the Container

Execute commands or send prompts to the running container:

```bash
# Replace with your actual containerId from step 4
CONTAINER_ID="ctr_cfg-local-demo_a1b2c3d4"

curl -X POST http://127.0.0.1:8787/api/containers/$CONTAINER_ID/prompt \
  -H 'Content-Type: application/json' \
  -d '{
        "prompt": "npm test",
        "context": { "task": "smoke" }
      }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "exitCode": 0,
    "stdout": "✓ All tests passed\n",
    "stderr": "",
    "success": true
  },
  "timestamp": 1730217800000,
  "requestId": "uuid-here"
}
```

**✅ Real Execution:**
- Request routed to **real container** running `container_src/` application
- Command executed inside isolated container environment
- Actual exit codes, stdout, and stderr returned
- Non-zero exits surfaced with `success: false`

**❌ Common Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `"Not Found"` | Invalid containerId | Double-check the containerId from step 4 |
| `503 Service Unavailable` | Container provisioning in progress | Wait a few seconds and retry |
| `401 Unauthorized` | Missing/invalid headers | Verify X-Installation-ID and X-User-ID headers |

## 6. Inspect Logs (Optional)

Retrieve execution logs from the container:

```bash
# Replace with your actual containerId
CONTAINER_ID="ctr_cfg-local-demo_a1b2c3d4"

curl http://127.0.0.1:8787/api/containers/$CONTAINER_ID/logs
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      "[2025-01-23T10:35:00.123Z] Container started",
      "[2025-01-23T10:35:01.456Z] Command executed: npm test",
      "[2025-01-23T10:35:02.789Z] Exit code: 0"
    ]
  },
  "timestamp": 1730217900000,
  "requestId": "uuid-here"
}
```

## 7. Terminate the Container

Clean up the container when done:

```bash
# Replace with your actual containerId
CONTAINER_ID="ctr_cfg-local-demo_a1b2c3d4"

curl -X DELETE http://127.0.0.1:8787/api/containers/$CONTAINER_ID
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "status": "terminated",
    "containerId": "ctr_cfg-local-demo_a1b2c3d4"
  },
  "timestamp": 1730218000000,
  "requestId": "uuid-here"
}
```

---

## 🤖 ACP Protocol Testing (NEW!)

The clean architecture includes full **Agent Communication Protocol (ACP) v0.3.1** support with JSON-RPC 2.0.

**🔒 IMPORTANT:** All ACP endpoints require `userId` in the request body for multi-tenant security.

**✅ GitHub Integration:** As of October 29, 2025, GitHub automation is fully supported! The worker automatically generates GitHub installation tokens and passes them to the container. No additional setup needed - just make sure you registered with a valid `installationId`. See [`docs/GITHUB_TOKEN_FIX.md`](./GITHUB_TOKEN_FIX.md) for details.

### Initialize ACP Session

```bash
# Use the userId from step 3
USER_ID="user-85955072-1730217600000"

curl -X POST http://127.0.0.1:8787/acp/initialize \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "protocolVersion": "0.3.1",
        "capabilities": ["prompts", "tools"]
      }'
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {},
    "authMethods": []
  },
  "id": 1730218100000
}
```

### Create New Session

**🔒 Security Note:** The worker fetches your encrypted API key from storage using `userId`.

```bash
# Use the userId from step 3
USER_ID="user-85955072-1730217600000"

curl -X POST http://127.0.0.1:8787/acp/session/new \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "configuration": {
          "workspaceUri": "file:///workspace"
        }
      }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "session-abc123-1730218200000",
    "modes": {
      "currentModeId": "default",
      "availableModes": []
    }
  },
  "id": 1730218200000
}
```

**📋 Save the `sessionId`** - you'll need it for sending prompts!

### Send Prompt to Session

**🔒 Security Note:** All ACP endpoints require `userId`. The worker automatically fetches your encrypted API key. **DO NOT send `anthropicApiKey` in the request body.**

**✅ Automatic GitHub Automation:** When you register a user with an `installationId`, the system automatically:
1. **Generates GitHub installation token** from your GitHub App credentials (App ID + Private Key)
2. **Auto-constructs clone URL** from repository owner/name (no need to provide full URL!)
3. **Clones repository** to workspace before Claude runs
4. **Provides file system tools** to Claude (readFile, writeFile, executeBash, etc.)
5. **Detects changes** made by Claude
6. **Creates Pull Request** with all file modifications

**🎯 RECOMMENDED FORMAT:** Just provide repository as `"owner/repo"` string!

```bash
# Use the userId from step 3 and sessionId from previous step
USER_ID="user-85955072-1730217600000"
SESSION_ID="session-abc123-1730218200000"

# ============================================================================
# FORMAT 1: Simple String (RECOMMENDED - Simplest format!)
# ============================================================================
# The system will:
# 1. Parse "owner/repo" to { owner, name }
# 2. Auto-generate installation token from GitHub App credentials
# 3. Auto-construct cloneUrl as: https://x-access-token:{token}@github.com/owner/repo.git
# 4. Clone repository to workspace
# 5. Claude modifies files using file tools
# 6. Create PR with changes
# ============================================================================

curl -X POST http://127.0.0.1:8787/acp/session/prompt \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'",
        "installationId": "85955072",
        "content": [
          {
            "type": "text",
            "text": "Make background red in styles.css"
          }
        ],
        "context": {
          "repository": "YourUsername/test-repo"
        }
      }'

# ============================================================================
# FORMAT 2: Object with Owner/Name (Also works with auto-construct!)
# ============================================================================
# Use this if you need to specify additional options like defaultBranch
# The system will auto-construct cloneUrl from owner/name
# ============================================================================

curl -X POST http://127.0.0.1:8787/acp/session/prompt \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'",
        "installationId": "85955072",
        "content": [
          {
            "type": "text",
            "text": "Create a new README.md file with project documentation"
          }
        ],
        "context": {
          "repository": {
            "owner": "YourUsername",
            "name": "test-repo",
            "defaultBranch": "main"
          }
        }
      }'

# ============================================================================
# FORMAT 3: Explicit cloneUrl (Always worked, but more verbose)
# ============================================================================
# Use this if you want full control over the clone URL
# Note: Token is still auto-injected from installationId
# ============================================================================

curl -X POST http://127.0.0.1:8787/acp/session/prompt \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'",
        "installationId": "85955072",
        "content": [
          {
            "type": "text",
            "text": "Create a new README.md file with project documentation"
          }
        ],
        "context": {
          "repository": {
            "owner": "YourUsername",
            "name": "test-repo",
            "defaultBranch": "main",
            "cloneUrl": "https://github.com/YourUsername/test-repo.git"
          }
        }
      }'

# ============================================================================
# Optional: Customize Automation Behavior
# ============================================================================
# Add labels, issue title, branch name, etc.
# ============================================================================

curl -X POST http://127.0.0.1:8787/acp/session/prompt \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'",
        "installationId": "85955072",
        "content": [
          {
            "type": "text",
            "text": "Add comprehensive error handling to authentication module"
          }
        ],
        "context": {
          "repository": "YourUsername/test-repo",
          "automation": {
            "issueTitle": "Improve error handling",
            "labels": ["enhancement", "automated"],
            "branchName": "feature/error-handling",
            "baseBranch": "develop"
          }
        }
      }'
```

**Alternative: Git URL Format** (also works):

```bash
curl -X POST http://127.0.0.1:8787/acp/session/prompt \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'",
        "installationId": "85955072",
        "content": [
          {
            "type": "text",
            "text": "Fix typo in README"
          }
        ],
        "context": {
          "repository": "https://github.com/YourUsername/test-repo.git"
        }
      }'
```

**Expected Response (Success):**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "stopReason": "end_turn",
    "usage": {
      "inputTokens": 1250,
      "outputTokens": 856
    },
    "summary": "Modified styles.css to change background color to red",
    "automationResult": {
      "status": "success",
      "branch": "claude-code/update-styles-1730218300000",
      "pullRequest": {
        "number": 123,
        "url": "https://github.com/YourUsername/test-repo/pull/123",
        "title": "Update styles.css"
      },
      "filesChanged": ["styles.css"],
      "commitSha": "abc123def456"
    }
  },
  "id": 1730218300000
}
```

**Expected Console Logs (Worker Terminal):**
```
[PROMPT][session-xxx] resolvedRepo: {"owner":"YourUsername","name":"test-repo","cloneUrl":"missing"}
[PROMPT][session-xxx] token: present gitService: true
[PROMPT][session-xxx] auto-constructed cloneUrl from owner/name: https://x-access-token:***@github.com/YourUsername/test-repo.git
[PROMPT][session-xxx] calling ensureRepo at path: /tmp/workspace-xxx
[PROMPT][session-xxx] ensureRepo completed successfully
[PROMPT][session-xxx] ensured repo present at workspace ✅
[VercelOpenRouterAdapter] Streaming with tools enabled
Tool call: readFile { path: "styles.css" }
Tool result: { success: true, content: "...", size: 142 }
Tool call: writeFile { path: "styles.css", content: "body { background: red; }" }
Tool result: { success: true, path: "styles.css", size: 28 }
[GIT-DIAG][session-xxx] hasUncommitted=true files=["styles.css"] ✅
[GITHUB-AUTO][session-xxx] start: repository=YourUsername/test-repo
[GITHUB-AUTO][session-xxx] created branch: claude-code/update-styles-1730218300000
[GITHUB-AUTO][session-xxx] committed: 1 file(s) changed
[GITHUB-AUTO][session-xxx] pushed to remote
[GITHUB-AUTO][session-xxx] success: PR #123 created ✅
```

**What Just Happened:**
1. ✅ System parsed `"owner/repo"` to `{ owner, name }`
2. ✅ Generated installation token from GitHub App credentials
3. ✅ Auto-constructed clone URL with authentication
4. ✅ Cloned repository to temporary workspace
5. ✅ Claude received file system tools (readFile, writeFile, etc.)
6. ✅ Claude read styles.css
7. ✅ Claude wrote updated styles.css with red background
8. ✅ Git detected changes in workspace
9. ✅ Created feature branch
10. ✅ Committed changes
11. ✅ Pushed to GitHub
12. ✅ Created Pull Request with changes

**🎉 Success! Check your repository for the new Pull Request!**

**Error if userId missing:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params: userId is required for multi-tenant security",
    "data": {
      "hint": "Include userId in your request params. Get userId from /register-user endpoint."
    }
  },
  "id": 1730218300000
}
```

### Load Existing Session

Restore a previously created session:

```bash
USER_ID="user-85955072-1730217600000"
SESSION_ID="session-abc123-1730218200000"

curl -X POST http://127.0.0.1:8787/acp/session/load \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'"
      }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "session-abc123-1730218200000",
    "workspace": {
      "uri": "file:///workspace"
    },
    "modes": {
      "currentModeId": "default",
      "availableModes": []
    }
  },
  "id": 1730218400000
}
```

### Cancel Operation

Cancel an ongoing ACP operation:

```bash
USER_ID="user-85955072-1730217600000"
SESSION_ID="session-abc123-1730218200000"

curl -X POST http://127.0.0.1:8787/acp/cancel \
  -H 'Content-Type: application/json' \
  -d '{
        "userId": "'"$USER_ID"'",
        "sessionId": "'"$SESSION_ID"'",
        "reason": "User requested cancellation"
      }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "cancelled": true,
    "sessionId": "session-abc123-1730218200000"
  },
  "id": 1730218500000
}
```

### Get ACP Status

Check the health and status of the ACP bridge and container:

```bash
curl http://127.0.0.1:8787/acp/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "bridge": {
      "sessions": [],
      "timestamp": "2025-10-29T10:00:00.000Z",
      "version": "enhanced-bridge-v1.0"
    },
    "container": {
      "status": "healthy",
      "uptime": 3600,
      "version": "1.0.0"
    }
  },
  "timestamp": 1730218600000,
  "requestId": "uuid-here"
}
```

---

## 🔗 GitHub Webhook Testing (NEW!)

Test webhook processing with simulated GitHub events:

```bash
curl -X POST http://127.0.0.1:8787/api/github/webhooks \
  -H 'Content-Type: application/json' \
  -H 'X-Installation-ID: 85955072' \
  -H 'X-GitHub-Event: issues' \
  -d '{
        "event": "issues",
        "action": "opened",
        "issue": {
          "id": 12345,
          "number": 42,
          "title": "Test Issue",
          "body": "This is a test issue for local development",
          "user": {
            "login": "testuser"
          }
        },
        "repository": {
          "full_name": "owner/repo",
          "name": "repo",
          "owner": {
            "login": "owner"
          }
        },
        "installation": {
          "id": 85955072
        }
      }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "eventType": "issues",
    "action": "opened",
    "processed": true,
    "result": {
      "issueNumber": 42,
      "repository": "owner/repo",
      "status": "queued_for_processing"
    }
  },
  "timestamp": 1730218700000,
  "requestId": "uuid-here"
}
```

**What happens:**
1. Webhook validated and installation checked
2. User config loaded for the installation
3. Container spawned for issue processing
4. Issue routed to container for AI agent processing
5. Results posted back to GitHub (PR creation, comments, etc.)

### Fetch Repositories

List repositories accessible to the GitHub App installation:

```bash
curl -X GET http://127.0.0.1:8787/api/github/repositories \
  -H 'X-Installation-ID: 85955072'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "repositories": [
      {
        "id": 123456,
        "name": "my-repo",
        "full_name": "owner/my-repo",
        "private": false,
        "html_url": "https://github.com/owner/my-repo"
      }
    ],
    "total_count": 1
  },
  "timestamp": 1730218800000,
  "requestId": "uuid-here"
}
```

### Fetch Branches

List branches for a specific repository:

```bash
# Format: owner/repo
curl -X GET http://127.0.0.1:8787/api/github/repositories/owner%2Fmy-repo/branches \
  -H 'X-Installation-ID: 85955072'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "branches": [
      {
        "name": "main",
        "commit": {
          "sha": "abc123def456",
          "url": "https://api.github.com/repos/owner/my-repo/commits/abc123def456"
        },
        "protected": true
      }
    ]
  },
  "timestamp": 1730218900000,
  "requestId": "uuid-here"
}
```

### Create Pull Request

Create a new pull request:

```bash
curl -X POST http://127.0.0.1:8787/api/github/pull-requests \
  -H 'Content-Type: application/json' \
  -H 'X-Installation-ID: 85955072' \
  -d '{
        "owner": "owner",
        "repo": "my-repo",
        "title": "Add new feature",
        "body": "This PR adds an amazing new feature",
        "head": "feature-branch",
        "base": "main",
        "draft": false
      }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "pullRequest": {
      "number": 123,
      "html_url": "https://github.com/owner/my-repo/pull/123",
      "title": "Add new feature",
      "state": "open",
      "draft": false
    }
  },
  "timestamp": 1730219000000,
  "requestId": "uuid-here"
}
```

---

## 📋 Header Cheat Sheet

| Header | Required | Routes | Purpose |
|--------|----------|--------|---------|
| `X-Installation-ID` | ✅ | `/api/users/*`, `/api/containers/spawn`, `/api/github/*` | Multi-tenant routing - resolves correct Durable Object |
| `X-User-ID` | ✅ | `/api/containers/spawn` | Links container operations to registered user |
| `Content-Type: application/json` | ✅ | All POST/PUT requests | Enables validation middleware and JSON parsing |

**ACP Endpoints Note:** ACP routes (`/acp/*`) do NOT use headers. Instead, include `userId` directly in the **request body** for multi-tenant security.

---

## 📦 Additional User Management Endpoints

### Get User Details

Retrieve user configuration:

```bash
USER_ID="user-85955072-1730217600000"

curl -X GET http://127.0.0.1:8787/api/users/$USER_ID \
  -H 'X-Installation-ID: 85955072'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-85955072-1730217600000",
    "installationId": "85955072",
    "projectLabel": "Local Demo",
    "created": 1730217600000,
    "anthropicApiKey": "sk-***REDACTED***"
  },
  "timestamp": 1730219100000,
  "requestId": "uuid-here"
}
```

> 🔒 **Security**: API keys are always redacted in GET responses for security.

### Update User Configuration

Update user settings (e.g., change API key or project label):

```bash
USER_ID="user-85955072-1730217600000"

curl -X PUT http://127.0.0.1:8787/api/users/$USER_ID \
  -H 'Content-Type: application/json' \
  -H 'X-Installation-ID: 85955072' \
  -d '{
        "anthropicApiKey": "sk-ant-api03-NEW_KEY_HERE",
        "projectLabel": "Updated Project Name"
      }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-85955072-1730217600000",
    "installationId": "85955072",
    "projectLabel": "Updated Project Name",
    "updated": 1730219200000
  },
  "timestamp": 1730219200000,
  "requestId": "uuid-here"
}
```

### Delete User

Remove user configuration (careful - this is permanent!):

```bash
USER_ID="user-85955072-1730217600000"

curl -X DELETE http://127.0.0.1:8787/api/users/$USER_ID \
  -H 'X-Installation-ID: 85955072'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-85955072-1730217600000",
    "deleted": true,
    "timestamp": 1730219300000
  },
  "timestamp": 1730219300000,
  "requestId": "uuid-here"
}
```

---

## 🎯 Quick Test Checklist

Use this checklist to verify your local setup is working correctly:

- [ ] Health check returns `status: "healthy"`
- [ ] User registration succeeds with real GitHub installation ID
- [ ] User registration auto-generates `userId` when not provided
- [ ] Container spawns successfully and returns `containerId`
- [ ] Prompt execution returns real results (not simulated)
- [ ] Container logs are retrievable
- [ ] Container terminates cleanly
- [ ] ACP initialize returns valid JSON-RPC response
- [ ] ACP session creation requires `userId` and succeeds
- [ ] ACP session prompt requires both `userId` and `sessionId`
- [ ] ACP session prompt returns without requiring `anthropicApiKey` in body
- [ ] Webhook processing accepts GitHub events
- [ ] Repository list fetches successfully
- [ ] Branch list fetches for specific repository

---

## 🐛 Troubleshooting

### Worker won't start
- ✅ Check `.dev.vars` file exists with all required variables
- ✅ Verify Node.js 22+ is installed: `node --version`
- ✅ Ensure Docker Desktop is running (required for containers)
- ✅ Try `npm run dev -- --log-level debug`

### "Connection refused: container port not found" error
**This is the most common error!**

**Cause**: The container image hasn't been built yet

**Solution**:
```bash
# Stop the worker (Ctrl+C)
# Build the container
npm run build:container
# Restart the worker
npm run dev
```

**Why this happens**: Wrangler needs the Dockerfile to be built into a container image before it can spawn containers. The build process compiles the TypeScript in `container_src/` and creates the Docker image.

### Registration fails with 404 or validation errors
- ✅ Verify your GitHub App installation ID is correct
- ✅ Check GitHub App has repository access
- ✅ Ensure GitHub App credentials are valid in `.dev.vars`
- ✅ Confirm `anthropicApiKey` is provided in request body
- ✅ Check `installationId` matches header value

### Container spawn fails
- ✅ User must be registered first (step 3)
- ✅ Check `X-Installation-ID` and `X-User-ID` headers match registered user
- ✅ Verify container image was built: `npm run build:container`
- ✅ Check Docker Desktop is running

### ACP requests return "userId is required" error
- ✅ Ensure `userId` is included in request **body** (not headers!)
- ✅ Verify the userId exists (check registration response)
- ✅ Confirm user has Anthropic API key configured

### ACP requests return "User not found" error
- ✅ Register user first via `/api/users/register`
- ✅ Double-check the `userId` matches registration response
- ✅ Verify user wasn't deleted

### ACP container returns "Parse error" or 500
- ✅ Ensure container is running (check logs: `wrangler tail`)
- ✅ Verify `ANTHROPIC_API_KEY` is set in `.dev.vars` OR user has API key registered
- ✅ Check container build completed successfully
- ✅ Review container logs for startup errors

### "No workspace changes detected" error

**This error occurs when files are NOT being written or git repository is not being cloned.**

**Check these in order:**

1. **Is repository being cloned?**
   Look for these logs:
   ```
   [PROMPT][session-xxx] auto-constructed cloneUrl from owner/name
   [PROMPT][session-xxx] ensured repo present at workspace ✅
   ```

   ❌ **If you see**: `[PROMPT][session-xxx] WARNING: Repository was not cloned before Claude run`

   **Causes**:
   - Missing `installationId` in request
   - GitHub App credentials not in `.dev.vars`
   - Invalid repository owner/name format

   **Solutions**:
   - Add `"installationId": "85955072"` to request body
   - Check `.dev.vars` has `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`
   - Verify repository format: `"owner/repo"` or `{ owner: "x", name: "y" }`

2. **Are file tools enabled?**
   Look for these logs:
   ```
   [VercelOpenRouterAdapter] Streaming with tools enabled
   Tool call: writeFile { path: "..." }
   Tool result: { success: true }
   ```

   ❌ **If missing**: File tools not working

   **Solution**: Rebuild container (file tools were added recently):
   ```bash
   npm run build:container
   npm run dev
   ```

3. **Is git detecting changes?**
   Look for this log:
   ```
   [GIT-DIAG][session-xxx] hasUncommitted=true files=["..."] ✅
   ```

   ❌ **If you see**: `hasUncommitted=false files=[]`

   **Causes**:
   - Files written to wrong directory (not the git workspace)
   - Repository clone failed silently
   - Git workspace not initialized

   **Solution**: Check full logs from beginning of request, look for clone errors

### Files written but PR not created

**Symptoms**: Claude writes files successfully, but no PR is created.

**Debug Steps**:

1. Check if repository was cloned:
   ```bash
   # Look for this in logs:
   [PROMPT][session-xxx] ensured repo present at workspace ✅
   ```

2. Check if git detected changes:
   ```bash
   # Look for this in logs:
   [GIT-DIAG][session-xxx] hasUncommitted=true files=["..."] ✅
   ```

3. Check GitHub automation status:
   ```bash
   # Look for this in logs:
   [GITHUB-AUTO][session-xxx] success: PR #123 created ✅

   # OR error:
   [GITHUB-AUTO][session-xxx] skipped: No workspace changes detected
   ```

**Common Causes & Solutions**:

| Symptom | Cause | Solution |
|---------|-------|----------|
| Files written, but `hasUncommitted=false` | Repository not cloned before Claude ran | Check logs for "auto-constructed cloneUrl" message |
| Repository not cloned | Missing `cloneUrl` and auto-construct failed | Provide `installationId` in request |
| Token generation failed | GitHub App credentials not configured | Add `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to `.dev.vars` |
| Clone failed with auth error | Installation token expired or invalid | Check GitHub App installation is still active |

**Full Log Example (Success)**:
```
[PROMPT][session-xxx] resolvedRepo: {"owner":"x","name":"y","cloneUrl":"missing"}
[PROMPT][session-xxx] token: present ✅
[PROMPT][session-xxx] auto-constructed cloneUrl ✅
[PROMPT][session-xxx] ensured repo present at workspace ✅
[VercelOpenRouterAdapter] Streaming with tools enabled ✅
Tool call: writeFile ✅
[GIT-DIAG][session-xxx] hasUncommitted=true ✅
[GITHUB-AUTO][session-xxx] success ✅
```

### Claude CLI permission error: "cannot be used with root/sudo privileges"

**Error Message:**
```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

**⚠️ NOTE**: This error should **NO LONGER OCCUR** in the current architecture!

**Why**: The architecture has been cleaned up to use **Vercel AI SDK + OpenRouter** instead of the legacy Claude CLI. The CLI is no longer installed in the container.

**If you still see this error**, it means you're using an old container image. Rebuild:

```bash
# Stop the worker (Ctrl+C)
# Rebuild the container with modern architecture
npm run build:container
# Restart the worker
npm run dev
```

**Architecture Overview:**
```
Current (Clean):
  VercelOpenRouterAdapter → Vercel AI SDK → OpenRouter/Anthropic API
  └─ Fallback: HTTPAPIClientAdapter → Direct HTTP → API

Old (Removed):
  ❌ CLIClientAdapter → claude CLI command
  ❌ SDKClientAdapter → @anthropic-ai/claude-code SDK
```

**Verification**: After rebuilding, ACP session prompts should work without ANY permission errors.

### GitHub webhook processing fails
- ✅ Include `event` field in request body (e.g., `"event": "issues"`)
- ✅ Verify `X-Installation-ID` header matches registered installation
- ✅ Check webhook payload structure matches GitHub's format
- ✅ Ensure repository exists and is accessible to the GitHub App

---

## 🚀 **Quick Start - Copy & Paste Ready**

**For the impatient! Here's the simplest end-to-end test with all recent fixes:**

```bash
# 1. Set your values
INSTALLATION_ID="85955072"  # Your GitHub App installation ID
REPOSITORY="YourUsername/test-repo"  # Your test repository

# 2. Register user (one-time setup)
curl -X POST http://127.0.0.1:8787/api/users/register \
  -H 'Content-Type: application/json' \
  -H "X-Installation-ID: $INSTALLATION_ID" \
  -d "{
    \"installationId\": \"$INSTALLATION_ID\",
    \"anthropicApiKey\": \"sk-ant-api03-YOUR_KEY_HERE\",
    \"projectLabel\": \"Quick Test\"
  }"

# Save the returned userId!
USER_ID="user-85955072-1730217600000"  # Replace with actual userId from response

# 3. Create session
curl -X POST http://127.0.0.1:8787/acp/session/new \
  -H 'Content-Type: application/json' \
  -d "{
    \"userId\": \"$USER_ID\",
    \"configuration\": {
      \"workspaceUri\": \"file:///workspace\"
    }
  }"

# Save the returned sessionId!
SESSION_ID="session-abc123-1730218200000"  # Replace with actual sessionId from response

# 4. Send prompt (SIMPLEST FORMAT - Just owner/repo!)
curl -X POST http://127.0.0.1:8787/acp/session/prompt \
  -H 'Content-Type: application/json' \
  -d "{
    \"userId\": \"$USER_ID\",
    \"sessionId\": \"$SESSION_ID\",
    \"installationId\": \"$INSTALLATION_ID\",
    \"content\": [
      {
        \"type\": \"text\",
        \"text\": \"Make background red in styles.css\"
      }
    ],
    \"context\": {
      \"repository\": \"$REPOSITORY\"
    }
  }"

# 🎉 Check your GitHub repository for the new Pull Request!
```

**What to expect:**
- ✅ Repository cloned automatically from owner/repo
- ✅ Installation token generated from GitHub App credentials
- ✅ Claude modifies files using file system tools
- ✅ Changes committed to feature branch
- ✅ Pull Request created with all changes

**Check logs for:**
```
[PROMPT][session-xxx] auto-constructed cloneUrl ✅
[PROMPT][session-xxx] ensured repo present at workspace ✅
Tool call: writeFile ✅
[GIT-DIAG][session-xxx] hasUncommitted=true ✅
[GITHUB-AUTO][session-xxx] success: PR #123 created ✅
```

---

Happy testing! 🚀

**Need help?** Check the logs in your terminal running `npm run dev` for detailed error messages.

**Full documentation**: See [`COMPLETE-FIX-SUMMARY.md`](../COMPLETE-FIX-SUMMARY.md) for complete technical details of all fixes.

---

## 🔁 Stream Broker (POC) — Local Development

This project provides a simple mock Stream Broker you can run locally to test real-time streaming and WebSocket subscriptions.

Start the mock broker (dev mode):

```bash
# In a new terminal
cd test/mocks/stream-broker
npm install
PORT=3003 STREAM_BROKER_KEY=dev-key npm start
```

The broker exposes:
- POST /api/streams/sessions/:sessionId/events — Accepts event envelopes and broadcasts to WS subscribers
- GET /api/streams/sessions/:sessionId/snapshot — Returns the latest snapshot for a session
- GET /api/streams/sessions/:sessionId/logs — Returns audit logs for a session
- WS /ws/sessions/:sessionId — WebSocket subscription to receive streaming events in realtime
- UI demo: `http://localhost:3003/subscriber`

Example `curl` to post an event:

```bash
curl -X POST http://localhost:3003/api/streams/sessions/session-demo/events \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-key' \
  -d '{
    "type": "session.update",
    "payload": { "text": "Hello from container" },
    "seqNo": 1,
    "timestamp": "2025-11-19T12:00:00.000Z"
  }'
```

Connect a subscriber via the demo page or the WS path:

- Demo: http://localhost:3003/subscriber
- WS URL: ws://localhost:3003/ws/sessions/session-demo

How to integrate with the container for local dev:

1. Build the container application as usual: `npm run build:container` (from repo root)
2. Start the mock broker (`PORT=3003 STREAM_BROKER_KEY=dev-key npm start` from within `test/mocks/stream-broker`)
3. Start the worker with env vars to enable posting from the container:

```bash
STREAM_BROKER_URL=http://localhost:3003 STREAM_BROKER_KEY=dev-key STREAM_BROKER_ENABLED=1 npm run dev
```

Notes:
- `STREAM_BROKER_ENABLED` is a feature flag that explicitly enables broker posting. When not set, the container will enable posting when `STREAM_BROKER_URL` is present. Set to `0`/`false` to explicitly disable posting in dev or test environments.
- For safety, the container will not post events if `STREAM_BROKER_ENABLED` is `0`, even when `params.stream` is set to `true`.

Notes:
- In production, the worker will issue ephemeral `streamToken` values for container posts; the mock broker accepts a configured `STREAM_BROKER_KEY` only for local development.
- The container posts are fire-and-forget and non-blocking when the broker is unreachable — the container continues operation.

