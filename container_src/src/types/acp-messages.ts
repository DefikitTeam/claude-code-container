/**
 * TypeScript types for ACP JSON-RPC messages per data-model.md
 * Based on Agent Client Protocol v0.3.1 specification
 */

import type { GitHubAutomationResult } from '../core/interfaces/services/github-automation.service.js';

// ===== Core JSON-RPC 2.0 Types =====

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// ===== ACP-Specific Message Types =====

export interface ContentBlock {
  type: 'text' | 'image' | 'diff' | 'file' | 'thought' | 'error';
  content?: string; // For non-text types
  text?: string; // For text type (ACP standard)
  metadata?: {
    filename?: string;
    language?: string;
    startLine?: number;
    endLine?: number;
    mimeType?: string;
    [key: string]: unknown;
  };
}

export interface AgentCapabilities {
  editWorkspace: boolean;
  filesRead: boolean;
  filesWrite: boolean;
  sessionPersistence: boolean;
  streamingUpdates: boolean;
  githubIntegration: boolean;
  supportsImages?: boolean;
  supportsAudio?: boolean;
}

export interface AgentInfo {
  name: string;
  version: string;
  description?: string;
}

export interface WorkspaceInfo {
  rootPath: string;
  gitBranch?: string;
  hasUncommittedChanges: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Progress {
  current: number;
  total: number;
  message?: string;
}

// ===== Initialize Method Types =====

export interface InitializeRequest extends JSONRPCRequest {
  method: 'initialize';
  params: {
    protocolVersion: string;
    clientCapabilities?: {
      editWorkspace?: boolean;
      filesRead?: boolean;
      filesWrite?: boolean;
      supportsImages?: boolean;
      supportsAudio?: boolean;
    };
    clientInfo?: {
      name: string;
      version: string;
    };
  };
}

export interface InitializeResponse extends JSONRPCResponse {
  result: {
    protocolVersion: string;
    agentCapabilities: AgentCapabilities;
    agentInfo: AgentInfo;
  };
}

// ===== Session Management Types =====

export interface SessionNewRequest extends JSONRPCRequest {
  method: 'session/new';
  params: {
    workspaceUri?: string;
    sessionId?: string;
    mode?: 'conversation' | 'development';
    sessionOptions?: {
      persistHistory?: boolean;
      enableGitOps?: boolean;
      contextFiles?: string[];
    };
  };
}

export interface SessionNewResponse extends JSONRPCResponse {
  result: {
    sessionId: string;
    workspaceInfo?: WorkspaceInfo;
  };
}

export interface SessionLoadRequest extends JSONRPCRequest {
  method: 'session/load';
  params: {
    sessionId: string;
    includeHistory?: boolean;
  };
}

export interface SessionLoadResponse extends JSONRPCResponse {
  result: {
    sessionInfo: {
      sessionId: string;
      state: 'active' | 'paused' | 'completed' | 'error';
      createdAt: number;
      lastActiveAt: number;
    };
    workspaceInfo: WorkspaceInfo;
    historyAvailable: boolean;
    history?: ContentBlock[][];
  };
}

// ===== Prompt Processing Types =====

export interface SessionPromptRequest extends JSONRPCRequest {
  method: 'session/prompt';
  params: {
    sessionId: string;
    content: ContentBlock[];
    contextFiles?: string[];
    agentContext?: {
      requestingAgent?: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      userRequest?: string;
      [key: string]: unknown;
    };
  };
}

export interface SessionPromptResponse extends JSONRPCResponse {
  result: {
    stopReason: 'completed' | 'cancelled' | 'error' | 'timeout';
    usage?: Usage;
    githubOperations?: {
      branchCreated?: string;
      pullRequestCreated?: {
        url: string;
        number: number;
        title: string;
      };
      filesModified?: string[];
    };
    summary?: string;
    githubAutomation?: GitHubAutomationResult;
    [key: string]: unknown;
  };
}

// ===== Streaming Updates =====

export interface SessionUpdateNotification extends JSONRPCNotification {
  method: 'session/update';
  params: {
    sessionId: string;
    content?: ContentBlock[];
    status: 'thinking' | 'working' | 'completed' | 'error';
    progress?: Progress;
    targetAgent?: string;
  };
}

// ===== Cancellation =====

export interface CancelRequest extends JSONRPCRequest {
  method: 'cancel';
  params: {
    sessionId: string;
  };
}

export interface CancelResponse extends JSONRPCResponse {
  result: {
    cancelled: boolean;
  };
}

// ===== Error Codes =====

export const ACP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SESSION_NOT_FOUND: -32000,
  WORKSPACE_ERROR: -32001,
  AUTHENTICATION_FAILED: -32002,
  OPERATION_CANCELLED: -32003,
} as const;

export type ACPErrorCode =
  (typeof ACP_ERROR_CODES)[keyof typeof ACP_ERROR_CODES];

// ===== Union Types for Type Guards =====

export type ACPRequest =
  | InitializeRequest
  | SessionNewRequest
  | SessionLoadRequest
  | SessionPromptRequest
  | CancelRequest;

export type ACPResponse =
  | InitializeResponse
  | SessionNewResponse
  | SessionLoadResponse
  | SessionPromptResponse
  | CancelResponse;

export type ACPNotification = SessionUpdateNotification;

export type ACPMessage = ACPRequest | ACPResponse | ACPNotification;
