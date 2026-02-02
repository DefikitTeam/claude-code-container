/**
 * Session Cost Aggregator Service
 * 
 * Aggregates cost data across multiple LLM API calls within a session.
 * Useful for tracking total costs for multi-step tasks.
 */

export interface ModelUsage {
  /** Number of API calls made with this model */
  calls: number;

  /** Total tokens consumed by this model */
  tokens: number;

  /** Total cost in USD for this model */
  cost: number;
}

export interface SessionCostData {
  /** Session identifier */
  sessionId: string;

  /** Total prompt/input tokens across all calls */
  totalPromptTokens: number;

  /** Total completion/output tokens across all calls */
  totalCompletionTokens: number;

  /** Total tokens (prompt + completion) */
  totalTokens: number;

  /** Total cost in USD across all calls */
  totalCostUsd: number;

  /** Number of API calls made in this session */
  callCount: number;

  /** Average cost per API call */
  averageCostPerCall: number;

  /** Breakdown by model */
  modelBreakdown: Record<string, ModelUsage>;

  /** Timestamp of first call */
  startTime?: Date;

  /** Timestamp of last call */
  lastUpdate?: Date;
}

/**
 * Session Cost Aggregator Service
 * 
 * Tracks and aggregates costs across multiple LLM API calls within a session.
 */
export class SessionCostAggregatorService {
  private costs: Map<string, SessionCostData> = new Map();

  /**
   * Add a single API call to the session aggregate
   * 
   * @param sessionId - The session identifier
   * @param model - The model used for the call
   * @param promptTokens - Number of prompt/input tokens
   * @param completionTokens - Number of completion/output tokens
   * @param costUsd - Cost of this call in USD
   * 
   * @example
   * ```typescript
   * aggregator.addCall('session-123', 'openai/gpt-5-mini', 1000, 500, 0.00045);
   * ```
   */
  addCall(
    sessionId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    costUsd: number,
  ): void {
    let sessionData = this.costs.get(sessionId);

    if (!sessionData) {
      // Initialize new session data
      sessionData = {
        sessionId,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        callCount: 0,
        averageCostPerCall: 0,
        modelBreakdown: {},
        startTime: new Date(),
      };
      this.costs.set(sessionId, sessionData);
    }

    // Update session totals
    sessionData.totalPromptTokens += promptTokens;
    sessionData.totalCompletionTokens += completionTokens;
    sessionData.totalTokens += promptTokens + completionTokens;
    sessionData.totalCostUsd += costUsd;
    sessionData.callCount += 1;
    sessionData.averageCostPerCall =
      sessionData.totalCostUsd / sessionData.callCount;
    sessionData.lastUpdate = new Date();

    // Update model breakdown
    if (!sessionData.modelBreakdown[model]) {
      sessionData.modelBreakdown[model] = {
        calls: 0,
        tokens: 0,
        cost: 0,
      };
    }

    const modelData = sessionData.modelBreakdown[model];
    modelData.calls += 1;
    modelData.tokens += promptTokens + completionTokens;
    modelData.cost += costUsd;
  }

  /**
   * Get aggregated cost data for a session
   * 
   * @param sessionId - The session identifier
   * @returns Session cost data, or undefined if session not found
   */
  getSessionCost(sessionId: string): SessionCostData | undefined {
    return this.costs.get(sessionId);
  }

  /**
   * Get all sessions
   * 
   * @returns Array of all session cost data
   */
  getAllSessions(): SessionCostData[] {
    return Array.from(this.costs.values());
  }

  /**
   * Reset (clear) cost data for a specific session
   * 
   * @param sessionId - The session identifier to reset
   */
  resetSession(sessionId: string): void {
    this.costs.delete(sessionId);
  }

  /**
   * Clear all session cost data
   */
  resetAll(): void {
    this.costs.clear();
  }

  /**
   * Get total cost across all sessions
   * 
   * @returns Total cost in USD
   */
  getTotalCost(): number {
    let total = 0;
    for (const session of this.costs.values()) {
      total += session.totalCostUsd;
    }
    return total;
  }

  /**
   * Get summary statistics
   * 
   * @returns Summary of all sessions
   */
  getSummary(): {
    totalSessions: number;
    totalCalls: number;
    totalTokens: number;
    totalCost: number;
    averageCostPerSession: number;
  } {
    const sessions = Array.from(this.costs.values());
    const totalCalls = sessions.reduce((sum, s) => sum + s.callCount, 0);
    const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);

    return {
      totalSessions: sessions.length,
      totalCalls,
      totalTokens,
      totalCost,
      averageCostPerSession:
        sessions.length > 0 ? totalCost / sessions.length : 0,
    };
  }
}

/**
 * Singleton instance for global access
 */
export const sessionCostAggregator = new SessionCostAggregatorService();
