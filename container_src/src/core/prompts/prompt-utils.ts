export interface TokenEstimationOptions {
  model?: string; // future: model-specific multipliers
  overheadRatio?: number; // default overhead multiplier
}

export interface TokenEstimationResult {
  estimatedTokens: number;
  charCount: number;
  overheadApplied: number; // ratio actually used
}

export function estimateTokens(
  _text: string,
  _opts: TokenEstimationOptions = {},
): TokenEstimationResult {
  // Implement rough heuristic from original monolith:
  // 1 token ≈ 4 characters (simple heuristic)
  const charCount = _text.length;
  const avgCharsPerToken = 4;
  const baseTokens = Math.ceil(charCount / avgCharsPerToken);
  const overhead = _opts.overheadRatio ?? 1.0;
  const estimated = Math.max(0, Math.ceil(baseTokens * overhead));
  return {
    estimatedTokens: estimated,
    charCount,
    overheadApplied: overhead,
  };
}

export interface SummarizeOptions {
  maxTokens: number; // target budget
  model?: string;
  // future: strategy selection (e.g., extractive vs naive truncation)
}

export interface SummarizeResult {
  summary: string;
  originalTokens: number;
  truncated: boolean;
}

export function summarizeToBudget(
  _text: string,
  _opts: SummarizeOptions,
): SummarizeResult {
  // Simple initial implementation: if within budget return original, else truncate to approx budget
  const est = estimateTokens(_text, { model: _opts.model });
  const originalTokens = est.estimatedTokens;
  if (originalTokens <= _opts.maxTokens) {
    return { summary: _text, originalTokens, truncated: false };
  }
  // Truncate by characters proportionally
  const ratio = _opts.maxTokens / Math.max(1, originalTokens);
  const targetChars = Math.floor(_text.length * ratio);
  const truncated =
    _text.substring(0, Math.max(0, targetChars - 3)).trim() + '...';
  return { summary: truncated, originalTokens, truncated: true };
}

export interface PromptFormattingSegment {
  label?: string;
  content: string;
  // future: style hint (markdown/code/system)
  role?: 'system' | 'user' | 'assistant' | 'context';
}

export interface BuildPromptOptions {
  segments: PromptFormattingSegment[];
  maxTotalTokens?: number; // optional safety budget
  model?: string;
}

export interface BuildPromptResult {
  prompt: string;
  totalEstimatedTokens: number;
  truncatedSegments: number; // count of segments trimmed
}

export function buildCompositePrompt(
  _opts: BuildPromptOptions,
): BuildPromptResult {
  const segments = _opts.segments || [];
  const maxTokens = _opts.maxTotalTokens ?? Infinity;
  let totalEstimatedTokens = 0;
  let truncatedSegments = 0;
  const parts: string[] = [];

  for (const seg of segments) {
    const header = seg.label ? `### ${seg.label}\n` : '';
    const content = seg.content || '';
    const segText = header + content;
    const segTokens = estimateTokens(segText, {
      model: _opts.model,
    }).estimatedTokens;
    if (totalEstimatedTokens + segTokens > maxTokens) {
      // Need to truncate this segment to fit
      const remaining = Math.max(0, maxTokens - totalEstimatedTokens);
      if (remaining <= 0) {
        truncatedSegments++;
        break;
      }
      const summarized = summarizeToBudget(content, {
        maxTokens: remaining,
        model: _opts.model,
      });
      parts.push(header + summarized.summary);
      totalEstimatedTokens += remaining;
      truncatedSegments++;
      break; // budget exhausted
    }
    parts.push(segText);
    totalEstimatedTokens += segTokens;
  }

  return {
    prompt: parts.join('\n\n'),
    totalEstimatedTokens,
    truncatedSegments,
  };
}

export function buildPromptFromContent(
  content: any[],
  contextFiles?: string[],
  agentContext?: Record<string, unknown>,
  session?: any,
): string {
  let prompt = '';

  // Add agent context if provided
  if (agentContext) {
    if ((agentContext as any).userRequest) {
      prompt += `User Request: ${(agentContext as any).userRequest}\n\n`;
    }
    if ((agentContext as any).requestingAgent) {
      prompt += `Requesting Agent: ${(agentContext as any).requestingAgent}\n\n`;
    }
  }

  // Add workspace context
  if (session?.workspaceUri) {
    try {
      prompt += `Working in: ${new URL(session.workspaceUri).pathname}\n`;
    } catch {}
  }
  if (session?.mode) {
    prompt += `Session Mode: ${session.mode}\n\n`;
  }

  // Add context files if provided
  if (contextFiles && contextFiles.length > 0) {
    prompt += `Context Files:\n${contextFiles.map((f) => `- ${f}`).join('\n')}\n\n`;
  }

  // Process content blocks
  for (const block of content) {
    switch (block.type) {
      case 'text':
        prompt += (block.text || block.content) + '\n\n';
        break;
      case 'file':
        prompt += `File: ${block.metadata?.filename || 'unknown'}\n`;
        prompt += block.content + '\n\n';
        break;
      case 'diff':
        prompt += `Diff:\n${block.content}\n\n`;
        break;
      case 'image':
        prompt += `[Image: ${block.metadata?.filename || 'image'}]\n\n`;
        break;
      case 'thought':
        prompt += `Thought: ${block.content}\n\n`;
        break;
      case 'error':
        prompt += `Error: ${block.content}\n\n`;
        break;
      default:
        prompt += block.content + '\n\n';
    }
  }

  return prompt.trim();
}

export function estimateTokensFromMessage(message: any): number {
  const text = getMessageText(message);
  return estimateTokens(text).estimatedTokens;
}

export function getMessageText(message: any): string {
  if (typeof (message as any).text === 'string') return (message as any).text;
  if (typeof (message as any).content === 'string')
    return (message as any).content;
  if (Array.isArray((message as any).content))
    return (message as any).content
      .map((c: any) => c.text || JSON.stringify(c))
      .join('\n');
  return JSON.stringify(message);
}

export function extractMessageSummary(message: any): string {
  const text = getMessageText(message);
  return text.length > 200 ? text.substring(0, 200) + '...' : text;
}

export default {
  estimateTokens,
  summarizeToBudget,
  buildCompositePrompt,
};
