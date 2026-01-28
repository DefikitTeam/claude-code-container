/**
 * ACPSession, ContentBlock, and AgentCapabilities types
 * Session management and state tracking for ACP protocol
 */

import {
  ContentBlock,
  AgentCapabilities,
  WorkspaceInfo,
  AgentOrchestrationContext,
} from './acp-messages.js';

// ===== Session State Management =====

export type SessionState = 'active' | 'paused' | 'completed' | 'error';
export type SessionMode = 'conversation' | 'development';

export interface ACPSession {
  sessionId: string;
  workspaceUri?: string;
  mode: SessionMode;
  state: SessionState;
  createdAt: number;
  lastActiveAt: number;
  messageHistory: ContentBlock[][];
  workspaceState?: {
    currentBranch?: string;
    modifiedFiles?: string[];
    hasUncommittedChanges?: boolean;
  };
  sessionOptions?: {
    persistHistory?: boolean;
    enableGitOps?: boolean;
    contextFiles?: string[];
  };
  agentContext?: {
    requestingAgent?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    userRequest?: string;
    conversationId?: string;
    orchestration?: AgentOrchestrationContext;
    agentRole?: string; // e.g. 'executor', 'planner', 'reviewer'
    planId?: string;
    stepId?: string;
    subTask?: string;
    [key: string]: unknown;
  };
}

// ===== Session Lifecycle Events =====

export interface SessionEvent {
  sessionId: string;
  timestamp: number;
  type:
    | 'created'
    | 'loaded'
    | 'prompt_received'
    | 'update_sent'
    | 'completed'
    | 'error'
    | 'cancelled';
  data?: unknown;
}

// ===== Session Manager Interface =====

export interface SessionManager {
  createSession(params: {
    workspaceUri?: string;
    mode?: SessionMode;
    sessionOptions?: ACPSession['sessionOptions'];
  }): Promise<ACPSession>;

  loadSession(sessionId: string): Promise<ACPSession | null>;

  updateSession(sessionId: string, updates: Partial<ACPSession>): Promise<void>;

  deleteSession(sessionId: string): Promise<void>;

  listSessions(): Promise<string[]>;

  addMessageToHistory(
    sessionId: string,
    content: ContentBlock[],
  ): Promise<void>;

  updateLastActiveTime(sessionId: string): Promise<void>;
}

// ===== Session Statistics =====

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  errorSessions: number;
  averageSessionDuration: number;
  totalMessagesProcessed: number;
}

// ===== Session Configuration =====

export interface SessionConfig {
  maxSessionDuration: number; // milliseconds
  maxMessageHistory: number; // number of message exchanges
  defaultMode: SessionMode;
  enablePersistence: boolean;
  cleanupInterval: number; // milliseconds
}

// ===== Session Storage Interface =====

export interface SessionStorage {
  store(session: ACPSession): Promise<void>;
  retrieve(sessionId: string): Promise<ACPSession | null>;
  update(sessionId: string, updates: Partial<ACPSession>): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<string[]>;
  cleanup(olderThan: number): Promise<number>; // returns number of sessions cleaned
}

// ===== Default Session Options =====

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxSessionDuration: 2 * 60 * 60 * 1000, // 2 hours
  maxMessageHistory: 100,
  defaultMode: 'development',
  enablePersistence: true,
  cleanupInterval: 60 * 60 * 1000, // 1 hour
};

export const DEFAULT_SESSION_OPTIONS: Required<ACPSession['sessionOptions']> = {
  persistHistory: true,
  enableGitOps: true,
  contextFiles: [],
};

// ===== Session Utilities =====

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function isSessionExpired(
  session: ACPSession,
  maxDuration: number,
): boolean {
  return Date.now() - session.lastActiveAt > maxDuration;
}

export function getSessionDuration(session: ACPSession): number {
  return session.lastActiveAt - session.createdAt;
}

export function getMessageCount(session: ACPSession): number {
  return session.messageHistory.length;
}

// ===== Session Validation =====

export function validateSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0;
}

export function validateSessionMode(mode: string): mode is SessionMode {
  return mode === 'conversation' || mode === 'development';
}

export function validateSessionState(state: string): state is SessionState {
  return ['active', 'paused', 'completed', 'error'].includes(state);
}

// ===== Re-export from messages for convenience =====

export type {
  ContentBlock,
  AgentCapabilities,
  WorkspaceInfo,
} from './acp-messages.js';
