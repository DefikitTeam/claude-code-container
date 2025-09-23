/**
 * ACP Shared State (extracted from monolith acp-handlers.ts)
 * ---------------------------------------------------------
 * Centralizes session registry, operation tracking (AbortControllers),
 * environment & capability detection. Provides an API consumed by individual
 * handler modules and the PromptProcessor wiring layer.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { ACPSession } from '../types/acp-session.js';
import type { AgentCapabilities } from '../types/acp-messages.js';

export class ACPState {
  private sessions = new Map<string, ACPSession>();
  private initialized = false;
  private initializationTime?: number;
  private clientInfo?: { name: string; version: string };
  private activeOperations = new Map<string, AbortController>();

  private agentInfo = {
    name: 'Claude Code Container',
    version: '1.0.0',
    description: 'AI-powered containerized development assistant with GitHub integration',
    environment: this.detectEnvironment(),
  };

  private agentCapabilities: AgentCapabilities = this.detectCapabilities();

  // --- Session Management ---
  getSession(sessionId: string): ACPSession | undefined { return this.sessions.get(sessionId); }
  setSession(sessionId: string, session: ACPSession): void { this.sessions.set(sessionId, session); }
  deleteSession(sessionId: string): boolean { return this.sessions.delete(sessionId); }
  getAllSessions(): ACPSession[] { return Array.from(this.sessions.values()); }
  getSessionCount(): number { return this.sessions.size; }

  // --- Lifecycle ---
  isInitialized(): boolean { return this.initialized; }
  setInitialized(v: boolean): void { this.initialized = v; }
  getInitializationTime(): number | undefined { return this.initializationTime; }
  setInitializationTime(t: number): void { this.initializationTime = t; }

  // --- Agent Meta ---
  getAgentInfo() { return this.agentInfo; }
  getAgentCapabilities(): AgentCapabilities { return this.agentCapabilities; }
  setClientInfo(info?: { name: string; version: string }): void { this.clientInfo = info; }
  getClientInfo() { return this.clientInfo; }

  // --- Operation Tracking ---
  startOperation(sessionId: string, operationId: string): AbortController {
    const ac = new AbortController();
    this.activeOperations.set(`${sessionId}:${operationId}`, ac);
    return ac;
  }
  cancelOperation(sessionId: string, operationId?: string): boolean {
    if (operationId) {
      const key = `${sessionId}:${operationId}`;
      const ac = this.activeOperations.get(key);
      if (ac) { ac.abort(); this.activeOperations.delete(key); return true; }
      return false;
    }
    // cancel all for session
    let any = false;
    for (const [key, ac] of this.activeOperations.entries()) {
      if (key.startsWith(sessionId + ':')) { ac.abort(); this.activeOperations.delete(key); any = true; }
    }
    return any;
  }
  completeOperation(sessionId: string, operationId: string): void {
    this.activeOperations.delete(`${sessionId}:${operationId}`);
  }
  hasActiveOperations(sessionId: string): boolean {
    for (const key of this.activeOperations.keys()) { if (key.startsWith(sessionId + ':')) return true; }
    return false;
  }
  getActiveOperationCount(sessionId: string): number {
    let c = 0; for (const key of this.activeOperations.keys()) { if (key.startsWith(sessionId + ':')) c++; } return c;
  }

  // --- Internal Detection ---
  private detectEnvironment(): Record<string, unknown> {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      containerized: this.isContainerized(),
      workingDirectory: process.cwd(),
      runtimeMode: process.env.ACP_MODE || 'auto',
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasGitHubToken: !!process.env.GITHUB_TOKEN,
      uptime: process.uptime(),
    };
  }

  private detectCapabilities(): AgentCapabilities {
    const base: AgentCapabilities = {
      editWorkspace: true,
      filesRead: true,
      filesWrite: true,
      sessionPersistence: true,
      streamingUpdates: true,
      githubIntegration: true,
      supportsImages: false,
      supportsAudio: false,
    } as AgentCapabilities;
    if (process.env.ANTHROPIC_API_KEY) {
      // Potentially toggle advanced capabilities later
    }
    return base;
  }

  private isContainerized(): boolean {
    try {
      if (fs.existsSync('/.dockerenv')) return true;
      const cgroup = '/proc/1/cgroup';
      if (fs.existsSync(cgroup)) {
        const content = fs.readFileSync(cgroup, 'utf8');
        return /docker|kubepods|containerd/i.test(content);
      }
    } catch {}
    return false;
  }
}

export const acpState = new ACPState();
export default acpState;
