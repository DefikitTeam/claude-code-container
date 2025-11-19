import { z } from 'zod';
import type { ContentBlock } from '../../types/acp-messages.js';
import type {
  ACPSession,
  SessionMode,
  SessionState,
} from '../../types/acp-session.js';
import { DEFAULT_SESSION_OPTIONS } from '../../types/acp-session.js';
import { agentContextSchema, contentBlockArraySchema } from './schemas.js';

const sessionOptionsSchema = z
  .object({
    persistHistory: z.boolean().optional(),
    enableGitOps: z.boolean().optional(),
    contextFiles: z.array(z.string()).optional(),
  })
  .partial();

const workspaceStateSchema = z
  .object({
    currentBranch: z.string().optional(),
    modifiedFiles: z.array(z.string()).optional(),
    hasUncommittedChanges: z.boolean().optional(),
  })
  .partial();

const sessionSchema = z
  .object({
    sessionId: z.string().min(1),
    workspaceUri: z.string().min(1).optional(),
    mode: z.enum(['conversation', 'development']),
    state: z.enum(['active', 'paused', 'completed', 'error']),
    createdAt: z.number().int().nonnegative(),
    lastActiveAt: z.number().int().nonnegative(),
    messageHistory: z.array(contentBlockArraySchema).default([]),
    workspaceState: workspaceStateSchema.optional(),
    sessionOptions: sessionOptionsSchema.optional(),
    agentContext: agentContextSchema,
  })
  .strict();

type SessionSchema = z.infer<typeof sessionSchema> & {
  messageHistory: ContentBlock[][];
};

type SessionOptions = Required<NonNullable<SessionSchema['sessionOptions']>>;

type CloneableSession = Omit<SessionSchema, 'sessionOptions'> & {
  sessionOptions?: SessionOptions;
};

const AUTOMATION_KEY = 'automation';

