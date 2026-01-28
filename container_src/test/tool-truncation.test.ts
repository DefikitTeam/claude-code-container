
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIOpenRouterToolsAdapter } from '../src/infrastructure/ai/openai-openrouter-tools.adapter';
import { promises as fs } from 'node:fs';
import path from 'path';

// Mock node:fs
vi.mock('node:fs');

describe('Tool Truncation Logic', () => {
  let adapter: OpenAIOpenRouterToolsAdapter;

  beforeEach(() => {
    adapter = new OpenAIOpenRouterToolsAdapter();
    vi.resetAllMocks();
  });

  it('readFile should truncate content exceeding 8000 characters', async () => {
    const workspacePath = path.resolve('/tmp/test-workspace');
    const tools = (adapter as any).prepareTools({
      workspacePath
    });

    const readFileTool = tools.find((t: any) => t.function.name === 'readFile');
    expect(readFileTool).toBeDefined();

    // Mock file content larger than 8000 chars
    const largeContent = 'a'.repeat(9000);
    const mockStat = { size: 9000 };

    // Setup mocks
    vi.spyOn(fs, 'stat').mockResolvedValue(mockStat as any);
    vi.spyOn(fs, 'readFile').mockResolvedValue(largeContent);
    
    const result = await readFileTool.function.function({ path: 'large-file.txt' });

    if (!result.success) {
      throw new Error(`Test failed with tool error: ${result.error}`);
    }

    expect(result.success).toBe(true);

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    // Content should be 8000 + warning message length
    expect(result.content.length).toBeGreaterThan(8000);
    expect(result.content.length).toBeLessThan(9000);
    expect(result.content).toContain('[WARNING: File content truncated');
    // First 8000 chars should be 'a'
    expect(result.content.substring(0, 8000)).toBe('a'.repeat(8000));
  });

  it('readFile should NOT truncate content within limit', async () => {
    const workspacePath = path.resolve('/tmp/test-workspace');
    const tools = (adapter as any).prepareTools({
      workspacePath
    });
    const readFileTool = tools.find((t: any) => t.function.name === 'readFile');

    const smallContent = 'a'.repeat(100);
    const mockStat = { size: 100 };

    vi.spyOn(fs, 'stat').mockResolvedValue(mockStat as any);
    vi.spyOn(fs, 'readFile').mockResolvedValue(smallContent);

    const result = await readFileTool.function.function({ path: 'small-file.txt' });

    if (!result.success) {
      throw new Error(`Test failed with tool error: ${result.error}`);
    }

    expect(result.success).toBe(true);
    expect(result.truncated).toBeUndefined();
    expect(result.content).toBe(smallContent);
  });
});
