// Conversation types for OpenHands integration
// Phase 2 - T006: Define OpenHandsConversation and related interfaces

export type ConversationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OpenHandsConversation {
  // server-provided unique conversation id
  id: string;

  // optional human friendly title
  title?: string;

  // creation time as ISO 8601
  createdAt: string;

  // last updated time as ISO 8601
  updatedAt?: string;

  // current conversation status
  status: ConversationStatus;

  // optional summary or aggregated text
  summary?: string;

  // metadata such as repo list, user id, etc.
  metadata?: Record<string, unknown>;
}

export interface CreateConversationRequest {
  // initial prompt or user message
  prompt: string;

  // optional repositories context (multi-repo support)
  repositories?: Array<{ owner: string; repo: string; ref?: string }>;

  // optional model / adapter configuration overrides
  config?: Record<string, unknown>;
}

export interface ConversationStatusResponse {
  conversation: OpenHandsConversation;
  eventsCount?: number;
}

export default {} as const;
