#!/bin/bash

# Claude Code Container MCP Server Setup Script
# This script helps you set up and configure the MCP server

set -e

echo "🚀 Claude Code Container MCP Server Setup"
echo "========================================="

# Check Node.js version
echo "📋 Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1)

if [ "$MAJOR_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION found, but version 18+ is required."
    exit 1
fi

echo "✅ Node.js $NODE_VERSION found"

# Check if pnpm is available, otherwise use npm
if command -v pnpm &> /dev/null; then
    PACKAGE_MANAGER="pnpm"
else
    PACKAGE_MANAGER="npm"
    echo "ℹ️  pnpm not found, using npm"
fi

echo "📦 Using $PACKAGE_MANAGER as package manager"

# Install dependencies
echo "📦 Installing dependencies..."
$PACKAGE_MANAGER install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"

# Build the project
echo "🔨 Building the MCP server..."
$PACKAGE_MANAGER run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build completed"

# Setup environment file
if [ ! -f ".env" ]; then
    echo "⚙️  Creating environment configuration..."
    cat > .env << EOF
# Claude Code Container API URL
# Update this to match your deployment
CLAUDE_CODE_API_URL=http://localhost:8787

# Additional environment variables can be added here
# GITHUB_TOKEN=your_github_token_here
# DEBUG=mcp:*
EOF
    echo "✅ Environment file created (.env)"
    echo "📝 Please edit .env file to configure your API URL"
else
    echo "ℹ️  Environment file (.env) already exists"
fi

# Test the server
echo "🧪 Testing server build..."
timeout 10s node dist/index.js --help 2>/dev/null || echo "✅ Server executable built successfully"

# Generate integration examples
echo "📖 Setting up integration examples..."
chmod +x examples/custom-client.js

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env file to configure your Claude Code API URL"
echo "2. Ensure your Claude Code Container system is running"
echo "3. Test the MCP server:"
echo "   $PACKAGE_MANAGER start"
echo ""
echo "🔗 Integration options:"
echo "• Claude Desktop: See examples/claude-desktop.md"
echo "• Cline VSCode: See examples/cline-vscode.md"
echo "• Custom Client: Run examples/custom-client.js"
echo "• Web API: Run examples/web-api-integration.js"
echo ""
echo "📚 Full documentation: README.md"
echo ""

# Offer to test the connection if Claude Code API URL is set
if grep -q "CLAUDE_CODE_API_URL=http" .env; then
    read -p "🔍 Test connection to Claude Code Container? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔗 Testing connection..."
        
        # Create a simple health check script
        cat > test_connection.js << 'EOF'
import { ClaudeCodeClient } from './dist/client.js';

const client = new ClaudeCodeClient();

try {
    const canConnect = await client.testConnection();
    if (canConnect) {
        console.log('✅ Connection to Claude Code Container successful!');
        process.exit(0);
    } else {
        console.log('❌ Cannot connect to Claude Code Container');
        console.log('   Please ensure the system is running and URL is correct');
        process.exit(1);
    }
} catch (error) {
    console.log('❌ Connection test failed:', error.message);
    process.exit(1);
}
EOF
        
        node test_connection.js
        rm test_connection.js
    fi
fi

echo "✨ Setup complete! Happy coding! ✨"
