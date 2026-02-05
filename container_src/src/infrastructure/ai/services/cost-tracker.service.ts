/**
 * Cost Tracker Service for LLM API calls
 * 
 * This service tracks cost data for individual LLM calls and can be used
 * for logging, monitoring, and debugging purposes.
 * 
 * The service integrates with LangSmith for automatic tracing.
 */

/**
 * Cost tracking data for a single LLM API call
 */
export interface CostTrackingData {
  /** The model used for the API call */
  model: string;

  /** Number of prompt/input tokens */
  promptTokens: number;

  /** Number of completion/output tokens */
  completionTokens: number;

  /** Number of cache read tokens (if supported) */
  cacheReadTokens?: number;

  /** Total cost in USD */
  totalCostUsd: number;

  /** Input cost in USD */
  inputCostUsd: number;

  /** Output cost in USD */
  outputCostUsd: number;

  /** Cache read cost in USD (if applicable) */
  cacheReadCostUsd?: number;

  /** Timestamp of the call */
  timestamp?: Date;

  /** Session ID (for aggregation) */
  sessionId?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Cost Tracker Service
 * 
 * Tracks individual LLM API call costs for monitoring and debugging.
 * This service logs cost data and can be extended to send metrics
 * to monitoring systems.
 */
export class CostTrackerService {
  private readonly serviceName = 'CostTrackerService';

  /**
   * Track a single LLM API call
   * 
   * @param sessionId - The session identifier
   * @param data - Cost tracking data
   * 
   * @example
   * ```typescript
   * costTracker.trackCall('session-123', {
   *   model: 'openai/gpt-5-mini',
   *   promptTokens: 1000,
   *   completionTokens: 500,
   *   totalCostUsd: 0.00045,
   *   inputCostUsd: 0.00015,
   *   outputCostUsd: 0.0003,
   * });
   * ```
   */
  trackCall(sessionId: string, data: CostTrackingData): void {
    const trackingData: CostTrackingData = {
      ...data,
      sessionId,
      timestamp: data.timestamp || new Date(),
    };

    // Log for debugging and monitoring
    console.log(`[${this.serviceName}]`, {
      sessionId,
      model: trackingData.model,
      tokens: {
        prompt: trackingData.promptTokens,
        completion: trackingData.completionTokens,
        cacheRead: trackingData.cacheReadTokens,
        total:
          trackingData.promptTokens +
          trackingData.completionTokens +
          (trackingData.cacheReadTokens || 0),
      },
      cost: {
        input: `$${trackingData.inputCostUsd.toFixed(6)}`,
        output: `$${trackingData.outputCostUsd.toFixed(6)}`,
        cacheRead: trackingData.cacheReadCostUsd
          ? `$${trackingData.cacheReadCostUsd.toFixed(6)}`
          : undefined,
        total: `$${trackingData.totalCostUsd.toFixed(6)}`,
      },
      timestamp: trackingData.timestamp?.toISOString() || new Date().toISOString(),
      metadata: trackingData.metadata,
    });

    // Future: Send to monitoring/analytics service
    // this.sendToMonitoring(trackingData);
  }

  /**
   * Track multiple calls at once
   * 
   * @param sessionId - The session identifier
   * @param calls - Array of cost tracking data
   */
  trackBatch(sessionId: string, calls: CostTrackingData[]): void {
    calls.forEach((data) => this.trackCall(sessionId, data));
  }

  /**
   * Log a summary of costs
   * 
   * @param sessionId - The session identifier
   * @param totalCost - Total cost for the session
   * @param callCount - Number of API calls
   */
  logSummary(
    sessionId: string,
    totalCost: number,
    callCount: number,
  ): void {
    console.log(`[${this.serviceName}] Session Summary`, {
      sessionId,
      totalCost: `$${totalCost.toFixed(6)}`,
      callCount,
      averageCostPerCall:
        callCount > 0 ? `$${(totalCost / callCount).toFixed(6)}` : '$0.00',
    });
  }
}

/**
 * Singleton instance for easy access
 */
export const costTracker = new CostTrackerService();
