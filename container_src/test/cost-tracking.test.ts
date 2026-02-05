/**
 * Cost Tracking Integration Tests
 * 
 * Tests for LangSmith cost tracking implementation.
 */

import { describe, it, expect } from 'vitest';
import { calculateCost, isFreeModel, formatCost, OPENROUTER_PRICING } from '../src/infrastructure/ai/utils/cost-calculator';
import { SessionCostAggregatorService } from '../src/services/session-cost-aggregator.service';

describe('Cost Calculator', () => {
  it('should calculate cost for GPT-5 Mini correctly', () => {
    const result = calculateCost('openai/gpt-5-mini', 1000, 500);
    
    // Expected: (1000/1M * 0.15) + (500/1M * 0.6) = 0.00015 + 0.0003 = 0.00045
    expect(result.inputCostUsd).toBeCloseTo(0.00015, 6);
    expect(result.outputCostUsd).toBeCloseTo(0.0003, 6);
    expect(result.totalCostUsd).toBeCloseTo(0.00045, 6);
  });

  it('should calculate cost for free models (Gemini)', () => {
    const result = calculateCost('google/gemini-2.0-flash-lite-001', 1000, 500);
    
    expect(result.inputCostUsd).toBe(0);
    expect(result.outputCostUsd).toBe(0);
    expect(result.totalCostUsd).toBe(0);
  });

  it('should handle cache read tokens', () => {
    const result = calculateCost('openai/gpt-5.2-codex', 1000, 500, 2000);
    
    // Expected: (1000/1M * 1.75) + (500/1M * 14.0) + (2000/1M * 0.175)
    expect(result.inputCostUsd).toBeCloseTo(0.00175, 6);
    expect(result.outputCostUsd).toBeCloseTo(0.007, 6);
    expect(result.cacheReadCostUsd).toBeCloseTo(0.00035, 6);
    expect(result.totalCostUsd).toBeCloseTo(0.0091, 6);
  });

  it('should return zero cost for unknown models', () => {
    const result = calculateCost('unknown/model', 1000, 500);
    
    expect(result.totalCostUsd).toBe(0);
  });

  it('should identify free models correctly', () => {
    expect(isFreeModel('google/gemini-2.0-flash-lite-001')).toBe(true);
    expect(isFreeModel('openai/gpt-5-mini')).toBe(false);
    expect(isFreeModel('unknown/model')).toBe(false);
  });

  it('should format costs correctly', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.00001)).toBe('$0.000010');
    expect(formatCost(0.001)).toBe('$0.0010');
    expect(formatCost(0.5)).toBe('$0.50');
    expect(formatCost(10.5)).toBe('$10.50');
  });

  it('should have pricing data for common models', () => {
    expect(OPENROUTER_PRICING['openai/gpt-5-mini']).toBeDefined();
    expect(OPENROUTER_PRICING['openai/gpt-5.2-codex']).toBeDefined();
    expect(OPENROUTER_PRICING['google/gemini-2.0-flash-lite-001']).toBeDefined();
    expect(OPENROUTER_PRICING['anthropic/claude-sonnet-4']).toBeDefined();
  });
});

describe('Session Cost Aggregator', () => {
  it('should aggregate costs correctly for single session', () => {
    const aggregator = new SessionCostAggregatorService();
    
    // Add first call
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    
    const session = aggregator.getSessionCost('session-1');
    expect(session).toBeDefined();
    expect(session?.totalPromptTokens).toBe(1000);
    expect(session?.totalCompletionTokens).toBe(500);
    expect(session?.totalTokens).toBe(1500);
    expect(session?.totalCostUsd).toBeCloseTo(0.00045, 6);
    expect(session?.callCount).toBe(1);
  });

  it('should aggregate multiple calls in same session', () => {
    const aggregator = new SessionCostAggregatorService();
    
    // Add multiple calls
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 2000, 1000, 0.0009);
    aggregator.addCall('session-1', 'google/gemini-2.0-flash-lite-001', 500, 250, 0);
    
    const session = aggregator.getSessionCost('session-1');
    expect(session?.totalPromptTokens).toBe(3500);
    expect(session?.totalCompletionTokens).toBe(1750);
    expect(session?.totalTokens).toBe(5250);
    expect(session?.totalCostUsd).toBeCloseTo(0.00135, 6);
    expect(session?.callCount).toBe(3);
    expect(session?.averageCostPerCall).toBeCloseTo(0.00045, 6);
  });

  it('should track model breakdown correctly', () => {
    const aggregator = new SessionCostAggregatorService();
    
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    aggregator.addCall('session-1', 'google/gemini-2.0-flash-lite-001', 2000, 1000, 0);
    
    const session = aggregator.getSessionCost('session-1');
    expect(session?.modelBreakdown['openai/gpt-5-mini']).toBeDefined();
    expect(session?.modelBreakdown['openai/gpt-5-mini'].calls).toBe(2);
    expect(session?.modelBreakdown['openai/gpt-5-mini'].tokens).toBe(3000);
    expect(session?.modelBreakdown['openai/gpt-5-mini'].cost).toBeCloseTo(0.0009, 6);
    
    expect(session?.modelBreakdown['google/gemini-2.0-flash-lite-001']).toBeDefined();
    expect(session?.modelBreakdown['google/gemini-2.0-flash-lite-001'].calls).toBe(1);
    expect(session?.modelBreakdown['google/gemini-2.0-flash-lite-001'].tokens).toBe(3000);
    expect(session?.modelBreakdown['google/gemini-2.0-flash-lite-001'].cost).toBe(0);
  });

  it('should handle multiple sessions independently', () => {
    const aggregator = new SessionCostAggregatorService();
    
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    aggregator.addCall('session-2', 'openai/gpt-5-mini', 2000, 1000, 0.0009);
    
    const session1 = aggregator.getSessionCost('session-1');
    const session2 = aggregator.getSessionCost('session-2');
    
    expect(session1?.totalCostUsd).toBeCloseTo(0.00045, 6);
    expect(session2?.totalCostUsd).toBeCloseTo(0.0009, 6);
    
    const summary = aggregator.getSummary();
    expect(summary.totalSessions).toBe(2);
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalCost).toBeCloseTo(0.00135, 6);
  });

  it('should reset session correctly', () => {
    const aggregator = new SessionCostAggregatorService();
    
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    expect(aggregator.getSessionCost('session-1')).toBeDefined();
    
    aggregator.resetSession('session-1');
    expect(aggregator.getSessionCost('session-1')).toBeUndefined();
  });

  it('should calculate summary correctly', () => {
    const aggregator = new SessionCostAggregatorService();
    
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    aggregator.addCall('session-1', 'openai/gpt-5-mini', 1000, 500, 0.00045);
    aggregator.addCall('session-2', 'openai/gpt-5-mini', 2000, 1000, 0.0009);
    
    const summary = aggregator.getSummary();
    expect(summary.totalSessions).toBe(2);
    expect(summary.totalCalls).toBe(3);
    expect(summary.totalTokens).toBe(6000);
    expect(summary.totalCost).toBeCloseTo(0.0018, 6);
    expect(summary.averageCostPerSession).toBeCloseTo(0.0009, 6);
  });
});
