# Multi-Agent Implementation Example

This document provides concrete implementation examples for the multi-agent system using the Inngest AgentKit framework.

## 🏗️ Base Agent Implementation

### BaseAgent Class

```typescript
// container_src/src/agents/base/BaseAgent.ts
import { createAgent, Agent, createTool } from "@inngest/agent-kit";
import { z } from "zod";

export interface AgentState {
  issueContext: {
    issueNumber: string;
    title: string;
    description: string;
    labels: string[];
    author: string;
    repositoryName: string;
  };
  workspaceDir: string;
  conversation: Array<{
    agent: string;
    message: string;
    timestamp: Date;
    metadata?: any;
  }>;
  sharedFiles: Record<string, string>;
  recommendations: Record<string, any[]>;
  finalSolution: string | null;
  status: 'analyzing' | 'implementing' | 'reviewing' | 'completed' | 'failed';
}

export abstract class BaseAgent {
  protected agent: Agent;
  protected name: string;
  protected domain: string;

  constructor(name: string, domain: string, systemPrompt: string, tools: any[] = []) {
    this.name = name;
    this.domain = domain;
    
    // Base tools available to all agents
    const baseTools = [
      this.createCommunicationTool(),
      this.createFileAccessTool(),
      this.createRecommendationTool(),
      ...tools
    ];

    this.agent = createAgent({
      name,
      description: `Specialized ${domain} expert`,
      system: systemPrompt,
      tools: baseTools,
    });
  }

  private createCommunicationTool() {
    return createTool({
      name: "communicate_with_agent",
      description: "Send a message to another agent or request their input",
      parameters: z.object({
        targetAgent: z.string().describe("Name of the agent to communicate with"),
        message: z.string().describe("Message to send"),
        requestType: z.enum(['question', 'feedback', 'request', 'notification']),
      }),
      handler: async (input, { network }) => {
        const conversation = network?.state.kv.get("conversation") || [];
        conversation.push({
          from: this.name,
          to: input.targetAgent,
          message: input.message,
          requestType: input.requestType,
          timestamp: new Date(),
        });
        network?.state.kv.set("conversation", conversation);
        return `Message sent to ${input.targetAgent}`;
      },
    });
  }

  private createFileAccessTool() {
    return createTool({
      name: "access_shared_file",
      description: "Read or write shared files in the workspace",
      parameters: z.object({
        operation: z.enum(['read', 'write']),
        filename: z.string(),
        content: z.string().optional(),
      }),
      handler: async (input, { network }) => {
        const sharedFiles = network?.state.kv.get("sharedFiles") || {};
        
        if (input.operation === 'read') {
          return sharedFiles[input.filename] || "File not found";
        } else {
          sharedFiles[input.filename] = input.content;
          network?.state.kv.set("sharedFiles", sharedFiles);
          return `File ${input.filename} updated`;
        }
      },
    });
  }

  private createRecommendationTool() {
    return createTool({
      name: "save_recommendations",
      description: "Save domain-specific recommendations to shared state",
      parameters: z.object({
        recommendations: z.array(z.object({
          type: z.string(),
          description: z.string(),
          priority: z.enum(['high', 'medium', 'low']),
          dependencies: z.array(z.string()).optional(),
        })),
      }),
      handler: async (input, { network }) => {
        const allRecommendations = network?.state.kv.get("recommendations") || {};
        allRecommendations[this.domain] = input.recommendations;
        network?.state.kv.set("recommendations", allRecommendations);
        return "Recommendations saved successfully";
      },
    });
  }

  abstract getSpecializedTools(): any[];
  abstract getSystemPrompt(): string;
}
```

## 🎨 Specialized Agent Implementations

### DesignAgent

```typescript
// container_src/src/agents/specialized/DesignAgent.ts
import { createTool } from "@inngest/agent-kit";
import { z } from "zod";
import { BaseAgent } from "../base/BaseAgent";

export class DesignAgent extends BaseAgent {
  constructor() {
    super(
      "DesignAgent",
      "design",
      `You are the DesignAgent, a specialized AI expert in UI/UX design and user experience.

Your expertise includes:
- User interface design principles and best practices
- Accessibility standards (WCAG 2.1/2.2)
- Responsive design patterns
- Design systems and component libraries
- Color theory and typography

