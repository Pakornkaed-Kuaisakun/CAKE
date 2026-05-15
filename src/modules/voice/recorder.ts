// src/modules/voice/recorder.ts
//
// Microphone capture — returns a path to a .wav file.
//
// Backends tried in order:
//   1. sox (rec)    — best: has built-in silence detection to auto-stop
//   2. arecord      — Linux ALSA, reliable but no silence detection
//   3. ffmpeg       — universal fallback, no silence detection
//
// Push-to-talk usage:
//   const rec = startRecording(config);
//   // ... user holds key ...
//   const wavPath = await rec.stop();
//
// Auto-stop usage (silence detection via sox):
//   const wavPath = await recordUntilSilence(config);

import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import type { VoiceConfig } from "./index.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

export const VOICE_DIR = path.join(CAKE_DIR, "voice");

function tmpWav(): string {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  return path.join(VOICE_DIR, `rec-${Date.now()}.wav`);
}

// ── Backend detection ─────────────────────────────────────────────────────────

type RecordBackend = "sox" | "arecord" | "ffmpeg" | "none";

function detectRecordBackend(): RecordBackend {
  const cmds: [RecordBackend, string][] = [
    ["sox", "rec --version"],
    ["arecord", "arecord --version"],
    ["ffmpeg", "ffmpeg -version"],
  ];
  for (const [name, cmd] of cmds) {
    try {
      execSync(cmd, { stdio: "pipe" });
      return name;
    } catch {}
  }
  return "none";
}

// Cache after first call
let _backend: RecordBackend | null = null;
export function getRecordBackend(): RecordBackend {
  if (_backend === null) _backend = detectRecordBackend();
  return _backend;
}

// ── Recording handle ──────────────────────────────────────────────────────────

export interface RecordingHandle {
  /** Absolute path to the WAV file being written */
  filePath: string;
  /** Stop recording and resolve with the final file path */
  stop(): Promise<string>;
  /** True while the subprocess is still running */
  readonly isRecording: boolean;
}

// ── Push-to-talk: manual start/stop ──────────────────────────────────────────

/**
 * Start recording immediately. Call handle.stop() when the user releases
 * the push-to-talk key.
 */
export function startRecording(
  config: Pick<VoiceConfig, "maxRecordSeconds">,
): RecordingHandle {
  const backend = getRecordBackend();
  if (backend === "none") {
    throw new Error(
      "No audio recording tool found.\n" +
        "Install one:\n" +
        "  macOS  : brew install sox\n" +
        "  Ubuntu : sudo apt install sox\n" +
        "  Windows: https://sourceforge.net/projects/sox/",
    );
  }

  const filePath = tmpWav();
  let proc: ChildProcess;
  let _isRecording = true;

  if (backend === "sox") {
    // sox rec: 16kHz mono WAV, max duration guard
    proc = spawn(
      "rec",
      [
        "-r",
        "16000",
        "-c",
        "1",
        "-e",
        "signed-integer",
        "-b",
        "16",
        filePath,
        "trim",
        "0",
        String(config.maxRecordSeconds),
      ],
      { stdio: "pipe" },
    );
  } else if (backend === "arecord") {
    proc = spawn(
      "arecord",
      [
        "-f",
        "S16_LE",
        "-r",
        "16000",
        "-c",
        "1",
        "-d",
        String(config.maxRecordSeconds),
        filePath,
      ],
      { stdio: "pipe" },
    );
  } else {
    // ffmpeg
    proc = spawn(
      "ffmpeg",
      [
        "-f",
        process.platform === "darwin" ? "avfoundation" : "alsa",
        "-i",
        process.platform === "darwin" ? ":0" : "default",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-t",
        String(config.maxRecordSeconds),
        "-y",
        filePath,
      ],
      { stdio: "pipe" },
    );
  }

  proc.on("exit", () => {
    _isRecording = false;
  });

  return {
    filePath,
    isRecording: _isRecording,
    stop(): Promise<string> {
      return new Promise((resolve, reject) => {
        if (!_isRecording) {
          resolve(filePath);
          return;
        }
        proc.once("exit", (code) => {
          _isRecording = false;
          // Any exit is fine for push-to-talk — we killed it intentionally
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
            resolve(filePath);
          } else {
            reject(new Error("Recording produced no audio (file too small)."));
          }
        });
        // SIGINT lets sox flush headers properly; SIGTERM for others
        proc.kill(backend === "sox" ? "SIGINT" : "SIGTERM");
      });
    },
  };
}

// ── Auto-stop: silence detection (sox only) ───────────────────────────────────

/**
 * Record until silence is detected (sox) or max duration reached.
 * Returns the path to the wav file.
 *
 * Falls back to a fixed-duration recording when sox is unavailable.
 */
export function recordUntilSilence(
  config: Pick<VoiceConfig, "silenceTimeout" | "maxRecordSeconds">,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const backend = getRecordBackend();
    if (backend === "none") {
      reject(new Error("No audio recording tool found. Install sox."));
      return;
    }

    const filePath = tmpWav();

    if (backend === "sox") {
      // sox silence effect: stop after `silenceTimeout` seconds of < 1% volume
      const proc = spawn(
        "rec",
        [
          "-r",
          "16000",
          "-c",
          "1",
          "-e",
          "signed-integer",
          "-b",
          "16",
          filePath,
          "silence",
          "1",
          "0.1",
          "1%", // start when noise detected
          "1",
          String(config.silenceTimeout),
          "1%", // stop after silence
          "trim",
          "0",
          String(config.maxRecordSeconds), // hard cap
        ],
        { stdio: "pipe" },
      );

      proc.once("exit", () => {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
          resolve(filePath);
        } else {
          reject(new Error("Recording captured no audio."));
        }
      });

      proc.once("error", reject);
    } else {
      // Non-sox fallback: record for a fixed short window
      const handle = startRecording({
        maxRecordSeconds: config.maxRecordSeconds,
      });
      setTimeout(async () => {
        try {
          resolve(await handle.stop());
        } catch (e) {
          reject(e);
        }
      }, config.maxRecordSeconds * 1000);
    }
  });
}

/** Delete a temp recording file — call after transcription is done */
export function cleanupRecording(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}