function clone<T>(value: T): T {
  const structured = (globalThis as any).structuredClone as
    | (<U>(input: U) => U)
    | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof structured === 'function') {
    return structured(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

const SESSION_OPTION_FALLBACK: SessionOptions = {
  persistHistory: DEFAULT_SESSION_OPTIONS?.persistHistory ?? true,
  enableGitOps: DEFAULT_SESSION_OPTIONS?.enableGitOps ?? true,
  contextFiles: DEFAULT_SESSION_OPTIONS?.contextFiles
    ? [...DEFAULT_SESSION_OPTIONS.contextFiles]
    : [],
};

function normalizeSessionOptions(
  options: SessionSchema['sessionOptions'],
): SessionOptions {
  return {
    persistHistory:
      options?.persistHistory ?? SESSION_OPTION_FALLBACK.persistHistory,
    enableGitOps: options?.enableGitOps ?? SESSION_OPTION_FALLBACK.enableGitOps,
    contextFiles: options?.contextFiles
      ? [...options.contextFiles]
      : [...SESSION_OPTION_FALLBACK.contextFiles],
  };
}

function normalizeMessageHistory(history: ContentBlock[][]): ContentBlock[][] {
  return history.map((exchange) => exchange.map((block) => clone(block)));
}

function normalizeWorkspaceState(
  state: SessionSchema['workspaceState'],
): SessionSchema['workspaceState'] {
  if (!state) return undefined;
  return {
    currentBranch: state.currentBranch,
    hasUncommittedChanges: state.hasUncommittedChanges,
    modifiedFiles: state.modifiedFiles ? [...state.modifiedFiles] : undefined,
  };
}

function mergeAgentContexts(
  base?: Record<string, unknown>,
  incoming?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!base && !incoming) return undefined;
  if (!base) return incoming ? clone(incoming) : undefined;
  if (!incoming) return clone(base);

  const merged: Record<string, unknown> = { ...base, ...incoming };
  const baseAutomation = extractAutomation(base);
  const incomingAutomation = extractAutomation(incoming);
  if (baseAutomation || incomingAutomation) {
    merged[AUTOMATION_KEY] = {
      ...baseAutomation,
      ...incomingAutomation,
    };
  }
  return merged;
}

function extractAutomation(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const raw = context[AUTOMATION_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  return clone(raw as Record<string, unknown>);
}

export class SessionEntity {
  private readonly props: CloneableSession;

  private constructor(props: CloneableSession) {
    this.props = props;
  }

  static create(input: ACPSession): SessionEntity {
    return SessionEntity.fromPlain(input);
  }

  static fromPlain(input: ACPSession): SessionEntity {
    const parsed = sessionSchema.parse(input) as SessionSchema;
    return new SessionEntity({
      ...parsed,
      messageHistory: normalizeMessageHistory(parsed.messageHistory),
      workspaceState: normalizeWorkspaceState(parsed.workspaceState),
      sessionOptions: normalizeSessionOptions(parsed.sessionOptions),
      agentContext: parsed.agentContext
        ? clone(parsed.agentContext)
        : undefined,
    });
  }

  get id(): string {
    return this.props.sessionId;
  }

  get sessionId(): string {
    return this.props.sessionId;
  }

  get mode(): SessionMode {
    return this.props.mode;
  }

  get state(): SessionState {
    return this.props.state;
  }

  get workspaceUri(): string | undefined {
    return this.props.workspaceUri;
  }

  get sessionOptions(): SessionOptions | undefined {
    return this.props.sessionOptions
      ? { ...this.props.sessionOptions }
      : undefined;
  }

  get agentContext(): Record<string, unknown> | undefined {
    return this.props.agentContext ? clone(this.props.agentContext) : undefined;
  }

  get messageHistory(): readonly ContentBlock[][] {
    return this.props.messageHistory;
  }

  get lastActiveAt(): number {
    return this.props.lastActiveAt;
  }

  withAgentContext(context?: Record<string, unknown>): SessionEntity {
    return new SessionEntity({
      ...this.props,
      agentContext: context ? clone(context) : undefined,
    });
  }

  mergeAgentContext(incoming?: Record<string, unknown>): SessionEntity {
    const merged = mergeAgentContexts(this.props.agentContext, incoming);
    return new SessionEntity({
      ...this.props,
      agentContext: merged,
    });
  }

  withState(state: SessionState): SessionEntity {
    return new SessionEntity({
      ...this.props,
      state,
    });
  }

  touchLastActiveAt(timestamp: number = Date.now()): SessionEntity {
    return new SessionEntity({
      ...this.props,
      lastActiveAt: Math.max(this.props.lastActiveAt, timestamp),
    });
  }

  appendMessageHistory(
    content: ContentBlock[],
    timestamp: number = Date.now(),
  ): SessionEntity {
    if (content.length === 0) {
      throw new Error('Cannot append empty content block array');
    }
    const validated = contentBlockArraySchema
      .parse(content)
      .map((block) => clone(block));
    return new SessionEntity({
      ...this.props,
      messageHistory: [...this.props.messageHistory, validated],
      lastActiveAt: Math.max(this.props.lastActiveAt, timestamp),
    });
  }

  shouldPersistHistory(): boolean {
    const opts = this.props.sessionOptions;
    return opts?.persistHistory ?? SESSION_OPTION_FALLBACK.persistHistory;
  }

  toJSON(): ACPSession {
    return {
      sessionId: this.props.sessionId,
      workspaceUri: this.props.workspaceUri,
      mode: this.props.mode,
      state: this.props.state,
      createdAt: this.props.createdAt,
      lastActiveAt: this.props.lastActiveAt,
      messageHistory: normalizeMessageHistory(this.props.messageHistory),
      workspaceState: normalizeWorkspaceState(this.props.workspaceState),
      sessionOptions: this.props.sessionOptions
        ? {
            persistHistory: this.props.sessionOptions.persistHistory,
            enableGitOps: this.props.sessionOptions.enableGitOps,
            contextFiles: [...(this.props.sessionOptions.contextFiles ?? [])],
          }
        : undefined,
      agentContext: this.props.agentContext
        ? clone(this.props.agentContext)
        : undefined,
    };
  }
}

export default SessionEntity;
