// Generic ACP Agent for Client-Server Architecture
// Adapted from Zed's implementation for generic agent-to-agent communication

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
  TerminalHandle,
  TerminalOutputResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@zed-industries/agent-client-protocol";
import {
  McpServerConfig,
  Options,
  PermissionMode,
  Query,
  query,
  SDKAssistantMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-code";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { v7 as uuidv7 } from "uuid";
import { nodeToWebReadable, nodeToWebWritable, Pushable, unreachable } from "./zed-utils.js";
import { SessionNotification } from "@zed-industries/agent-client-protocol";
import { toolInfoFromToolUse, planEntries, toolUpdateFromToolResult } from "./zed-tools.js";
import { AddressInfo } from "node:net";
import { createMcpServer, toolNames } from "./zed-mcp-server.js";

type Session = {
  query: Query;
  input: Pushable<SDKUserMessage>;
  cancelled: boolean;
  permissionMode: PermissionMode;
  clientId?: string; // Track which client this session belongs to
};

type BackgroundTerminal =
  | {
      handle: TerminalHandle;
      status: "started";
      lastOutput: TerminalOutputResponse | null;
    }
  | {
      status: "aborted" | "exited" | "killed" | "timedOut";
      pendingOutput: TerminalOutputResponse;
    };

type ToolUseCache = {
  [key: string]: { type: "tool_use"; id: string; name: string; input: any };
};

// Generic ACP Agent for Client-Server Architecture
export class GenericClaudeAcpAgent implements Agent {
  sessions: {
    [key: string]: Session;
  };
  client: AgentSideConnection;
  toolUseCache: ToolUseCache;
  fileContentCache: { [key: string]: string };
  backgroundTerminals: { [key: string]: BackgroundTerminal } = {};
  clientCapabilities?: ClientCapabilities;
  private authRequired: boolean = false;

  constructor(client: AgentSideConnection, options: { requireAuth?: boolean } = {}) {
    this.sessions = {};
    this.client = client;
    this.toolUseCache = {};
    this.fileContentCache = {};
    this.authRequired = options.requireAuth ?? false;
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
          sse: true,
        },
      },
      authMethods: this.authRequired ? [
        {
          description: "Provide API key or authentication token",
          name: "Client Authentication",
          id: "client-auth",
        },
      ] : [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    // Skip Zed-specific authentication checks for generic clients
    if (this.authRequired && !process.env.ANTHROPIC_API_KEY) {
      throw RequestError.authRequired();
    }

    const sessionId = uuidv7();
    const input = new Pushable<SDKUserMessage>();

    // Setup MCP servers from client-provided configuration
    const mcpServers: Record<string, McpServerConfig> = {};
    if (Array.isArray(params.mcpServers)) {
      for (const server of params.mcpServers) {
        if ("type" in server) {
          mcpServers[server.name] = {
            type: server.type,
            url: server.url,
            headers: server.headers
              ? Object.fromEntries(server.headers.map((e) => [e.name, e.value]))
              : undefined,
          };
        } else {
          mcpServers[server.name] = {
            type: "stdio",
            command: server.command,
            args: server.args,
            env: server.env
              ? Object.fromEntries(server.env.map((e) => [e.name, e.value]))
              : undefined,
          };
        }
      }
    }

    // Create internal MCP server for container capabilities
    const server = await createMcpServer(this, sessionId, this.clientCapabilities);
    const address = server.address() as AddressInfo;
    mcpServers["container"] = {
      type: "http",
      url: "http://127.0.0.1:" + address.port + "/mcp",
      headers: {
        "x-acp-proxy-session-id": sessionId,
      },
    };

    const options: Options = {
      cwd: params.cwd || process.cwd(),
      mcpServers,
      permissionPromptToolName: toolNames.permission, // This maps to mcp__container__permission
      stderr: (err) => console.error(`[CLAUDE] ${err}`),
      executable: process.execPath as any,
    };

    // Configure tools based on client capabilities
    const allowedTools = [];
    const disallowedTools = [];
    
    // Always allow container tools
    allowedTools.push(toolNames.read, toolNames.write);
    
    if (this.clientCapabilities?.fs?.readTextFile) {
      allowedTools.push(toolNames.read);
      disallowedTools.push("Read");
    }
    if (this.clientCapabilities?.fs?.writeTextFile) {
      allowedTools.push(toolNames.write);
      disallowedTools.push("Write", "Edit", "MultiEdit");
    }
    if (this.clientCapabilities?.terminal) {
      allowedTools.push(toolNames.bashOutput, toolNames.killBash);
      disallowedTools.push("Bash", "BashOutput", "KillBash");
    }

    if (allowedTools.length > 0) {
      options.allowedTools = allowedTools;
    }
    if (disallowedTools.length > 0) {
      options.disallowedTools = disallowedTools;
    }

    const q = query({
      prompt: input,
      options,
    });
    
    this.sessions[sessionId] = {
      query: q,
      input: input,
      cancelled: false,
      permissionMode: "default",
    };

    // Get available commands and notify client
    getAvailableSlashCommands(q).then((availableCommands) => {
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands,
        },
      });
    });

    return {
      sessionId,
      modes: {
        currentModeId: "default",
        availableModes: [
          {
            id: "default",
            name: "Always Ask",
            description: "Prompts for permission on first use of each tool",
          },
          {
            id: "acceptEdits",
            name: "Accept Edits",
            description: "Automatically accepts file edit permissions for the session",
          },
          {
            id: "bypassPermissions",
            name: "Bypass Permissions",
            description: "Skips all permission prompts",
          },
          {
            id: "plan",
            name: "Plan Mode",
            description: "Claude can analyze but not modify files or execute commands",
          },
        ],
      },
    };
  }

  async authenticate(params: AuthenticateRequest): Promise<void> {
    // Generic authentication - could be API key, token, etc.
    if (params.methodId === "client-auth") {
      // For now, just verify that ANTHROPIC_API_KEY is present
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY required for authentication");
      }
    } else {
      throw new Error("Unsupported authentication method");
    }
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    if (!this.sessions[params.sessionId]) {
      throw new Error("Session not found");
    }

    this.sessions[params.sessionId].cancelled = false;

    const { query, input } = this.sessions[params.sessionId];

    input.push(promptToClaude(params));
    while (true) {
      const { value: message, done } = await query.next();
      if (done || !message) {
        if (this.sessions[params.sessionId].cancelled) {
          return { stopReason: "cancelled" };
        }
        break;
      }
      switch (message.type) {
        case "system":
          break;
        case "result": {
          if (this.sessions[params.sessionId].cancelled) {
            return { stopReason: "cancelled" };
          }

          switch (message.subtype) {
            case "success": {
              // Check for authentication required messages
              if (message.result.includes("Please run /login") || 
                  message.result.includes("ANTHROPIC_API_KEY")) {
                throw RequestError.authRequired();
              }
              return { stopReason: "end_turn" };
            }
            case "error_during_execution":
              return { stopReason: "refusal" };
            case "error_max_turns":
              return { stopReason: "max_turn_requests" };
            default:
              return { stopReason: "refusal" };
          }
        }
        case "user":
        case "assistant": {
          if (this.sessions[params.sessionId].cancelled) {
            continue;
          }

          // Handle command outputs
          if (
            typeof message.message.content === "string" &&
            message.message.content.includes("<local-command-stdout>")
          ) {
            console.log(message.message.content);
            break;
          }

          if (
            typeof message.message.content === "string" &&
            message.message.content.includes("<local-command-stderr>")
          ) {
            console.error(message.message.content);
            break;
          }

          // Send notifications to client
          for (const notification of toAcpNotifications(
            message,
            params.sessionId,
            this.toolUseCache,
            this.fileContentCache,
          )) {
            await this.client.sessionUpdate(notification);
          }
          break;
        }
        default:
          unreachable(message as never);
      }
    }
    throw new Error("Session did not end in result");
  }

  async cancel(params: CancelNotification): Promise<void> {
    if (!this.sessions[params.sessionId]) {
      throw new Error("Session not found");
    }
    this.sessions[params.sessionId].cancelled = true;
    await this.sessions[params.sessionId].query.interrupt();
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    if (!this.sessions[params.sessionId]) {
      throw new Error("Session not found");
    }

    switch (params.modeId) {
      case "default":
      case "acceptEdits":
      case "plan":
        this.sessions[params.sessionId].permissionMode = params.modeId;
        await this.sessions[params.sessionId].query.setPermissionMode(params.modeId);
        return {};
      case "bypassPermissions":
        this.sessions[params.sessionId].permissionMode = "bypassPermissions";
        await this.sessions[params.sessionId].query.setPermissionMode("acceptEdits");
        return {};
      default:
        throw new Error("Invalid mode");
    }
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const response = await this.client.readTextFile(params);
    if (!params.limit && !params.line) {
      this.fileContentCache[params.path] = response.content;
    }
    return response;
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const response = await this.client.writeTextFile(params);
    this.fileContentCache[params.path] = params.content;
    return response;
  }
}

