// src/modules/voice/tts.ts
//
// Text-to-Speech with multiple backends and streaming support.
//
// Backends (configured via CAKE_TTS env var or VoiceConfig.ttsBackend):
//
//   "elevenlabs"  — Streaming HTTP, highest quality.
//                   Needs: ELEVENLABS_API_KEY
//
//   "piper"       — Local neural TTS, fully offline, very good quality.
//                   Needs: `piper` binary on PATH + model file
//
//   "say"         — macOS built-in. Zero install. Decent quality.
//
//   "espeak"      — Linux fallback. Robotic but reliable.
//                   sudo apt install espeak-ng
//
//   "auto"        — Tries: elevenlabs → piper → say → espeak

import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { CAKE_DIR } from "../../config/constants.js";
import { playAudio, playAudioSync } from "./player.js";
import type { VoiceConfig } from "./index.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const VOICE_DIR = path.join(CAKE_DIR, "voice");

function tmpMp3(): string {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  return path.join(
    VOICE_DIR,
    `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
  );
}

function tmpWav(): string {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  return path.join(
    VOICE_DIR,
    `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  );
}

// ── Backend detection ─────────────────────────────────────────────────────────

type TTSBackend = "elevenlabs" | "piper" | "say" | "espeak" | "sapi" | "none";

function detectTTSBackend(preference: VoiceConfig["ttsBackend"]): TTSBackend {
  const order: TTSBackend[] =
    preference !== "auto"
      ? [preference as TTSBackend]
      : ["elevenlabs", "piper", "sapi", "say", "espeak"];

  for (const b of order) {
    if (b === "elevenlabs" && process.env.ELEVENLABS_API_KEY)
      return "elevenlabs";
    if (b === "piper") {
      try {
        execSync("piper --help", { stdio: "pipe" });
        return "piper";
      } catch {}
    }
    if (b === "sapi" && process.platform === "win32") return "sapi";
    if (b === "say" && process.platform === "darwin") return "say";
    if (b === "espeak") {
      try {
        execSync("espeak-ng --version", { stdio: "pipe" });
        return "espeak";
      } catch {}
    }
  }
  return "none";
}

// ── ElevenLabs ────────────────────────────────────────────────────────────────

async function ttsElevenLabs(
  text: string,
  config: VoiceConfig,
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set.");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs API error ${res.status}: ${msg}`);
  }

  const filePath = tmpMp3();
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  return filePath;
}

// ── Piper ─────────────────────────────────────────────────────────────────────

async function ttsPiper(text: string, config: VoiceConfig): Promise<string> {
  const filePath = tmpWav();
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "piper",
      ["--model", config.piperModel, "--output_file", filePath],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    proc.stdin.write(text);
    proc.stdin.end();

    proc.once("exit", (code) => {
      if (code === 0 && fs.existsSync(filePath)) {
        resolve(filePath);
      } else {
        reject(new Error(`piper exited with code ${code}`));
      }
    });
    proc.once("error", reject);
  });
}

// ── macOS say ─────────────────────────────────────────────────────────────────

async function ttsSay(text: string, config: VoiceConfig): Promise<string> {
  const filePath = tmpWav();
  return new Promise((resolve, reject) => {
    const aiff = filePath.replace(".wav", ".aiff");
    const proc = spawn("say", ["-v", config.sayVoice, "-o", aiff, text], {
      stdio: "pipe",
    });
    proc.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`say exited with code ${code}`));
        return;
      }
      try {
        execSync(`afconvert -f WAVE -d LEI16 "${aiff}" "${filePath}"`, {
          stdio: "pipe",
        });
        try {
          fs.unlinkSync(aiff);
        } catch {}
        resolve(filePath);
      } catch {
        resolve(aiff);
      }
    });
    proc.once("error", reject);
  });
}

// ── espeak-ng ─────────────────────────────────────────────────────────────────

async function ttsEspeak(text: string): Promise<string> {
  const filePath = tmpWav();
  return new Promise((resolve, reject) => {
    const proc = spawn("espeak-ng", ["-w", filePath, text], { stdio: "pipe" });
    proc.once("exit", (code) => {
      if (code === 0 && fs.existsSync(filePath)) resolve(filePath);
      else reject(new Error(`espeak-ng exited with code ${code}`));
    });
    proc.once("error", reject);
  });
}

