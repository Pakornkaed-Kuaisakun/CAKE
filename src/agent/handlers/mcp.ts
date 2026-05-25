// src/agent/handlers/mcp.ts
//
// MCP handler — exposes MCP tools, resources, and server management
// as CAKE agent commands.
//
// Intents / commands:
//   mcp                    — show status of all MCP servers
//   mcp_list               — list all registered servers
//   mcp_connect <name>     — connect/reconnect a server
//   mcp_disconnect <name>  — disconnect a server
//   mcp_add <config>       — add a new server (JSON or template name)
//   mcp_remove <name>      — remove a server from registry
//   mcp_enable <name>      — enable a server
//   mcp_disable <name>     — disable a server
//   mcp_tools [server]     — list available tools
//   mcp_call <tool> [json] — call a tool directly
//   mcp_resources [server] — list available resources
//   mcp_read <uri>         — read a resource
//   mcp_prompts [server]   — list available prompts

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import { getMCPManager } from "../../modules/mcp/manager.js";
import {
  addServer,
  removeServer,
  enableServer,
  getServer,
  listServers,
  registryFilePath,
  BUILTIN_SERVER_TEMPLATES,
} from "../../modules/mcp/registry.js";
import type { MCPServerConfig } from "../../modules/mcp/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripVerb(input: string, verbs: string[]): string {
  for (const v of verbs) {
    const re = new RegExp(`^${v}\\s*`, "i");
    if (re.test(input)) return input.replace(re, "").trim();
  }
  return input.trim();
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── mcp (status overview) ─────────────────────────────────────────────────────

export async function handleMcp(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const manager = getMCPManager();
  const statuses = manager.getStatus();

  if (statuses.length === 0) {
    return text(
      [
        "[MCP] No servers configured.",
        "",
        "Add a server with: mcp_add <name> <transport> <command> [args...]",
        "Or use a template: mcp_add filesystem",
        "",
        `Registry: ${registryFilePath()}`,
        "",
        "Built-in templates: " +
          Object.keys(BUILTIN_SERVER_TEMPLATES).join(", "),
      ].join("\n"),
    );
  }

  const lines: string[] = [
    `[MCP] ${manager.connectedCount}/${statuses.length} servers connected · ${manager.totalToolCount} tools available`,
    `Registry: ${registryFilePath()}`,
    "─".repeat(60),
  ];

  for (const status of statuses) {
    const icon = status.connected ? "✅" : "❌";
    const toolCount = status.tools.length;
    const resCount = status.resources.length;
    const serverVer = status.serverInfo
      ? ` [${status.serverInfo.name} v${status.serverInfo.version}]`
      : "";

    lines.push(
      `${icon} ${status.name}${serverVer}`,
      `   Tools: ${toolCount} · Resources: ${resCount}`,
    );

    if (toolCount > 0) {
      const toolNames = status.tools
        .map((t) => t.name)
        .slice(0, 5)
        .join(", ");
      lines.push(
        `   ${toolNames}${toolCount > 5 ? ` +${toolCount - 5} more` : ""}`,
      );
    }

    if (status.error) {
      lines.push(`   ⚠️  ${status.error}`);
    }
  }

  lines.push(
    "",
    "Commands: mcp_tools · mcp_call <tool> · mcp_connect <name> · mcp_add <template>",
  );

  return text(lines.join("\n"));
}

// ── mcp_list ──────────────────────────────────────────────────────────────────

export async function handleMcpList(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const servers = listServers();

  if (servers.length === 0) {
    return text(
      "[MCP] No servers registered. Use: mcp_add <name> <transport> <command>",
    );
  }

  const manager = getMCPManager();
  const rows = servers.map((s, i) => {
    const client = manager.getClient(s.name);
    const connected = client?.connected ?? false;
    const icon = s.enabled === false ? "⏸️ " : connected ? "✅" : "❌";
    const transport = s.transport;
    const cmd = s.command
      ? `${s.command} ${(s.args ?? []).join(" ")}`.slice(0, 50)
      : (s.url ?? "");

    return `${String(i + 1).padStart(2)}. ${icon} ${s.name} [${transport}]\n       ${cmd}`;
  });

  return text(
    [
      `[MCP] ${servers.length} registered server${servers.length !== 1 ? "s" : ""}`,
      ...rows,
      "",
      "Manage: mcp_connect <name> · mcp_disconnect <name> · mcp_remove <name>",
    ].join("\n"),
  );
}