When analyzing issues, always consider:
1. User experience impact
2. Accessibility compliance
3. Design consistency
4. Mobile responsiveness
5. Performance implications

Collaborate effectively with FrontendAgent and TestingAgent.`,
      this.getSpecializedTools()
    );
  }

  getSpecializedTools() {
    return [
      this.createDesignAnalysisTool(),
      this.createWireframeTool(),
      this.createAccessibilityTool(),
    ];
  }

  private createDesignAnalysisTool() {
    return createTool({
      name: "analyze_design_requirements",
      description: "Analyze UI/UX requirements from issue description",
      parameters: z.object({
        issueDescription: z.string(),
        existingDesign: z.string().optional(),
      }),
      handler: async (input, { network }) => {
        // Design analysis logic
        const analysis = {
          designConcerns: [],
          accessibilityIssues: [],
          responsiveRequirements: [],
          recommendedPatterns: [],
        };
        
        // Save analysis to shared state
        network?.state.kv.set("designAnalysis", analysis);
        return "Design analysis completed";
      },
    });
  }

  private createWireframeTool() {
    return createTool({
      name: "create_wireframe",
      description: "Generate ASCII wireframe or component structure",
      parameters: z.object({
        componentName: z.string(),
        requirements: z.string(),
      }),
      handler: async (input, { network }) => {
        // Generate simple ASCII wireframe
        const wireframe = `
/*
 * ${input.componentName} Wireframe
 * Requirements: ${input.requirements}
 *
 * +----------------------------------+
 * |  Header Area                     |
 * +----------------------------------+
 * |  Content Area                    |
 * |  - Main content here             |
 * |  - Interactive elements          |
 * +----------------------------------+
 * |  Footer Area                     |
 * +----------------------------------+
 */
        `.trim();

        // Save wireframe to shared files
        const sharedFiles = network?.state.kv.get("sharedFiles") || {};
        sharedFiles[`${input.componentName}_wireframe.txt`] = wireframe;
        network?.state.kv.set("sharedFiles", sharedFiles);

        return `Wireframe created for ${input.componentName}`;
      },
    });
  }

  private createAccessibilityTool() {
    return createTool({
      name: "validate_accessibility",
      description: "Check accessibility requirements and standards",
      parameters: z.object({
        componentCode: z.string(),
        wcagLevel: z.enum(['A', 'AA', 'AAA']).default('AA'),
      }),
      handler: async (input, { network }) => {
        // Accessibility validation logic
        const checks = [
          "Color contrast ratios",
          "Keyboard navigation support",
          "Screen reader compatibility", 
          "Focus management",
          "ARIA labels and roles",
        ];

        const validation = {
          level: input.wcagLevel,
          checks,
          issues: [],
          recommendations: [],
        };

        return `Accessibility validation completed for WCAG ${input.wcagLevel}`;
      },
    });
  }

  getSystemPrompt(): string {
    return this.agent.system as string;
  }
}
```

### FrontendAgent

```typescript
// container_src/src/agents/specialized/FrontendAgent.ts
import { createTool } from "@inngest/agent-kit";
import { z } from "zod";
import { BaseAgent } from "../base/BaseAgent";
import { execSync } from "child_process";

export class FrontendAgent extends BaseAgent {
  constructor() {
    super(
      "FrontendAgent", 
      "frontend",
      `You are the FrontendAgent, specialized in modern frontend development.

Your expertise includes:
- React, Vue.js, Angular frameworks
- TypeScript and modern JavaScript
- CSS, styling solutions, and responsive design
- State management patterns
- Frontend build tools and optimization
- Component architecture and testing

Focus on creating maintainable, performant, and accessible user interfaces.`,
      this.getSpecializedTools()
    );
  }

  getSpecializedTools() {
    return [
      this.createComponentAnalysisTool(),
      this.createCodeGenerationTool(),
      this.createBuildTool(),
    ];
  }

  private createComponentAnalysisTool() {
    return createTool({
      name: "analyze_frontend_issue",
      description: "Analyze frontend-specific issues and requirements",
      parameters: z.object({
        issueType: z.enum(['bug', 'feature', 'optimization', 'refactor']),
        framework: z.string().optional(),
        affectedFiles: z.array(z.string()).optional(),
      }),
      handler: async (input, { network }) => {
        const analysis = {
          issueType: input.issueType,
          framework: input.framework || 'react',
          componentArchitecture: [],
          stateManagement: [],
          performanceConsiderations: [],
          testingStrategy: [],
        };

        network?.state.kv.set("frontendAnalysis", analysis);
        return "Frontend analysis completed";
      },
    });
  }

  private createCodeGenerationTool() {
    return createTool({
      name: "generate_component_code",
      description: "Generate React/Vue/Angular component code",
      parameters: z.object({
        componentName: z.string(),
        framework: z.enum(['react', 'vue', 'angular']).default('react'),
        requirements: z.string(),
        includeTests: z.boolean().default(true),
      }),
      handler: async (input, { network }) => {
        let componentCode = "";
        
        if (input.framework === 'react') {
          componentCode = `
