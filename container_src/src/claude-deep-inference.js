import Anthropic from '@anthropic-ai/sdk';

console.log('Claude Deep Inference System loaded - Optimized for thorough reasoning');

/**
 * Advanced Claude API system focused on deep reasoning and high-quality analysis
 * Implements Chain-of-Thought, multi-step analysis, and extended reasoning time
 */
export class ClaudeDeepInference {
  constructor() {
    this.anthropic = null;
    this.initialized = false;
    
    // Deep reasoning configuration profiles
    this.deepProfiles = {
      // Ultra-deep analysis for complex issues (60-120s expected)
      ultra_deep: {
        model: 'claude-3-5-sonnet-20241022', // Most capable model
        max_tokens: 8192,                    // Maximum context for deep analysis
        temperature: 0.3,                    // Balanced creativity/precision
        top_p: 0.9,                         // High diversity for thorough exploration
        top_k: 50,                          // Wide vocabulary for detailed explanations
        reasoning_steps: 5,                 // Multiple reasoning phases
        validation_passes: 3,               // Multiple validation rounds
        reflection_enabled: true,           // Self-reflection on answers
        delay_between_steps: 2000           // 2s between reasoning steps
      },
      
      // Deep analysis for standard issues (30-60s expected)
      deep: {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 6144,
        temperature: 0.25,
        top_p: 0.85,
        top_k: 40,
        reasoning_steps: 3,
        validation_passes: 2,
        reflection_enabled: true,
        delay_between_steps: 1500
      },
      
      // Thorough analysis for simple issues (15-30s expected)
      thorough: {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.2,
        top_p: 0.8,
        top_k: 30,
        reasoning_steps: 2,
        validation_passes: 1,
        reflection_enabled: false,
        delay_between_steps: 1000
      }
    };
  }

  /**
   * Initialize with authentication
   */
  async initialize(apiKey = null) {
    if (this.initialized && this.anthropic) {
      return this.anthropic;
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key is required for deep inference');
    }

    try {
      this.anthropic = new Anthropic({ apiKey: key });
      this.initialized = true;
      console.log('🧠 Claude Deep Inference System initialized successfully');
      return this.anthropic;
    } catch (error) {
      console.error('❌ Failed to initialize Deep Inference System:', error);
      throw new Error(`Deep Inference initialization failed: ${error.message}`);
    }
  }

  /**
   * Auto-select optimal deep reasoning profile based on issue complexity
   */
  selectDeepProfile(issueContext) {
    const title = (issueContext.title || '').toLowerCase();
    const description = (issueContext.description || '').toLowerCase();
    const labels = Array.isArray(issueContext.labels) ? 
      issueContext.labels.map(l => (typeof l === 'string' ? l : l.name || '').toLowerCase()).join(' ') : '';
    
    const fullText = `${title} ${description} ${labels}`;
    const wordCount = fullText.split(/\s+/).length;
    const complexity = this.calculateComplexity(fullText, issueContext);
    
    console.log(`📊 Issue complexity analysis:`, {
      wordCount,
      complexity,
      title: title.substring(0, 50),
      hasLabels: labels.length > 0
    });
    
    // Select profile based on complexity
    if (complexity >= 0.8 || wordCount > 300) {
      return 'ultra_deep';
    } else if (complexity >= 0.5 || wordCount > 100) {
      return 'deep';  
    } else {
      return 'thorough';
    }
  }

  /**
   * Calculate issue complexity score (0-1)
   */
  calculateComplexity(text, context) {
    let complexity = 0.2; // Base complexity
    
    // Technical keywords increase complexity
    const techPatterns = [
      /component|function|class|method|api|database|performance|optimization/g,
      /bug|error|crash|exception|memory|async|concurrent|race.condition/g,
      /refactor|architecture|design.pattern|algorithm|data.structure/g,
      /security|authentication|authorization|encryption|vulnerability/g
    ];
    
    techPatterns.forEach(pattern => {
      const matches = (text.match(pattern) || []).length;
      complexity += matches * 0.1;
    });
    
    // Labels increase complexity
    if (context.labels && context.labels.length > 0) {
      complexity += context.labels.length * 0.05;
    }
    
    // Critical/urgent issues need deeper analysis
    if (text.match(/critical|urgent|blocker|high.priority/)) {
      complexity += 0.2;
    }
    
    // Multiple components/files mentioned
    const fileReferences = (text.match(/\.js|\.ts|\.jsx|\.tsx|\.py|\.css|\.html/g) || []).length;
    complexity += fileReferences * 0.05;
    
    return Math.min(complexity, 1.0); // Cap at 1.0
  }

