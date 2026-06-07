// src/agent/handlers/bash.ts
import { exec } from "child_process";
import { promisify } from "util";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import { stripVerb } from "../../shared/utils/utils.js";
import {
  guardOperation,
  classifyBashCommand,
  getPermissionLevel,
  type PermissionRequest,
  type PermissionDecision,
} from "../permissions/index.js";

const execAsync = promisify(exec);

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\S)/, // rm -rf / (root wipe)
  /mkfs/, // format disk
  /dd\s+if=.*of=\/dev\//, // dd to raw device
  /:\(\)\{.*\}/, // fork bomb
  />\s*\/dev\/sd[a-z]\b/, // write to raw disk
];

function isSafe(cmd: string): boolean {
  return !BLOCKED_PATTERNS.some((p) => p.test(cmd));
}

function extractBashCommand(input: string): string {
  return stripVerb(input, ["bash", "run", "shell", "\\$"]);
}

// ── Default ask handler (CLI readline fallback) ───────────────────────────────
// The CLI overrides this via setBashAskHandler() so Ink can render the prompt.
// Autonomous mode uses the deny-by-default fallback when no handler is set.

let _askHandler:
  | ((req: PermissionRequest) => Promise<PermissionDecision>)
  | null = null;

export function setBashAskHandler(
  fn: (req: PermissionRequest) => Promise<PermissionDecision>,
): void {
  _askHandler = fn;
}

async function defaultAskHandler(
  req: PermissionRequest,
): Promise<PermissionDecision> {
  // In non-interactive contexts (autonomous, Discord) default to deny for safety
  if (!process.stdin.isTTY) return "deny";

  // Inline readline prompt as fallback when Ink handler isn't wired yet
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  Permission required\n` +
        `   Operation : ${req.description}\n` +
        `   Detail    : ${req.detail}\n` +
        `   Allow? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y" ? "allow" : "deny");
      },
    );
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleBash(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const cmd = extractBashCommand(input);
  if (!cmd) {
    return text(
      "Usage: bash <command>\nExamples:\n bash ls -la\n bash echo hello\n $ pwd",
    );
  }

  // Hard safety block — always denied regardless of permissions
  if (!isSafe(cmd)) {
    return text(
      `⛔ Command blocked for safety reasons: "${cmd}"\nDestructive system-level commands are not allowed.`,
    );
  }

  // ── Permission check ────────────────────────────────────────────────────────
  const categories = classifyBashCommand(cmd);

  // Build a human-readable description of what the command touches
  const touchesList = categories.filter((c) => c !== "bash").join(", ");
  const description =
    touchesList.length > 0
      ? `Shell command (affects: ${touchesList})`
      : "Shell command (read-only)";

  const req: PermissionRequest = {
    category: "bash",
    description,
    detail: cmd,
  };

  const ask = _askHandler ?? defaultAskHandler;
  const guard = await guardOperation(req, ask);

  if (!guard.allowed) {
    return text(`🚫 ${guard.reason ?? "Permission denied."}`);
  }

  // ── Execute ─────────────────────────────────────────────────────────────────
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      cwd: process.cwd(),
      env: process.env,
    });
    // const output = execAsync(cmd, {
    //   encoding: "utf-8",
    //   timeout: 15_000,
    //   maxBuffer: 1024 * 1024,
    //   cwd: process.cwd(),
    //   env: process.env,
    // });
    const trimmed = stdout.trim();
    const lines = trimmed.split("\n");
    const preview =
      lines.length > 200
        ? lines.slice(0, 200).join("\n") +
          `\n… (${lines.length - 200} more lines)`
        : trimmed;
    return text(
      `[BASH] $ ${cmd}\n${"─".repeat(40)}\n${preview || "(no output)"}`,
    );
  } catch (err: any) {
    const stderr = (err.stderr ?? "").toString().trim();
    const stdout = (err.stdout ?? "").toString().trim();
    const exitCode = err.status ?? "?";

    const parts: string[] = [`[BASH] $ ${cmd}`, `Exit code: ${exitCode}`];
    if (stdout) parts.push(`stdout:\n${stdout}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);
    if (!stdout && !stderr) parts.push(err.message ?? "Unknown error");

    return text(parts.join("\n"));
  }
}
