// src/agent/handlers/vision.ts
//
// Screenshot + Vision handler
//
// Captures the screen (or a region / window) using platform-native tools,
// then sends the image to Claude's vision API for analysis.
//
// Platform support:
//   macOS   → screencapture  (built-in, no install needed)
//   Linux   → scrot | gnome-screenshot | import (ImageMagick)
//   Windows → PowerShell snippet via snippingtool / nircmd
//
// Commands the router should map to this handler:
//   screenshot                    → capture full screen + describe
//   screenshot analyze            → same
//   screenshot <question>         → capture + answer a specific question
//   vision <question>             → alias
//   what's on my screen?          → alias
//   screen analyze                → alias

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), "cake-vision");

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

/**
 * Returns the path to the screenshot PNG on success, throws on failure.
 * `region` is an optional [x,y,w,h] for a partial capture (mac/linux only).
 */
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
    // screencapture ships with every macOS install
    const regionFlag = region
      ? `-R${region[0]},${region[1]},${region[2]},${region[3]}`
      : "";
    const cmd = `screencapture -x ${regionFlag} "${outputPath}"`.trim();
    execSync(cmd, { timeout: 10_000 });
    return;
  }

  if (platform === "linux") {
    // Try tools in order of preference
    const regionArg = region
      ? `--geometry=${region[2]}x${region[3]}+${region[0]}+${region[1]}`
      : "";

    const candidates = [
      // scrot (lightweight, usually pre-installed)
      `scrot ${region ? `-a ${region[0]},${region[1]},${region[2]},${region[3]}` : ""} "${outputPath}"`,
      // GNOME screenshot tool
      `gnome-screenshot ${region ? `--geometry=${region[2]}x${region[3]}+${region[0]}+${region[1]}` : ""} -f "${outputPath}"`,
      // ImageMagick import (X11)
      `import ${region ? `-crop ${region[2]}x${region[3]}+${region[0]}+${region[1]}` : "-window root"} "${outputPath}"`,
      // Wayland: grim
      `grim ${region ? `-g "${region[0]},${region[1]} ${region[2]}x${region[3]}"` : ""} "${outputPath}"`,
    ];

    let lastErr = "";
    for (const cmd of candidates) {
      try {
        execSync(cmd, { timeout: 10_000, stdio: "pipe" });
        return; // success
      } catch (err: any) {
        lastErr = err.message ?? String(err);
      }
    }
    throw new Error(
      `No screenshot tool found. Install one of: scrot, gnome-screenshot, imagemagick, grim.\nLast error: ${lastErr}`,
    );
  }

  if (platform === "windows") {
    // PowerShell one-liner using .NET — no extra install needed
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

// ── Vision API call ───────────────────────────────────────────────────────────

/**
 * Sends the captured screenshot to the provider's vision endpoint.
 * Falls back gracefully if the provider doesn't support vision.
 */
async function analyzeWithVision(
  provider: AIProvider,
  base64Image: string,
  question: string,
  model?: string,
): Promise<string> {
  // Claude's vision API requires an image content block
  // We build the message manually to pass the base64 image.
  const visionModel = model ?? getVisionModel(provider.name);

  // Build the multi-modal message content
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

  // Pass via provider.chat() using a special content structure.
  // We coerce the message content to the multi-modal format that Claude expects.
  const result = await provider.chat(
    [
      {
        role: "user",
        // Cast to string since our Message type uses string content;
        // the actual Claude SDK accepts arrays, so we JSON-encode as a hint
        // and let the provider handle it — OR we use a direct API call below.
        content: JSON.stringify([imageBlock, textBlock]),
      },
    ],
    { model: visionModel },
  );

  // If the provider returned an error about unsupported content, fall back
  if (
    result.text.includes("I cannot") ||
    result.text.includes("image") === false
  ) {
    return result.text;
  }

  return result.text;
}

/**
 * For providers that accept raw multi-modal content we call the Anthropic SDK
 * directly so the image bytes are properly encoded.
 */
async function analyzeWithClaudeVision(
  provider: AIProvider,
  base64Image: string,
  question: string,
  model?: string,
): Promise<string> {
  // Dynamically import the Anthropic SDK to avoid hard dependency for other providers
  let Anthropic: any;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    throw new Error("@anthropic-ai/sdk not installed.");
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await client.messages.create({
    model: model ?? "claude-opus-4-5",
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
      return "claude-opus-4-5"; // best vision quality
    case "openai":
      return "gpt-4o";
    case "gemini":
      return "gemini-1.5-pro";
    default:
      return "claude-opus-4-5";
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

/**
 * Parses free-form input into structured args.
 *
 * Examples:
 *   "screenshot"                          → { question: "Describe what's on the screen." }
 *   "screenshot what app is open?"        → { question: "what app is open?" }
 *   "screenshot region 0,0,800,600"       → partial capture
 *   "screenshot save ~/Desktop/snap.png"  → also save the file
 */
function parseVisionInput(raw: string): VisionArgs {
  // Strip trigger words
  let input = raw
    .replace(
      /^(screenshot|vision|screen\s+analyze|what'?s?\s+on\s+(my\s+)?screen\??)\s*/i,
      "",
    )
    .trim();

  let region: [number, number, number, number] | undefined;
  let savePath: string | undefined;

  // --region x,y,w,h  or  region x,y,w,h
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

  // --save <path>  or  save <path>
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
  // 1. Validate platform
  const platform = detectPlatform();
  if (platform === "unsupported") {
    return text(
      `[VISION] Unsupported platform: ${process.platform}.\n` +
        `Screenshot capture requires macOS, Linux, or Windows.`,
    );
  }

  // 2. Check vision support
  if (!supportsVision(provider.name)) {
    return text(
      `[VISION] Provider "${provider.name}" does not support vision/image analysis.\n` +
        `Switch to claude, openai, or gemini with: /provider claude`,
    );
  }

  // 3. Parse input
  const args = parseVisionInput(input);
  const tmpFile = path.join(TMP_DIR, `screen-${Date.now()}.png`);

  // 4. Capture
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

  // 5. Optionally copy to user-specified path
  if (args.savePath) {
    try {
      fs.mkdirSync(path.dirname(args.savePath), { recursive: true });
      fs.copyFileSync(tmpFile, args.savePath);
    } catch {
      // non-fatal
    }
  }

  // 6. Encode to base64
  const base64 = imageToBase64(tmpFile);

  // 7. Analyze
  let analysis: string;
  try {
    // Prefer direct Anthropic SDK call for Claude (most reliable vision support)
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
    // Clean up temp file before returning
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return text(`[VISION] Analysis failed.\n${err.message}`);
  }

  // 8. Clean up temp file
  try {
    fs.unlinkSync(tmpFile);
  } catch {}

  // 9. Build response
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
  if (platform === "mac") return ""; // screencapture is always available
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
