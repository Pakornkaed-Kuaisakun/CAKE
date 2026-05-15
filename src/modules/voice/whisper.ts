// src/modules/voice/whisper.ts
//
// Speech-to-Text using OpenAI's Whisper API (primary) or a local
// whisper.cpp binary (fallback / offline mode).
//
// OpenAI Whisper API:
//   Needs OPENAI_API_KEY. Sends the WAV file as multipart/form-data.
//   Model: whisper-1 (only model currently available via API).
//
// Local whisper.cpp:
//   Needs `whisper` binary on PATH (https://github.com/ggerganov/whisper.cpp).
//   Uses the model specified in VoiceConfig.whisperModel.
//   Command: whisper <wav> --model <model> --output-txt --no-prints
//
// Both return a plain transcription string.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { VoiceConfig } from "./index.js";

// ── Backend detection ─────────────────────────────────────────────────────────

type STTBackend = "openai" | "whisper-cpp" | "none";

function detectSTTBackend(): STTBackend {
  if (process.env.OPENAI_API_KEY) return "openai";
  try {
    execSync("whisper --help", { stdio: "pipe" });
    return "whisper-cpp";
  } catch {}
  return "none";
}

let _sttBackend: STTBackend | null = null;
export function getSTTBackend(): STTBackend {
  if (_sttBackend === null) _sttBackend = detectSTTBackend();
  return _sttBackend;
}

// ── OpenAI Whisper API ────────────────────────────────────────────────────────

async function transcribeWithOpenAI(wavPath: string): Promise<string> {
  // Dynamically import to avoid hard dep for non-voice usage
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

  // response_format "text" returns a plain string
  return (
    typeof response === "string" ? response : ((response as any).text ?? "")
  ).trim();
}

// ── Local whisper.cpp ─────────────────────────────────────────────────────────

function transcribeWithWhisperCpp(
  wavPath: string,
  config: Pick<VoiceConfig, "whisperModel">,
): string {
  const outDir = path.dirname(wavPath);
  const baseName = path.basename(wavPath, ".wav");
  const txtFile = path.join(outDir, `${baseName}.txt`);

  try {
    execSync(
      `whisper "${wavPath}" --model ${config.whisperModel} --output-txt --output-dir "${outDir}" --no-prints`,
      { timeout: 60_000, stdio: "pipe" },
    );

    if (!fs.existsSync(txtFile)) {
      throw new Error("whisper.cpp produced no output file.");
    }

    const text = fs.readFileSync(txtFile, "utf-8").trim();
    try {
      fs.unlinkSync(txtFile);
    } catch {}
    return text;
  } catch (err: any) {
    throw new Error(`whisper.cpp transcription failed: ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Transcribe a WAV file to text.
 * Automatically selects the best available backend.
 */
export async function transcribe(
  wavPath: string,
  config: Pick<VoiceConfig, "whisperModel">,
): Promise<string> {
  const backend = getSTTBackend();

  if (backend === "none") {
    throw new Error(
      "No STT backend available.\n" +
        "Options:\n" +
        "  1. Set OPENAI_API_KEY  (uses OpenAI Whisper API)\n" +
        "  2. Install whisper.cpp (https://github.com/ggerganov/whisper.cpp)\n" +
        "     brew install whisper-cpp  OR  build from source",
    );
  }

  if (backend === "openai") {
    return transcribeWithOpenAI(wavPath);
  }

  return transcribeWithWhisperCpp(wavPath, config);
}

/** Returns a human-readable description of the active STT backend */
export function describeSTTBackend(): string {
  const b = getSTTBackend();
  if (b === "openai") return "OpenAI Whisper API";
  if (b === "whisper-cpp") return "whisper.cpp (local)";
  return "none (STT unavailable)";
}