// Rest of the functions remain the same...
async function getAvailableSlashCommands(query: Query): Promise<AvailableCommand[]> {
  // Try to get commands, fallback to empty array if not available
  try {
    const commands = await (query as any).supportedCommands();
    return commands
      .map((command: any) => {
        const input = command.argumentHint ? { hint: command.argumentHint } : null;
        return {
          name: command.name,
          description: command.description || "",
          input,
        };
      })
      .filter(
        (command: AvailableCommand) =>
          !command.name.match(/\(MCP\)/)
      );
  } catch (error) {
    console.warn("supportedCommands not available in SDK, returning empty array");
    return [];
  }
}

function formatUriAsLink(uri: string): string {
  try {
    if (uri.startsWith("file://")) {
      const path = uri.slice(7);
      const name = path.split("/").pop() || path;
      return `[@${name}](${uri})`;
    } else if (uri.startsWith("http://") || uri.startsWith("https://")) {
      return uri;
    }
    return uri;
  } catch {
    return uri;
  }
}

function promptToClaude(prompt: PromptRequest): SDKUserMessage {
  const content: any[] = [];
  const context: any[] = [];

  for (const chunk of prompt.prompt) {
    switch (chunk.type) {
      case "text":
        content.push({ type: "text", text: chunk.text });
        break;
      case "resource_link": {
        const formattedUri = formatUriAsLink(chunk.uri);
        content.push({
          type: "text",
          text: formattedUri,
        });
        break;
      }
      case "resource": {
        if ("text" in chunk.resource) {
          const formattedUri = formatUriAsLink(chunk.resource.uri);
          content.push({
            type: "text",
            text: formattedUri,
          });
          context.push({
            type: "text",
            text: `\n<context ref="${chunk.resource.uri}">\n${chunk.resource.text}\n</context>`,
          });
        }
        break;
      }
      case "image":
        if (chunk.data) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              data: chunk.data,
              media_type: chunk.mimeType,
            },
          });
        } else if (chunk.uri && chunk.uri.startsWith("http")) {
          content.push({
            type: "image",
            source: {
              type: "url",
              url: chunk.uri,
            },
          });
        }
        break;
      default:
        break;
    }
  }

  content.push(...context);

  return {
    type: "user",
    message: {
      role: "user",
      content: content,
    },
    session_id: prompt.sessionId,
    parent_tool_use_id: null,
  };
}

