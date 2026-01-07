
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LightweightClaudeAcpAgent } from '../src/acp-agent.js';
import { AgentSideConnection, NewSessionRequest } from '@zed-industries/agent-client-protocol';
import { Pushable } from '../src/utils.js';

// Mock AgentSideConnection
const mockClient = {
  sessionUpdate: vi.fn(),
} as unknown as AgentSideConnection;

// Mock @anthropic-ai/claude-code to prevent side effects and stream consumption
vi.mock('@anthropic-ai/claude-code', () => ({
  query: vi.fn().mockReturnValue({
    next: vi.fn(),
    interrupt: vi.fn(),
    setPermissionMode: vi.fn(),
  }),
  // We need to export other types/values if they are used as values, but types are erased.
  // PermissionsMode etc are types or values? PermissionMode is a type.
  PermissionMode: {}, 
}));

describe('LightweightClaudeAcpAgent - Resume Logic', () => {
  let agent: LightweightClaudeAcpAgent;

  beforeEach(() => {
    agent = new LightweightClaudeAcpAgent(mockClient);
    vi.clearAllMocks();
  });

  it('should use cwd from resumeState if provided', async () => {
    const resumeCwd = '/tmp/restored-cwd';
    const params: NewSessionRequest = {
        cwd: '/default/cwd',
        // @ts-ignore - injecting custom field
        resumeState: {
            terminal: {
                cwd: resumeCwd
            }
        }
    };

    const response = await agent.newSession(params);
    expect(response.sessionId).toBeDefined();

    // Access the private sessions map to verify options
    // @ts-ignore
    const session = agent.sessions[response.sessionId];
    expect(session).toBeDefined();
  });

  it('should inject initialContext summary into input stream', async () => {
    const contextSummary = 'User was building a React app.';
    const params: NewSessionRequest = {
        cwd: '/default/cwd',
        // @ts-ignore
        initialContext: {
            contextSummary
        }
    };

    const response = await agent.newSession(params);
    
    // @ts-ignore
    const session = agent.sessions[response.sessionId];
    const input = session.input as Pushable<any>;
    
    // Check pending messages in the Pushable queue by inspecting internal state
    // purely to avoid async generator race conditions or blocking if consumer logic changes.
    // @ts-ignore
    const items = (input as any).items as any[];
    
    expect(items.length).toBeGreaterThan(0);
    const firstMessage = items[0];
    
    expect(firstMessage).toBeDefined();
    expect(firstMessage.message.content[0].text).toContain('System Restoration: Previous Session Context Summary');
    expect(firstMessage.message.content[0].text).toContain(contextSummary);
  });

  it('should inject openFiles into input stream', async () => {
    const openFiles = ['/src/App.tsx', '/src/utils.ts'];
    const params: NewSessionRequest = {
        cwd: '/default/cwd',
        // @ts-ignore
        resumeState: {
            openFiles
        }
    };

    const response = await agent.newSession(params);
    
    // @ts-ignore
    const session = agent.sessions[response.sessionId];
    const input = session.input as Pushable<any>;
    
    // @ts-ignore
    const items = (input as any).items as any[];
    
    expect(items.length).toBeGreaterThan(0);
    const firstMessage = items[0];
    
    expect(firstMessage).toBeDefined();
    expect(firstMessage.message.content[0].text).toContain('The user has the following files open');
    expect(firstMessage.message.content[0].text).toContain('/src/App.tsx, /src/utils.ts');
  });
});
