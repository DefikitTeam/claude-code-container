/**
 * Simplified tools for lightweight ACP client
 * Based on Zed's tools.ts but without heavy dependencies
 */

export interface ToolInfo {
  name: string;
  description: string;
  input?: any;
}

export interface ToolUpdate {
  status: 'completed' | 'failed' | 'pending';
  output?: string;
  error?: string;
}

/**
 * Extract tool information from tool use
 */
export function toolInfoFromToolUse(toolUse: any, fileContentCache: Record<string, string>): ToolInfo {
  return {
    name: toolUse.name || 'unknown',
    description: `Tool: ${toolUse.name}`,
    input: toolUse.input
  };
}

/**
 * Generate tool update from tool result
 */
export function toolUpdateFromToolResult(toolResult: any, toolUse: any): ToolUpdate {
  return {
    status: toolResult.is_error ? 'failed' : 'completed',
    output: toolResult.content || '',
    error: toolResult.is_error ? toolResult.content : undefined
  };
}

/**
 * Generate plan entries from todo input
 */
export function planEntries(input: any): any[] {
  if (!input || !Array.isArray(input.todos)) {
    return [];
  }

  return input.todos.map((todo: any, index: number) => ({
    id: index,
    text: todo.text || todo.description || 'Todo item',
    completed: todo.completed || false
  }));
}