// OpenHands event types, Zod schemas and small parsing helpers
// Phase 2 - T005/T008: Define OpenHandsEvent interface and Zod validation

import { z } from 'zod';

export interface OpenHandsEvent {
  // unique event identifier provided by OpenHands
  id: string;

  // high level event type (message, action, system, etc.)
  type: 'message' | 'action' | 'system' | string;

  // ISO 8601 timestamp string
  timestamp: string;

  // optional conversation id this event belongs to
  conversationId?: string;

  // payload carries the event content (structure varies by type)
  payload?: unknown;

  // optional additional metadata
  metadata?: Record<string, unknown>;
}

export type OpenHandsEventInput = unknown;

// Zod schema for a generic OpenHands event. Keep schema permissive where the
// spec allows unknown payload shapes. Consumers can refine by event `type`.
export const OpenHandsEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().min(1),
  conversationId: z.string().optional(),
  payload: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type OpenHandsEventParsed = z.infer<typeof OpenHandsEventSchema>;

/**
 * Safely parse an unknown value into an OpenHandsEventParsed using Zod's
 * safeParse. Returns the Zod safeParse result so callers can decide how to
 * handle failures (log, classify, retry, etc.).
 */
export function safeParseOpenHandsEvent(
  input: unknown,
):
  | { success: true; data: OpenHandsEventParsed }
  | { success: false; error: z.ZodError } {
  const result = OpenHandsEventSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}

// Simple export useful for event deduplication/storage helpers elsewhere
export const createEventIdSet = (): Set<string> => new Set<string>();

/**
 * EventParser: small, single-responsibility class that
 * - validates incoming raw events using Zod
 * - provides deduplication via an in-memory Set
 * - maintains a bounded in-memory buffer of recent events
 *
 * This class intentionally has no networking or I/O.
 */
export class EventParser {
  private seen: Set<string>;
  private buffer: OpenHandsEventParsed[];
  private maxBuffer: number;

  constructor(options?: { maxBuffer?: number; seedSeen?: Iterable<string> }) {
    this.maxBuffer = options?.maxBuffer ?? 1000;
    this.seen = new Set<string>(options?.seedSeen ?? []);
    this.buffer = [];
  }

  /**
   * Parse a raw input into an OpenHandsEventParsed. Returns null if parsing
   * failed. Use `safeParseOpenHandsEvent` directly if you need error details.
   */
  parse(input: unknown): OpenHandsEventParsed | null {
    const res = safeParseOpenHandsEvent(input);
    if (!res.success) return null;
    return res.data;
  }

  /**
   * Parse and add event to buffer if valid and not seen before. Returns true
   * if the event was added (new), false if it was duplicate or invalid.
   */
  parseAndAdd(input: unknown): boolean {
    const parsed = this.parse(input);
    if (!parsed) return false;
    if (this.seen.has(parsed.id)) return false;
    this.addEvent(parsed);
    return true;
  }

  /**
   * Add an already-validated event to the buffer and mark as seen.
   */
  addEvent(event: OpenHandsEventParsed) {
    this.buffer.push(event);
    this.seen.add(event.id);
    this.trimBufferIfNeeded();
  }

  /**
   * Remove duplicates from an event array based on ids and return only new
   * events (also mark them as seen). Useful when ingesting batch results.
   */
  dedupe(events: OpenHandsEventParsed[]): OpenHandsEventParsed[] {
    const out: OpenHandsEventParsed[] = [];
    for (const ev of events) {
      if (!this.seen.has(ev.id)) {
        this.seen.add(ev.id);
        out.push(ev);
      }
    }
    return out;
  }

  /**
   * Return a shallow copy of the internal buffer (most recent last).
   */
  getBuffer(): OpenHandsEventParsed[] {
    return [...this.buffer];
  }

  /**
   * Whether the parser has already seen the given event id.
   */
  hasSeen(id: string): boolean {
    return this.seen.has(id);
  }

  /**
   * Clear seen ids and buffer.
   */
  clear(): void {
    this.seen.clear();
    this.buffer = [];
  }

  private trimBufferIfNeeded() {
    while (this.buffer.length > this.maxBuffer) {
      const removed = this.buffer.shift();
      if (removed) {
        // Optionally remove from seen to allow re-processing (keeps memory bounded)
        this.seen.delete(removed.id);
      }
    }
  }
}
