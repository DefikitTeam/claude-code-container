# 🚀 Deploy Claude Code Container to Cloudflare

## ⚠️ Important: Deploy Button Status

**Current Status**: The direct deploy button has known authorization issues with complex Workers projects that use containers and durable objects.

**Recommended Solution**: Use the **Fork + GitHub Actions** method below for reliable deployment.

---

## 🎯 **Method 1: Fork + GitHub Actions** (Recommended)

This is the most reliable way to deploy:

### Step 1: Fork the Repository
1. Click the **"Fork"** button at the top of this page
2. Choose your GitHub account as the destination

### Step 2: Set up Cloudflare Secrets
In your forked repository:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Add these **4 Repository secrets**:

```bash
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ENCRYPTION_KEY=your_32_character_encryption_key_here
```

**How to get these values:**

- **CLOUDFLARE_API_TOKEN**: 
  1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
  2. Click "Create Token"
  3. Use "Edit Cloudflare Workers" template
  4. Include permissions: `Zone:Zone:Read`, `Account:Cloudflare Workers:Edit`

- **CLOUDFLARE_ACCOUNT_ID**: 
  1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
  2. Select your domain
  3. Find "Account ID" in the right sidebar

- **ANTHROPIC_API_KEY**: 
  1. Go to [Anthropic Console](https://console.anthropic.com/)
  2. Create an API key

- **ENCRYPTION_KEY**: 
  1. Generate a secure 32-character key: `openssl rand -hex 32`
  2. Example: `a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456`

### Step 3: Deploy
1. Go to your forked repo's **Actions** tab
2. Click **"Deploy to Cloudflare Workers"**
3. Click **"Run workflow"**
4. Select branch: `main`
5. Choose environment: `production`
6. Click **"Run workflow"**

### Step 4: Complete Setup
After deployment:
1. Visit: `https://your-worker-name.workers.dev/install`
2. Follow the GitHub App setup wizard
3. Configure webhooks and test!

---

## 🛠️ **Method 2: Local CLI Deployment**

For developers who prefer command-line:

### Prerequisites
- [Node.js 18+](https://nodejs.org/)
- [Git](https://git-scm.com/)

### Steps

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/claude-code-container.git
cd claude-code-container

# 2. Install dependencies
npm install
cd container_src && npm install && cd ..

# 3. Install Wrangler CLI
npm install -g wrangler

# 4. Login to Cloudflare
wrangler login

# 5. Deploy
wrangler deploy --env production
```

---

## 🔧 **Method 3: Manual Deploy Button** (Limited Support)

⚠️ **Warning**: This method may fail due to authentication issues.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DefikitTeam/claude-code-container)

If you encounter "Unauthorized" errors, please use **Method 1** instead.

---

## 🎉 **After Deployment**

Once deployed successfully:

1. **Configure GitHub App**: Visit `https://your-worker-url.workers.dev/install`
2. **Set up Webhooks**: Point to `https://your-worker-url.workers.dev/webhook/github`
3. **Test**: Create a GitHub issue to see automation in action!

---

## 🆘 **Troubleshooting**

### "Unauthorized" Error
- **Solution**: Use Method 1 (Fork + GitHub Actions)
- **Cause**: Deploy button service limitations

### Build Failures
- **Check**: All dependencies installed correctly
- **Try**: Re-run GitHub Actions workflow

### GitHub App Issues
- **Verify**: Webhook URL is correct
- **Check**: GitHub App permissions include Issues, Pull Requests, Contents

---

## 📚 **Need Help?**

- 📖 [Full Documentation](./README.md)
- 🐛 [Report Issues](https://github.com/DefikitTeam/claude-code-container/issues)
- 💬 [GitHub Discussions](https://github.com/DefikitTeam/claude-code-container/discussions)
