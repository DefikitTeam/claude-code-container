#!/bin/bash

# Cloudflare Deploy Button Handler
# This script is called by Cloudflare's deployment service

set -e

echo "🚀 Starting Claude Code Container deployment..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install container dependencies
echo "📦 Installing container dependencies..."
cd container_src
npm install
cd ..

# Build container TypeScript
echo "🔨 Building container..."
cd container_src
npm run build
cd ..

# Deploy using wrangler
echo "🌍 Deploying to Cloudflare Workers..."
npx wrangler deploy --env production

echo "✅ Deployment completed successfully!"
echo "🌐 Your worker should be available shortly"
echo "📋 Next steps:"
echo "   1. Visit your worker URL + /install to set up GitHub App"
echo "   2. Configure webhook URL in your GitHub App settings"
echo "   3. Test with a GitHub issue"
