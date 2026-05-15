// src/modules/voice/player.ts
//
// Cross-platform audio playback for WAV / MP3 files.
//
// Backends tried in order per platform:
//   macOS   : afplay (built-in)
//   Linux   : mpv → aplay → paplay → ffplay
//   Windows : PowerShell SoundPlayer

import { spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";

// ── Backend detection ─────────────────────────────────────────────────────────

type PlayBackend =
  | "afplay"
  | "mpv"
  | "aplay"
  | "paplay"
  | "ffplay"
  | "powershell"
  | "none";

function detectPlayBackend(): PlayBackend {
  if (process.platform === "darwin") return "afplay"; // always available
  if (process.platform === "win32") return "powershell";

  const candidates: [PlayBackend, string][] = [
    ["mpv", "mpv --version"],
    ["aplay", "aplay --version"],
    ["paplay", "paplay --version"],
    ["ffplay", "ffplay -version"],
  ];
  for (const [name, cmd] of candidates) {
    try {
      execSync(cmd, { stdio: "pipe" });
      return name;
    } catch {}
  }
  return "none";
}

let _playBackend: PlayBackend | null = null;
function getPlayBackend(): PlayBackend {
  if (_playBackend === null) _playBackend = detectPlayBackend();
  return _playBackend;
}

// ── Active playback handle ────────────────────────────────────────────────────

export interface PlaybackHandle {
  /** Resolves when playback finishes */
  done: Promise<void>;
  /** Immediately stop playback */
  stop(): void;
}

// ── Core play function ────────────────────────────────────────────────────────

/**
 * Play an audio file (WAV or MP3).
 * Returns a handle so the caller can await completion or stop early.
 */
export function playAudio(filePath: string): PlaybackHandle {
  const backend = getPlayBackend();
  let proc: ChildProcess;

  switch (backend) {
    case "afplay":
      proc = spawn("afplay", [filePath], { stdio: "pipe" });
      break;

    case "mpv":
      proc = spawn("mpv", ["--no-video", "--really-quiet", filePath], {
        stdio: "pipe",
      });
      break;

    case "aplay":
      proc = spawn("aplay", ["-q", filePath], { stdio: "pipe" });
      break;

    case "paplay":
      proc = spawn("paplay", [filePath], { stdio: "pipe" });
      break;

    case "ffplay":
      proc = spawn(
        "ffplay",
        ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath],
        { stdio: "pipe" },
      );
      break;

    case "powershell": {
      const ps = `
(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()
`.trim();
      proc = spawn("powershell", ["-Command", ps], { stdio: "pipe" });
      break;
    }

    default:
      // No backend — return immediately resolved handle
      return {
        done: Promise.resolve(),
        stop: () => {},
      };
  }

  const done = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.once("error", () => resolve()); // don't throw on playback errors
  });

  return {
    done,
    stop() {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
  };
}

/** Play audio and await completion. Convenience wrapper. */
export async function playAudioSync(filePath: string): Promise<void> {
  await playAudio(filePath).done;
}

export function describePlayBackend(): string {
  return getPlayBackend();
}
