#!/bin/bash

# Debug specific failing endpoint

echo "🔍 Debugging ACP Session/New Failure"
echo "===================================="

# Test basic worker health first
echo "1. Testing worker health..."
curl -s http://localhost:8787/health | jq '.'

echo -e "\n2. Testing session/new with verbose curl..."
curl -v -X POST http://localhost:8787/acp/session/new \
  -H "Content-Type: application/json" \
  -d '{
    "sessionOptions": {
      "workspaceUri": "file:///tmp/test-workspace",
      "mode": "development"
    }
  }' | jq '.'

echo -e "\n3. Testing simple initialize first..."
curl -s -X POST http://localhost:8787/acp/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "protocolVersion": "0.3.1",
    "capabilities": {"tools": {}},
    "clientInfo": {"name": "debug-test", "version": "1.0"}
  }' | jq '.'