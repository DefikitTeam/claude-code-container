/**
 * Simplified tools for lightweight ACP client
 * Based on Zed's tools.ts but without heavy dependencies
 */

export interface ToolInfo {
  name: string;
  description: string;
  input?: unknown;
}

export interface ToolUpdate {
  status: 'completed' | 'failed' | 'pending';
  output?: string;
  error?: string;
}

/**
 * Extract tool information from tool use
 */
export interface ToolUse {
  name: string;
  input: unknown;
}

export interface ToolResult {
  is_error?: boolean;
  content?: string;
}

/**
 * Extract tool information from tool use
 */
export function toolInfoFromToolUse(
  toolUse: ToolUse,
  fileContentCache: Record<string, string>,
): ToolInfo {
  return {
    name: toolUse.name || 'unknown',
    description: `Tool: ${toolUse.name}`,
    input: toolUse.input,
  };
}

/**
 * Generate tool update from tool result
 */
export function toolUpdateFromToolResult(
  toolResult: ToolResult,
  toolUse: ToolUse,
): ToolUpdate {
  return {
    status: toolResult.is_error ? 'failed' : 'completed',
    output: toolResult.content || '',
    error: toolResult.is_error ? toolResult.content : undefined,
  };
}

/**
 * Generate plan entries from todo input
 */
export function planEntries(input: unknown): {
  id: number;
  text: string;
  completed: boolean;
}[] {
  const typedInput = input as {
    todos?: Array<{
      text?: string;
      description?: string;
      completed?: boolean;
    }>;
  };
  if (!typedInput || !Array.isArray(typedInput.todos)) {
    return [];
  }

  return typedInput.todos.map((todo, index) => ({
    id: index,
    text: todo.text || todo.description || 'Todo item',
    completed: todo.completed || false,
  }));
}
