import Anthropic from '@anthropic-ai/sdk';

console.log('SemanticAnalyzer module loaded successfully');

/**
 * Semantic analyzer for GitHub issue intent detection using Claude API
 * Replaces keyword-based pattern matching with AI-powered understanding
 */
export class SemanticAnalyzer {
  constructor() {
    this.anthropic = null;
    this.initialized = false;
  }

  /**
   * Initialize Claude API client
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('ANTHROPIC_API_KEY not set - semantic analysis will be disabled');
      return false;
    }

    try {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      });
      this.initialized = true;
      console.log('SemanticAnalyzer initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize SemanticAnalyzer:', error);
      return false;
    }
  }

  /**
   * Analyze issue intent using Claude API
   */
  async analyzeIntent(issueTitle, issueBody, repositoryContext = {}) {
    try {
      await this.initialize();
      
      if (!this.initialized) {
        return this.getFallbackIntent(issueTitle, issueBody);
      }

      const prompt = this.buildIntentAnalysisPrompt(issueTitle, issueBody, repositoryContext);
      
      console.log('Analyzing issue intent with Claude API...');
      
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const analysis = this.parseIntentResponse(response.content[0].text);
      
      console.log('Intent analysis completed:', {
        primaryIntent: analysis.primaryIntent,
        confidence: analysis.confidence,
        targetFiles: analysis.targetFiles?.length || 0
      });

      return analysis;
    } catch (error) {
      console.error('Intent analysis failed:', error);
      return this.getFallbackIntent(issueTitle, issueBody);
    }
  }

  /**
   * Build intent analysis prompt for Claude API
   */
  buildIntentAnalysisPrompt(title, body, repositoryContext) {
    return `Analyze this GitHub issue and determine the developer's intent. Provide a structured analysis in JSON format.

## Issue Details
**Title:** ${title}
**Description:** ${body || 'No description provided'}

## Repository Context
**Language:** ${repositoryContext.language || 'Unknown'}
**Type:** ${repositoryContext.type || 'Unknown'}
**Has README:** ${repositoryContext.hasReadme ? 'Yes' : 'No'}

## Analysis Instructions
Determine the intent category, confidence level, target files, and specific actions needed.

## Required JSON Response Format
{
  "primaryIntent": "fix_typo|delete_content|make_concise|add_feature|fix_bug|improve_code|add_documentation|refactor|other",
  "confidence": 0.95,
  "description": "Brief description of what the user wants to accomplish",
  "targetFiles": ["README.md", "src/main.js"],
  "specificActions": [
    {
      "action": "delete",
      "target": "second half of README.md",
      "method": "split_and_remove"
    }
  ],
  "complexity": "simple|moderate|complex",
  "estimatedFiles": 2,
  "requiresAnalysis": false,
  "fallbackToKeywords": false
}

## Intent Categories
- **fix_typo**: Correct spelling, grammar, or punctuation errors
- **delete_content**: Remove specific content, sections, or files
- **make_concise**: Reduce verbosity, simplify, or condense content
- **add_feature**: Implement new functionality or features
- **fix_bug**: Resolve identified bugs or issues
- **improve_code**: Enhance code quality, performance, or structure
- **add_documentation**: Create or improve documentation
- **refactor**: Restructure code without changing functionality
- **other**: Intent doesn't fit standard categories

## Action Types
- **delete**: Remove content (specify target and method)
- **edit**: Modify existing content (specify changes)
- **add**: Insert new content (specify location and content)
- **replace**: Replace content with new version
- **reformat**: Change formatting or structure
- **fix**: Correct specific issues

Respond with only the JSON object, no additional text.`;
  }

  /**
   * Build context summary for prompt
   */
  buildContextSummary(repositoryContext) {
    const summary = [];
    
    summary.push(`**Language:** ${repositoryContext.language || 'Unknown'}`);
    summary.push(`**Framework:** ${repositoryContext.framework || 'Unknown'}`);
    summary.push(`**Project Type:** ${repositoryContext.type || 'Unknown'}`);
    summary.push(`**Project Size:** ${repositoryContext.size || 'Unknown'} (${repositoryContext.files?.length || 0} files)`);
    summary.push(`**Complexity:** ${repositoryContext.complexity || 'Unknown'}`);
    summary.push(`**Has README:** ${repositoryContext.hasReadme ? 'Yes' : 'No'}`);
    
    if (repositoryContext.readmeContent) {
      const readmeSnippet = repositoryContext.readmeContent.substring(0, 300);
      summary.push(`**README Preview:** ${readmeSnippet}...`);
    }
    
    return summary.join('\n');
  }

  /**
   * Summarize project dependencies
   */
  summarizeDependencies(dependencies) {
    if (!dependencies || Object.keys(dependencies).length === 0) {
      return 'No dependencies detected';
    }
    
    const keyDeps = Object.keys(dependencies).slice(0, 10); // Top 10 dependencies
    const summary = [`**Key Dependencies:** ${keyDeps.join(', ')}`];
    
    // Categorize dependencies
    const categories = {
      ui: ['react', 'vue', 'angular', '@angular/core', 'svelte'],
      styling: ['tailwindcss', 'styled-components', 'emotion', 'sass'],
      backend: ['express', 'fastify', 'koa', 'nest', 'next'],
      database: ['prisma', 'mongoose', 'sequelize', 'typeorm'],
      testing: ['jest', 'vitest', 'cypress', 'playwright'],
      build: ['webpack', 'vite', 'parcel', 'rollup', 'esbuild']
    };
    
    for (const [category, deps] of Object.entries(categories)) {
      const found = deps.filter(dep => dependencies[dep]);
      if (found.length > 0) {
        summary.push(`**${category.toUpperCase()}:** ${found.join(', ')}`);
      }
    }
    
    return summary.join('\n');
  }