// ── mcp_connect ───────────────────────────────────────────────────────────────

export async function handleMcpConnect(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const name = stripVerb(input, ["mcp_connect", "mcp connect"]);

  if (!name) {
    return text("Usage: mcp_connect <server-name>");
  }

  const config = getServer(name);
  if (!config) {
    return text(
      `❌ Server "${name}" not found in registry. Use mcp_list to see registered servers.`,
    );
  }

  const manager = getMCPManager();

  try {
    await manager.connect(config);
    const client = manager.getClient(name)!;
    const toolCount = client.tools.length;

    return text(
      [
        `✅ Connected to "${name}"`,
        client.serverInfo
          ? `   Server: ${client.serverInfo.name} v${client.serverInfo.version}`
          : "",
        `   Tools available: ${toolCount}`,
        toolCount > 0
          ? `   ${client.tools
              .map((t) => t.name)
              .slice(0, 8)
              .join(", ")}${toolCount > 8 ? ` +${toolCount - 8} more` : ""}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err: any) {
    return text(`❌ Failed to connect to "${name}"\n${err.message}`);
  }
}

// ── mcp_disconnect ────────────────────────────────────────────────────────────

export async function handleMcpDisconnect(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const name = stripVerb(input, ["mcp_disconnect", "mcp disconnect"]);

  if (!name) {
    return text("Usage: mcp_disconnect <server-name>");
  }

  const manager = getMCPManager();
  await manager.disconnect(name);
  return text(`✅ Disconnected from "${name}"`);
}

// ── mcp_add ───────────────────────────────────────────────────────────────────

export async function handleMcpAdd(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["mcp_add", "mcp add"]);

  if (!raw) {
    const templates = Object.keys(BUILTIN_SERVER_TEMPLATES).join(", ");
    return text(
      [
        "Usage:",
        "  mcp_add <template-name>",
        "  mcp_add <name> stdio <command> [args...]",
        "  mcp_add <name> sse <url>",
        "  mcp_add <name> http <url>",
        "",
        `Built-in templates: ${templates}`,
        "",
        "Examples:",
        "  mcp_add filesystem",
        "  mcp_add my-server stdio node /path/to/server.js",
        "  mcp_add remote-server sse https://my-mcp-server.com",
      ].join("\n"),
    );
  }

  // Check if it's a template name (single word matching a template)
  if (!raw.includes(" ") && BUILTIN_SERVER_TEMPLATES[raw]) {
    const template = BUILTIN_SERVER_TEMPLATES[raw];
    const config: MCPServerConfig = { name: raw, ...template };
    addServer(config);

    const manager = getMCPManager();
    if (config.enabled !== false) {
      try {
        await manager.connect(config);
        const client = manager.getClient(raw)!;
        return text(
          `✅ Added and connected template "${raw}"\n   Tools: ${client.tools.length}\n   Run: mcp_tools ${raw}`,
        );
      } catch (err: any) {
        return text(
          `✅ Template "${raw}" added to registry.\n⚠️  Auto-connect failed: ${err.message}\n   Run: mcp_connect ${raw}`,
        );
      }
    }
    return text(`✅ Template "${raw}" added to registry.`);
  }

  // Parse: <name> <transport> <command/url> [args...]
  const parts = raw.split(/\s+/);
  if (parts.length < 3) {
    return text(
      "Usage: mcp_add <name> <stdio|sse|http> <command or url> [args...]\n" +
        "Example: mcp_add my-server stdio npx -y @modelcontextprotocol/server-filesystem /tmp",
    );
  }

  const [name, transport, ...rest] = parts;

  if (!["stdio", "sse", "http"].includes(transport)) {
    return text(
      `❌ Invalid transport "${transport}". Use: stdio, sse, or http`,
    );
  }

  let config: MCPServerConfig;

  if (transport === "stdio") {
    const [command, ...args] = rest;
    config = {
      name,
      transport: "stdio",
      command,
      args,
      enabled: true,
    };
  } else {
    // SSE or HTTP
    config = {
      name,
      transport: transport as "sse" | "http",
      url: rest[0],
      enabled: true,
    };
  }

  addServer(config);

  const manager = getMCPManager();
  try {
    await manager.connect(config);
    const client = manager.getClient(name)!;
    return text(
      `✅ Added and connected "${name}"\n   Tools: ${client.tools.length}`,
    );
  } catch (err: any) {
    return text(
      `✅ Server "${name}" added to registry.\n⚠️  Auto-connect failed: ${err.message}\n   Run: mcp_connect ${name}`,
    );
  }
}

// ── mcp_remove ────────────────────────────────────────────────────────────────

export async function handleMcpRemove(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const name = stripVerb(input, ["mcp_remove", "mcp remove"]);

  if (!name) return text("Usage: mcp_remove <server-name>");

  const manager = getMCPManager();
  await manager.disconnect(name);

  const removed = removeServer(name);
  if (!removed) {
    return text(`❌ Server "${name}" not found in registry.`);
  }

  return text(`🗑️  Removed MCP server "${name}" from registry.`);
}

// ── mcp_enable / mcp_disable ──────────────────────────────────────────────────

export async function handleMcpEnable(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const name = stripVerb(input, ["mcp_enable", "mcp enable"]);
  if (!name) return text("Usage: mcp_enable <server-name>");

  const ok = enableServer(name, true);
  if (!ok) return text(`❌ Server "${name}" not found.`);

  return text(`✅ Enabled server "${name}". Run: mcp_connect ${name}`);
}

export async function handleMcpDisable(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const name = stripVerb(input, ["mcp_disable", "mcp disable"]);
  if (!name) return text("Usage: mcp_disable <server-name>");

  const manager = getMCPManager();
  await manager.disconnect(name);

  const ok = enableServer(name, false);
  if (!ok) return text(`❌ Server "${name}" not found.`);

  return text(`⏸️  Disabled server "${name}".`);
}

// ── mcp_tools ─────────────────────────────────────────────────────────────────

export async function handleMcpTools(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const serverFilter = stripVerb(input, ["mcp_tools", "mcp tools"]);

  const manager = getMCPManager();
  const allTools = manager.getAllTools();

  if (allTools.length === 0) {
    return text(
      "[MCP] No tools available.\nConnect a server first: mcp_connect <name>",
    );
  }

  const filtered = serverFilter
    ? allTools.filter((t) => t.server === serverFilter)
    : allTools;

  if (filtered.length === 0) {
    return text(`[MCP] No tools found for server "${serverFilter}".`);
  }

  // Group by server
  const byServer = new Map<string, typeof filtered>();
  for (const entry of filtered) {
    const existing = byServer.get(entry.server) ?? [];
    existing.push(entry);
    byServer.set(entry.server, existing);
  }

  const lines: string[] = [
    `[MCP] ${filtered.length} tool${filtered.length !== 1 ? "s" : ""} available`,
  ];

  for (const [server, tools] of byServer) {
    lines.push("", `📡 ${server} (${tools.length} tools)`, "─".repeat(40));

    for (const { tool } of tools) {
      const required = tool.inputSchema?.required?.join(", ") ?? "";
      lines.push(
        `  ${tool.name}`,
        `    ${tool.description}`,
        required ? `    Required: ${required}` : "",
      );
    }
  }

  lines.push("", 'Call a tool: mcp_call <tool-name> {"key":"value"}');

  return text(lines.filter((l) => l !== "").join("\n"));
}

// ── mcp_call ──────────────────────────────────────────────────────────────────

export async function handleMcpCall(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["mcp_call", "mcp call"]);

  if (!raw) {
    return text(
      "Usage: mcp_call <tool-name> [json-args]\n" +
        'Example: mcp_call read_file {"path":"./README.md"}\n' +
        "         mcp_call list_directory",
    );
  }

  // Parse: <tool-name> [json-args]
  const spaceIdx = raw.search(/\s/);
  let toolName: string;
  let argsStr: string;

  if (spaceIdx === -1) {
    toolName = raw;
    argsStr = "{}";
  } else {
    toolName = raw.slice(0, spaceIdx);
    argsStr = raw.slice(spaceIdx + 1).trim();
  }

  let args: Record<string, unknown> = {};
  if (argsStr && argsStr !== "{}") {
    try {
      args = JSON.parse(argsStr);
    } catch {
      // Try treating remainder as a plain string argument
      args = { input: argsStr };
    }
  }

  const manager = getMCPManager();

  try {
    const result = await manager.callTool(toolName, args);
    const status = result.isError ? "⚠️  Error" : "✅";

    return text(
      [
        `[MCP] ${status} ${toolName} (${result.serverName}, ${formatDuration(result.durationMs)})`,
        "─".repeat(50),
        result.content,
      ].join("\n"),
    );
  } catch (err: any) {
    return text(`[MCP] ❌ Failed to call tool "${toolName}"\n${err.message}`);
  }
}

// ── mcp_resources ─────────────────────────────────────────────────────────────

export async function handleMcpResources(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const serverFilter = stripVerb(input, ["mcp_resources", "mcp resources"]);

  const manager = getMCPManager();
  const allResources = manager.getAllResources();

  if (allResources.length === 0) {
    return text("[MCP] No resources available.");
  }

  const filtered = serverFilter
    ? allResources.filter((r) => r.server === serverFilter)
    : allResources;

  const lines = [
    `[MCP] ${filtered.length} resource${filtered.length !== 1 ? "s" : ""} available`,
  ];

  for (const { server, resource } of filtered) {
    lines.push(
      `  [${server}] ${resource.name}`,
      `    URI: ${resource.uri}`,
      resource.description ? `    ${resource.description}` : "",
    );
  }

  lines.push("", "Read a resource: mcp_read <uri>");

  return text(lines.filter((l) => l !== "").join("\n"));
}

// ── mcp_read ──────────────────────────────────────────────────────────────────

export async function handleMcpRead(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const uri = stripVerb(input, ["mcp_read", "mcp read"]);

  if (!uri) return text("Usage: mcp_read <resource-uri>");

  const manager = getMCPManager();

  try {
    const content = await manager.readResource(uri);
    return text(`[MCP] Resource: ${uri}\n${"─".repeat(40)}\n${content}`);
  } catch (err: any) {
    return text(`[MCP] ❌ Failed to read resource "${uri}"\n${err.message}`);
  }
}

// ── mcp_prompts ───────────────────────────────────────────────────────────────

export async function handleMcpPrompts(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const serverFilter = stripVerb(input, ["mcp_prompts", "mcp prompts"]);

  const manager = getMCPManager();
  const allPrompts = manager.getAllPrompts();

  if (allPrompts.length === 0) {
    return text("[MCP] No prompts available.");
  }

  const filtered = serverFilter
    ? allPrompts.filter((p) => p.server === serverFilter)
    : allPrompts;

  const lines = [
    `[MCP] ${filtered.length} prompt${filtered.length !== 1 ? "s" : ""} available`,
  ];

  for (const { server, prompt } of filtered) {
    const args = prompt.arguments
      ?.map((a) => `${a.name}${a.required ? "*" : ""}`)
      .join(", ");
    lines.push(
      `  [${server}] ${prompt.name}`,
      prompt.description ? `    ${prompt.description}` : "",
      args ? `    Args: ${args}` : "",
    );
  }

  return text(lines.filter((l) => l !== "").join("\n"));
}
