#!/bin/bash

# Test deployment configuration
# This script validates that the deploy button setup will work

echo "🧪 Testing Claude Code Container deploy button configuration..."

# Check required files exist
echo "📄 Checking required configuration files..."

required_files=(
    "app.json"
    "cloudflare.json"
    "deploy.json"
    "package.json"
    "wrangler.jsonc"
    "Dockerfile"
    "container_src/package.json"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

# Test npm scripts
echo "🔧 Testing npm scripts..."
if npm run-script 2>/dev/null | grep -q "build:all"; then
    echo "✅ build:all script available"
else
    echo "❌ build:all script missing"
    exit 1
fi

# Test container dependencies
echo "📦 Testing container dependencies..."
if [ -d "container_src/node_modules" ]; then
    echo "✅ Container dependencies installed"
else
    echo "⚠️  Container dependencies not installed, installing..."
    cd container_src && npm install && cd ..
fi

# Validate JSON files
echo "🔍 Validating JSON configuration..."
for json_file in app.json cloudflare.json deploy.json; do
    if node -e "JSON.parse(require('fs').readFileSync('$json_file', 'utf8'))" 2>/dev/null; then
        echo "✅ $json_file is valid JSON"
    else
        echo "❌ $json_file has invalid JSON"
        exit 1
    fi
done

echo ""
echo "🎉 Deploy button configuration test completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Commit and push these configuration files"
echo "   2. Test the deploy button: https://deploy.workers.cloudflare.com/?url=https://github.com/DefikitTeam/claude-code-container"
echo "   3. Verify deployment works in Cloudflare dashboard"
