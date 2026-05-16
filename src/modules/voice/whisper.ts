// src/modules/voice/whisper.ts
//
// Speech-to-Text — OpenAI Whisper API (primary) or local whisper.cpp (offline).
//
// Local whisper.cpp on Windows:
//   Binary : C:\ai\whisper-bin-x64\Release\whisper-cli.exe  (or anywhere on PATH)
//   Model  : C:\ai\models\ggml-base.en.bin
//   Set in .env:
//     WHISPER_CLI=C:\ai\whisper-bin-x64\Release\whisper-cli.exe
//     WHISPER_MODEL=C:\ai\models\ggml-base.en.bin

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { VoiceConfig } from "./index.js";

// ── Binary detection ──────────────────────────────────────────────────────────

type STTBackend = "openai" | "whisper-cpp" | "none";

// Common locations whisper.cpp gets installed on Windows
const WINDOWS_WHISPER_CANDIDATES = [
  process.env.WHISPER_CLI ?? "", // user-set path (highest priority)
  "C:\\ai\\whisper-bin-x64\\Release\\whisper-cli.exe",
  "C:\\ai\\whisper-bin-x64\\whisper-cli.exe",
  "C:\\ai\\whisper-cli.exe",
  "C:\\Program Files\\whisper.cpp\\whisper-cli.exe",
  "whisper-cli", // on PATH
  "whisper", // on PATH (older builds)
].filter(Boolean);

function findWhisperBinary(): string | null {
  if (process.platform === "win32") {
    for (const candidate of WINDOWS_WHISPER_CANDIDATES) {
      // If it looks like an absolute path, check if the file exists
      if (candidate.includes("\\") || candidate.includes("/")) {
        if (fs.existsSync(candidate)) return candidate;
        continue;
      }
      // Otherwise try running it
      try {
        execSync(`"${candidate}" --help`, { stdio: "pipe" });
        return candidate;
      } catch {}
    }
    return null;
  }

  // macOS / Linux
  for (const name of ["whisper-cli", "whisper"]) {
    try {
      execSync(`${name} --help`, { stdio: "pipe" });
      return name;
    } catch {}
  }
  return null;
}

function detectSTTBackend(): STTBackend {
  if (
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_API_KEY !== "YOUR_API_KEY"
  ) {
    return "openai";
  }
  if (findWhisperBinary()) return "whisper-cpp";
  return "none";
}

let _sttBackend: STTBackend | null = null;
export function getSTTBackend(): STTBackend {
  if (_sttBackend === null) _sttBackend = detectSTTBackend();
  return _sttBackend;
}

// ── Model path resolution ─────────────────────────────────────────────────────

const WINDOWS_MODEL_CANDIDATES = [
  process.env.WHISPER_MODEL ?? "", // user-set (highest priority)
  "C:\\ai\\models\\ggml-base.en.bin",
  "C:\\ai\\models\\ggml-tiny.en.bin",
  "C:\\ai\\models\\ggml-base.bin",
  "C:\\ai\\models\\ggml-tiny.bin",
].filter(Boolean);

function resolveModelPath(configModel: string): string {
  // If the config value is an absolute path that exists, use it directly
  if (path.isAbsolute(configModel) && fs.existsSync(configModel)) {
    return configModel;
  }

  // On Windows, search candidate locations
  if (process.platform === "win32") {
    for (const candidate of WINDOWS_MODEL_CANDIDATES) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // Fall back to config value (model name like "base.en" for PATH-based whisper)
  return configModel;
}

// ── OpenAI Whisper API ────────────────────────────────────────────────────────

async function transcribeWithOpenAI(wavPath: string): Promise<string> {
  let OpenAI: any;
  try {
    OpenAI = (await import("openai")).default;
  } catch {
    throw new Error("openai package not installed. Run: npm install openai");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(wavPath),
    model: "whisper-1",
    response_format: "text",
    language: "en",
  });

  return (
    typeof response === "string" ? response : ((response as any).text ?? "")
  ).trim();
}

// ── Local whisper.cpp ─────────────────────────────────────────────────────────

function transcribeWithWhisperCpp(
  wavPath: string,
  config: Pick<VoiceConfig, "whisperModel">,
): string {
  const binary = findWhisperBinary();
  if (!binary) throw new Error("whisper-cli binary not found.");

  const modelPath = resolveModelPath(config.whisperModel);
  const outDir = path.dirname(wavPath);
  const baseName = path.basename(wavPath, ".wav");
  const txtFile = path.join(outDir, `${baseName}.txt`);

  // Quote paths to handle spaces (important on Windows)
  const cmd = `"${binary}" -m "${modelPath}" -f "${wavPath}" --output-txt --output-dir "${outDir}" --no-prints`;

  try {
    execSync(cmd, { timeout: 60_000, stdio: "pipe" });
  } catch (err: any) {
    // whisper-cli exits 0 even on success sometimes; check for output file
    if (!fs.existsSync(txtFile)) {
      throw new Error(
        `whisper-cli failed.\n` +
          `Command: ${cmd}\n` +
          `Error: ${err.message}\n\n` +
          `Check that the model file exists:\n  ${modelPath}\n\n` +
          `Download models from:\n  https://huggingface.co/ggerganov/whisper.cpp/tree/main`,
      );
    }
  }

  if (!fs.existsSync(txtFile)) {
    throw new Error(
      `whisper-cli ran but produced no output.\n` +
        `Expected: ${txtFile}\n` +
        `Model: ${modelPath}`,
    );
  }

  const text = fs.readFileSync(txtFile, "utf-8").trim();
  try {
    fs.unlinkSync(txtFile);
  } catch {}
  return text;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function transcribe(
  wavPath: string,
  config: Pick<VoiceConfig, "whisperModel">,
): Promise<string> {
  const backend = getSTTBackend();

  if (backend === "none") {
    throw new Error(
      "No STT backend found.\n\n" +
        "── Option A: Local (free, no API key) ──────────────────\n" +
        "1. Download whisper-bin-x64.zip from:\n" +
        "   https://github.com/ggml-org/whisper.cpp/releases\n" +
        "2. Extract to C:\\ai\\whisper-bin-x64\\\n" +
        "3. Download a model (ggml-base.en.bin ~145MB) from:\n" +
        "   https://huggingface.co/ggerganov/whisper.cpp/tree/main\n" +
        "4. Save model to C:\\ai\\models\\ggml-base.en.bin\n" +
        "5. Install VC++ Redistributable:\n" +
        "   https://aka.ms/vs/17/release/vc_redist.x64.exe\n\n" +
        "── Option B: Custom path ───────────────────────────────\n" +
        "Add to your .env:\n" +
        "   WHISPER_CLI=C:\\path\\to\\whisper-cli.exe\n" +
        "   WHISPER_MODEL=C:\\path\\to\\ggml-base.en.bin\n",
    );
  }

  if (backend === "openai") return transcribeWithOpenAI(wavPath);
  return transcribeWithWhisperCpp(wavPath, config);
}

export function describeSTTBackend(): string {
  const b = getSTTBackend();
  if (b === "openai") return "OpenAI Whisper API";
  if (b === "whisper-cpp") {
    const bin = findWhisperBinary() ?? "whisper-cli";
    return `whisper.cpp local (${path.basename(bin)})`;
  }
  return "none (not configured — see /voice status)";
}