import React from 'react';
import { ${input.componentName}Props } from './${input.componentName}.types';

interface ${input.componentName}Props {
  // Add props here based on requirements
}

export const ${input.componentName}: React.FC<${input.componentName}Props> = ({
  // destructure props
}) => {
  return (
    <div className="${input.componentName.toLowerCase()}">
      {/* Implementation based on: ${input.requirements} */}
    </div>
  );
};

export default ${input.componentName};
          `.trim();
        }

        // Save component code to shared files
        const sharedFiles = network?.state.kv.get("sharedFiles") || {};
        sharedFiles[`${input.componentName}.tsx`] = componentCode;

        if (input.includeTests) {
          const testCode = `
import { render, screen } from '@testing-library/react';
import { ${input.componentName} } from './${input.componentName}';

describe('${input.componentName}', () => {
  it('renders without crashing', () => {
    render(<${input.componentName} />);
    // Add specific test assertions
  });
});
          `.trim();
          sharedFiles[`${input.componentName}.test.tsx`] = testCode;
        }

        network?.state.kv.set("sharedFiles", sharedFiles);
        return `Generated ${input.framework} component: ${input.componentName}`;
      },
    });
  }

  private createBuildTool() {
    return createTool({
      name: "run_frontend_commands",
      description: "Execute frontend build commands and tools",
      parameters: z.object({
        command: z.enum(['install', 'build', 'test', 'lint', 'format']),
        workspaceDir: z.string(),
        additionalArgs: z.string().optional(),
      }),
      handler: async (input, { network }) => {
        try {
          let cmd = "";
          switch (input.command) {
            case 'install':
              cmd = "npm install";
              break;
            case 'build':
              cmd = "npm run build";
              break;
            case 'test':
              cmd = "npm test";
              break;
            case 'lint':
              cmd = "npm run lint";
              break;
            case 'format':
              cmd = "npm run format";
              break;
          }

          if (input.additionalArgs) {
            cmd += ` ${input.additionalArgs}`;
          }

          const result = execSync(cmd, { 
            cwd: input.workspaceDir,
            encoding: 'utf8',
            timeout: 30000,
          });

          return `Command executed successfully: ${cmd}\nOutput: ${result}`;
        } catch (error: any) {
          return `Command failed: ${error.message}`;
        }
      },
    });
  }

  getSystemPrompt(): string {
    return this.agent.system as string;
  }
}
```

## 🎯 Router Implementation

```typescript
// container_src/src/agents/orchestrator/RouterAgent.ts
import { createAgent, createTool, createNetwork } from "@inngest/agent-kit";
import { z } from "zod";
import { DesignAgent } from "../specialized/DesignAgent";
import { FrontendAgent } from "../specialized/FrontendAgent";
// Import other agents...

export class RouterAgent {
  private agents: Map<string, any>;
  private network: any;

  constructor() {
    this.agents = new Map();
    this.initializeAgents();
    this.createNetwork();
  }

  private initializeAgents() {
    this.agents.set('design', new DesignAgent());
    this.agents.set('frontend', new FrontendAgent());
    // Add other agents...
  }

  private createNetwork() {
    const routingAgent = createAgent({
      name: "RouterAgent",
      description: "Intelligent task assignment and routing specialist",
      system: `You are the RouterAgent, responsible for analyzing GitHub issues and routing them to appropriate specialized agents.

