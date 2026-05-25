// src/modules/mcp/manager.ts
//
// MCPManager — singleton that manages all MCP server connections.
// Handles connect/disconnect/reconnect and exposes a unified tool-call API.

import { EventEmitter } from "events";
import { MCPClient } from "./client.js";
import { loadRegistry } from "./registry.js";
import type {
  MCPServerConfig,
  MCPServerStatus,
  MCPTool,
  MCPToolCallParams,
  MCPCallResult,
  MCPResource,
  MCPPrompt,
} from "./types.js";

export class MCPManager extends EventEmitter {
  private clients = new Map<string, MCPClient>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private initialized = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialize all enabled servers from the registry.
   * Called once at startup. Non-blocking — failed servers are logged but don't block.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const registry = loadRegistry();
    const enabled = registry.servers.filter((s) => s.enabled !== false);

    if (enabled.length === 0) return;

    const results = await Promise.allSettled(
      enabled.map((server) => this.connect(server)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const name = enabled[i].name;
        if (process.env.MCP_DEBUG === "true") {
          console.warn(`[MCP] Failed to connect "${name}": ${result.reason}`);
        }
      }
    }
  }

  /**
   * Connect to a single MCP server.
   */
  async connect(config: MCPServerConfig): Promise<void> {
    // Disconnect existing client if any
    await this.disconnect(config.name);

    const client = new MCPClient(config);

    client.on("disconnect", () => {
      this.emit("serverDisconnected", config.name);
      if (config.autoReconnect !== false) {
        this.scheduleReconnect(config);
      }
    });

    client.on("error", (err) => {
      this.emit("serverError", config.name, err);
    });

    await client.connect();
    this.clients.set(config.name, client);
    this.emit("serverConnected", config.name);
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnect(name: string): Promise<void> {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }

    const client = this.clients.get(name);
    if (client) {
      await client.disconnect().catch(() => {});
      this.clients.delete(name);
    }
  }

  /**
   * Disconnect all servers.
   */
  async disconnectAll(): Promise<void> {
    for (const name of this.clients.keys()) {
      await this.disconnect(name);
    }
  }

  /**
   * Reconnect a server (disconnect + connect).
   */
  async reconnect(name: string): Promise<void> {
    const registry = loadRegistry();
    const config = registry.servers.find((s) => s.name === name);
    if (!config) throw new Error(`Server "${name}" not found in registry`);

    await this.disconnect(name);
    await this.connect(config);
  }

  private scheduleReconnect(config: MCPServerConfig): void {
    // Exponential backoff: 5s, 10s, 20s, max 60s
    const delay = Math.min(60_000, 5_000);
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(config.name);
      try {
        await this.connect(config);
      } catch {
        if (config.autoReconnect !== false) {
          this.scheduleReconnect(config);
        }
      }
    }, delay);

    this.reconnectTimers.set(config.name, timer);
  }

  // ── Tool Discovery ─────────────────────────────────────────────────────────

  /**
   * Get all available tools across all connected servers.
   */
  getAllTools(): Array<{ server: string; tool: MCPTool }> {
    const result: Array<{ server: string; tool: MCPTool }> = [];
    for (const [name, client] of this.clients) {
      if (!client.connected) continue;
      for (const tool of client.tools) {
        result.push({ server: name, tool });
      }
    }
    return result;
  }

  /**
   * Find which server has a specific tool.
   */
  findTool(toolName: string): { client: MCPClient; tool: MCPTool } | null {
    for (const [, client] of this.clients) {
      if (!client.connected) continue;
      const tool = client.tools.find((t) => t.name === toolName);
      if (tool) return { client, tool };
    }
    return null;
  }

  /**
   * Find tools by fuzzy name match.
   */
  searchTools(query: string): Array<{ server: string; tool: MCPTool }> {
    const lower = query.toLowerCase();
    return this.getAllTools().filter(
      ({ tool }) =>
        tool.name.toLowerCase().includes(lower) ||
        tool.description.toLowerCase().includes(lower),
    );
  }

  // ── Tool Execution ─────────────────────────────────────────────────────────

  /**
   * Call a tool by name. Automatically routes to the correct server.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown> = {},
    serverName?: string,
  ): Promise<MCPCallResult> {
    const t0 = Date.now();

    let client: MCPClient;
    let found: { client: MCPClient; tool: MCPTool } | null = null;

    if (serverName) {
      const c = this.clients.get(serverName);
      if (!c) throw new Error(`MCP server "${serverName}" not connected`);
      const tool = c.tools.find((t) => t.name === toolName);
      if (!tool)
        throw new Error(
          `Tool "${toolName}" not found on server "${serverName}"`,
        );
      found = { client: c, tool };
    } else {
      found = this.findTool(toolName);
    }

    if (!found) {
      throw new Error(
        `MCP tool "${toolName}" not found. Connected servers: ${[...this.clients.keys()].join(", ") || "none"}`,
      );
    }

    const params: MCPToolCallParams = {
      name: toolName,
      arguments: args,
    };

    const result = await found.client.callTool(params);

    // Flatten content to string
    const content = result.content
      .map((c) => {
        if (c.type === "text") return c.text;
        if (c.type === "image") return `[Image: ${c.mimeType}]`;
        if (c.type === "resource")
          return c.resource.text ?? `[Resource: ${c.resource.uri}]`;
        return "";
      })
      .join("\n");

    return {
      serverName: found.client.name,
      toolName,
      content,
      isError: result.isError ?? false,
      durationMs: Date.now() - t0,
    };
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  getAllResources(): Array<{ server: string; resource: MCPResource }> {
    const result: Array<{ server: string; resource: MCPResource }> = [];
    for (const [name, client] of this.clients) {
      if (!client.connected) continue;
      for (const resource of client.resources) {
        result.push({ server: name, resource });
      }
    }
    return result;
  }

  async readResource(uri: string): Promise<string> {
    // Find which server has this resource
    for (const [, client] of this.clients) {
      if (!client.connected) continue;
      const res = client.resources.find((r) => r.uri === uri);
      if (res) {
        const contents = await client.readResource(uri);
        return contents.map((c) => c.text ?? c.blob ?? "").join("\n");
      }
    }
    throw new Error(`Resource "${uri}" not found on any connected MCP server`);
  }

  // ── Prompts ────────────────────────────────────────────────────────────────

  getAllPrompts(): Array<{ server: string; prompt: MCPPrompt }> {
    const result: Array<{ server: string; prompt: MCPPrompt }> = [];
    for (const [name, client] of this.clients) {
      if (!client.connected) continue;
      for (const prompt of client.prompts) {
        result.push({ server: name, prompt });
      }
    }
    return result;
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(): MCPServerStatus[] {
    const registry = loadRegistry();
    const statuses: MCPServerStatus[] = [];

    // Include all registry entries (connected or not)
    for (const config of registry.servers) {
      const client = this.clients.get(config.name);
      statuses.push({
        name: config.name,
        connected: client?.connected ?? false,
        tools: client?.tools ?? [],
        resources: client?.resources ?? [],
        prompts: client?.prompts ?? [],
        serverInfo: client?.serverInfo ?? undefined,
      });
    }

    // Include any connected servers not in registry (added dynamically)
    for (const [name, client] of this.clients) {
      if (!statuses.find((s) => s.name === name)) {
        statuses.push({
          name,
          connected: client.connected,
          tools: client.tools,
          resources: client.resources,
          prompts: client.prompts,
          serverInfo: client.serverInfo ?? undefined,
        });
      }
    }

    return statuses;
  }

  getClient(name: string): MCPClient | null {
    return this.clients.get(name) ?? null;
  }

  get connectedCount(): number {
    return [...this.clients.values()].filter((c) => c.connected).length;
  }

  get totalToolCount(): number {
    return this.getAllTools().length;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!_instance) {
    _instance = new MCPManager();
  }
  return _instance;
}

/** Reset the singleton (for testing) */
export function resetMCPManager(): void {
  _instance?.disconnectAll().catch(() => {});
  _instance = null;
}