  /**
   * Create Chain-of-Thought reasoning prompt
   */
  buildChainOfThoughtPrompt(issueContext, workspaceContext, step = 1, totalSteps = 3) {
    const stepInstructions = {
      1: `
🔍 **STEP 1: DEEP UNDERSTANDING & ANALYSIS**

First, let me carefully analyze and understand this issue:

1. **Issue Comprehension**: Break down what exactly is being requested
2. **Context Analysis**: Understand the codebase structure and current state  
3. **Problem Identification**: Identify root causes and underlying issues
4. **Scope Assessment**: Determine the full scope of changes needed

Take your time to thoroughly examine each aspect. Think step-by-step and explain your reasoning process.`,
      
      2: `
💡 **STEP 2: SOLUTION DESIGN & PLANNING**

Now, let me design a comprehensive solution:

1. **Approach Selection**: Choose the best technical approach and explain why
2. **Implementation Strategy**: Plan the step-by-step implementation process
3. **Risk Assessment**: Identify potential issues and mitigation strategies
4. **Alternative Considerations**: Consider alternative approaches and trade-offs

Focus on creating a robust, maintainable solution. Explain your decision-making process in detail.`,
      
      3: `
⚡ **STEP 3: IMPLEMENTATION & VALIDATION**

Finally, let me implement and validate the solution:

1. **Code Generation**: Create high-quality, production-ready code
2. **Integration Testing**: Ensure the solution integrates properly
3. **Edge Case Handling**: Address potential edge cases and errors
4. **Quality Assurance**: Review code quality, performance, and maintainability

Provide complete, tested code with detailed explanations of how it solves the problem.`
    };

    return `# 🧠 DEEP REASONING ANALYSIS - Step ${step}/${totalSteps}

${stepInstructions[step]}

## Issue Context:
**Title**: ${issueContext.title || 'No title provided'}
**Description**: ${issueContext.description || 'No description provided'}
**Labels**: ${issueContext.labels ? issueContext.labels.map(l => typeof l === 'string' ? l : l.name || '').join(', ') : 'None'}

## Workspace Context:
${workspaceContext || 'No workspace context provided'}

---

**IMPORTANT**: This is step ${step} of a ${totalSteps}-step deep reasoning process. Focus ONLY on the current step's objectives. Be thorough, analytical, and explain your reasoning process in detail. Take your time to think through each aspect carefully.

Your response for this step:`;
  }

  /**
   * Create reflection prompt for self-validation
   */
  buildReflectionPrompt(previousAnalysis, issueContext) {
    return `# 🔄 REFLECTION & VALIDATION

Please review and reflect on your previous analysis:

## Your Previous Analysis:
${previousAnalysis}

## Original Issue:
**Title**: ${issueContext.title || 'No title'}
**Description**: ${issueContext.description || 'No description'}

## Reflection Questions:
1. **Completeness**: Have I addressed all aspects of the issue?
2. **Accuracy**: Is my technical solution correct and appropriate?
3. **Quality**: Is the code production-ready and follows best practices?
4. **Clarity**: Are my explanations clear and comprehensive?
5. **Edge Cases**: Have I considered potential problems and edge cases?

**Task**: Provide a critical evaluation of your previous analysis. Identify any gaps, improvements, or corrections needed. If the analysis is solid, confirm its quality. If improvements are needed, provide the enhanced version.

Your reflection:`;
  }