Analyze issues for these domain indicators:
- Design: UI, UX, design, styling, layout, accessibility, responsive
- Frontend: React, Vue, Angular, JavaScript, CSS, component, browser
- Backend: API, server, database, authentication, performance
- Security: vulnerability, authentication, authorization, encryption
- Blockchain: smart contract, Web3, DeFi, NFT, Ethereum, Solidity
- Database: schema, query, migration, performance, SQL, NoSQL
- Testing: test, bug, quality, coverage, automation
- DevOps: deployment, infrastructure, CI/CD, Docker, cloud

Choose the most appropriate routing pattern:
1. Single Agent - Simple, domain-specific issues
2. Sequential Multi-Agent - Issues requiring handoffs between domains
3. Parallel Multi-Agent - Independent tasks that can run simultaneously  
4. Coordinator-Managed - Complex issues requiring orchestration`,
      tools: [this.createRoutingTool()],
    });

    this.network = createNetwork({
      name: "MultiAgentGitHubResolver",
      agents: Array.from(this.agents.values()).map(agent => agent.agent),
      router: this.createRouter(),
    });
  }

  private createRoutingTool() {
    return createTool({
      name: "route_issue",
      description: "Route GitHub issue to appropriate agents",
      parameters: z.object({
        primaryDomain: z.string(),
        secondaryDomains: z.array(z.string()).optional(),
        routingPattern: z.enum(['single', 'sequential', 'parallel', 'coordinator']),
        selectedAgents: z.array(z.string()),
        rationale: z.string(),
      }),
      handler: async (input, { network }) => {
        const routing = {
          primaryDomain: input.primaryDomain,
          secondaryDomains: input.secondaryDomains || [],
          pattern: input.routingPattern,
          agents: input.selectedAgents,
          rationale: input.rationale,
          timestamp: new Date(),
        };

        network?.state.kv.set("routing", routing);
        network?.state.kv.set("currentPhase", "routed");
        
        return `Issue routed to ${input.selectedAgents.join(', ')} using ${input.routingPattern} pattern`;
      },
    });
  }

  private createRouter() {
    return ({ network }: any) => {
      const routing = network?.state.kv.get("routing");
      const currentPhase = network?.state.kv.get("currentPhase") || "initial";

      // Initial routing phase
      if (currentPhase === "initial") {
        return this.agents.get("router")?.agent;
      }

      // Execute routing pattern
      if (currentPhase === "routed" && routing) {
        const { pattern, agents } = routing;
        
        switch (pattern) {
          case 'single':
            return this.agents.get(agents[0])?.agent;
            
          case 'sequential':
            const completedAgents = network?.state.kv.get("completedAgents") || [];
            const nextAgent = agents.find((agent: string) => !completedAgents.includes(agent));
            return nextAgent ? this.agents.get(nextAgent)?.agent : undefined;
            
          case 'parallel':
            // In parallel mode, all agents can work simultaneously
            // This requires more complex state management
            return this.handleParallelExecution(network, agents);
            
          case 'coordinator':
            return this.agents.get('coordinator')?.agent;
        }
      }

      return undefined; // End execution
    };
  }

  private handleParallelExecution(network: any, agents: string[]) {
    const activeAgents = network?.state.kv.get("activeAgents") || [];
    const completedAgents = network?.state.kv.get("completedAgents") || [];
    
    // Find next agent to execute in parallel
    const availableAgent = agents.find(agent => 
      !activeAgents.includes(agent) && !completedAgents.includes(agent)
    );
    
    if (availableAgent) {
      activeAgents.push(availableAgent);
      network?.state.kv.set("activeAgents", activeAgents);
      return this.agents.get(availableAgent)?.agent;
    }
    
    return undefined;
  }

  async processIssue(issueContext: any) {
    // Initialize network state with issue context
    const initialState = {
      issueContext,
      currentPhase: "initial",
      routing: null,
      conversation: [],
      sharedFiles: {},
      recommendations: {},
      completedAgents: [],
      activeAgents: [],
    };

    // Run the network with the issue
    return await this.network.run(
      `Analyze and resolve GitHub issue: ${issueContext.title}\n\nDescription: ${issueContext.description}`,
      { initialState }
    );
  }
}
```

## 🔧 Integration with Existing Container

