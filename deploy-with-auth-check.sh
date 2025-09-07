#!/bin/bash

# Enhanced deployment script with authentication checks
# This script validates authentication before attempting deployment

set -e

echo "🔐 Claude Code Container - Authentication Check & Deploy"
echo "======================================================="

# Function to check if user is authenticated
check_auth() {
    echo "🔍 Checking Cloudflare authentication..."
    
    if ! command -v wrangler &> /dev/null; then
        echo "❌ Wrangler CLI not found. Installing..."
        npm install -g wrangler
    fi
    
    # Check if already authenticated
    if wrangler whoami &>/dev/null; then
        echo "✅ Already authenticated with Cloudflare"
        return 0
    else
        echo "❌ Not authenticated with Cloudflare"
        return 1
    fi
}

# Function to attempt login
attempt_login() {
    echo "🔐 Attempting Cloudflare login..."
    
    # Try to login (this will open browser or prompt for API token)
    if wrangler login; then
        echo "✅ Successfully authenticated with Cloudflare"
        return 0
    else
        echo "❌ Authentication failed"
        return 1
    fi
}

# Function to check required environment variables
check_env_vars() {
    echo "📋 Checking required environment variables..."
    
    required_vars=("ANTHROPIC_API_KEY")
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -eq 0 ]]; then
        echo "✅ All required environment variables are set"
        return 0
    else
        echo "❌ Missing required environment variables: ${missing_vars[*]}"
        echo ""
        echo "Please set these environment variables:"
        for var in "${missing_vars[@]}"; do
            case $var in
                "ANTHROPIC_API_KEY")
                    echo "  export ANTHROPIC_API_KEY='your-api-key-here'  # Get from https://console.anthropic.com/"
                    ;;
            esac
        done
        return 1
    fi
}

# Function to install dependencies
install_deps() {
    echo "📦 Installing dependencies..."
    
    # Install root dependencies
    if npm install; then
        echo "✅ Root dependencies installed"
    else
        echo "❌ Failed to install root dependencies"
        return 1
    fi
    
    # Install container dependencies
    echo "📦 Installing container dependencies..."
    if cd container_src && npm install && cd ..; then
        echo "✅ Container dependencies installed"
    else
        echo "❌ Failed to install container dependencies"
        return 1
    fi
}

# Function to build project
build_project() {
    echo "🔨 Building project..."
    
    if cd container_src && npm run build && cd ..; then
        echo "✅ Container build completed"
        return 0
    else
        echo "❌ Container build failed"
        return 1
    fi
}

# Function to deploy
deploy_worker() {
    echo "🚀 Deploying to Cloudflare Workers..."
    
    if wrangler deploy --env production; then
        echo "✅ Deployment successful!"
        return 0
    else
        echo "❌ Deployment failed"
        return 1
    fi
}

# Main execution flow
main() {
    # Check authentication first
    if ! check_auth; then
        echo ""
        echo "⚠️  Authentication required. Attempting to log in..."
        if ! attempt_login; then
            echo ""
            echo "❌ Deployment cannot proceed without authentication."
            echo ""
            echo "🔧 Alternative deployment methods:"
            echo "   1. Use GitHub Actions (recommended): See DEPLOYMENT_GUIDE.md"
            echo "   2. Set CLOUDFLARE_API_TOKEN environment variable"
            echo "   3. Run 'wrangler login' manually"
            exit 1
        fi
    fi
    
    # Check environment variables
    if ! check_env_vars; then
        echo ""
        echo "❌ Deployment cannot proceed without required environment variables."
        exit 1
    fi
    
    # Install dependencies
    if ! install_deps; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
    
    # Build project
    if ! build_project; then
        echo "❌ Failed to build project"
        exit 1
    fi
    
    # Deploy
    if ! deploy_worker; then
        echo "❌ Deployment failed"
        exit 1
    fi
    
    # Success message
    echo ""
    echo "🎉 Deployment completed successfully!"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Visit your worker URL + /install to set up GitHub App"
    echo "   2. Configure webhook URL in your GitHub App settings"
    echo "   3. Test with a GitHub issue"
    echo ""
    echo "📚 For help: See DEPLOYMENT_GUIDE.md"
}

# Run main function
main "$@"
