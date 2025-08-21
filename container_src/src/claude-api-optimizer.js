import Anthropic from '@anthropic-ai/sdk';

console.log('Claude API Optimizer module loaded successfully');

/**
 * Advanced Claude API configuration and optimization
 * Based on the example configurations from worker-configuration.d.ts
 */
export class ClaudeAPIOptimizer {
  constructor() {
    this.anthropic = null;
    this.initialized = false;
    
    // Optimized configuration profiles for different use cases
    this.configProfiles = {
      // High precision for code analysis
      analysis: {
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        temperature: 0.1,          // Low creativity for factual analysis
        top_p: 0.8,                // Focused on most probable responses  
        top_k: 20,                 // Limit to top 20 most probable words
        repetition_penalty: 1.05,  // Slight penalty to avoid repetition
        frequency_penalty: 0.1,    // Discourage repetitive phrases
        presence_penalty: 0.0      // Don't penalize new topics
      },
      
      // Balanced approach for implementation
      implementation: {
        model: 'claude-3-haiku-20240307',
        max_tokens: 3000,
        temperature: 0.2,          // Slightly more creative for solutions
        top_p: 0.9,                // Allow more diverse responses
        top_k: 40,                 // More word choices for implementation
        repetition_penalty: 1.1,   // Moderate penalty for repetition
        frequency_penalty: 0.15,   // Discourage repetitive code patterns
        presence_penalty: 0.05     // Slight encouragement for diverse topics
      },
      
      // High creativity for problem-solving
      problem_solving: {
        model: 'claude-3-haiku-20240307',
        max_tokens: 3500,
        temperature: 0.3,          // More creative for innovative solutions
        top_p: 0.95,               // High diversity in responses
        top_k: 60,                 // More word choices for creativity
        repetition_penalty: 1.15,  // Higher penalty to encourage variety
        frequency_penalty: 0.2,    // Discourage repetitive solutions
        presence_penalty: 0.1      // Encourage exploring new approaches
      },
      
      // Focused approach for semantic understanding
      semantic: {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1500,
        temperature: 0.05,         // Very low for precise understanding
        top_p: 0.7,                // Focused on most likely responses
        top_k: 15,                 // Very focused word selection
        repetition_penalty: 1.02,  // Minimal repetition penalty
        frequency_penalty: 0.05,   // Minimal frequency penalty
        presence_penalty: 0.0      // No presence penalty for consistency
      }
    };
  }

  /**
   * Initialize Claude API with authentication
   */
  async initialize(apiKey = null) {
    if (this.initialized && this.anthropic) {
      return this.anthropic;
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key is required but not provided');
    }

    try {
      this.anthropic = new Anthropic({
        apiKey: key
      });
      
      this.initialized = true;
      console.log('✅ Claude API Optimizer initialized successfully');
      return this.anthropic;
    } catch (error) {
      console.error('❌ Failed to initialize Claude API Optimizer:', error);
      throw new Error(`Claude API Optimizer initialization failed: ${error.message}`);
    }
  }

  /**
   * Get optimized configuration for specific use case
   */
  getOptimizedConfig(profile = 'analysis', customOverrides = {}) {
    const baseConfig = this.configProfiles[profile];
    if (!baseConfig) {
      console.warn(`⚠️ Unknown profile '${profile}', using 'analysis' as fallback`);
      return { ...this.configProfiles.analysis, ...customOverrides };
    }

    const config = { ...baseConfig, ...customOverrides };
    
    console.log(`🎯 Using optimized config profile: '${profile}'`, {
      model: config.model,
      max_tokens: config.max_tokens,
      temperature: config.temperature,
      top_p: config.top_p,
      top_k: config.top_k,
      customOverrides: Object.keys(customOverrides)
    });

    return config;
  }

