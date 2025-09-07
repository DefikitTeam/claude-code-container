# 🚀 Deploy Your Own Claude Code Containers

This template helps you quickly deploy your own instance of the Claude Code Containers system to Cloudflare Workers.

## 📋 Prerequisites

Before you begin, make sure you have:

- [x] **Cloudflare Account** (free tier works)
- [x] **GitHub Account** (where you'll fork this repo)
- [x] **Anthropic API Key** ([get one here](https://console.anthropic.com/))

## ⚡ Quick Deploy (Recommended)

The fastest way to get started is using our one-click deploy button:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yourusername/claudecode-modern-container)

This will:
1. Fork this repository to your GitHub account
2. Set up Cloudflare Workers environment
3. Guide you through credential configuration
4. Deploy your instance automatically

## 🛠️ Manual Setup (Advanced)

If you prefer manual setup or need custom configuration:

### Step 1: Fork Repository
1. Click the "Fork" button at the top of this repository
2. Choose your GitHub account as the destination

### Step 2: Configure Environment Variables
1. Create `.dev.vars` file from `.dev.vars.template`
2. Add your Anthropic API key:
   ```bash
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```

### Step 3: Deploy to Cloudflare
1. Install Wrangler CLI: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. Deploy: `npm run deploy`

### Step 4: Configure GitHub App
1. Create GitHub App with required permissions
2. Store credentials using the `/config` endpoint
3. Set up webhook URL pointing to your worker

## 📖 Configuration Guide

### Required Environment Variables

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `ANTHROPIC_API_KEY` | Your Claude API key | [Anthropic Console](https://console.anthropic.com/) |

### GitHub App Permissions

When creating your GitHub App, configure these permissions:
- **Issues**: Read & Write
- **Pull Requests**: Read & Write  
- **Contents**: Read & Write
- **Metadata**: Read

### Webhook Configuration
- **Webhook URL**: `https://your-worker.your-subdomain.workers.dev/webhook/github`
- **Content type**: `application/json`
- **Events**: Issues
- **Secret**: Generate and save securely

## 🔧 Troubleshooting

### Common Issues

**Deploy Button Not Working?**
- Make sure your repository is public
- Check that all required files are present
- Verify your GitHub permissions

**Worker Deploy Failing?**
- Check your Cloudflare account limits
- Verify your API keys are correct
- Review the deployment logs

**GitHub Integration Issues?**
- Confirm webhook URL is correct
- Check GitHub App permissions
- Verify webhook secret matches

### Support

If you need help:
1. Check the [troubleshooting guide](./docs/troubleshooting.md)
2. Review [common deployment issues](./docs/common-issues.md)
3. Open an issue in the original repository

## 🎯 Next Steps

Once deployed:
1. Test the system by creating a GitHub issue
2. Watch Claude Code analyze and respond
3. Review generated pull requests
4. Customize the system for your needs

## 📄 License

This template is provided under the MIT License. See [LICENSE](./LICENSE) for details.

---

*This template creates an automated GitHub issue processing system powered by Claude Code on Cloudflare Workers.*