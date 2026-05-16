// src/agent/handlers/vision.ts
//
// Screenshot + Vision handler
//
// BUG FIX: getVisionModel() and analyzeWithClaudeVision() were hardcoded to
// "claude-opus-4-5" which is an outdated / non-standard model string.
// Updated to use the current recommended model via a constant, matching the
// pattern used everywhere else in the codebase.

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), "cake-vision");

// BUG FIX: was "claude-opus-4-5" (non-existent / outdated string).
// Use the same default as ClaudeProvider.chat() for consistency.
const CLAUDE_VISION_MODEL = "claude-sonnet-4-5";

// ── Platform detection ────────────────────────────────────────────────────────

type Platform = "mac" | "linux" | "windows" | "unsupported";

function detectPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unsupported";
  }
}

// ── Capture helpers ───────────────────────────────────────────────────────────

function captureScreen(
  outputPath: string,
  region?: [number, number, number, number],
): void {
  const platform = detectPlatform();

  if (platform === "unsupported") {
    throw new Error("Screenshot capture is not supported on this platform.");
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });

  if (platform === "mac") {
    const regionFlag = region
      ? `-R${region[0]},${region[1]},${region[2]},${region[3]}`
      : "";
    const cmd = `screencapture -x ${regionFlag} "${outputPath}"`.trim();
    execSync(cmd, { timeout: 10_000 });
    return;
  }

  if (platform === "linux") {
    const candidates = [
      `scrot ${region ? `-a ${region[0]},${region[1]},${region[2]},${region[3]}` : ""} "${outputPath}"`,
      `gnome-screenshot ${region ? `--geometry=${region[2]}x${region[3]}+${region[0]}+${region[1]}` : ""} -f "${outputPath}"`,
      `import ${region ? `-crop ${region[2]}x${region[3]}+${region[0]}+${region[1]}` : "-window root"} "${outputPath}"`,
      `grim ${region ? `-g "${region[0]},${region[1]} ${region[2]}x${region[3]}"` : ""} "${outputPath}"`,
    ];

    let lastErr = "";
    for (const cmd of candidates) {
      try {
        execSync(cmd, { timeout: 10_000, stdio: "pipe" });
        return;
      } catch (err: any) {
        lastErr = err.message ?? String(err);
      }
    }
    throw new Error(
      `No screenshot tool found. Install one of: scrot, gnome-screenshot, imagemagick, grim.\nLast error: ${lastErr}`,
    );
  }

  if (platform === "windows") {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height;
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size);
$bmp.Save('${outputPath.replace(/\\/g, "\\\\")}');
$g.Dispose(); $bmp.Dispose();
`.trim();
    execSync(`powershell -Command "${ps.replace(/\n/g, " ")}"`, {
      timeout: 15_000,
    });
  }
}

// ── Image → base64 ────────────────────────────────────────────────────────────

function imageToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

// ── Vision API call (non-Claude providers) ────────────────────────────────────

async function analyzeWithVision(
  provider: AIProvider,
  base64Image: string,
  question: string,
  model?: string,
): Promise<string> {
  const visionModel = model ?? getVisionModel(provider.name);

  const imageBlock: any = {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: base64Image,
    },
  };

  const textBlock: any = {
    type: "text",
    text: question,
  };

  const result = await provider.chat(
    [
      {
        role: "user",
        content: JSON.stringify([imageBlock, textBlock]),
      },
    ],
    { model: visionModel },
  );

  return result.text;
}

// ── Vision API call (Claude — direct SDK for proper multimodal encoding) ──────

async function analyzeWithClaudeVision(
  provider: AIProvider,
  base64Image: string,
  question: string,
  model?: string,
): Promise<string> {
  let Anthropic: any;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    throw new Error("@anthropic-ai/sdk not installed.");
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // BUG FIX: was hardcoded "claude-opus-4-5"; now uses caller-supplied model
  // or falls back to the current recommended vision model constant.
  const response = await client.messages.create({
    model: model ?? CLAUDE_VISION_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64Image,
            },
          },
          {
            type: "text",
            text: question,
          },
        ],
      },
    ],
  });

  return response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}

// ── Model selection ───────────────────────────────────────────────────────────

function getVisionModel(providerName: string): string {
  switch (providerName) {
    case "claude":
      // BUG FIX: was "claude-opus-4-5" (non-existent / outdated)
      return CLAUDE_VISION_MODEL;
    case "openai":
      return "gpt-4o";
    case "gemini":
      return "gemini-1.5-pro";
    default:
      return CLAUDE_VISION_MODEL;
  }
}

function supportsVision(providerName: string): boolean {
  return ["claude", "openai", "gemini"].includes(providerName);
}

// ── Input parsing ─────────────────────────────────────────────────────────────

interface VisionArgs {
  question: string;
  region?: [number, number, number, number];
  savePath?: string;
}

function parseVisionInput(raw: string): VisionArgs {
  let input = raw
    .replace(
      /^(screenshot|vision|screen\s+analyze|what'?s?\s+on\s+(my\s+)?screen\??)\s*/i,
      "",
    )
    .trim();

  let region: [number, number, number, number] | undefined;
  let savePath: string | undefined;

  const regionMatch = input.match(/\bregion\s+(\d+),(\d+),(\d+),(\d+)/i);
  if (regionMatch) {
    region = [
      parseInt(regionMatch[1]),
      parseInt(regionMatch[2]),
      parseInt(regionMatch[3]),
      parseInt(regionMatch[4]),
    ];
    input = input.replace(regionMatch[0], "").trim();
  }

  const saveMatch = input.match(/\bsave\s+(\S+)/i);
  if (saveMatch) {
    savePath = saveMatch[1].replace(/^~/, os.homedir());
    input = input.replace(saveMatch[0], "").trim();
  }

  const question =
    input.length > 3
      ? input
      : "Describe everything visible on this screen in detail. List open applications, windows, content, and anything notable.";

  return { question, region, savePath };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleScreenshot(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const platform = detectPlatform();
  if (platform === "unsupported") {
    return text(
      `[VISION] Unsupported platform: ${process.platform}.\n` +
        `Screenshot capture requires macOS, Linux, or Windows.`,
    );
  }

  if (!supportsVision(provider.name)) {
    return text(
      `[VISION] Provider "${provider.name}" does not support vision/image analysis.\n` +
        `Switch to claude, openai, or gemini with: /provider claude`,
    );
  }

  const args = parseVisionInput(input);
  const tmpFile = path.join(TMP_DIR, `screen-${Date.now()}.png`);

  let captureMs = 0;
  try {
    const t0 = Date.now();
    captureScreen(tmpFile, args.region);
    captureMs = Date.now() - t0;
  } catch (err: any) {
    return text(
      `[VISION] Screen capture failed.\n${err.message}\n\n` +
        installHint(platform),
    );
  }

  if (!fs.existsSync(tmpFile)) {
    return text(
      `[VISION] Screenshot tool ran but produced no output at: ${tmpFile}`,
    );
  }

  const sizeKb = (fs.statSync(tmpFile).size / 1024).toFixed(1);

  if (args.savePath) {
    try {
      fs.mkdirSync(path.dirname(args.savePath), { recursive: true });
      fs.copyFileSync(tmpFile, args.savePath);
    } catch {
      // non-fatal
    }
  }

  const base64 = imageToBase64(tmpFile);

  let analysis: string;
  try {
    if (provider.name === "claude") {
      analysis = await analyzeWithClaudeVision(
        provider,
        base64,
        args.question,
        model,
      );
    } else {
      analysis = await analyzeWithVision(
        provider,
        base64,
        args.question,
        model,
      );
    }
  } catch (err: any) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return text(`[VISION] Analysis failed.\n${err.message}`);
  }

  try {
    fs.unlinkSync(tmpFile);
  } catch {}

  const header = [
    `[VISION] Screenshot captured (${sizeKb} KB, ${captureMs}ms)`,
    args.region
      ? `Region: ${args.region.join(", ")} (x, y, w, h)`
      : "Full screen",
    args.savePath ? `Saved to: ${args.savePath}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return text(`${header}\n${"─".repeat(50)}\n${analysis}`);
}

// ── Install hint ──────────────────────────────────────────────────────────────

function installHint(platform: Platform): string {
  if (platform === "mac") return "";
  if (platform === "linux") {
    return (
      "Install a screenshot tool:\n" +
      "  Ubuntu/Debian : sudo apt install scrot\n" +
      "  Wayland       : sudo apt install grim\n" +
      "  Fedora        : sudo dnf install scrot"
    );
  }
  if (platform === "windows") {
    return "Ensure PowerShell has access to System.Windows.Forms (default on Windows 10+).";
  }
  return "";
}
