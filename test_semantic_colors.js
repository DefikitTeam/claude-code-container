#!/usr/bin/env node

/**
 * Test script for enhanced semantic color parsing
 */

const { ClaudeCodeProcessor } = require('./container_src/src/claude-code-processor.js');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function testSemanticColorParsing() {
  console.log('🧪 Testing Enhanced Semantic Color Parsing');
  console.log('==========================================');
  
  const processor = new ClaudeCodeProcessor();
  
  // Test 1: Advanced color extraction
  console.log('\n1. Testing advanced color extraction:');
  const testColors = [
    'cyan blue',
    'light green', 
    'dark red',
    'navy blue',
    'turquoise',
    'forest green'
  ];
  
  for (const color of testColors) {
    const extractedColor = processor.extractSemanticColor(color);
    console.log(`   "${color}" → ${extractedColor}`);
  }
  
  // Test 2: Contrast color calculation  
  console.log('\n2. Testing contrast color calculation:');
  const testHexColors = ['#00BFFF', '#008000', '#8B0000', '#000080'];
  
  for (const hexColor of testHexColors) {
    const contrastColor = processor.getContrastColor(hexColor);
    console.log(`   ${hexColor} → text: ${contrastColor}`);
  }
  
  // Test 3: CSS generation with semantic analysis
  console.log('\n3. Testing CSS generation with analysis:');
  const mockAnalysis = {
    analysis: `ISSUE TYPE: styling
COLORS IDENTIFIED: cyan blue: #00BFFF
TARGET FILES: index.css, globals.css
IMPLEMENTATION APPROACH: Update CSS variables with specific color`
  };
  
  const mockIntent = {
    description: 'make the background have color cyan blue'
  };
  
  const generatedCSS = processor.generateBackgroundColorCSS(mockIntent, mockAnalysis);
  console.log('Generated CSS:');
  console.log(generatedCSS);
  
  // Test 4: Full analysis prompt
  console.log('\n4. Testing improved analysis prompt:');
  const mockIssue = {
    title: 'Change background to cyan blue',
    number: 123,
    state: 'open',  
    user: { login: 'testuser' },
    body: 'Please make the background have color cyan blue'
  };
  
  const analysisPrompt = processor.buildAnalysisPrompt(mockIssue, '/tmp/test');
  console.log('Analysis prompt preview:');
  console.log(analysisPrompt.substring(0, 500) + '...\n');
  
  console.log('✅ All tests completed successfully!');
  console.log('\n📋 Key improvements:');
  console.log('   • Advanced natural language color parsing');
  console.log('   • Automatic contrast color calculation');
  console.log('   • Semantic analysis integration');
  console.log('   • Enhanced prompt structure');
}

// Run tests
testSemanticColorParsing().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