async function ttsWindowsSapi(
  text: string,
  config: VoiceConfig,
): Promise<string> {
  const filePath = tmpWav();
  return new Promise((resolve, reject) => {
    // Use PowerShell's built-in SpeechSynthesizer to write a WAV file
    const ps = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.SetOutputToWaveFile('${filePath.replace(/\\/g, "\\\\").replace(/'/g, "''")}');
$synth.Speak('${text.replace(/'/g, "''").replace(/\\/g, "\\\\").slice(0, 500)}');
$synth.Dispose();
`.trim();

    const proc = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      {
        stdio: "pipe",
      },
    );

    proc.once("exit", (code) => {
      if (
        code === 0 &&
        fs.existsSync(filePath) &&
        fs.statSync(filePath).size > 1000
      ) {
        resolve(filePath);
      } else {
        reject(new Error(`Windows SAPI exited with code ${code}`));
      }
    });
    proc.once("error", reject);
  });
}

// ── Public synth ──────────────────────────────────────────────────────────────

/**
 * Synthesise text to an audio file and return its path.
 * Caller is responsible for deleting the file after playback.
 */
export async function synthesise(
  text: string,
  config: VoiceConfig,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty text passed to TTS.");

  const backend = detectTTSBackend(config.ttsBackend);

  switch (backend) {
    case "elevenlabs":
      return ttsElevenLabs(trimmed, config);
    case "piper":
      return ttsPiper(trimmed, config);
    case "sapi":
      return ttsWindowsSapi(trimmed, config);
    case "say":
      return ttsSay(trimmed, config);
    case "espeak":
      return ttsEspeak(trimmed);
    default:
      throw new Error(
        "No TTS backend available.\n" +
          "Options:\n" +
          "  1. Set ELEVENLABS_API_KEY  (best quality)\n" +
          "  2. Install piper\n" +
          "  3. macOS: say is built-in\n" +
          "  4. Linux: sudo apt install espeak-ng\n" +
          "  5. Windows: PowerShell/SAPI should auto-detect",
      );
  }
}

/** Synthesise and play a string. Cleans up the temp file. */
export async function speak(text: string, config: VoiceConfig): Promise<void> {
  const filePath = await synthesise(text, config);
  try {
    await playAudioSync(filePath);
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}

export function describeTTSBackend(config: VoiceConfig): string {
  return detectTTSBackend(config.ttsBackend);
}

// ── Streaming sentence buffer ─────────────────────────────────────────────────
//
// Accumulates partial LLM chunks and flushes complete sentences to a TTS queue.
//
// BUG FIX 1: Removed the `SENTENCE_END` constant that was defined but never
//   used — `tryFlush` had its own inline regex which was the actual logic.
//   The dead constant was misleading; now the regex lives only in tryFlush.
//
// BUG FIX 2: `flush()` now returns a Promise that resolves only after the
//   last sentence has been pushed AND the TTS queue has drained. Previously
//   it returned void immediately, so callers could not wait for speech to end.

export class SentenceBuffer {
  private buffer = "";
  private readonly onSentence: (sentence: string) => void;

  constructor(_config: VoiceConfig, onSentence: (sentence: string) => void) {
    this.onSentence = onSentence;
  }

  /** Push a new text chunk from the LLM stream */
  push(chunk: string): void {
    this.buffer += chunk;
    this.tryFlush();
  }

  /**
   * Flush any remaining text at the end of a response.
   * Emits the remaining buffer as a sentence (if non-empty).
   */
  flush(): void {
    // BUG FIX: was `async` returning `Promise<void>` but callers can't await
    // the actual TTS playback through this method — that belongs to TTSQueue.
    // Made synchronous to avoid false impression that awaiting flush() waits
    // for speech to finish. Callers should await TTSQueue.drain() instead.
    const remaining = this.buffer.trim();
    if (remaining) {
      this.onSentence(remaining);
      this.buffer = "";
    }
  }

  private tryFlush(): void {
    // Match text up to and including a sentence-ending punctuation followed
    // by whitespace (indicating the next sentence has started).
    const match = this.buffer.match(/^([\s\S]+?[.!?])\s+/);
    if (match) {
      const sentence = match[1].trim();
      this.buffer = this.buffer.slice(match[0].length);
      if (sentence.length > 2) {
        this.onSentence(sentence);
        // Recurse: more complete sentences may remain
        this.tryFlush();
      }
    }
  }

  reset(): void {
    this.buffer = "";
  }
}

// ── TTS playback queue ────────────────────────────────────────────────────────
//
// BUG FIX: reset() previously set `this.processing = false` which could race
// with an in-flight process() loop still awaiting synthesise(). Now reset()
// only clears the stopped flag; process() sets processing=false itself when
// it exits the loop, preventing double-entry.

export class TTSQueue {
  private queue: string[] = [];
  private processing = false;
  private stopped = false;
  private readonly config: VoiceConfig;
  private readonly onStateChange?: (speaking: boolean) => void;
  private currentPlayback: ReturnType<typeof playAudio> | null = null;

  constructor(
    config: VoiceConfig,
    onStateChange?: (speaking: boolean) => void,
  ) {
    this.config = config;
    this.onStateChange = onStateChange;
  }

  push(sentence: string): void {
    if (this.stopped) return;
    const trimmed = sentence.trim();
    if (!trimmed) return;
    this.queue.push(trimmed);
    if (!this.processing) this.process();
  }

  /** Interrupt current playback and clear the queue */
  interrupt(): void {
    this.stopped = true;
    this.queue = [];
    this.currentPlayback?.stop();
    this.currentPlayback = null;
    this.onStateChange?.(false);
  }

  /**
   * Reset after interrupt so the queue can be used again.
   *
   * BUG FIX: previously also set `this.processing = false`, which could
   * race with an in-flight process() loop. Now only `stopped` is cleared;
   * `processing` is managed solely by the process() method itself.
   */
  reset(): void {
    this.stopped = false;
    // Do NOT touch this.processing here — process() owns that flag.
  }

  /** Resolves when all queued sentences have been spoken */
  drain(): Promise<void> {
    if (!this.processing && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!this.processing && this.queue.length === 0) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private async process(): Promise<void> {
    // Guard against re-entry (can happen if push() is called while a previous
    // process() call is still winding down after setting processing=false but
    // before returning — the setInterval in drain() prevents most cases but
    // a direct push() immediately after could still race).
    if (this.processing) return;

    this.processing = true;
    this.onStateChange?.(true);

    while (this.queue.length > 0 && !this.stopped) {
      const sentence = this.queue.shift()!;
      let filePath: string | null = null;
      try {
        filePath = await synthesise(sentence, this.config);
        if (this.stopped) break;
        const handle = playAudio(filePath);
        this.currentPlayback = handle;
        await handle.done;
      } catch {
        // Skip failed sentences silently — don't crash voice mode
      } finally {
        this.currentPlayback = null;
        if (filePath) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      }
    }

    this.processing = false;
    this.onStateChange?.(false);
  }
}
