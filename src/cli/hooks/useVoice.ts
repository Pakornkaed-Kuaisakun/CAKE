// src/cli/hooks/useVoice.ts
//
// React hook that wires voice I/O into the existing useAgent architecture.
//
// BUG FIXES applied in this file:
//
//   1. speakText() — was pushing `text` to the queue even when sentences were
//      already buffered via makeSpeakingOnChunk (double-speak on streaming).
//      Now speakText() only flushes the SentenceBuffer remainder; if the buffer
//      was empty (tool / non-streaming response) it pushes directly.
//
//   2. makeSpeakingOnChunk() — the returned chunk handler captured `voiceEnabled`
//      from the closure at hook-call time. If voiceEnabled changed after the
//      function was handed to agent.run(), the stale value was used for the
//      whole response. Fixed by checking the ref at call time instead.
//
//   3. transcribeFile — was recreated on every render because `config` itself
//      is a new object each render (resolveVoiceConfig returns a new ref).
//      Memoised with useRef so the callback is stable.
//
//   4. SentenceBuffer.flush() is now synchronous (matching the fixed tts.ts).
//      Callers that previously awaited it now just call it directly.

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
  handleVoiceKey(input: string, key: Key): boolean;
  /**
   * Wrap an onChunk callback so streamed text is also sent to TTS.
   * Pass the returned function as the `onChunk` option in agent.run().
   */
  makeSpeakingOnChunk(
    originalOnChunk: (chunk: string) => void,
  ): (chunk: string) => void;
  /**
   * Called after the full agent response is available.
   * Flushes the sentence buffer remainder and (for non-streaming tool responses)
   * speaks the complete text directly.
   */
  speakText(text: string, wasStreamed: boolean): Promise<void>;
  /** Interrupt TTS immediately */
  stopSpeaking(): void;
  /** Transcribe a WAV file (exposed for testing) */
  transcribeFile(wavPath: string): Promise<string>;
}

export function useVoice(
  handleSubmit: (value: string) => void,
  configOverrides: Partial<VoiceConfig> = {},
): UseVoiceReturn {
  // BUG FIX 3: Keep a stable ref to the config so useCallback deps don't
  // change on every render just because resolveVoiceConfig returns a new obj.
  const configRef = useRef<VoiceConfig>(resolveVoiceConfig(configOverrides));
  useEffect(() => {
    configRef.current = resolveVoiceConfig(configOverrides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(configOverrides)]);

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [statusLine, setStatusLine] = useState("");

  // BUG FIX 2: Keep a ref to voiceEnabled so closures handed to agent.run()
  // always read the current value, not a stale captured one.
  const voiceEnabledRef = useRef(false);
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  const recordingRef = useRef<RecordingHandle | null>(null);
  const ttsQueueRef = useRef<TTSQueue | null>(null);
  const sentenceBufferRef = useRef<SentenceBuffer | null>(null);

  // Initialise TTSQueue once
  useEffect(() => {
    ttsQueueRef.current = new TTSQueue(configRef.current, (speaking) => {
      setIsSpeaking(speaking);
    });
    return () => {
      ttsQueueRef.current?.interrupt();
    };
  }, []); // intentionally empty — TTSQueue is a singleton for this hook instance

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
      `🎤 Voice ON · STT: ${describeSTTBackend()} · TTS: ${describeTTSBackend(configRef.current)}`,
    );
  }, [voiceEnabled, isRecording, isSpeaking]);

  // ── Toggle voice mode ────────────────────────────────────────────────────

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      if (prev) {
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

  const handleVoiceKey = useCallback(
    (input: string, key: Key): boolean => {
      const isF2 =
        (key as any).name === "F2" ||
        input === "\x1b[12~" ||
        input === "\x1bOQ";
      if (!isF2 || !voiceEnabledRef.current) return false;

      if (!isRecording) {
        try {
          const handle = startRecording(configRef.current);
          recordingRef.current = handle;
          setIsRecording(true);
        } catch (err: any) {
          setStatusLine(`❌ Record failed: ${err.message}`);
        }
      } else {
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
            transcribe(wavPath, configRef.current).then((text) => ({
              wavPath,
              text,
            })),
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

      return true;
    },
    [isRecording, handleSubmit],
  );

  // ── Streaming TTS via onChunk ─────────────────────────────────────────────

  /**
   * Returns a wrapped onChunk callback that feeds text into TTS sentence
   * buffering while also calling the original UI chunk handler.
   *
   * BUG FIX 2: Uses `voiceEnabledRef.current` (not the captured `voiceEnabled`
   * state) so the check is always fresh, even mid-stream.
   */
  const makeSpeakingOnChunk = useCallback(
    (originalOnChunk: (chunk: string) => void): ((chunk: string) => void) => {
      if (!voiceEnabledRef.current) return originalOnChunk;

      const queue = ttsQueueRef.current!;
      queue.reset();

      const buffer = new SentenceBuffer(configRef.current, (sentence) => {
        queue.push(sentence);
      });
      sentenceBufferRef.current = buffer;

      return (chunk: string) => {
        originalOnChunk(chunk);
        // Check ref each time — user may have disabled voice mid-stream
        if (voiceEnabledRef.current) buffer.push(chunk);
      };
    },
    [], // stable — uses refs only
  );

  /**
   * Call after the full agent response is ready.
   *
   * BUG FIX 1: Previous implementation always pushed `text` to the queue,
   * causing double-speech for streaming responses (sentences already queued
   * via onChunk). Now:
   *   - wasStreamed=true  → just flush the buffer remainder (last partial sentence)
   *   - wasStreamed=false → push the full text directly (non-streaming tool response)
   */
  const speakText = useCallback(
    async (text: string, wasStreamed: boolean): Promise<void> => {
      if (!voiceEnabledRef.current) return;

      if (wasStreamed) {
        // Flush the trailing partial sentence from the buffer, if any
        if (sentenceBufferRef.current) {
          sentenceBufferRef.current.flush();
          sentenceBufferRef.current = null;
        }
      } else {
        // Non-streaming: speak the complete response directly
        const queue = ttsQueueRef.current;
        if (queue) {
          queue.reset();
          queue.push(text);
        }
      }
    },
    [],
  );

  const stopSpeaking = useCallback(() => {
    ttsQueueRef.current?.interrupt();
    ttsQueueRef.current?.reset();
    if (sentenceBufferRef.current) {
      sentenceBufferRef.current.reset();
      sentenceBufferRef.current = null;
    }
  }, []);

  // BUG FIX 3: Stable callback — reads config from ref, no dep on config obj
  const transcribeFile = useCallback(
    (wavPath: string) => transcribe(wavPath, configRef.current),
    [],
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
