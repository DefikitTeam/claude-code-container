import { describe, it, expect } from 'vitest';
import {
  buildPromptFromContent,
  EXECUTOR_SYSTEM_PROMPT,
} from '../src/core/prompts/prompt-utils.js';
import { ContentBlock } from '../src/types/acp-messages.js';

describe('Executor Agent Prompt', () => {
  const mockContent: ContentBlock[] = [
    { type: 'text', text: 'Please optimize the database query.' },
  ];

  it('should include EXECUTOR_SYSTEM_PROMPT when agentRole is "executor"', () => {
    const agentContext = {
      agentRole: 'executor',
      userRequest: 'Optimize query',
      subTask: 'Refactor finding users',
    };

    const prompt = buildPromptFromContent(mockContent, [], agentContext);

    expect(prompt).toContain(EXECUTOR_SYSTEM_PROMPT);
    expect(prompt).toContain('Assigned Sub-Task: Refactor finding users');
  });

  it('should NOT include EXECUTOR_SYSTEM_PROMPT when agentRole is undefined', () => {
    const agentContext = {
      userRequest: 'Optimize query',
    };

    const prompt = buildPromptFromContent(mockContent, [], agentContext);

    expect(prompt).not.toContain(EXECUTOR_SYSTEM_PROMPT);
    expect(prompt).not.toContain('Assigned Sub-Task');
  });

  it('should NOT include EXECUTOR_SYSTEM_PROMPT when agentRole is "planner"', () => {
    const agentContext = {
      agentRole: 'planner',
      userRequest: 'Optimize query',
    };

    const prompt = buildPromptFromContent(mockContent, [], agentContext);

    expect(prompt).not.toContain(EXECUTOR_SYSTEM_PROMPT);
  });
});
