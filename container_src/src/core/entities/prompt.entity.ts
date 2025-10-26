import { z } from 'zod';
import type { ContentBlock } from '../../types/acp-messages.js';
import type { ACPSession } from '../../types/acp-session.js';
import { contentBlockArraySchema, agentContextSchema } from './schemas.js';
import { buildPromptFromContent } from '../prompts/prompt-utils.js';
import { estimateTokens } from '../prompts/prompt-utils.js';

const promptInputSchema = z.object({
  content: contentBlockArraySchema.min(1),
  contextFiles: z.array(z.string()).optional(),
  agentContext: agentContextSchema,
});

type PromptInput = z.infer<typeof promptInputSchema>;

export class PromptEntity {
  private readonly props: PromptInput;
  private readonly promptText: string;
  private readonly estimatedTokens: number;

  private constructor(
    props: PromptInput,
    promptText: string,
    estimatedTokens: number,
  ) {
    this.props = props;
    this.promptText = promptText;
    this.estimatedTokens = estimatedTokens;
  }

  static create(
    input: {
      content: ContentBlock[];
      contextFiles?: string[];
      agentContext?: Record<string, unknown>;
    },
    session?: ACPSession,
  ): PromptEntity {
    const validated = promptInputSchema.parse(input);
    const promptText = buildPromptFromContent(
      validated.content,
      validated.contextFiles,
      validated.agentContext,
      session,
    );
    const tokens = estimateTokens(promptText).estimatedTokens;
    return new PromptEntity(
      {
        content: validated.content.map((block) => ({ ...block })),
        contextFiles: validated.contextFiles
          ? [...validated.contextFiles]
          : undefined,
        agentContext: validated.agentContext
          ? { ...validated.agentContext }
          : undefined,
      },
      promptText,
      tokens,
    );
  }

  get content(): readonly ContentBlock[] {
    return this.props.content;
  }

  get contextFiles(): readonly string[] | undefined {
    return this.props.contextFiles;
  }

  get agentContext(): Record<string, unknown> | undefined {
    return this.props.agentContext ? { ...this.props.agentContext } : undefined;
  }

  get text(): string {
    return this.promptText;
  }

  get tokenEstimate(): number {
    return this.estimatedTokens;
  }
}

export default PromptEntity;