  /**
   * Enhanced Claude API call with optimized parameters
   */
  async optimizedQuery(messages, profile = 'analysis', customOverrides = {}) {
    if (!this.initialized || !this.anthropic) {
      await this.initialize();
    }

    const config = this.getOptimizedConfig(profile, customOverrides);
    const startTime = Date.now();
    
    console.log(`🚀 Starting optimized Claude query with profile: ${profile}`);
    
    try {
      const response = await this.anthropic.messages.create({
        ...config,
        messages: messages
      });

      const duration = Date.now() - startTime;
      const usage = response.usage || {};
      
      console.log(`✅ Claude query completed successfully in ${duration}ms`, {
        profile,
        model: config.model,
        input_tokens: usage.input_tokens || 'unknown',
        output_tokens: usage.output_tokens || 'unknown',
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        temperature: config.temperature,
        duration_ms: duration
      });

      return {
        success: true,
        response,
        usage,
        duration,
        config: {
          profile,
          model: config.model,
          temperature: config.temperature,
          top_p: config.top_p,
          max_tokens: config.max_tokens
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`❌ Claude query failed after ${duration}ms:`, {
        profile,
        error: error.message,
        type: error.constructor.name,
        duration_ms: duration
      });

      throw new Error(`Optimized Claude query failed: ${error.message}`);
    }
  }

  /**
   * Prepare optimized prompt structure based on example/main.ts approach
   */
  prepareOptimizedPrompt(issueContext, workspaceDir, analysisType = 'semantic') {
    const optimizedPrompt = `# GitHub Issue Analysis - Intelligent Processing Required

## System Context
- **Processing Mode**: ${analysisType.toUpperCase()}
- **Repository**: ${issueContext.repositoryName || 'Unknown'}
- **Workspace**: ${workspaceDir}
- **Timestamp**: ${new Date().toISOString()}

## Issue Details
- **Number**: #${issueContext.issueNumber}
- **Title**: ${issueContext.title}
- **Author**: ${issueContext.author || 'Unknown'}
- **Labels**: ${Array.isArray(issueContext.labels) ? issueContext.labels.join(', ') : 'None'}

## Issue Description
${issueContext.description || 'No description provided'}

## Intelligent Analysis Instructions

### 1. SEMANTIC UNDERSTANDING (Priority: Critical)
Extract the TRUE intent behind the user's request:
- **Primary Objective**: What does the user actually want to achieve?
- **Technical Requirements**: What specific technical changes are needed?
- **Constraints & Context**: What limitations or existing patterns must be respected?
- **Success Criteria**: How will we know the solution is correct?

### 2. CONTEXTUAL ANALYSIS (Priority: High)
Examine the workspace and codebase:
- **Project Structure**: Understand the architecture and organization
- **Technology Stack**: Identify frameworks, languages, and tools in use
- **Existing Patterns**: Find similar implementations or established conventions
- **Dependencies**: Note relevant packages, libraries, or external services

### 3. SOLUTION ARCHITECTURE (Priority: High)
Design the optimal approach:
- **Implementation Strategy**: Step-by-step approach to solving the issue
- **File Modifications**: Specific files that need to be created or modified
- **Integration Points**: How changes integrate with existing code
- **Testing Strategy**: How to verify the solution works correctly

### 4. QUALITY ASSURANCE (Priority: Medium)
Ensure solution quality:
- **Code Standards**: Follow existing code style and conventions
- **Performance Impact**: Consider performance implications
- **Security Considerations**: Identify and address security concerns
- **Maintainability**: Ensure solution is maintainable and extensible

## Expected Response Format
Provide a structured analysis with:

\`\`\`
ISSUE TYPE: [type]
PRIMARY INTENT: [clear statement of what user wants]
TECHNICAL REQUIREMENTS: [specific technical needs]
PROPOSED SOLUTION: [detailed implementation approach]
FILES TO MODIFY: [list of files to change]
IMPLEMENTATION STEPS: [step-by-step instructions]
TESTING APPROACH: [how to verify success]
QUALITY NOTES: [important considerations]
\`\`\`

Focus on delivering ACTIONABLE, SPECIFIC guidance rather than generic advice.`;

    return {
      role: 'user',
      content: optimizedPrompt
    };
  }

  /**
   * Auto-select best configuration profile based on issue type
   */
  autoSelectProfile(issueContext) {
    const title = (issueContext.title || '').toLowerCase();
    const description = (issueContext.description || '').toLowerCase();
    const labels = Array.isArray(issueContext.labels) ? 
      issueContext.labels.map(l => l.toLowerCase()).join(' ') : '';
    
    const fullText = `${title} ${description} ${labels}`;
    
    // Pattern matching for profile selection
    if (fullText.match(/bug|fix|error|issue|problem|broken/)) {
      return 'problem_solving';
    } else if (fullText.match(/implement|add|create|build|develop|feature/)) {
      return 'implementation';  
    } else if (fullText.match(/style|color|design|ui|ux|theme/)) {
      return 'semantic';
    } else if (fullText.match(/analyze|review|understand|explain/)) {
      return 'analysis';
    }
    
    // Default to analysis for unknown patterns
    return 'analysis';
  }

  /**
   * Complete optimized analysis workflow
   */
  async performOptimizedAnalysis(issueContext, workspaceDir) {
    console.log('🎯 Starting optimized Claude analysis workflow');
    
    // Auto-select best profile for this issue type
    const selectedProfile = this.autoSelectProfile(issueContext);
    console.log(`📊 Auto-selected profile: ${selectedProfile} based on issue characteristics`);
    
    // Prepare optimized prompt
    const optimizedPrompt = this.prepareOptimizedPrompt(issueContext, workspaceDir, selectedProfile);
    
    // Custom overrides for specific improvements
    const customConfig = {};
    
    // Slightly increase max tokens for complex issues  
    if (issueContext.description && issueContext.description.length > 1000) {
      customConfig.max_tokens = 4000;
    }
    
    // Reduce temperature for critical bugs
    if (issueContext.labels && issueContext.labels.some(l => l.includes('critical'))) {
      customConfig.temperature = 0.05;
    }
    
    // Execute optimized query
    const result = await this.optimizedQuery(
      [optimizedPrompt],
      selectedProfile,
      customConfig
    );
    
    // Extract and format response
    if (result.success && result.response && result.response.content) {
      const content = result.response.content[0];
      const analysisText = content.type === 'text' ? content.text : JSON.stringify(content);
      
      console.log('✅ Optimized analysis completed successfully', {
        profile: selectedProfile,
        tokens_used: result.usage?.output_tokens || 'unknown',
        duration: result.duration,
        response_length: analysisText.length
      });
      
      return {
        success: true,
        analysis: analysisText,
        metadata: {
          profile: selectedProfile,
          config: result.config,
          usage: result.usage,
          duration: result.duration,
          optimizations_applied: [
            'Profile-based parameter selection',
            'Context-aware prompt optimization', 
            'Automatic issue type detection',
            'Performance-tuned API parameters'
          ]
        }
      };
    } else {
      throw new Error('Invalid response structure from Claude API');
    }
  }
}

export default ClaudeAPIOptimizer;