// src/modules/mcp/client.ts
//
// MCP Client — manages the lifecycle of a single MCP server connection.
// Handles the protocol handshake (initialize/initialized) and exposes
// typed methods for tools, resources, and prompts.

import { EventEmitter } from "events";
import { StdioTransport } from "./transport/stdio.js";
import { HttpTransport } from "./transport/http.js";
import type {
  MCPServerConfig,
  MCPServerInfo,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPToolCallParams,
  MCPToolResult,
  MCPGetPromptResult,
  MCPInitializeParams,
  MCPInitializeResult,
  JsonRpcResponse,
  MCPResourceReference,
} from "./types.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";

const CAKE_CLIENT_INFO = {
  name: "CAKE",
  version: "0.3.0",
};

export class MCPClient extends EventEmitter {
  private transport: StdioTransport | HttpTransport;
  private _tools: MCPTool[] = [];
  private _resources: MCPResource[] = [];
  private _prompts: MCPPrompt[] = [];
  private _serverInfo: MCPServerInfo | null = null;
  private _connected = false;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;

    if (config.transport === "stdio") {
      this.transport = new StdioTransport(config);
    } else {
      this.transport = new HttpTransport(config);
    }

    this.transport.on("error", (err) => this.emit("error", err));
    this.transport.on("close", () => {
      this._connected = false;
      this.emit("disconnect");
    });
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.transport.connect();
    await this.initialize();
    this._connected = true;
    this.emit("connect");
  }

  private async initialize(): Promise<void> {
    const params: MCPInitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        resources: { subscribe: false },
        prompts: {},
      },
      clientInfo: CAKE_CLIENT_INFO,
    };

    const response = await this.transport.send({
      method: "initialize",
      params: params as unknown as Record<string, unknown>,
    });

    if (response.error) {
      throw new Error(`MCP initialize failed: ${response.error.message}`);
    }

    const result = response.result as MCPInitializeResult;
    this._serverInfo = result.serverInfo;

    // Send initialized notification (required by spec)
    await this.transport.notify({ method: "notifications/initialized" });

    // Load capabilities
    await Promise.all([
      this.refreshTools(),
      this.refreshResources().catch(() => {}), // Resources are optional
      this.refreshPrompts().catch(() => {}), // Prompts are optional
    ]);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    await this.transport.disconnect();
  }

  // ── Tools ──────────────────────────────────────────────────────────────────

  async refreshTools(): Promise<MCPTool[]> {
    const response = await this.transport.send({ method: "tools/list" });

    if (response.error) {
      if (process.env.MCP_DEBUG === "true") {
        console.warn(
          `[MCP:${this.config.name}] tools/list error: ${response.error.message}`,
        );
      }
      return [];
    }

    this._tools = (response.result as any)?.tools ?? [];
    return this._tools;
  }

  async callTool(params: MCPToolCallParams): Promise<MCPToolResult> {
    if (!this._connected) {
      throw new Error(`MCP server "${this.config.name}" is not connected`);
    }

    const response = await this.transport.send({
      method: "tools/call",
      params: params as unknown as Record<string, unknown>,
    });

    if (response.error) {
      return {
        content: [
          { type: "text", text: `Tool error: ${response.error.message}` },
        ],
        isError: true,
      };
    }

    return response.result as MCPToolResult;
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  async refreshResources(): Promise<MCPResource[]> {
    const response = await this.transport.send({ method: "resources/list" });

    if (response.error) return [];

    this._resources = (response.result as any)?.resources ?? [];
    return this._resources;
  }

  async readResource(uri: string): Promise<MCPResourceReference[]> {
    const response = await this.transport.send({
      method: "resources/read",
      params: { uri },
    });

    if (response.error) {
      throw new Error(
        `Failed to read resource "${uri}": ${response.error.message}`,
      );
    }

    return (response.result as any)?.contents ?? [];
  }

  // ── Prompts ────────────────────────────────────────────────────────────────

  async refreshPrompts(): Promise<MCPPrompt[]> {
    const response = await this.transport.send({ method: "prompts/list" });

    if (response.error) return [];

    this._prompts = (response.result as any)?.prompts ?? [];
    return this._prompts;
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<MCPGetPromptResult> {
    const response = await this.transport.send({
      method: "prompts/get",
      params: { name, arguments: args ?? {} },
    });

    if (response.error) {
      throw new Error(
        `Failed to get prompt "${name}": ${response.error.message}`,
      );
    }

    return response.result as MCPGetPromptResult;
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  async setLogLevel(
    level: "debug" | "info" | "warning" | "error",
  ): Promise<void> {
    await this.transport
      .send({
        method: "logging/setLevel",
        params: { level },
      })
      .catch(() => {}); // Non-critical
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get name(): string {
    return this.config.name;
  }

  get displayName(): string {
    return this.config.displayName ?? this.config.name;
  }

  get tools(): MCPTool[] {
    return this._tools;
  }

  get resources(): MCPResource[] {
    return this._resources;
  }

  get prompts(): MCPPrompt[] {
    return this._prompts;
  }

  get serverInfo(): MCPServerInfo | null {
    return this._serverInfo;
  }

  get connected(): boolean {
    return this._connected && this.transport.isConnected();
  }

  get config_(): MCPServerConfig {
    return this.config;
  }
}
