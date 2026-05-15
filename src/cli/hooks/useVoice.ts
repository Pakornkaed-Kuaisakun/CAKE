// src/cli/hooks/useVoice.ts
//
// React hook that wires voice I/O into the existing useAgent architecture.
//
// Provides:
//   voiceEnabled    — whether voice mode is active
//   isRecording     — mic is open right now
//   isSpeaking      — TTS is playing right now
//   toggleVoice()   — turn voice mode on/off
//   handleVoiceKey  — call from useInput() in App.tsx for F2 push-to-talk
//   makeSpeakingOnChunk — wraps an onChunk callback with the TTS sentence buffer
//   stopSpeaking()  — interrupt current TTS (e.g. on new user input)
//   statusLine      — one-line status string for VoiceBar
//
// Push-to-talk protocol (F2):
//   keydown F2  → startRecording()
//   keyup F2    → stop() → transcribe() → handleSubmit(transcript)
//
// Ink's useInput doesn't expose keydown/keyup separately — it fires once
// per key event. We implement push-to-talk by treating the first F2 press
// as "start" and the second as "stop". Users hold and press again to stop.
// (True keydown/keyup would need raw stdin mode — out of scope here.)
//
// Alternative continuous mode (/voice on):
//   After each handleSubmit resolves, TTS plays. The hook handles the
//   TTS lifecycle; the caller just passes makeSpeakingOnChunk() as onChunk.

import { useState, useCallback, useRef, useEffect } from "react";
import type { Key } from "ink";
import {
  startRecording,
  cleanupRecording,
  transcribe,
  SentenceBuffer,
  TTSQueue,
  speak,
  resolveVoiceConfig,
  describeTTSBackend,
  describeSTTBackend,
  type VoiceConfig,
} from "../../modules/voice/index.js";
import type { RecordingHandle } from "../../modules/voice/recorder.js";

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseVoiceReturn {
  voiceEnabled: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  statusLine: string;
  toggleVoice(): void;
  /** Call inside useInput to handle F2 push-to-talk */
  handleVoiceKey(input: string, key: Key): boolean; // returns true if consumed
  /**
   * Wrap an onChunk callback so streamed text is also sent to TTS.
   * Pass the returned function as the `onChunk` option in agent.run().
   */
  makeSpeakingOnChunk(
    originalOnChunk: (chunk: string) => void,
    onResponseEnd: () => Promise<void>,
  ): (chunk: string) => void;
  /** Speak a complete string (used for non-streaming tool responses) */
  speakText(text: string): Promise<void>;
  /** Interrupt TTS immediately */
  stopSpeaking(): void;
  /** Transcribe a WAV file (exposed for testing) */
  transcribeFile(wavPath: string): Promise<string>;
}

