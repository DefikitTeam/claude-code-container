import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LightweightClaudeAcpAgent } from '../src/acp-agent.js';
import { AgentSideConnection } from '@zed-industries/agent-client-protocol';
import { Pushable } from '../src/utils.js';

// Mock dependencies
vi.mock('@zed-industries/agent-client-protocol', () => ({
  AgentSideConnection: vi.fn(),
  RequestError: { authRequired: vi.fn(() => new Error('Auth Required')) },
}));

vi.mock('../src/utils.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        // we keep Pushable real to test stream contents
    };
});

describe('SDK State Hydration', () => {
  let agent: LightweightClaudeAcpAgent;
  let mockClient: any;

  beforeEach(() => {
    mockClient = { sessionUpdate: vi.fn() };
    agent = new LightweightClaudeAcpAgent(mockClient);
    vi.clearAllMocks();
  });

  const createMockHistory = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `Message ${i}` }],
    }));
  };

  it('initializes session with pending history', async () => {
    const history = createMockHistory(5);
    const sessionRes = await agent.newSession({
      cwd: '/tmp',
      agentId: 'test-agent',
      opts: { history },
    } as any);

    const session = agent.sessions[sessionRes.sessionId];
    expect(session.pendingHistory).toEqual(history);
    expect(session.historyReplayed).toBe(false);
  });

  it('rehydrates history on first prompt', async () => {
    const history = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
    ];

    const sessionRes = await agent.newSession({
      cwd: '/tmp',
      agentId: 'test-agent',
      opts: { history },
    } as any);

    const sessionId = sessionRes.sessionId;
    const session = agent.sessions[sessionId];

    // Spy on input push
    const inputSpy = vi.spyOn(session.input, 'push');
    
    // Mock query.next to return a result so prompt() exits cleanly
    session.query = {
        next: vi.fn()
            .mockResolvedValueOnce({ 
                done: false, 
                value: { type: 'result', subtype: 'success', result: 'done' } 
            })
            .mockResolvedValue({ done: true, value: undefined }),
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
    } as any;

    await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'New prompt' }],
    } as any);

    expect(session.historyReplayed).toBe(true);
    
    // Verify pushed messages: 
    // 1. User 'Hello'
    // 2. Assistant 'Hi there'
    // 3. New User 'New prompt'
    expect(inputSpy).toHaveBeenCalledTimes(3);
    
    const calls = inputSpy.mock.calls;
    expect(calls[0][0].message.content[0].text).toBe('Hello');
    expect(calls[1][0].message.content[0].text).toBe('Hi there');
    expect(calls[2][0].message.content[0].text).toBe('New prompt');
  });

  it('sanitizes tool use from history', async () => {
    const history = [
      { 
          role: 'assistant', 
          content: [
              { type: 'text', text: 'Thinking about tools...' },
              { type: 'tool_use', name: 'writeFile', input: {} } // Should be stripped
          ] 
      },
    ];

    const sessionRes = await agent.newSession({
      cwd: '/tmp',
      agentId: 'test-agent',
      opts: { history },
    } as any);

    const sessionId = sessionRes.sessionId;
    const session = agent.sessions[sessionId];
    const inputSpy = vi.spyOn(session.input, 'push');

    session.query = {
        next: vi.fn()
            .mockResolvedValueOnce({ 
                done: false, 
                value: { type: 'result', subtype: 'success', result: 'done' } 
            })
            .mockResolvedValue({ done: true, value: undefined }),
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
    } as any;

    await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'next' }],
    } as any);

    // Should have 2 calls: 1 sanitized assistant msg, 1 new user msg
    expect(inputSpy).toHaveBeenCalledTimes(2);

    const assistantMsg = inputSpy.mock.calls[0][0];
    expect(assistantMsg.type).toBe('assistant');
    // Content should only have the text part
    expect(assistantMsg.message.content).toHaveLength(1);
    expect(assistantMsg.message.content[0].type).toBe('text');
    expect(assistantMsg.message.content[0].text).toBe('Thinking about tools...');
  });

  it('applies tail-only strategy for long history', async () => {
    // Create 40 messages
    const history = createMockHistory(40);

    const sessionRes = await agent.newSession({
        cwd: '/tmp',
        agentId: 'test-agent',
        opts: { history },
      } as any);
  
      const sessionId = sessionRes.sessionId;
      const session = agent.sessions[sessionId];
      const inputSpy = vi.spyOn(session.input, 'push');
  
      session.query = {
          next: vi.fn()
            .mockResolvedValueOnce({ 
                done: false, 
                value: { type: 'result', subtype: 'success', result: 'done' } 
            })
            .mockResolvedValue({ done: true, value: undefined }),
          interrupt: vi.fn(),
          setPermissionMode: vi.fn(),
      } as any;
  
      await agent.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'next' }],
      } as any);

      // Expect 30 replayed messages + 1 new prompt = 31
      expect(inputSpy).toHaveBeenCalledTimes(31);
      
      // Verify the first replayed message is actually the 11th message (index 10) from original history (0-39)
      // Since we take last 30, it starts from index 10.
      // Message 10 text should be "Message 10"
      expect(inputSpy.mock.calls[0][0].message.content[0].text).toBe('Message 10');
  });

  it('skips rehydration on subsequent prompts', async () => {
    const history = createMockHistory(2);
    const sessionRes = await agent.newSession({
        cwd: '/tmp',
        agentId: 'test-agent',
        opts: { history },
      } as any);
    
    const sessionId = sessionRes.sessionId;
    const session = agent.sessions[sessionId];
    
    session.query = {
        next: vi.fn()
            // First prompt interactions
            .mockResolvedValueOnce({ 
                done: false, 
                value: { type: 'result', subtype: 'success', result: 'done' } 
            })
            // Second prompt interactions
            .mockResolvedValueOnce({ 
                done: false, 
                value: { type: 'result', subtype: 'success', result: 'done' } 
            }),
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
    } as any;

    // First prompt -> Rehydrate
    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: '1' }] } as any);
    expect(session.historyReplayed).toBe(true);

    const inputSpy = vi.spyOn(session.input, 'push');
    inputSpy.mockClear();

    // Second prompt -> No rehydration
    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: '2' }] } as any);
    
    // Should ONLY push the new prompt (1 call)
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(inputSpy.mock.calls[0][0].message.content[0].text).toBe('2');
  });
});
