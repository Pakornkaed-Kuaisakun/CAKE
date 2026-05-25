// src/modules/mcp/registry.ts
//
// Persistent registry for MCP server configurations.
// Stored at ~/.cake/mcp-servers.json

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import type { MCPServerConfig, MCPRegistry } from "./types.js";

const REGISTRY_FILE = path.join(CAKE_DIR, "mcp-servers.json");

const EMPTY_REGISTRY: MCPRegistry = {
  servers: [],
  lastUpdated: new Date().toISOString(),
};

// ── I/O ───────────────────────────────────────────────────────────────────────

export function loadRegistry(): MCPRegistry {
  try {
    if (!fs.existsSync(REGISTRY_FILE))
      return { ...EMPTY_REGISTRY, servers: [] };
    const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MCPRegistry>;
    return {
      servers: parsed.servers ?? [],
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    };
  } catch {
    return { ...EMPTY_REGISTRY, servers: [] };
  }
}

export function saveRegistry(registry: MCPRegistry): void {
  if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
  registry.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

export function registryFilePath(): string {
  return REGISTRY_FILE;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function addServer(config: MCPServerConfig): MCPServerConfig {
  const registry = loadRegistry();

  const existing = registry.servers.findIndex((s) => s.name === config.name);
  if (existing >= 0) {
    registry.servers[existing] = config;
  } else {
    registry.servers.push(config);
  }

  saveRegistry(registry);
  return config;
}

export function removeServer(name: string): boolean {
  const registry = loadRegistry();
  const before = registry.servers.length;
  registry.servers = registry.servers.filter((s) => s.name !== name);
  if (registry.servers.length === before) return false;
  saveRegistry(registry);
  return true;
}

export function getServer(name: string): MCPServerConfig | null {
  const registry = loadRegistry();
  return registry.servers.find((s) => s.name === name) ?? null;
}

export function listServers(): MCPServerConfig[] {
  return loadRegistry().servers;
}

export function enableServer(name: string, enabled: boolean): boolean {
  const registry = loadRegistry();
  const server = registry.servers.find((s) => s.name === name);
  if (!server) return false;
  server.enabled = enabled;
  saveRegistry(registry);
  return true;
}

export function updateServer(
  name: string,
  updates: Partial<MCPServerConfig>,
): MCPServerConfig | null {
  const registry = loadRegistry();
  const idx = registry.servers.findIndex((s) => s.name === name);
  if (idx === -1) return null;
  registry.servers[idx] = { ...registry.servers[idx], ...updates };
  saveRegistry(registry);
  return registry.servers[idx];
}

// ── Built-in server templates ─────────────────────────────────────────────────

export const BUILTIN_SERVER_TEMPLATES: Record<
  string,
  Omit<MCPServerConfig, "name">
> = {
  filesystem: {
    displayName: "Filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
    enabled: true,
  },
  memory: {
    displayName: "Memory",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: true,
  },
  brave_search: {
    displayName: "Brave Search",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY ?? "" },
    enabled: !!process.env.BRAVE_API_KEY,
  },
  github: {
    displayName: "GitHub",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? "" },
    enabled: !!process.env.GITHUB_TOKEN,
  },
  sequential_thinking: {
    displayName: "Sequential Thinking",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabled: true,
  },
  postgres: {
    displayName: "PostgreSQL",
    transport: "stdio",
    command: "npx",
    args: [
      "-y",
      "@modelcontextprotocol/server-postgres",
      process.env.DATABASE_URL ?? "",
    ],
    enabled: !!process.env.DATABASE_URL,
  },
  puppeteer: {
    displayName: "Puppeteer (Browser)",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    enabled: true,
  },
  slack: {
    displayName: "Slack",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? "",
      SLACK_TEAM_ID: process.env.SLACK_TEAM_ID ?? "",
    },
    enabled: !!process.env.SLACK_BOT_TOKEN,
  },
};