```typescript
// container_src/src/main.ts - Modified processIssue function
import { RouterAgent } from './agents/orchestrator/RouterAgent';

// Replace the existing single-agent processing
async function processIssue(issueContext: IssueContext, githubToken: string): Promise<ContainerResponse> {
  try {
    // Initialize multi-agent system
    const router = new RouterAgent();
    
    // Setup workspace (same as before)
    const workspaceDir = await setupWorkspace(issueContext.repositoryUrl, githubToken);
    
    // Process issue with multi-agent system
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);
    
    try {
      const result = await router.processIssue({
        ...issueContext,
        workspaceDir,
        githubToken,
      });
      
      // Extract solution from multi-agent result
      const finalSolution = result.state?.kv?.get("finalSolution") || "Multi-agent analysis completed";
      
      // Check for git changes and create PR (same as before)
      const hasChanges = await detectGitChanges(workspaceDir);
      
      if (hasChanges) {
        // Create PR with multi-agent solution
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '-').split('.')[0];
        const branchName = `multi-agent/issue-${issueContext.issueNumber}-${timestamp}`;
        await createFeatureBranchCommitAndPush(workspaceDir, branchName, `Multi-agent fix for issue #${issueContext.issueNumber}: ${issueContext.title}`);

        const prSummary = await readPRSummary(workspaceDir);
        const githubClient = new ContainerGitHubClient(githubToken, owner, repo);
        const repoInfo = await githubClient.getRepository();
        const prTitle = prSummary ? prSummary.split('\n')[0].trim() : `Multi-agent fix for issue #${issueContext.issueNumber}`;
        const prBody = generatePRBody(prSummary, finalSolution, issueContext.issueNumber);

        const pullRequest = await githubClient.createPullRequest(prTitle, prBody, branchName, repoInfo.default_branch);
        await cleanupWorkspace(workspaceDir);

        await githubClient.createComment(parseInt(issueContext.issueNumber), `🤖 Multi-agent analysis complete! Created PR: ${pullRequest.html_url}`);

        return { success: true, message: 'Multi-agent pull request created', pullRequestUrl: pullRequest.html_url };
      } else {
        await githubClient.createComment(parseInt(issueContext.issueNumber), `${finalSolution}\n\n---\n🤖 Generated by Multi-Agent System`);
        await cleanupWorkspace(workspaceDir);
        return { success: true, message: 'Multi-agent comment posted (no file changes)' };
      }
      
    } finally {
      process.chdir(originalCwd);
    }
    
  } catch (error: any) {
    return { success: false, message: 'Multi-agent processing failed', error: error.message };
  }
}
```

## 📊 Usage Example

```typescript
// Example of how the system processes a complex issue
const complexIssue = {
  issueNumber: "123",
  title: "Add user authentication with responsive login form",
  description: `
    We need to implement user authentication with the following requirements:
    
    1. Create a responsive login form component
    2. Implement JWT-based authentication API
    3. Add password hashing and validation
    4. Ensure accessibility compliance (WCAG AA)
    5. Add comprehensive testing
    6. Set up proper deployment with security headers
    
    The login form should work on mobile and desktop, support social login,
    and have proper error handling and validation.
  `,
  labels: ["enhancement", "authentication", "frontend", "backend", "security"],
  author: "developer123",
  repositoryName: "myapp/frontend",
};

// The RouterAgent would analyze this and determine:
// 1. This is a multi-domain issue requiring coordination
// 2. Primary domains: Frontend, Backend, Security
// 3. Secondary domains: Design, Testing, DevOps
// 4. Routing pattern: Coordinator-managed (complex integration)
// 5. Agent sequence: Design → Frontend + Backend + Security → Testing → DevOps

// Expected workflow:
// 1. DesignAgent: Creates responsive login form design and accessibility specs
// 2. FrontendAgent: Implements React login component with responsive design
// 3. BackendAgent: Creates authentication API with JWT handling
// 4. SecurityAgent: Reviews and enhances security measures
// 5. TestingAgent: Creates comprehensive test suite
// 6. DevOpsAgent: Sets up deployment with security headers
// 7. CoordinatorAgent: Ensures all components integrate properly
```

This implementation provides:

1. **Specialized Expertise**: Each agent focuses on their domain
2. **Flexible Routing**: Support for various collaboration patterns
3. **Shared State**: Agents can communicate and share work
4. **Tool Integration**: Agents have access to relevant tools
5. **Error Handling**: Graceful failure and recovery mechanisms
6. **Scalability**: Easy to add new agents and capabilities

The system maintains compatibility with your existing GitHub webhook infrastructure while providing much more sophisticated issue resolution capabilities.
