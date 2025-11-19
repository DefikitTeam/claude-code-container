#!/usr/bin/env node

/**
 * Test script for HTTP Bridge functionality
 * Tests communication between lightweight client and remote worker
 */

import { WorkerHttpClient } from './dist/utils.js';

async function testHttpBridge() {
  console.log('🧪 Testing HTTP Bridge Client...');

  const workerUrl = process.env.WORKER_URL || 'http://localhost:8787';
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  const client = new WorkerHttpClient(workerUrl, apiKey);

  try {
    // Test 1: Initialize request
    console.log('📡 Testing initialize...');
    const initResult = await client.sendJsonRpc(
      'initialize',
      {
        protocolVersion: '0.3.1',
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      },
      'test-init',
    );

    console.log('✅ Initialize success:', JSON.stringify(initResult, null, 2));

    // Test 2: New session
    console.log('📡 Testing new session...');
    const sessionResult = await client.sendJsonRpc(
      'session/new',
      {
        cwd: process.cwd(),
        mcpServers: [],
      },
      'test-session',
    );

    console.log(
      '✅ New session success:',
      JSON.stringify(sessionResult, null, 2),
    );

    // Test 3: Simple prompt
    console.log('📡 Testing prompt...');
    const promptResult = await client.sendJsonRpc(
      'session/prompt',
      {
        sessionId: sessionResult.sessionId,
        prompt: [
          {
            type: 'text',
            text: 'Hello, can you help me create a simple JavaScript function?',
          },
        ],
      },
      'test-prompt',
    );

    console.log('✅ Prompt success:', JSON.stringify(promptResult, null, 2));

    console.log('🎉 All HTTP Bridge tests passed!');
  } catch (error) {
    console.error('❌ HTTP Bridge test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testHttpBridge();
}
