// src/modules/voice/recorder.ts
//
// Microphone capture — returns a path to a .wav file.
//
// Backends tried in order:
//   1. sox (rec)       — best: built-in silence detection
//   2. arecord         — Linux ALSA
//   3. ffmpeg          — universal fallback
//   4. powershell      — Windows built-in (NAudio via NuGet is heavy;
//                        we use the lighter WinMM waveIn approach via
//                        a small inline C# snippet compiled at runtime)

import { spawn, execSync, type ChildProcess } from "child_process";
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

type RecordBackend = "sox" | "arecord" | "ffmpeg" | "powershell" | "none";

function detectRecordBackend(): RecordBackend {
  if (process.platform === "win32") {
    // On Windows, check preferred tools first, fall back to PowerShell
    const winCandidates: [RecordBackend, string][] = [
      ["sox", "rec --version"],
      ["ffmpeg", "ffmpeg -version"],
    ];
    for (const [name, cmd] of winCandidates) {
      try {
        execSync(cmd, { stdio: "pipe" });
        return name;
      } catch {}
    }
    // PowerShell is always available on Windows — use it as the guaranteed fallback
    return "powershell";
  }

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

let _backend: RecordBackend | null = null;
export function getRecordBackend(): RecordBackend {
  if (_backend === null) _backend = detectRecordBackend();
  return _backend;
}

// ── Recording handle ──────────────────────────────────────────────────────────

export interface RecordingHandle {
  filePath: string;
  stop(): Promise<string>;
  isRecording: boolean;
}

// ── PowerShell WAV recorder (Windows built-in, no installs) ──────────────────
//
// Uses System.Speech (built into .NET / Windows) to capture microphone audio
// into a WAV file via a small inline C# snippet that PowerShell compiles
// on the fly with Add-Type. No external tools needed.
//
// The recorder writes continuously until we send "q\n" to its stdin,
// which triggers a clean WAV finalisation before exit.

function buildPowerShellRecorderScript(
  filePath: string,
  maxSeconds: number,
): string {
  // Escape backslashes in path for PowerShell string
  const psPath = filePath.replace(/\\/g, "\\\\");

  return `
Add-Type -AssemblyName System.Speech;
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;

public class WavRecorder {
    [DllImport("winmm.dll")] static extern int waveInGetNumDevs();
    [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr hWaveIn, int uDeviceID, ref WAVEFORMATEX lpFormat, IntPtr dwCallback, IntPtr dwCallbackInstance, int fdwOpen);
    [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr hWaveIn, ref WAVEHDR lpWaveInHdr, int uSize);
    [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr hWaveIn, ref WAVEHDR lpWaveInHdr, int uSize);
    [DllImport("winmm.dll")] static extern int waveInStart(IntPtr hWaveIn);
    [DllImport("winmm.dll")] static extern int waveInStop(IntPtr hWaveIn);
    [DllImport("winmm.dll")] static extern int waveInReset(IntPtr hWaveIn);
    [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr hWaveIn, ref WAVEHDR lpWaveInHdr, int uSize);
    [DllImport("winmm.dll")] static extern int waveInClose(IntPtr hWaveIn);

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEFORMATEX {
        public short wFormatTag;
        public short nChannels;
        public int nSamplesPerSec;
        public int nAvgBytesPerSec;
        public short nBlockAlign;
        public short wBitsPerSample;
        public short cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEHDR {
        public IntPtr lpData;
        public int dwBufferLength;
        public int dwBytesRecorded;
        public IntPtr dwUser;
        public int dwFlags;
        public int dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    const int WAVE_MAPPER = -1;
    const int WAVE_FORMAT_PCM = 1;

    public static void Record(string outputPath, int maxSeconds) {
        int sampleRate = 16000;
        int bufferSecs  = 1;
        int bufSize     = sampleRate * 2 * bufferSecs; // 16-bit mono

        var fmt = new WAVEFORMATEX {
            wFormatTag      = WAVE_FORMAT_PCM,
            nChannels       = 1,
            nSamplesPerSec  = sampleRate,
            nAvgBytesPerSec = sampleRate * 2,
            nBlockAlign     = 2,
            wBitsPerSample  = 16,
            cbSize          = 0
        };

        IntPtr hWave;
        waveInOpen(out hWave, WAVE_MAPPER, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);

        var allData = new System.Collections.Generic.List<byte>();
        var deadline = DateTime.UtcNow.AddSeconds(maxSeconds);
        bool running = true;

        // Ping-pong two buffers
        byte[] buf1 = new byte[bufSize];
        byte[] buf2 = new byte[bufSize];
        var gch1 = GCHandle.Alloc(buf1, GCHandleType.Pinned);
        var gch2 = GCHandle.Alloc(buf2, GCHandleType.Pinned);

        var hdr1 = new WAVEHDR { lpData = gch1.AddrOfPinnedObject(), dwBufferLength = bufSize };
        var hdr2 = new WAVEHDR { lpData = gch2.AddrOfPinnedObject(), dwBufferLength = bufSize };

        waveInPrepareHeader(hWave, ref hdr1, Marshal.SizeOf(hdr1));
        waveInPrepareHeader(hWave, ref hdr2, Marshal.SizeOf(hdr2));
        waveInAddBuffer(hWave, ref hdr1, Marshal.SizeOf(hdr1));
        waveInAddBuffer(hWave, ref hdr2, Marshal.SizeOf(hdr2));
        waveInStart(hWave);

        // Poll for stop signal on stdin or timeout
        var stdinThread = new Thread(() => {
            var line = Console.ReadLine();
            if (line != null && line.Trim().ToLower() == "q") running = false;
        });
        stdinThread.IsBackground = true;
        stdinThread.Start();

        while (running && DateTime.UtcNow < deadline) {
            Thread.Sleep(100);
            // Harvest completed buffer 1
            if ((hdr1.dwFlags & 0x00000001) != 0) { // WHDR_DONE
                byte[] tmp = new byte[hdr1.dwBytesRecorded];
                Marshal.Copy(hdr1.lpData, tmp, 0, hdr1.dwBytesRecorded);
                allData.AddRange(tmp);
                hdr1.dwFlags = 0; hdr1.dwBytesRecorded = 0; hdr1.dwBufferLength = bufSize;
                waveInPrepareHeader(hWave, ref hdr1, Marshal.SizeOf(hdr1));
                waveInAddBuffer(hWave, ref hdr1, Marshal.SizeOf(hdr1));
            }
            // Harvest completed buffer 2
            if ((hdr2.dwFlags & 0x00000001) != 0) {
                byte[] tmp = new byte[hdr2.dwBytesRecorded];
                Marshal.Copy(hdr2.lpData, tmp, 0, hdr2.dwBytesRecorded);
                allData.AddRange(tmp);
                hdr2.dwFlags = 0; hdr2.dwBytesRecorded = 0; hdr2.dwBufferLength = bufSize;
                waveInPrepareHeader(hWave, ref hdr2, Marshal.SizeOf(hdr2));
                waveInAddBuffer(hWave, ref hdr2, Marshal.SizeOf(hdr2));
            }
        }

        waveInStop(hWave);
        waveInReset(hWave);
        Thread.Sleep(200); // let final buffers drain

        // Harvest any last data
        if ((hdr1.dwFlags & 0x00000001) != 0) {
            byte[] tmp = new byte[hdr1.dwBytesRecorded];
            Marshal.Copy(hdr1.lpData, tmp, 0, hdr1.dwBytesRecorded);
            allData.AddRange(tmp);
        }
        if ((hdr2.dwFlags & 0x00000001) != 0) {
            byte[] tmp = new byte[hdr2.dwBytesRecorded];
            Marshal.Copy(hdr2.lpData, tmp, 0, hdr2.dwBytesRecorded);
            allData.AddRange(tmp);
        }

        waveInUnprepareHeader(hWave, ref hdr1, Marshal.SizeOf(hdr1));
        waveInUnprepareHeader(hWave, ref hdr2, Marshal.SizeOf(hdr2));
        gch1.Free(); gch2.Free();
        waveInClose(hWave);

        // Write WAV file
        byte[] pcm = allData.ToArray();
        using (var fs = new FileStream(outputPath, FileMode.Create)) {
            using (var bw = new BinaryWriter(fs)) {
                int dataLen = pcm.Length;
                bw.Write(new char[]{'R','I','F','F'});
                bw.Write(36 + dataLen);
                bw.Write(new char[]{'W','A','V','E'});
                bw.Write(new char[]{'f','m','t',' '});
                bw.Write(16);          // chunk size
                bw.Write((short)1);    // PCM
                bw.Write((short)1);    // mono
                bw.Write(16000);       // sample rate
                bw.Write(32000);       // byte rate
                bw.Write((short)2);    // block align
                bw.Write((short)16);   // bits per sample
                bw.Write(new char[]{'d','a','t','a'});
                bw.Write(dataLen);
                bw.Write(pcm);
            }
        }
    }
}
'@ -Language CSharp;

[WavRecorder]::Record('${psPath}', ${maxSeconds});
`.trim();
}

// ── Push-to-talk: manual start/stop ──────────────────────────────────────────

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
        "  Windows: ffmpeg from https://ffmpeg.org/download.html\n" +
        "           (add to PATH, then restart terminal)",
    );
  }

  const filePath = tmpWav();

  const handle: RecordingHandle = {
    filePath,
    isRecording: true,
    stop(): Promise<string> {
      return new Promise((resolve, reject) => {
        if (!handle.isRecording) {
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
            resolve(filePath);
          } else {
            reject(new Error("Recording produced no audio (file too small)."));
          }
          return;
        }
        proc.once("exit", () => {
          handle.isRecording = false;
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
            resolve(filePath);
          } else {
            reject(new Error("Recording produced no audio (file too small)."));
          }
        });

        if (backend === "powershell") {
          // Signal the inline C# loop to stop cleanly via stdin
          try {
            proc.stdin?.write("q\n");
          } catch {}
          // Hard-kill after 3 s if it doesn't exit (WAV flush should be fast)
          setTimeout(() => {
            try {
              proc.kill("SIGTERM");
            } catch {}
          }, 3000);
        } else {
          proc.kill(backend === "sox" ? "SIGINT" : "SIGTERM");
        }
      });
    },
  };

  let proc: ChildProcess;

  if (backend === "sox") {
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
  } else if (backend === "ffmpeg") {
    const inputDevice =
      process.platform === "win32"
        ? [
            "dshow",
            "-i",
            "audio=@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{...}",
          ]
        : process.platform === "darwin"
          ? ["avfoundation", "-i", ":0"]
          : ["alsa", "-i", "default"];

    // On Windows use DirectShow default device shorthand
    const ffmpegArgs =
      process.platform === "win32"
        ? [
            "-f",
            "dshow",
            "-i",
            "audio=default_device",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-t",
            String(config.maxRecordSeconds),
            "-y",
            filePath,
          ]
        : process.platform === "darwin"
          ? [
              "-f",
              "avfoundation",
              "-i",
              ":0",
              "-ar",
              "16000",
              "-ac",
              "1",
              "-t",
              String(config.maxRecordSeconds),
              "-y",
              filePath,
            ]
          : [
              "-f",
              "alsa",
              "-i",
              "default",
              "-ar",
              "16000",
              "-ac",
              "1",
              "-t",
              String(config.maxRecordSeconds),
              "-y",
              filePath,
            ];

    proc = spawn("ffmpeg", ffmpegArgs, { stdio: "pipe" });
  } else {
    // powershell backend
    const script = buildPowerShellRecorderScript(
      filePath,
      config.maxRecordSeconds,
    );
    proc = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  }

  proc.on("exit", () => {
    handle.isRecording = false;
  });

  return handle;
}

// ── Auto-stop: silence detection ──────────────────────────────────────────────

export function recordUntilSilence(
  config: Pick<VoiceConfig, "silenceTimeout" | "maxRecordSeconds">,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const backend = getRecordBackend();
    if (backend === "none") {
      reject(
        new Error("No audio recording tool found. Install sox or ffmpeg."),
      );
      return;
    }

    const filePath = tmpWav();

    if (backend === "sox") {
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
          "1%",
          "1",
          String(config.silenceTimeout),
          "1%",
          "trim",
          "0",
          String(config.maxRecordSeconds),
        ],
        { stdio: "pipe" },
      );
      proc.once("exit", () => {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000)
          resolve(filePath);
        else reject(new Error("Recording captured no audio."));
      });
      proc.once("error", reject);
    } else {
      // Fallback: fixed-duration recording
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

/** Delete a temp recording file after transcription */
export function cleanupRecording(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}