  /**
   * Add artificial reasoning delay to simulate deeper thinking
   */
  async reasoningDelay(milliseconds) {
    console.log(`🤔 Deep reasoning pause (${milliseconds}ms)...`);
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  /**
   * Perform multi-step deep reasoning analysis
   */
  async performDeepAnalysis(issueContext, workspaceContext, profile = 'deep') {
    if (!this.initialized) {
      await this.initialize();
    }

    const config = this.deepProfiles[profile];
    if (!config) {
      throw new Error(`Unknown deep profile: ${profile}`);
    }

    console.log(`🧠 Starting deep reasoning analysis with profile: ${profile}`);
    console.log(`⏱️  Expected completion time: ${this.getExpectedTime(profile)}`);
    
    const startTime = Date.now();
    const results = [];
    let cumulativeAnalysis = '';

    try {
      // Multi-step reasoning process
      for (let step = 1; step <= config.reasoning_steps; step++) {
        console.log(`🔄 Deep Reasoning Step ${step}/${config.reasoning_steps}`);
        
        // Add reasoning delay
        await this.reasoningDelay(config.delay_between_steps);
        
        const stepPrompt = this.buildChainOfThoughtPrompt(
          issueContext, 
          `${workspaceContext}\n\nPrevious Analysis:\n${cumulativeAnalysis}`, 
          step, 
          config.reasoning_steps
        );
        
        const stepResult = await this.executeReasoningStep(stepPrompt, config, step);
        results.push(stepResult);
        cumulativeAnalysis += `\n\n--- Step ${step} Results ---\n${stepResult.content}`;
        
        console.log(`✅ Step ${step} completed (${stepResult.duration}ms, ${stepResult.tokens} tokens)`);
      }
      
      // Validation passes
      let finalAnalysis = cumulativeAnalysis;
      for (let pass = 1; pass <= config.validation_passes; pass++) {
        console.log(`🔍 Validation Pass ${pass}/${config.validation_passes}`);
        
        await this.reasoningDelay(config.delay_between_steps);
        
        const validationResult = await this.executeValidation(finalAnalysis, issueContext, config, pass);
        finalAnalysis = validationResult.content;
        results.push(validationResult);
        
        console.log(`✅ Validation ${pass} completed (${validationResult.duration}ms)`);
      }
      
      // Self-reflection (if enabled)
      if (config.reflection_enabled) {
        console.log('🪞 Performing self-reflection...');
        
        await this.reasoningDelay(config.delay_between_steps);
        
        const reflectionPrompt = this.buildReflectionPrompt(finalAnalysis, issueContext);
        const reflectionResult = await this.executeReasoningStep(reflectionPrompt, config, 'reflection');
        results.push(reflectionResult);
        finalAnalysis = reflectionResult.content;
        
        console.log(`✅ Self-reflection completed (${reflectionResult.duration}ms)`);
      }
      
      const totalDuration = Date.now() - startTime;
      const totalTokens = results.reduce((sum, r) => sum + (r.tokens || 0), 0);
      
      console.log(`🎉 Deep reasoning analysis completed!`, {
        profile,
        totalDuration: `${totalDuration}ms`,
        steps: config.reasoning_steps,
        validations: config.validation_passes,
        reflection: config.reflection_enabled,
        totalTokens,
        avgStepTime: `${Math.round(totalDuration / results.length)}ms`
      });
      
      return {
        success: true,
        analysis: finalAnalysis,
        metadata: {
          profile,
          config,
          steps: results,
          totalDuration,
          totalTokens,
          reasoning_quality: 'deep',
          complexity_handled: this.calculateComplexity(
            `${issueContext.title} ${issueContext.description}`, 
            issueContext
          )
        }
      };
      
    } catch (error) {
      console.error(`❌ Deep reasoning analysis failed:`, error);
      throw new Error(`Deep reasoning failed: ${error.message}`);
    }
  }

  /**
   * Execute a single reasoning step
   */
  async executeReasoningStep(prompt, config, stepId) {
    const startTime = Date.now();
    
    try {
      const response = await this.anthropic.messages.create({
        model: config.model,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
        top_p: config.top_p,
        top_k: config.top_k,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const duration = Date.now() - startTime;
      const content = response.content[0]?.text || '';
      const tokens = response.usage?.output_tokens || 0;
      
      return {
        stepId,
        content,
        duration,
        tokens,
        success: true
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Reasoning step ${stepId} failed after ${duration}ms:`, error);
      throw error;
    }
  }

  /**
   * Execute validation pass
   */
  async executeValidation(analysis, issueContext, config, passNumber) {
    const validationPrompt = `# 🔍 VALIDATION PASS ${passNumber}

Please review and improve the following analysis:

## Analysis to Validate:
${analysis}

## Original Issue:
**Title**: ${issueContext.title}
**Description**: ${issueContext.description}

## Validation Tasks:
1. Check technical accuracy and completeness
2. Verify that all issue requirements are addressed
3. Ensure code quality and best practices
4. Validate edge case handling
5. Confirm clear explanations

**Instructions**: If the analysis is solid, confirm it. If improvements are needed, provide the enhanced version with specific improvements noted.

Validation result:`;

    return await this.executeReasoningStep(validationPrompt, config, `validation-${passNumber}`);
  }

  /**
   * Get expected completion time for profile
   */
  getExpectedTime(profile) {
    const timeRanges = {
      'ultra_deep': '60-120 seconds',
      'deep': '30-60 seconds', 
      'thorough': '15-30 seconds'
    };
    return timeRanges[profile] || '30-60 seconds';
  }

  /**
   * Create optimized deep reasoning prompt
   */
  createDeepPrompt(issueContext, workspaceContext, customInstructions = '') {
    return `# 🧠 DEEP REASONING ANALYSIS SYSTEM

You are an expert software engineer with deep analytical capabilities. Your task is to perform thorough, methodical analysis with extended reasoning time.

## REASONING METHODOLOGY:
1. **Deep Understanding**: Carefully analyze the issue and context
2. **Systematic Thinking**: Break down complex problems into manageable parts
3. **Multiple Perspectives**: Consider various approaches and their trade-offs
4. **Quality Focus**: Prioritize accuracy and completeness over speed
5. **Thorough Validation**: Double-check your reasoning and solutions

## ISSUE CONTEXT:
**Title**: ${issueContext.title || 'No title provided'}
**Description**: ${issueContext.description || 'No description provided'}  
**Labels**: ${issueContext.labels ? issueContext.labels.map(l => typeof l === 'string' ? l : l.name || '').join(', ') : 'None'}

## WORKSPACE CONTEXT:
${workspaceContext || 'No workspace context provided'}

## CUSTOM INSTRUCTIONS:
${customInstructions}

---

**IMPORTANT**: Take your time to think through this thoroughly. Explain your reasoning process step-by-step. Focus on creating high-quality, production-ready solutions with comprehensive explanations.

Begin your deep analysis:`;
  }
}

export default ClaudeDeepInference;
