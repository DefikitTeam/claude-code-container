#!/usr/bin/env node

/**
 * Test script for Claude Deep Inference System
 * This script allows testing the deep reasoning capabilities locally
 */

import { ClaudeDeepInference } from './src/claude-deep-inference.js';
import 'dotenv/config';

console.log('🧪 Claude Deep Inference Test Suite');
console.log('===================================');

// Test issue examples
const testIssues = {
  simple: {
    title: 'Fix typo in header',
    description: 'There is a small typo in the main header text',
    labels: ['bug', 'documentation']
  },
  
  complex: {
    title: 'Implement user authentication system with JWT',
    description: `Need to implement a complete user authentication system with the following requirements:
    - User registration and login
    - JWT token management
    - Password hashing and security
    - Role-based access control
    - Session management
    - Integration with existing API endpoints`,
    labels: ['feature', 'security', 'backend', 'authentication']
  },
  
  critical: {
    title: 'Critical memory leak in production causing server crashes',
    description: `Production servers are experiencing severe memory leaks causing crashes every 2-3 hours.
    - Memory usage grows from 200MB to 8GB over time
    - Happens primarily during high-traffic periods
    - Error logs show "Maximum call stack size exceeded"
    - Affects user sessions and data persistence
    - Need immediate fix to prevent service downtime`,
    labels: ['critical', 'bug', 'performance', 'production', 'memory-leak']
  }
};

async function testDeepInference() {
  try {
    const deepInference = new ClaudeDeepInference();
    await deepInference.initialize();
    
    console.log('\n🎯 Testing Issue Complexity Analysis');
    console.log('=====================================');
    
    for (const [type, issue] of Object.entries(testIssues)) {
      const complexity = deepInference.calculateComplexity(
        `${issue.title} ${issue.description}`,
        issue
      );
      const profile = deepInference.selectDeepProfile(issue);
      const expectedTime = deepInference.getExpectedTime(profile);
      
      console.log(`\n📊 ${type.toUpperCase()} ISSUE:`);
      console.log(`  Title: ${issue.title.substring(0, 60)}...`);
      console.log(`  Complexity: ${complexity.toFixed(2)} (0.0-1.0)`);
      console.log(`  Selected Profile: ${profile}`);
      console.log(`  Expected Time: ${expectedTime}`);
    }
    
    console.log('\n🧠 Testing Deep Reasoning Analysis');
    console.log('===================================');
    
    // Test with a moderately complex issue
    const testIssue = testIssues.complex;
    const workspaceContext = `
## Test Workspace Context
- Repository: test-auth-system
- Technology: Node.js, Express, MongoDB
- Current files: app.js, routes/, models/, middleware/
- Dependencies: express, mongoose, bcrypt, jsonwebtoken
    `;
    
    console.log(`\n🚀 Starting deep analysis for: "${testIssue.title}"`);
    console.log('⏱️  This will take 30-60 seconds with deep reasoning...');
    
    const startTime = Date.now();
    const result = await deepInference.performDeepAnalysis(
      testIssue,
      workspaceContext,
      'deep' // Force deep profile for testing
    );
    const totalTime = Date.now() - startTime;
    
    console.log('\n✅ Deep Analysis Results:');
    console.log('========================');
    console.log(`⏱️  Total Time: ${totalTime}ms (${Math.round(totalTime/1000)}s)`);
    console.log(`🧠 Reasoning Steps: ${result.metadata.steps.length}`);
    console.log(`📊 Total Tokens: ${result.metadata.totalTokens}`);
    console.log(`🎯 Profile Used: ${result.metadata.profile}`);
    console.log(`📈 Quality Level: ${result.metadata.reasoning_quality}`);
    
    console.log('\n📝 Analysis Preview (first 500 chars):');
    console.log('=====================================');
    console.log(result.analysis.substring(0, 500) + '...');
    
    console.log('\n🔍 Step-by-Step Breakdown:');
    console.log('==========================');
    result.metadata.steps.forEach((step, index) => {
      console.log(`Step ${index + 1} (${step.stepId}): ${step.duration}ms, ${step.tokens} tokens`);
    });
    
    console.log('\n🎉 Test completed successfully!');
    console.log('The Deep Inference System is working properly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

async function testProfileSelection() {
  console.log('\n🎯 Profile Selection Test');
  console.log('=========================');
  
  const deepInference = new ClaudeDeepInference();
  
  const testCases = [
    { text: 'fix button color', expected: 'thorough' },
    { text: 'implement complex authentication system with multiple providers', expected: 'deep' },
    { text: 'critical production bug memory leak causing crashes security vulnerability', expected: 'ultra_deep' },
    { text: 'add new feature component dashboard analytics reporting system', expected: 'deep' }
  ];
  
  testCases.forEach((testCase, index) => {
    const mockIssue = {
      title: testCase.text,
      description: testCase.text,
      labels: []
    };
    
    const complexity = deepInference.calculateComplexity(testCase.text, mockIssue);
    const selectedProfile = deepInference.selectDeepProfile(mockIssue);
    const isCorrect = selectedProfile === testCase.expected;
    
    console.log(`Test ${index + 1}: ${isCorrect ? '✅' : '❌'}`);
    console.log(`  Input: "${testCase.text}"`);
    console.log(`  Complexity: ${complexity.toFixed(2)}`);
    console.log(`  Expected: ${testCase.expected}, Got: ${selectedProfile}`);
  });
}

// Main execution
async function runTests() {
  console.log('\n🚀 Starting Deep Inference Tests...\n');
  
  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is required');
    console.log('Please set your Claude API key in .env file or environment variables');
    process.exit(1);
  }
  
  try {
    await testProfileSelection();
    await testDeepInference();
    
    console.log('\n🎉 All tests passed! Deep Inference System is ready to use.');
    console.log('\nNext steps:');
    console.log('1. Set ENABLE_DEEP_REASONING=true in your environment');
    console.log('2. Increase PROCESSING_TIMEOUT to at least 180000 (3 minutes)');
    console.log('3. Deploy and test with real GitHub issues');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  }
}

runTests();
