// src/modules/voice/index.ts
//
// Voice I/O module — Speech-to-Text + Text-to-Speech
//
// STT backends  (tried in order):
//   1. OpenAI Whisper API       — best quality, needs OPENAI_API_KEY
//   2. whisper.cpp (local)      — free, needs `whisper` binary on PATH
//
// TTS backends  (configured via CAKE_TTS env var or /voice config):
//   "elevenlabs"  — streaming, highest quality, needs ELEVENLABS_API_KEY
//   "piper"       — local, free, offline, needs `piper` binary on PATH
//   "say"         — macOS built-in, zero install
//   "espeak"      — Linux built-in fallback
//
// Audio capture:
//   sox (rec)     — cross-platform, best silence detection
//   arecord       — Linux ALSA fallback
//   ffmpeg        — universal fallback

export * from "./recorder.js";
export * from "./whisper.js";
export * from "./tts.js";
export * from "./player.js";

export interface VoiceConfig {
  /** Whether voice mode is active this session */
  enabled: boolean;
  /** TTS backend to use */
  ttsBackend: "elevenlabs" | "piper" | "sapi" | "say" | "espeak" | "auto";
  /** ElevenLabs voice ID (default: Rachel) */
  elevenLabsVoiceId: string;
  /** Piper model path or name */
  piperModel: string;
  /** macOS `say` voice name */
  sayVoice: string;
  /** Whisper model for local transcription */
  whisperModel: string;
  /** Silence threshold in seconds before auto-stop recording */
  silenceTimeout: number;
  /** Max recording duration in seconds */
  maxRecordSeconds: number;
  /** Speak TTS as response streams (true) or wait for full response (false) */
  streamSpeak: boolean;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: false,
  ttsBackend: "auto",
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
  piperModel: "en_US-lessac-medium",
  sayVoice: "Samantha",
  whisperModel: "base.en",
  silenceTimeout: 1.5,
  maxRecordSeconds: 30,
  streamSpeak: true,
};

/** Load voice config from env overrides + defaults */
export function resolveVoiceConfig(
  overrides: Partial<VoiceConfig> = {},
): VoiceConfig {
  return {
    ...DEFAULT_VOICE_CONFIG,
    ttsBackend:
      (process.env.CAKE_TTS as VoiceConfig["ttsBackend"]) ??
      DEFAULT_VOICE_CONFIG.ttsBackend,
    elevenLabsVoiceId:
      process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_CONFIG.elevenLabsVoiceId,
    piperModel: process.env.PIPER_MODEL ?? DEFAULT_VOICE_CONFIG.piperModel,
    sayVoice: process.env.SAY_VOICE ?? DEFAULT_VOICE_CONFIG.sayVoice,
    whisperModel:
      process.env.WHISPER_MODEL ?? DEFAULT_VOICE_CONFIG.whisperModel,
    ...overrides,
  };
}
