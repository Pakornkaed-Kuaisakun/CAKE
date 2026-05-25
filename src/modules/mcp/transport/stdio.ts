// src/modules/mcp/transport/stdio.ts
//
// Stdio transport for MCP servers.
// Communicates with child processes via stdin/stdout using newline-delimited JSON.

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  MCPServerConfig,
} from "../types.js";

export interface TransportEvents {
  message: (msg: JsonRpcResponse | JsonRpcNotification) => void;
  error: (err: Error) => void;
  close: () => void;
}

export class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
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

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error(
        `No command specified for MCP server "${this.config.name}"`,
      );
    }

    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...(this.config.env ?? {}) };

      this.process = spawn(this.config.command!, this.config.args ?? [], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      const startupTimeout = setTimeout(() => {
        reject(new Error(`MCP server "${this.config.name}" startup timed out`));
      }, this.config.timeout ?? 10_000);

      this.process.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf-8");
        this.processBuffer();
      });

      this.process.stderr?.on("data", (chunk: Buffer) => {
        // MCP servers use stderr for logging — don't treat as errors
        const msg = chunk.toString("utf-8").trim();
        if (process.env.MCP_DEBUG === "true" && msg) {
          console.error(`[MCP:${this.config.name}] stderr: ${msg}`);
        }
      });

      this.process.on("error", (err) => {
        clearTimeout(startupTimeout);
        this.connected = false;
        this.emit("error", err);
        reject(err);
      });

      this.process.on("exit", (code) => {
        this.connected = false;
        // Reject all pending requests
        for (const [, { reject: rej, timer }] of this.pending) {
          clearTimeout(timer);
          rej(
            new Error(
              `MCP server "${this.config.name}" exited with code ${code}`,
            ),
          );
        }
        this.pending.clear();
        this.emit("close");
      });

      // Consider connected once process is spawned
      clearTimeout(startupTimeout);
      this.connected = true;
      resolve();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as
          | JsonRpcResponse
          | JsonRpcNotification;

        // Handle response (has id) vs notification (no id)
        if ("id" in msg && msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            pending.resolve(msg as JsonRpcResponse);
          }
        } else {
          // Notification
          this.emit("message", msg);
        }
      } catch (err) {
        if (process.env.MCP_DEBUG === "true") {
          console.error(
            `[MCP:${this.config.name}] Failed to parse: ${trimmed}`,
          );
        }
      }
    }
  }

  async send(
    request: Omit<JsonRpcRequest, "jsonrpc" | "id">,
  ): Promise<JsonRpcResponse> {
    if (!this.connected || !this.process?.stdin) {
      throw new Error(`MCP server "${this.config.name}" is not connected`);
    }

    const id = this.requestId++;
    const fullRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      ...request,
    };

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

      const line = JSON.stringify(fullRequest) + "\n";
      this.process!.stdin!.write(line, "utf-8", (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async notify(
    notification: Omit<JsonRpcNotification, "jsonrpc">,
  ): Promise<void> {
    if (!this.connected || !this.process?.stdin) return;

    const full: JsonRpcNotification = { jsonrpc: "2.0", ...notification };
    const line = JSON.stringify(full) + "\n";
    this.process.stdin.write(line, "utf-8");
  }

  async disconnect(): Promise<void> {
    if (!this.process) return;
    this.connected = false;

    // Cancel pending requests
    for (const [, { reject: rej, timer }] of this.pending) {
      clearTimeout(timer);
      rej(new Error(`Disconnected from MCP server "${this.config.name}"`));
    }
    this.pending.clear();

    return new Promise((resolve) => {
      this.process!.once("exit", () => resolve());
      this.process!.kill("SIGTERM");
      setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolve();
      }, 3000);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }
}
