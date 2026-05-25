// src/modules/mcp/types.ts
//
// MCP (Model Context Protocol) type definitions.
// Based on the MCP specification: https://modelcontextprotocol.io/specification

// ── JSON-RPC 2.0 Base ─────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ── MCP Protocol Types ────────────────────────────────────────────────────────

export interface MCPServerInfo {
  name: string;
  version: string;
}

export interface MCPClientInfo {
  name: string;
  version: string;
}

export interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  clientInfo: MCPClientInfo;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: MCPServerInfo;
}

// ── MCP Tool Types ────────────────────────────────────────────────────────────

export interface MCPToolInputSchema {
  type: "object";
  properties: Record<string, MCPSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface MCPSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object" | "integer";
  description?: string;
  enum?: unknown[];
  items?: MCPSchemaProperty;
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
  default?: unknown;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

// ── MCP Content Types ─────────────────────────────────────────────────────────

export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

export interface MCPTextContent {
  type: "text";
  text: string;
}

export interface MCPImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface MCPResourceContent {
  type: "resource";
  resource: MCPResourceReference;
}

// ── MCP Resource Types ────────────────────────────────────────────────────────

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceReference {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ── MCP Prompt Types ──────────────────────────────────────────────────────────

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPromptMessage {
  role: "user" | "assistant";
  content: MCPContent;
}

export interface MCPGetPromptResult {
  description?: string;
  messages: MCPPromptMessage[];
}

// ── MCP Server Connection ─────────────────────────────────────────────────────

export type MCPTransportType = "stdio" | "sse" | "http";

export interface MCPServerConfig {
  /** Unique name for this server instance */
  name: string;
  /** Human-readable display name */
  displayName?: string;
  /** Transport type */
  transport: MCPTransportType;
  /** For stdio: command to run */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For stdio: environment variables */
  env?: Record<string, string>;
  /** For SSE/HTTP: server URL */
  url?: string;
  /** Connection timeout in ms */
  timeout?: number;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Whether this server is enabled */
  enabled?: boolean;
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  error?: string;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  lastConnectedAt?: string;
  serverInfo?: MCPServerInfo;
}

// ── CAKE-specific MCP types ───────────────────────────────────────────────────

export interface MCPRegistry {
  servers: MCPServerConfig[];
  lastUpdated: string;
}

export interface MCPCallResult {
  serverName: string;
  toolName: string;
  content: string;
  isError: boolean;
  durationMs: number;
}
