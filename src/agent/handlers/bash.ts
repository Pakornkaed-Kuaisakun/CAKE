import { execSync, spawn } from "child_process";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";

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

/**
 * Extracts the shell command from user input.
 * Handles forms like:
 *   bash ls -la
 *   run ls -la
 *   shell echo hello
 *   $ ls -la
 */
function extractBashCommand(input: string): string {
  return input.replace(/^(bash|run|shell|\$)\s+/i, "").trim();
}

export async function handleBash(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const cmd = extractBashCommand(input);
  if (!cmd) {
    return text(
      "Usage: bash <command> \nExamples:\n bash ls -la\n bash echo hello\n $ pwd",
    );
  }

  if (!isSafe(cmd)) {
    return text(
      `⛔ Command blocked for safety reasons: "${cmd}"\nDestructive system-level commands are not allowed.`,
    );
  }

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 15_000, // 15 seconds hard limit
      maxBuffer: 1024 * 1024, // 1 MB output cap
      cwd: process.cwd(),
      env: process.env,
    });

    const trimmed = output.trim();
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
    // execSync throws on non-zero exit; stderr is in err.stderr
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
