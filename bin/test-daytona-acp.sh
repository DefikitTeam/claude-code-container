#!/usr/bin/env bash

# ==============================================================================
# Daytona ACP Protocol Full Flow Test Script
# ==============================================================================
# Tests complete ACP workflow: healthcheck → register → session → prompt
# Designed for testing Daytona container provider integration
#
# Usage:
#   ./bin/test-daytona-acp.sh \
#     --installation-id <GITHUB_INSTALLATION_ID> \
#     --api-key <ANTHROPIC_API_KEY> \
#     --repository <OWNER/REPO>
#
# Example:
#   ./bin/test-daytona-acp.sh \
#     --installation-id 85955072 \
#     --api-key sk-ant-api03-xxx \
#     --repository myusername/test-repo
#
# Requirements:
#   - Worker running on http://127.0.0.1:8787 (via `pnpm dev`)
#   - CONTAINER_PROVIDER=daytona in .dev.vars
#   - DAYTONA_API_URL and DAYTONA_API_KEY configured
#   - curl and jq installed
# ==============================================================================

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
WORKER_URL="http://127.0.0.1:8787"
INSTALLATION_ID=""
ANTHROPIC_API_KEY=""
REPOSITORY=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --installation-id)
      INSTALLATION_ID="$2"
      shift 2
      ;;
    --api-key)
      ANTHROPIC_API_KEY="$2"
      shift 2
      ;;
    --repository)
      REPOSITORY="$2"
      shift 2
      ;;
    --worker-url)
      WORKER_URL="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 --installation-id <ID> --api-key <KEY> --repository <OWNER/REPO>"
      echo ""
      echo "Options:"
      echo "  --installation-id    GitHub App installation ID (required)"
      echo "  --api-key            Anthropic API key (required)"
      echo "  --repository         Repository in format owner/repo (required)"
      echo "  --worker-url         Worker URL (default: http://127.0.0.1:8787)"
      echo "  --help               Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Validate required parameters
if [[ -z "$INSTALLATION_ID" ]]; then
  echo -e "${RED}❌ Error: --installation-id is required${NC}"
  exit 1
fi

if [[ -z "$ANTHROPIC_API_KEY" ]]; then
  echo -e "${RED}❌ Error: --api-key is required${NC}"
  exit 1
fi

if [[ -z "$REPOSITORY" ]]; then
  echo -e "${RED}❌ Error: --repository is required${NC}"
  exit 1
fi

# Check dependencies
if ! command -v curl &> /dev/null; then
  echo -e "${RED}❌ Error: curl is not installed${NC}"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo -e "${RED}❌ Error: jq is not installed${NC}"
  exit 1
fi

# Print test configuration
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Daytona ACP Protocol Full Flow Test                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo -e "  Worker URL:       $WORKER_URL"
echo -e "  Installation ID:  $INSTALLATION_ID"
echo -e "  Repository:       $REPOSITORY"
echo -e "  API Key:          ${ANTHROPIC_API_KEY:0:20}***"
echo ""

# Variables to store intermediate results
USER_ID=""
SESSION_ID=""

# ==============================================================================
# Step 1: Health Check
# ==============================================================================
echo -e "${BLUE}[STEP 1]${NC} Health Check..."

HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$WORKER_URL/health")
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -n 1)

if [[ "$HEALTH_STATUS" == "200" ]]; then
  STATUS=$(echo "$HEALTH_BODY" | jq -r '.status // "unknown"')
  PROVIDER=$(echo "$HEALTH_BODY" | jq -r '.containerProvider // "not-specified"')
  echo -e "${GREEN}✅ [STEP 1] Success: Worker is healthy${NC}"
  echo -e "   Status: $STATUS"
  echo -e "   Container Provider: $PROVIDER"
  
  if [[ "$PROVIDER" != "daytona" ]]; then
    echo -e "${YELLOW}⚠️  Warning: Container provider is '$PROVIDER', expected 'daytona'${NC}"
    echo -e "   Make sure CONTAINER_PROVIDER=daytona in .dev.vars"
  fi
else
  echo -e "${RED}❌ [STEP 1] Failed: Worker health check failed (HTTP $HEALTH_STATUS)${NC}"
  echo -e "   Response: $HEALTH_BODY"
  exit 1
fi
echo ""

# ==============================================================================
# Step 2: Register User
# ==============================================================================
echo -e "${BLUE}[STEP 2]${NC} Registering user..."

REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$WORKER_URL/api/users/register" \
  -H "Content-Type: application/json" \
  -H "X-Installation-ID: $INSTALLATION_ID" \
  -d "{
    \"installationId\": \"$INSTALLATION_ID\",
    \"anthropicApiKey\": \"$ANTHROPIC_API_KEY\",
    \"projectLabel\": \"Daytona ACP Test\"
  }")

REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed '$d')
REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n 1)

