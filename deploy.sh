#!/bin/bash

# Claude Code Containers - Easy Deploy Script
echo "🚀 Claude Code Containers Deployment Script"
echo "============================================"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "📦 Installing Wrangler CLI..."
    npm install -g wrangler
fi

# Check if user is logged in
echo "🔐 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "Please log in to Cloudflare:"
    wrangler login
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

cd container_src
npm install
echo "🔨 Building container..."
npm run build
cd ..

# Deploy
echo "🚀 Deploying to Cloudflare Workers..."
wrangler deploy

echo "✅ Deployment complete!"
echo "🔗 Your worker should be available at the URL shown above"
echo ""
echo "Next steps:"
echo "1. Create a GitHub App and get your Installation ID"
echo "2. Configure your GitHub App using the /config endpoint"
echo "3. Test by creating an issue in your repository"