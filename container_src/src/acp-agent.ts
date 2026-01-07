/**
 * Lightweight ACP Agent based on Zed's pattern
 * Supports both local ACP communication and HTTP bridge mode
 */

import {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AvailableCommand,
  CancelNotification,
  ClientCapabilities,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestError,
  SetSessionModeRequest,
  SetSessionModeResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@zed-industries/agent-client-protocol';
import {
  McpServerConfig,
  Options,
  PermissionMode,
  Query,
  query,
  SDKAssistantMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-code';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { v7 as uuidv7 } from 'uuid';
import {
  nodeToWebReadable,
  nodeToWebWritable,
  Pushable,
  unreachable,
} from './utils.js';
import {
  toolInfoFromToolUse,
  toolUpdateFromToolResult,
  planEntries,
} from './tools.js';

type Session = {
  query: Query;
  input: Pushable<SDKUserMessage>;
  cancelled: boolean;
  permissionMode: PermissionMode;
};

/**
 * Lightweight Claude ACP Agent
 * Based on Zed's implementation but optimized for our container system
 */
export class LightweightClaudeAcpAgent implements Agent {
  sessions: { [key: string]: Session };
  client: AgentSideConnection;
  clientCapabilities?: ClientCapabilities;

  constructor(client: AgentSideConnection) {
    this.sessions = {};
    this.client = client;
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    this.clientCapabilities = request.clientCapabilities;
    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {
          image: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: false,
        },
      },
      authMethods: [
        {
          description: 'Run `claude /login` in the terminal',
          name: 'Log in with Claude Code',
          id: 'claude-login',
        },
      ],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    // Extend the request type to include our custom fields
    interface ExtendedNewSessionRequest extends NewSessionRequest {
      resumeState?: {
        openFiles?: string[];
        activeFile?: string;
        terminal?: {
          cwd?: string;
        };
      };
      initialContext?: {
        contextSummary?: string;
      };
    }

    const extendedParams = params as ExtendedNewSessionRequest;

    // Check for auth requirement
    if (
      fs.existsSync(path.resolve(os.homedir(), '.claude.json.backup')) &&
      !fs.existsSync(path.resolve(os.homedir(), '.claude.json'))
    ) {
      throw RequestError.authRequired();
    }

    const sessionId = uuidv7();
    const input = new Pushable<SDKUserMessage>();

    // Handle resumeState.cwd if provided, otherwise perform default behavior
    const initialCwd = extendedParams.resumeState?.terminal?.cwd || params.cwd;

    const options: Options = {
      cwd: initialCwd,
      permissionPromptToolName: 'permission',
      stderr: (err) => console.error(err),
      executable: process.execPath as any,
    };

    const q = query({
      prompt: input,
      options,
    });

    this.sessions[sessionId] = {
      query: q,
      input: input,
      cancelled: false,
      permissionMode: 'default',
    };

    // Inject Initial Context (Summary) if available
    if (extendedParams.initialContext?.contextSummary) {
      const summary = extendedParams.initialContext.contextSummary;
      const summaryMessage: SDKUserMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `System Restoration: Previous Session Context Summary:\n${summary}\n\nPlease continue assisting the user based on this context.`,
            },
          ],
        },
        session_id: sessionId,
        parent_tool_use_id: null,
      };
      input.push(summaryMessage);
    }

    // Handle Open Files from Resume State
    if (
      extendedParams.resumeState?.openFiles &&
      extendedParams.resumeState.openFiles.length > 0
    ) {
      const files = extendedParams.resumeState.openFiles.join(', ');
      const openFilesMessage: SDKUserMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `System Restoration: The user has the following files open in their editor: ${files}. Please prioritize these files if relevant to the next request.`,
            },
          ],
        },
        session_id: sessionId,
        parent_tool_use_id: null,
      };
      input.push(openFilesMessage);
    }

    return {
      sessionId,
      modes: {
        currentModeId: 'default',
        availableModes: [
          {
            id: 'default',
            name: 'Always Ask',
            description: 'Prompts for permission on first use of each tool',
          },
          {
            id: 'acceptEdits',
            name: 'Accept Edits',
            description:
              'Automatically accepts file edit permissions for the session',
          },
          {
            id: 'bypassPermissions',
            name: 'Bypass Permissions',
            description: 'Skips all permission prompts',
          },
        ],
      },
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<void> {
    throw new Error('Authentication not implemented');
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    if (!this.sessions[params.sessionId]) {
      throw new Error('Session not found');
    }

    this.sessions[params.sessionId].cancelled = false;
    const { query, input } = this.sessions[params.sessionId];

    // Convert ACP prompt to Claude format
    const claudeMessage = this.promptToClaude(params);
    input.push(claudeMessage);

    try {
      while (true) {
        const { value: message, done } = await query.next();
        if (done || !message) {
          if (this.sessions[params.sessionId].cancelled) {
            return { stopReason: 'cancelled' };
          }
          break;
        }

        switch (message.type) {
          case 'result': {
            if (this.sessions[params.sessionId].cancelled) {
              return { stopReason: 'cancelled' };
            }

            switch (message.subtype) {
              case 'success': {
                if (message.result.includes('Please run /login')) {
                  throw RequestError.authRequired();
                }
                return { stopReason: 'end_turn' };
              }
              case 'error_during_execution':
                return { stopReason: 'refusal' };
              case 'error_max_turns':
                return { stopReason: 'max_turn_requests' };
              default:
                return { stopReason: 'refusal' };
            }
          }
          case 'assistant':
          case 'user': {
            if (this.sessions[params.sessionId].cancelled) {
              continue;
            }

            // Handle auth requirement
            if (
              message.message.model === '<synthetic>' &&
              Array.isArray(message.message.content) &&
              message.message.content.length === 1 &&
              message.message.content[0].text?.includes('Please run /login')
            ) {
              throw RequestError.authRequired();
            }

            // Send notifications to client
            const notifications = this.toAcpNotifications(
              message,
              params.sessionId,
            );
            for (const notification of notifications) {
              await this.client.sessionUpdate(notification);
            }
            break;
          }
          default:
            // Handle other message types
            break;
        }
      }
    } catch (error) {
      console.error('Prompt processing error:', error);
      return { stopReason: 'refusal' };
    }

    throw new Error('Session did not end in result');
  }

  async cancel(params: CancelNotification): Promise<void> {
    if (!this.sessions[params.sessionId]) {
      throw new Error('Session not found');
    }
    this.sessions[params.sessionId].cancelled = true;
    await this.sessions[params.sessionId].query.interrupt();
  }

  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    if (!this.sessions[params.sessionId]) {
      throw new Error('Session not found');
    }

    const validModes = ['default', 'acceptEdits', 'bypassPermissions'];
    if (!validModes.includes(params.modeId)) {
      throw new Error('Invalid mode');
    }

    this.sessions[params.sessionId].permissionMode =
      params.modeId as PermissionMode;
    await this.sessions[params.sessionId].query.setPermissionMode(
      params.modeId as PermissionMode,
    );

    return {};
  }

  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    const response = await this.client.readTextFile(params);
    return response;
  }

  async writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    const response = await this.client.writeTextFile(params);
    return response;
  }

  private promptToClaude(prompt: PromptRequest): SDKUserMessage {
    const content: any[] = [];

    for (const chunk of prompt.prompt) {
      switch (chunk.type) {
        case 'text':
          content.push({ type: 'text', text: chunk.text });
          break;
        case 'resource_link':
          content.push({ type: 'text', text: `[@${chunk.uri}](${chunk.uri})` });
          break;
        case 'resource':
          if ('text' in chunk.resource) {
            content.push({
              type: 'text',
              text: `[@${chunk.resource.uri}](${chunk.resource.uri})`,
            });
            content.push({
              type: 'text',
              text: `\n<context ref="${chunk.resource.uri}">\n${chunk.resource.text}\n</context>`,
            });
          }
          break;
        case 'image':
          if (chunk.data) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                data: chunk.data,
                media_type: chunk.mimeType,
              },
            });
          }
          break;
        default:
          break;
      }
    }

    return {
      type: 'user',
      message: {
        role: 'user',
        content: content,
      },
      session_id: prompt.sessionId,
      parent_tool_use_id: null,
    };
  }

  private toAcpNotifications(
    message: SDKAssistantMessage | SDKUserMessage,
    sessionId: string,
  ): any[] {
    const chunks = message.message.content as any[];
    const notifications = [];

    for (const chunk of chunks) {
      let update: any = null;

      switch (chunk.type) {
        case 'text':
          update = {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: chunk.text,
            },
          };
          break;
        case 'thinking':
          update = {
            sessionUpdate: 'agent_thought_chunk',
            content: {
              type: 'text',
              text: chunk.thinking,
            },
          };
          break;
        default:
          // Handle other chunk types as needed
          break;
      }

      if (update) {
        notifications.push({ sessionId, update });
      }
    }

    return notifications;
  }
}

export function runAcp(): void {
  new AgentSideConnection(
    (client) => new LightweightClaudeAcpAgent(client),
    nodeToWebWritable(process.stdout),
    nodeToWebReadable(process.stdin),
  );
}