export function toAcpNotifications(
  message: SDKAssistantMessage | SDKUserMessage,
  sessionId: string,
  toolUseCache: ToolUseCache,
  fileContentCache: { [key: string]: string },
): SessionNotification[] {
  const chunks = message.message.content as ContentChunk[];
  const output = [];
  
  for (const chunk of chunks) {
    let update: SessionNotification["update"] | null = null;
    switch (chunk.type) {
      case "text":
        update = {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: chunk.text,
          },
        };
        break;
      case "image":
        update = {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "image",
            data: chunk.source.type === "base64" ? chunk.source.data : "",
            mimeType: chunk.source.type === "base64" ? chunk.source.media_type : "",
            uri: chunk.source.type === "url" ? chunk.source.url : undefined,
          },
        };
        break;
      case "thinking":
        update = {
          sessionUpdate: "agent_thought_chunk",
          content: {
            type: "text",
            text: chunk.thinking,
          },
        };
        break;
      case "tool_use":
        toolUseCache[chunk.id] = chunk;
        if (chunk.name === "TodoWrite") {
          update = {
            sessionUpdate: "plan",
            entries: planEntries(chunk.input),
          };
        } else {
          update = {
            toolCallId: chunk.id,
            sessionUpdate: "tool_call",
            rawInput: chunk.input,
            status: "pending",
            ...toolInfoFromToolUse(chunk, fileContentCache),
          };
        }
        break;

      case "tool_result": {
        const toolUse = toolUseCache[chunk.tool_use_id];
        if (!toolUse) {
          console.error(
            `[claude-acp] Got a tool result for tool use that wasn't tracked: ${chunk.tool_use_id}`,
          );
          break;
        }

        if (toolUse.name !== "TodoWrite") {
          update = {
            toolCallId: chunk.tool_use_id,
            sessionUpdate: "tool_call_update",
            status: chunk.is_error ? "failed" : "completed",
            ...toolUpdateFromToolResult(chunk, toolUseCache[chunk.tool_use_id]),
          };
        }
        break;
      }

      default:
        console.warn("Unhandled chunk type:", chunk.type);
        break;
    }
    if (update) {
      output.push({ sessionId, update });
    }
  }

  return output;
}

// Export function to run generic ACP agent
export function runGenericAcp(options: { requireAuth?: boolean } = {}) {
  new AgentSideConnection(
    (client) => new GenericClaudeAcpAgent(client, options),
    nodeToWebWritable(process.stdout),
    nodeToWebReadable(process.stdin) as any,
  );
}

type ContentChunk =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | {
      type: "tool_result";
      content: string;
      tool_use_id: string;
      is_error: boolean;
    }
  | { type: "thinking"; thinking: string }
  | { type: "redacted_thinking" }
  | { type: "image"; source: ImageSource }
  | { type: "document" }
  | { type: "web_search_tool_result" }
  | { type: "untagged_text"; text: string };

type ImageSource =
  | { type: "base64"; data: string; media_type: string }
  | { type: "url"; url: string };