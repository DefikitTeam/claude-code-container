#!/bin/bash

# T017 Integration Test Script
# Tests the complete production flow: Worker (8787) → Container (8080) → Enhanced ACP Handlers

echo "🚀 Testing T017: Worker-to-Container ACP Integration"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test URLs
WORKER_URL="http://localhost:8787"
CONTAINER_URL="http://localhost:8080"

# Function to test an endpoint
test_endpoint() {
    local url=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local description=$5

    echo -e "\n${YELLOW}Testing: $description${NC}"
    echo "URL: $method $url$endpoint"

    if [ -n "$data" ]; then
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "$method" "$url$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null)
    else
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "$method" "$url$endpoint" 2>/dev/null)
    fi

    http_status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
    response_body=$(echo "$response" | sed '/HTTP_STATUS:/d')

    if [ "$http_status" -eq 200 ] || [ "$http_status" -eq 201 ]; then
        echo -e "${GREEN}✅ PASS${NC} (HTTP $http_status)"
        echo "Response: $(echo "$response_body" | jq -r '.message // .status // .result.serverInfo.name // "Success"' 2>/dev/null || echo "$response_body" | head -c 100)"
    else
        echo -e "${RED}❌ FAIL${NC} (HTTP $http_status)"
        echo "Response: $(echo "$response_body" | head -c 200)"
    fi

    return $http_status
}

# Start the tests
echo -e "\n${YELLOW}1. Testing Basic Worker Health${NC}"
test_endpoint "$WORKER_URL" "GET" "/health" "" "Worker health check"

echo -e "\n${YELLOW}2. Testing Container Health via Worker${NC}"
test_endpoint "$WORKER_URL" "GET" "/container/health" "" "Container health via worker"

echo -e "\n${YELLOW}3. Testing ACP Bridge Status${NC}"
test_endpoint "$WORKER_URL" "GET" "/acp/status" "" "ACP bridge status"

echo -e "\n${YELLOW}4. Testing ACP Initialize via Worker${NC}"
INIT_DATA='{
  "protocolVersion": "0.3.1",
  "capabilities": {
    "tools": {}
  },
  "clientInfo": {
    "name": "test-client",
    "version": "1.0.0"
  }
}'
test_endpoint "$WORKER_URL" "POST" "/acp/initialize" "$INIT_DATA" "ACP Initialize through worker"

echo -e "\n${YELLOW}5. Testing ACP Session Creation via Worker${NC}"
SESSION_DATA='{
  "sessionOptions": {
    "workspaceUri": "file:///tmp/test-workspace",
    "mode": "development"
  }
}'

# Capture session ID for subsequent tests
echo -e "\n${YELLOW}Creating session and extracting session ID...${NC}"
session_response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WORKER_URL/acp/session/new" \
    -H "Content-Type: application/json" \
    -d "$SESSION_DATA" 2>/dev/null)

session_http_status=$(echo "$session_response" | grep "HTTP_STATUS:" | cut -d: -f2)
session_response_body=$(echo "$session_response" | sed '/HTTP_STATUS:/d')

if [ "$session_http_status" -eq 200 ]; then
    SESSION_ID=$(echo "$session_response_body" | jq -r '.result.sessionId // empty' 2>/dev/null)
    if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "null" ]; then
        echo -e "${GREEN}✅ Session Created${NC}: $SESSION_ID"
    else
        echo -e "${RED}❌ Failed to extract session ID${NC}"
        SESSION_ID="test-session-123"  # fallback
    fi
else
    echo -e "${RED}❌ Session creation failed${NC} (HTTP $session_http_status)"
    SESSION_ID="test-session-123"  # fallback
fi

echo -e "\n${YELLOW}6. Testing ACP Session Prompt via Worker${NC}"
PROMPT_DATA="{
  \"sessionId\": \"$SESSION_ID\",
  \"content\": [
    {
      \"type\": \"text\",
      \"content\": \"Hello, this is a test prompt for T017 verification\"
    }
  ]
}"
test_endpoint "$WORKER_URL" "POST" "/acp/session/prompt" "$PROMPT_DATA" "ACP Session Prompt through worker"

echo -e "\n${YELLOW}7. Testing Direct Container Access (Expected to Fail)${NC}"
echo -e "${YELLOW}Note: Containers are internal to Cloudflare Workers - direct access is not supported${NC}"
test_endpoint "$CONTAINER_URL" "POST" "/acp" '{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "0.3.1",
    "capabilities": {},
    "clientInfo": {"name": "direct-test", "version": "1.0"}
  },
  "id": 1
}' "Direct container ACP initialize (expected failure)"

echo -e "\n=================================================="
echo -e "${GREEN}🎯 T017 Integration Test Complete${NC}"
echo ""
echo "📋 Summary:"
echo "  - Worker routing to container ACP handlers"
echo "  - Enhanced ACP handlers (T012-T016) integration"
echo "  - Production flow verification: Worker (8787) → Container (8080)"
echo ""
echo "🔧 To run this test:"
echo "  1. Start worker: pnpm dev (port 8787)"
echo "  2. Container starts automatically via worker"
echo "  3. Run: bash test-acp-integration.sh"
echo ""
echo "📝 Expected Results:"
echo "  - Worker endpoints (steps 1-5) should return HTTP 200"
echo "  - Session creation should return dynamic session ID"
echo "  - Session prompt will fail with ANTHROPIC_API_KEY error (known issue)"
echo "  - Direct container access (step 7) should fail with connection error"
echo ""
echo "⚠️  Known Issues:"
echo "  - Step 6: ANTHROPIC_API_KEY not passed to container (configuration issue)"
echo "  - Step 7: Direct container access not supported in Cloudflare Workers"