if [[ "$REGISTER_STATUS" == "200" ]] || [[ "$REGISTER_STATUS" == "201" ]]; then
  USER_ID=$(echo "$REGISTER_BODY" | jq -r '.data.userId // empty')
  
  if [[ -z "$USER_ID" ]]; then
    echo -e "${RED}❌ [STEP 2] Failed: userId not found in response${NC}"
    echo -e "   Response: $REGISTER_BODY"
    exit 1
  fi
  
  echo -e "${GREEN}✅ [STEP 2] Success: User registered${NC}"
  echo -e "   User ID: $USER_ID"
else
  echo -e "${RED}❌ [STEP 2] Failed: User registration failed (HTTP $REGISTER_STATUS)${NC}"
  echo -e "   Response: $REGISTER_BODY"
  exit 1
fi
echo ""

# ==============================================================================
# Step 3: Create ACP Session
# ==============================================================================
echo -e "${BLUE}[STEP 3]${NC} Creating ACP session..."

SESSION_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$WORKER_URL/acp/session/new" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"configuration\": {
      \"workspaceUri\": \"file:///workspace\"
    }
  }")

SESSION_BODY=$(echo "$SESSION_RESPONSE" | sed '$d')
SESSION_STATUS=$(echo "$SESSION_RESPONSE" | tail -n 1)

if [[ "$SESSION_STATUS" == "200" ]]; then
  SESSION_ID=$(echo "$SESSION_BODY" | jq -r '.result.sessionId // empty')
  
  if [[ -z "$SESSION_ID" ]]; then
    echo -e "${RED}❌ [STEP 3] Failed: sessionId not found in response${NC}"
    echo -e "   Response: $SESSION_BODY"
    exit 1
  fi
  
  echo -e "${GREEN}✅ [STEP 3] Success: ACP session created${NC}"
  echo -e "   Session ID: $SESSION_ID"
else
  echo -e "${RED}❌ [STEP 3] Failed: Session creation failed (HTTP $SESSION_STATUS)${NC}"
  echo -e "   Response: $SESSION_BODY"
  exit 1
fi
echo ""

# ==============================================================================
# Step 4: Send Prompt
# ==============================================================================
echo -e "${BLUE}[STEP 4]${NC} Sending prompt to Daytona container..."
echo -e "   This may take 30-60s for Daytona workspace provisioning..."

PROMPT_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$WORKER_URL/acp/session/prompt" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"sessionId\": \"$SESSION_ID\",
    \"installationId\": \"$INSTALLATION_ID\",
    \"content\": [
      {
        \"type\": \"text\",
        \"text\": \"Read the README.md file and tell me what this project does in one sentence\"
      }
    ],
    \"context\": {
      \"repository\": \"$REPOSITORY\"
    }
  }")

PROMPT_BODY=$(echo "$PROMPT_RESPONSE" | sed '$d')
PROMPT_STATUS=$(echo "$PROMPT_RESPONSE" | tail -n 1)

if [[ "$PROMPT_STATUS" == "200" ]]; then
  STOP_REASON=$(echo "$PROMPT_BODY" | jq -r '.result.stopReason // "unknown"')
  SUMMARY=$(echo "$PROMPT_BODY" | jq -r '.result.summary // "No summary available"')
  
  echo -e "${GREEN}✅ [STEP 4] Success: Prompt executed${NC}"
  echo -e "   Stop Reason: $STOP_REASON"
  echo -e "   Summary: $SUMMARY"
  
  # Check for automation result (PR creation)
  AUTOMATION_STATUS=$(echo "$PROMPT_BODY" | jq -r '.result.automationResult.status // "none"')
  if [[ "$AUTOMATION_STATUS" != "none" ]] && [[ "$AUTOMATION_STATUS" != "null" ]]; then
    PR_URL=$(echo "$PROMPT_BODY" | jq -r '.result.automationResult.pullRequest.url // "N/A"')
    PR_NUMBER=$(echo "$PROMPT_BODY" | jq -r '.result.automationResult.pullRequest.number // "N/A"')
    echo -e "   Automation: $AUTOMATION_STATUS"
    echo -e "   Pull Request: #$PR_NUMBER ($PR_URL)"
  fi
else
  echo -e "${RED}❌ [STEP 4] Failed: Prompt execution failed (HTTP $PROMPT_STATUS)${NC}"
  echo -e "   Response: $PROMPT_BODY"
  exit 1
fi
echo ""

# ==============================================================================
# Summary
# ==============================================================================
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Test Summary                                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ All steps completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Key Information:${NC}"
echo -e "  User ID:       $USER_ID"
echo -e "  Session ID:    $SESSION_ID"
echo -e "  Repository:    $REPOSITORY"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  • Check your GitHub repository for changes or PRs"
echo -e "  • Review worker logs for Daytona workspace details"
echo -e "  • Run again with different repository to test workspace reuse"
echo ""

exit 0
