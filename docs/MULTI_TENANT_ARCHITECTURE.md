# Multi-Tenant Architecture Options

## Current Architecture: Single GitHub App Model

```typescript
// Single config per Worker deployment
const configDO = getGitHubConfigDO(env);
const id = env.GITHUB_APP_CONFIG.idFromName("github-app-config");
```

## Option 1: App-per-Namespace Model

```typescript
// Multiple apps with different namespaces
function getGitHubConfigDO(env: Env, appNamespace: string) {
  const id = env.GITHUB_APP_CONFIG.idFromName(`app-${appNamespace}`);
  return env.GITHUB_APP_CONFIG.get(id);
}

// Usage:
const userConfig = await getGitHubConfig(env, "user123");
const orgConfig = await getGitHubConfig(env, "org-acme");
```

## Option 2: Installation-based Model

```typescript
// Store configs by installation ID
function getGitHubConfigByInstallation(env: Env, installationId: string) {
  const id = env.GITHUB_APP_CONFIG.idFromName(`install-${installationId}`);
  return env.GITHUB_APP_CONFIG.get(id);
}

// Auto-detect from webhook:
const config = await getGitHubConfigByInstallation(
  env, 
  payload.installation.id.toString()
);
```

## Option 3: Repository-based Model

```typescript
// Per-repository configuration
function getGitHubConfigForRepo(env: Env, repoFullName: string) {
  const id = env.GITHUB_APP_CONFIG.idFromName(`repo-${repoFullName}`);
  return env.GITHUB_APP_CONFIG.get(id);
}

// Usage:
const config = await getGitHubConfigForRepo(env, "owner/repo");
```

## Recommended: Hybrid Model

```typescript
interface MultiTenantGitHubConfig {
  // Primary key: Installation ID (GitHub's natural boundary)
  installationId: string;
  
  // App configuration
  appId: string;
  privateKey: string;
  webhookSecret: string;
  
  // Tenant metadata
  tenantId?: string;     // Optional: for enterprise customers
  userId?: string;       // Optional: for individual users
  repositories: string[]; // Accessible repositories
  
  // Access control
  permissions: {
    canProcessIssues: boolean;
    canCreatePullRequests: boolean;
    maxContainersPerHour: number;
  };
}
```

### Implementation:

```typescript
// Multi-tenant config retrieval
async function getGitHubConfigForInstallation(
  env: Env, 
  installationId: string
): Promise<MultiTenantGitHubConfig | null> {
  const configDO = getGitHubConfigDO(env, `install-${installationId}`);
  const response = await configDO.fetch(
    new Request("http://localhost/retrieve")
  );
  
  if (!response.ok) return null;
  return await response.json();
}

// Auto-detect from webhook payload
const config = await getGitHubConfigForInstallation(
  env,
  payload.installation.id.toString()
);
```

## Storage Requirements Analysis

### Current Model:
- ✅ Simple: 1 config object per Worker
- ✅ No database needed
- ❌ Single tenant only
- ❌ No per-user isolation

### Multi-Tenant Model:
- ✅ Multiple GitHub Apps supported  
- ✅ Per-installation isolation
- ✅ Still uses Durable Objects (no external DB)
- ✅ Natural GitHub boundaries
- ⚠️ More complex config management

## Container Scaling Implications

```typescript
// Current: Simple container naming
const containerId = c.env.MY_CONTAINER.idFromName(`issue-${issue.id}`);

// Multi-tenant: Include installation in container ID
const containerId = c.env.MY_CONTAINER.idFromName(
  `install-${installationId}-issue-${issue.id}`
);
```

### Benefits:
1. **Tenant Isolation**: Containers are isolated by installation
2. **Resource Attribution**: Easy to track usage per tenant
3. **Security**: No cross-tenant data leakage
4. **Billing**: Can measure usage per installation

## GitHub Installation Model Clarification

### **❌ Common Misconception:**
```
1 Repository = 1 Installation ID (WRONG)
Need to change config for each repo (WRONG)
```

### **✅ Actual GitHub Model:**
```
1 GitHub App Installation = Multiple Repositories
1 Installation ID = Access to ALL selected repos in that org/user account
```

**Real Example:**
```typescript
// User Alice installs your GitHub App with Installation ID: 12345
// This SINGLE installation can access:
Installation 12345 → {
  repositories: [
    "alice/repo1",      // ✅ Same installation
    "alice/repo2",      // ✅ Same installation  
    "alice/repo3",      // ✅ Same installation
    "alice/private-repo" // ✅ Same installation
  ]
}

// Organization ACME installs your GitHub App with Installation ID: 67890  
Installation 67890 → {
  repositories: [
    "acme/frontend",    // ✅ Same installation
    "acme/backend",     // ✅ Same installation
    "acme/mobile-app"   // ✅ Same installation
  ]
}
```

### **Container Parallelism is NOT Affected:**
```typescript
// All these run in parallel with SAME installation ID:
const container1 = env.MY_CONTAINER.idFromName(`install-12345-issue-101`); // alice/repo1 issue
const container2 = env.MY_CONTAINER.idFromName(`install-12345-issue-202`); // alice/repo2 issue  
const container3 = env.MY_CONTAINER.idFromName(`install-12345-issue-303`); // alice/repo3 issue

// Different organizations use different installation IDs:
const container4 = env.MY_CONTAINER.idFromName(`install-67890-issue-404`); // acme/frontend issue
```

## Conclusion

**For multi-user/multi-repo scenarios:**
- Container isolation handles processing separation ✅
- Durable Objects handle configuration storage ✅  
- No external database needed ✅
- GitHub Installation ID is natural tenant boundary ✅
- **1 Installation = Multiple Repos (Perfect parallelism)** ✅

**Recommended approach:**
Use Installation-based multi-tenancy with Durable Objects storage.