export function useVoice(
  handleSubmit: (value: string) => void,
  configOverrides: Partial<VoiceConfig> = {},
): UseVoiceReturn {
  const config = resolveVoiceConfig(configOverrides);

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [statusLine, setStatusLine] = useState("");

  const recordingRef = useRef<RecordingHandle | null>(null);
  const ttsQueueRef = useRef<TTSQueue | null>(null);
  const sentenceBufferRef = useRef<SentenceBuffer | null>(null);

  // Initialise TTSQueue once
  useEffect(() => {
    ttsQueueRef.current = new TTSQueue(config, (speaking) => {
      setIsSpeaking(speaking);
    });
    return () => {
      ttsQueueRef.current?.interrupt();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update status line whenever state changes
  useEffect(() => {
    if (!voiceEnabled) {
      setStatusLine("");
      return;
    }
    if (isRecording) {
      setStatusLine("🎙  Recording… press F2 to stop");
      return;
    }
    if (isSpeaking) {
      setStatusLine("🔊 Speaking…");
      return;
    }
    setStatusLine(
      `🎤 Voice ON · STT: ${describeSTTBackend()} · TTS: ${describeTTSBackend(config)}`,
    );
  }, [voiceEnabled, isRecording, isSpeaking, config]);

  // ── Toggle voice mode ────────────────────────────────────────────────────

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      if (prev) {
        // Turning off — clean up any active recording / speaking
        recordingRef.current?.stop().catch(() => {});
        ttsQueueRef.current?.interrupt();
        ttsQueueRef.current?.reset();
        setIsRecording(false);
        setIsSpeaking(false);
      }
      return !prev;
    });
  }, []);

  // ── Push-to-talk ─────────────────────────────────────────────────────────
  // F2 toggles: first press = start, second press = stop + transcribe + submit

  const handleVoiceKey = useCallback(
    (input: string, key: Key): boolean => {
      // Ink represents F2 as escape sequence \x1b[12~ or the string "F2"
      // We also check for a common raw sequence. Ink normalises to `key.name`.
      const isF2 =
        (key as any).name === "F2" ||
        input === "\x1b[12~" ||
        input === "\x1bOQ";
      if (!isF2 || !voiceEnabled) return false;

      if (!isRecording) {
        // ── Start recording ──
        try {
          const handle = startRecording(config);
          recordingRef.current = handle;
          setIsRecording(true);
        } catch (err: any) {
          setStatusLine(`❌ Record failed: ${err.message}`);
        }
      } else {
        // ── Stop recording, transcribe, submit ──
        const handle = recordingRef.current;
        if (!handle) {
          setIsRecording(false);
          return true;
        }

        recordingRef.current = null;
        setIsRecording(false);
        setStatusLine("⏳ Transcribing…");

        handle
          .stop()
          .then((wavPath) =>
            transcribe(wavPath, config).then((text) => ({ wavPath, text })),
          )
          .then(({ wavPath, text }) => {
            cleanupRecording(wavPath);
            const trimmed = text.trim();
            if (trimmed) {
              setStatusLine(
                `🗣  "${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}"`,
              );
              handleSubmit(trimmed);
            } else {
              setStatusLine("❓ No speech detected. Try again (F2).");
            }
          })
          .catch((err: any) => {
            setStatusLine(`❌ Transcription failed: ${err.message}`);
          });
      }

      return true; // key consumed
    },
    [voiceEnabled, isRecording, config, handleSubmit],
  );

  // ── Streaming TTS via onChunk ─────────────────────────────────────────────

  const makeSpeakingOnChunk = useCallback(
    (
      originalOnChunk: (chunk: string) => void,
      onResponseEnd: () => Promise<void>,
    ) => {
      if (!voiceEnabled) return originalOnChunk;

      // Reset sentence buffer for each new response
      const queue = ttsQueueRef.current!;
      queue.reset();

      const buffer = new SentenceBuffer(config, (sentence) => {
        queue.push(sentence);
      });
      sentenceBufferRef.current = buffer;

      return (chunk: string) => {
        originalOnChunk(chunk);
        if (voiceEnabled) buffer.push(chunk);
      };
    },
    [voiceEnabled, config],
  );

  // Called by useAgent after the full response is in — flush the last sentence
  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!voiceEnabled) return;
      // Flush remaining buffer
      if (sentenceBufferRef.current) {
        await sentenceBufferRef.current.flush();
        sentenceBufferRef.current = null;
      }
      // If TTS queue is empty (non-streaming tool response), speak directly
      const queue = ttsQueueRef.current;
      if (queue && !isSpeaking) {
        queue.push(text);
      }
    },
    [voiceEnabled, isSpeaking],
  );

  const stopSpeaking = useCallback(() => {
    ttsQueueRef.current?.interrupt();
    ttsQueueRef.current?.reset();
  }, []);

  const transcribeFile = useCallback(
    (wavPath: string) => transcribe(wavPath, config),
    [config],
  );

  return {
    voiceEnabled,
    isRecording,
    isSpeaking,
    statusLine,
    toggleVoice,
    handleVoiceKey,
    makeSpeakingOnChunk,
    speakText,
    stopSpeaking,
    transcribeFile,
  };
}
