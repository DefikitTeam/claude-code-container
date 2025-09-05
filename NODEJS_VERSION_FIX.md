# Node.js Version Compatibility Issue & Fix

## 🚨 **Issue Description**

GitHub Actions deployment fails with error:
```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: '@octokit/*',
npm warn EBADENGINE   required: { node: '>= 20' },
npm warn EBADENGINE   current: { node: 'v18.20.8', npm: '10.8.2' }
```

## 🔍 **Root Cause**

- **Wrangler 3.90.0+** and its dependencies require **Node.js 20+**
- **GitHub Actions workflow** was using **Node.js 18**
- **Octokit packages** (used by Wrangler) specifically require Node.js 20+

## ✅ **Fix Applied**

### 1. **Updated GitHub Actions Workflow**
```yaml
# .github/workflows/deploy.yml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'  # Changed from '18' to '20'
    cache: 'npm'
```

### 2. **Updated Documentation**
```markdown
# DEPLOYMENT_GUIDE.md
- [Node.js 20+](https://nodejs.org/) (required for latest Wrangler)
```

### 3. **Added Engine Requirements**
```json
// package.json
"engines": {
  "node": ">=20.0.0"
}
```

```json
// container_src/package.json  
"engines": {
  "node": ">=22.0.0"
}
```

## 🎯 **Version Requirements Summary**

| **Component** | **Node.js Version** | **Reason** |
|---------------|-------------------|------------|
| **GitHub Actions** | Node.js 20+ | Wrangler 3.90.0+ compatibility |
| **Local Development** | Node.js 20+ | Wrangler CLI requirements |
| **Container Runtime** | Node.js 22+ | Cloudflare Container compatibility |

## 🔧 **For Users Who Fork**

If you encounter this error:

### **Option 1: Use Latest Workflow** (Recommended)
- Fork the repository **after this fix**
- The workflow already uses Node.js 20

### **Option 2: Manual Fix**
If you forked before the fix:

1. **Update workflow file** `.github/workflows/deploy.yml`:
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'  # Change from '18' to '20'
    cache: 'npm'
```

2. **Commit and push** the change
3. **Re-run** the failed workflow

### **Option 3: Local Development Fix**
For local CLI deployment:

```bash
# Check current Node.js version
node --version

# If < 20.0.0, upgrade Node.js
# Using nvm (recommended):
nvm install 20
nvm use 20

# Or download from: https://nodejs.org/
```

## 🚀 **Verification**

After applying the fix:

```bash
# Verify Node.js version
node --version  # Should show v20.x.x or higher

# Verify Wrangler works
npx wrangler --version  # Should install without engine warnings
```

## 📋 **Deployment Process Now**

1. **Fork repository** (gets latest workflow with Node.js 20)
2. **Add 4 secrets** (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ANTHROPIC_API_KEY, ENCRYPTION_KEY)
3. **Push change or run workflow manually** 
4. **✅ Deployment succeeds** without engine warnings

## 🔍 **Technical Details**

The specific packages requiring Node.js 20+:
- `@octokit/auth-token@6.0.0`
- `@octokit/core@7.0.3`  
- `@octokit/endpoint@11.0.0`
- `@octokit/graphql@9.0.1`
- `@octokit/plugin-*` (multiple packages)
- `@octokit/request@10.0.3`
- `@octokit/rest@22.0.0`

These are dependencies of Wrangler CLI used for GitHub integration features.