  /**
   * Parse Claude API response into structured intent data
   */
  parseIntentResponse(responseText) {
    try {
      // Extract JSON from response (handle potential markdown formatting)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);
      
      // Validate required fields
      const required = ['primaryIntent', 'confidence', 'description'];
      for (const field of required) {
        if (!(field in analysis)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Ensure confidence is between 0 and 1
      analysis.confidence = Math.max(0, Math.min(1, analysis.confidence));

      // Default values for optional fields
      analysis.targetFiles = analysis.targetFiles || [];
      analysis.specificActions = analysis.specificActions || [];
      analysis.complexity = analysis.complexity || 'moderate';
      analysis.estimatedFiles = analysis.estimatedFiles || 1;
      analysis.requiresAnalysis = analysis.requiresAnalysis !== false;
      analysis.fallbackToKeywords = analysis.fallbackToKeywords === true;

      return analysis;
    } catch (error) {
      console.error('Failed to parse intent response:', error);
      console.error('Response text:', responseText);
      
      // Return basic analysis with low confidence
      return {
        primaryIntent: 'other',
        confidence: 0.3,
        description: 'Unable to parse intent analysis',
        targetFiles: [],
        specificActions: [],
        complexity: 'moderate',
        estimatedFiles: 1,
        requiresAnalysis: true,
        fallbackToKeywords: true
      };
    }
  }

  /**
   * Fallback intent detection using basic keyword analysis
   */
  getFallbackIntent(title, body) {
    const text = `${title} ${body || ''}`.toLowerCase();
    
    console.log('Using fallback intent detection');

    // Basic keyword-based detection with confidence scoring
    const patterns = [
      {
        intent: 'delete_content',
        keywords: ['delete', 'remove', 'half', 'second half'],
        confidence: 0.7,
        requiredKeywords: 2
      },
      {
        intent: 'make_concise',
        keywords: ['concise', 'shorter', 'brief', 'reduce', 'simplify'],
        confidence: 0.8,
        requiredKeywords: 1
      },
      {
        intent: 'fix_typo',
        keywords: ['typo', 'spelling', 'grammar', 'dot', 'period', 'punctuation'],
        confidence: 0.9,
        requiredKeywords: 1
      },
      {
        intent: 'add_feature',
        keywords: ['add', 'implement', 'create', 'new feature'],
        confidence: 0.6,
        requiredKeywords: 1
      },
      {
        intent: 'fix_bug',
        keywords: ['bug', 'error', 'fix', 'broken', 'issue'],
        confidence: 0.7,
        requiredKeywords: 1
      }
    ];

    for (const pattern of patterns) {
      const matches = pattern.keywords.filter(keyword => text.includes(keyword));
      if (matches.length >= pattern.requiredKeywords) {
        return {
          primaryIntent: pattern.intent,
          confidence: pattern.confidence * (matches.length / pattern.keywords.length),
          description: `Detected ${pattern.intent} based on keywords: ${matches.join(', ')}`,
          targetFiles: text.includes('readme') ? ['README.md'] : [],
          specificActions: [],
          complexity: 'simple',
          estimatedFiles: 1,
          requiresAnalysis: true,
          fallbackToKeywords: true
        };
      }
    }

    // Default fallback
    return {
      primaryIntent: 'other',
      confidence: 0.4,
      description: 'Could not determine specific intent',
      targetFiles: [],
      specificActions: [],
      complexity: 'moderate',
      estimatedFiles: 1,
      requiresAnalysis: true,
      fallbackToKeywords: true
    };
  }

  /**
   * Get repository context for better intent analysis
   */
  async getRepositoryContext(workspaceDir) {
    try {
      const { promises: fs } = await import('node:fs');
      const path = await import('node:path');
      
      const context = {
        hasReadme: false,
        language: 'unknown',
        type: 'unknown',
        files: []
      };

      // Check for README
      try {
        await fs.access(path.join(workspaceDir, 'README.md'));
        context.hasReadme = true;
      } catch {
        // README doesn't exist
      }

      // Detect primary language/framework
      try {
        const packageJsonPath = path.join(workspaceDir, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        context.language = 'javascript';
        context.type = packageJson.dependencies?.react ? 'react' : 
                     packageJson.dependencies?.vue ? 'vue' :
                     packageJson.dependencies?.express ? 'express' : 'node';
      } catch {
        // Not a Node.js project, check other indicators
      }

      // Get file list for context
      try {
        const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
        context.files = entries
          .filter(entry => entry.isFile())
          .map(entry => entry.name)
          .slice(0, 10); // Limit for performance
      } catch {
        // Can't read directory
      }

      return context;
    } catch (error) {
      console.error('Failed to get repository context:', error);
      return { hasReadme: false, language: 'unknown', type: 'unknown', files: [] };
    }
  }
}