import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';

console.log('FileContentAnalyzer module loaded successfully');

/**
 * File content analyzer for automatic issue detection using Claude API
 * Proactively identifies potential issues in code and documentation
 */
export class FileContentAnalyzer {
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
      console.warn('ANTHROPIC_API_KEY not set - file content analysis will be disabled');
      return false;
    }

    try {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      });
      this.initialized = true;
      console.log('FileContentAnalyzer initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize FileContentAnalyzer:', error);
      return false;
    }
  }

  /**
   * Analyze repository files for potential issues
   */
  async analyzeRepository(workspaceDir, options = {}) {
    try {
      await this.initialize();
      
      const {
        maxFiles = 10,
        fileTypes = ['.md', '.txt', '.js', '.ts', '.json'],
        skipPatterns = ['node_modules', '.git', 'dist', 'build']
      } = options;

      console.log('Starting repository content analysis...');
      
      // Get files to analyze
      const files = await this.getAnalyzableFiles(workspaceDir, fileTypes, skipPatterns, maxFiles);
      console.log(`Found ${files.length} files to analyze`);
      
      const issues = [];
      
      for (const filePath of files) {
        try {
          const fileIssues = await this.analyzeFile(filePath, workspaceDir);
          if (fileIssues.length > 0) {
            issues.push({
              file: path.relative(workspaceDir, filePath),
              issues: fileIssues
            });
          }
        } catch (error) {
          console.error(`Failed to analyze ${filePath}:`, error);
        }
      }
      
      // Generate summary report
      const summary = this.generateIssueSummary(issues);
      
      console.log(`Content analysis completed: ${issues.length} files with issues`);
      
      return {
        summary,
        fileIssues: issues,
        totalFiles: files.length,
        filesWithIssues: issues.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Repository analysis failed:', error);
      return this.getFallbackAnalysis(workspaceDir);
    }
  }

  /**
   * Analyze individual file for issues
   */
  async analyzeFile(filePath, workspaceDir) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const fileName = path.basename(filePath);
      const fileExtension = path.extname(filePath);
      
      if (content.length > 10000) {
        console.log(`Skipping ${fileName} - too large (${content.length} chars)`);
        return [];
      }
      
      if (!this.initialized) {
        return this.getFallbackFileAnalysis(content, fileName);
      }
      
      const prompt = this.buildFileAnalysisPrompt(content, fileName, fileExtension);
      
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1500,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const analysis = this.parseFileAnalysisResponse(response.content[0].text);
      
      return analysis.issues || [];
      
    } catch (error) {
      console.error(`File analysis failed for ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Build file analysis prompt for Claude API
   */
  buildFileAnalysisPrompt(content, fileName, fileExtension) {
    return `Analyze this file for potential issues and improvements. Focus on practical problems that could impact usability, maintainability, or correctness.

## File Details
**Name:** ${fileName}
**Type:** ${fileExtension}
**Size:** ${content.length} characters

## File Content
\`\`\`
${content}
\`\`\`

## Analysis Instructions
Identify specific, actionable issues in the following categories:

1. **Typos & Grammar**: Spelling errors, grammatical mistakes, punctuation issues
2. **Structure & Organization**: Poor formatting, missing sections, unclear organization
3. **Content Quality**: Outdated information, missing details, verbose explanations
4. **Code Issues**: Syntax errors, deprecated patterns, security concerns (for code files)
5. **Documentation**: Missing documentation, unclear instructions, broken links

## Required JSON Response Format
{
  "issues": [
    {
      "type": "typo|structure|quality|code|documentation",
      "severity": "low|medium|high",
      "title": "Brief description of the issue",
      "description": "Detailed explanation of the problem",
      "location": {
        "line": 15,
        "column": 20,
        "context": "surrounding text"
      },
      "suggestion": "Specific fix or improvement",
      "automated": true
    }
  ],
  "overallQuality": "excellent|good|fair|poor",
  "confidence": 0.85
}

## Issue Severity Guidelines
- **High**: Critical errors, security issues, broken functionality
- **Medium**: Usability problems, unclear content, minor bugs
- **Low**: Style improvements, optional enhancements, minor typos

## Automation Guidelines
- Set "automated": true for issues that can be automatically fixed
- Set "automated": false for issues requiring human review

Focus on finding real, actionable problems. Don't create issues for subjective style preferences unless they significantly impact readability.

Respond with only the JSON object, no additional text.`;
  }

  /**
   * Parse Claude API response for file analysis
   */
  parseFileAnalysisResponse(responseText) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);
      
      // Validate and normalize issues
      if (analysis.issues) {
        analysis.issues = analysis.issues.map(issue => ({
          type: issue.type || 'quality',
          severity: issue.severity || 'medium',
          title: issue.title || 'Unnamed issue',
          description: issue.description || 'No description provided',
          location: issue.location || {},
          suggestion: issue.suggestion || 'Manual review required',
          automated: issue.automated === true
        }));
      }
      
      analysis.overallQuality = analysis.overallQuality || 'fair';
      analysis.confidence = Math.max(0, Math.min(1, analysis.confidence || 0.5));
      
      return analysis;
      
    } catch (error) {
      console.error('Failed to parse file analysis response:', error);
      console.error('Response text:', responseText);
      
      return {
        issues: [],
        overallQuality: 'unknown',
        confidence: 0.1
      };
    }
  }

  /**
   * Generate summary of all issues found
   */
  generateIssueSummary(fileIssues) {
    const stats = {
      total: 0,
      byType: {},
      bySeverity: {},
      automated: 0,
      files: fileIssues.length
    };
    
    const prioritizedIssues = [];
    
    for (const fileData of fileIssues) {
      for (const issue of fileData.issues) {
        stats.total++;
        stats.byType[issue.type] = (stats.byType[issue.type] || 0) + 1;
        stats.bySeverity[issue.severity] = (stats.bySeverity[issue.severity] || 0) + 1;
        
        if (issue.automated) {
          stats.automated++;
        }
        
        // Add high priority issues to summary
        if (issue.severity === 'high' || issue.automated) {
          prioritizedIssues.push({
            file: fileData.file,
            ...issue
          });
        }
      }
    }
    
    return {
      stats,
      prioritizedIssues: prioritizedIssues.slice(0, 10), // Top 10 priority issues
      recommendations: this.generateRecommendations(stats),
      canAutoFix: stats.automated > 0
    };
  }

  /**
   * Generate recommendations based on issue analysis
   */
  generateRecommendations(stats) {
    const recommendations = [];
    
    if (stats.bySeverity.high > 0) {
      recommendations.push({
        priority: 'high',
        action: 'fix_critical_issues',
        description: `Address ${stats.bySeverity.high} high-severity issues immediately`
      });
    }
    
    if (stats.automated > 0) {
      recommendations.push({
        priority: 'medium',
        action: 'apply_auto_fixes',
        description: `${stats.automated} issues can be automatically fixed`
      });
    }
    
    if (stats.byType.typo > 2) {
      recommendations.push({
        priority: 'low',
        action: 'spell_check',
        description: `Run spell check - found ${stats.byType.typo} potential typos`
      });
    }
    
    if (stats.byType.structure > 1) {
      recommendations.push({
        priority: 'medium',
        action: 'improve_structure',
        description: `Improve file organization - ${stats.byType.structure} structure issues found`
      });
    }
    
    return recommendations;
  }

  /**
   * Get files suitable for analysis
   */
  async getAnalyzableFiles(workspaceDir, fileTypes, skipPatterns, maxFiles) {
    const files = [];
    
    const walk = async (currentDir, depth = 0) => {
      if (depth > 3 || files.length >= maxFiles) return; // Limit depth and total files
      
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (files.length >= maxFiles) break;
          
          // Skip hidden files and specified patterns
          if (entry.name.startsWith('.') || 
              skipPatterns.some(pattern => entry.name.includes(pattern))) {
            continue;
          }
          
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile() && fileTypes.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`Failed to read directory ${currentDir}:`, error);
      }
    };
    
    await walk(workspaceDir);
    return files;
  }

  /**
   * Fallback analysis when Claude API is unavailable
   */
  getFallbackAnalysis(workspaceDir) {
    console.log('Using fallback content analysis');
    
    return {
      summary: {
        stats: { total: 0, automated: 0, files: 0 },
        prioritizedIssues: [],
        recommendations: [{
          priority: 'medium',
          action: 'manual_review',
          description: 'Claude API unavailable - manual review recommended'
        }],
        canAutoFix: false
      },
      fileIssues: [],
      totalFiles: 0,
      filesWithIssues: 0,
      timestamp: new Date().toISOString(),
      fallback: true
    };
  }

  /**
   * Fallback file analysis using simple heuristics
   */
  getFallbackFileAnalysis(content, fileName) {
    const issues = [];
    
    // Simple typo detection
    const commonTypos = ['recieve', 'occurence', 'seperate', 'definately'];
    for (const typo of commonTypos) {
      if (content.toLowerCase().includes(typo)) {
        issues.push({
          type: 'typo',
          severity: 'low',
          title: `Possible typo: ${typo}`,
          description: `Found potential misspelling of "${typo}"`,
          suggestion: 'Check spelling and correct if needed',
          automated: true
        });
      }
    }
    
    // Check for very long lines
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (line.length > 200) {
        issues.push({
          type: 'structure',
          severity: 'low',
          title: 'Very long line detected',
          description: `Line ${index + 1} is ${line.length} characters long`,
          location: { line: index + 1 },
          suggestion: 'Consider breaking long lines for better readability',
          automated: false
        });
      }
    });
    
    return issues;
  }

  /**
   * Apply automatic fixes to files
   */
  async applyAutomaticFixes(workspaceDir, analysisResult) {
    const fixedFiles = [];
    
    try {
      for (const fileData of analysisResult.fileIssues) {
        const filePath = path.join(workspaceDir, fileData.file);
        const automaticIssues = fileData.issues.filter(issue => issue.automated);
        
        if (automaticIssues.length > 0) {
          const success = await this.fixFileIssues(filePath, automaticIssues);
          if (success) {
            fixedFiles.push({
              file: fileData.file,
              issuesFixed: automaticIssues.length
            });
          }
        }
      }
      
      console.log(`Applied automatic fixes to ${fixedFiles.length} files`);
      
      return {
        success: true,
        fixedFiles,
        totalFixes: fixedFiles.reduce((sum, f) => sum + f.issuesFixed, 0)
      };
      
    } catch (error) {
      console.error('Failed to apply automatic fixes:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fix specific issues in a file
   */
  async fixFileIssues(filePath, issues) {
    try {
      let content = await fs.readFile(filePath, 'utf8');
      let modified = false;
      
      for (const issue of issues) {
        if (issue.type === 'typo' && issue.automated) {
          // Apply simple typo fixes
          const fixedContent = this.applyTypoFix(content, issue);
          if (fixedContent !== content) {
            content = fixedContent;
            modified = true;
          }
        }
      }
      
      if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`Applied fixes to ${path.basename(filePath)}`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error(`Failed to fix issues in ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Apply typo fix to content
   */
  applyTypoFix(content, issue) {
    // Simple typo corrections
    const corrections = {
      'recieve': 'receive',
      'occurence': 'occurrence',
      'seperate': 'separate',
      'definately': 'definitely'
    };
    
    let fixedContent = content;
    
    for (const [wrong, right] of Object.entries(corrections)) {
      if (issue.title.includes(wrong)) {
        const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
        fixedContent = fixedContent.replace(regex, (match) => {
          // Preserve case
          if (match === match.toUpperCase()) return right.toUpperCase();
          if (match[0] === match[0].toUpperCase()) return right[0].toUpperCase() + right.slice(1);
          return right;
        });
      }
    }
    
    return fixedContent;
  }
}