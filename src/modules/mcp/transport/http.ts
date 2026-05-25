// src/modules/mcp/transport/http.ts
//
// HTTP transport for MCP servers (SSE + HTTP POST).
// Connects to a remote MCP server via Server-Sent Events for messages
// and HTTP POST for sending requests.

import { EventEmitter } from "events";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  MCPServerConfig,
} from "../types.js";

export class HttpTransport extends EventEmitter {
  private requestId = 1;
  private pending = new Map<
    number | string,
    {
      resolve: (v: JsonRpcResponse) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private connected = false;
  private config: MCPServerConfig;
  private sessionId: string | null = null;
  private sseController: AbortController | null = null;

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error(`No URL specified for MCP server "${this.config.name}"`);
    }

    // For SSE transport, establish a server-sent events connection
    if (this.config.transport === "sse") {
      await this.connectSSE();
    } else {
      // Plain HTTP: just verify connectivity
      this.connected = true;
    }
  }

  private async connectSSE(): Promise<void> {
    const sseUrl = `${this.config.url}/sse`;
    this.sseController = new AbortController();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`SSE connection timed out for "${this.config.name}"`));
      }, this.config.timeout ?? 10_000);

      fetch(sseUrl, {
        headers: { Accept: "text/event-stream" },
        signal: this.sseController!.signal,
      })
        .then((res) => {
          if (!res.ok) {
            clearTimeout(timeout);
            reject(
              new Error(
                `SSE connection failed: ${res.status} ${res.statusText}`,
              ),
            );
            return;
          }

          clearTimeout(timeout);
          this.connected = true;
          resolve();

          // Process SSE stream
          this.processSSEStream(res.body!).catch((err) => {
            if (!this.sseController?.signal.aborted) {
              this.emit("error", err);
            }
          });
        })
        .catch((err) => {
          clearTimeout(timeout);
          if (!this.sseController?.signal.aborted) {
            reject(err);
          }
        });
    });
  }

  private async processSSEStream(
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const msg = JSON.parse(data) as
                | JsonRpcResponse
                | JsonRpcNotification;
              this.handleMessage(msg);
            } catch {
              // Ignore parse errors
            }
          } else if (line.startsWith("id: ")) {
            this.sessionId = line.slice(4).trim();
          }
        }
      }
    } finally {
      this.connected = false;
      this.emit("close");
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in msg && msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        pending.resolve(msg as JsonRpcResponse);
      }
    } else {
      this.emit("message", msg);
    }
  }

  async send(
    request: Omit<JsonRpcRequest, "jsonrpc" | "id">,
  ): Promise<JsonRpcResponse> {
    if (!this.connected) {
      throw new Error(`MCP server "${this.config.name}" is not connected`);
    }

    const id = this.requestId++;
    const fullRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      ...request,
    };

    // For SSE transport, POST to /message endpoint
    const postUrl =
      this.config.transport === "sse"
        ? `${this.config.url}/message`
        : this.config.url!;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.timeout ?? 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request timed out: ${request.method} on "${this.config.name}"`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      fetch(postUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(fullRequest),
      })
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            clearTimeout(timer);
            this.pending.delete(id);
            reject(new Error(`HTTP ${res.status}: ${text}`));
            return;
          }

          // For plain HTTP (non-SSE), response comes directly
          if (this.config.transport === "http") {
            const json = (await res.json()) as JsonRpcResponse;
            clearTimeout(timer);
            this.pending.delete(id);
            resolve(json);
          }
          // For SSE, response comes via the SSE stream (already handled)
        })
        .catch((err) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        });
    });
  }

  async notify(
    _notification: Omit<JsonRpcNotification, "jsonrpc">,
  ): Promise<void> {
    // HTTP transport doesn't typically need client notifications
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sseController?.abort();

    for (const [, { reject: rej, timer }] of this.pending) {
      clearTimeout(timer);
      rej(new Error(`Disconnected from MCP server "${this.config.name}"`));
    }
    this.pending.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }
}
