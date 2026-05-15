// src/cli/components/VoiceBar.tsx
//
// Ink status bar rendered in App.tsx when voice mode is active.
// Shows recording / speaking / idle state with animated indicators.
//
// Placement in App.tsx — add between MessageList and the thinking indicator:
//
//   {voiceEnabled && (
//     <VoiceBar
//       isRecording={isRecording}
//       isSpeaking={isSpeaking}
//       statusLine={statusLine}
//     />
//   )}

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/useTheme.js";

interface Props {
  isRecording: boolean;
  isSpeaking: boolean;
  statusLine: string;
}

// ── Animated waveform for recording ──────────────────────────────────────────

const WAVE_FRAMES = [
  "▁▂▃▄▅▆▇█",
  "▂▃▄▅▆▇█▁",
  "▃▄▅▆▇█▁▂",
  "▄▅▆▇█▁▂▃",
  "▅▆▇█▁▂▃▄",
  "▆▇█▁▂▃▄▅",
  "▇█▁▂▃▄▅▆",
  "█▁▂▃▄▅▆▇",
];

// Pulse frames for speaking
const PULSE_FRAMES = ["◉ ◯ ◯", "◯ ◉ ◯", "◯ ◯ ◉", "◯ ◉ ◯"];

function useAnimFrame(frames: string[], fps = 8, active = true): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) {
      setIdx(0);
      return;
    }
    const t = setInterval(
      () => setIdx((i) => (i + 1) % frames.length),
      1000 / fps,
    );
    return () => clearInterval(t);
  }, [active, frames.length, fps]);
  return frames[idx];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VoiceBar({ isRecording, isSpeaking, statusLine }: Props) {
  const { theme } = useTheme();
  const wave = useAnimFrame(WAVE_FRAMES, 10, isRecording);
  const pulse = useAnimFrame(PULSE_FRAMES, 6, isSpeaking);

  const borderColor = isRecording
    ? theme.danger
    : isSpeaking
      ? theme.secondary
      : theme.muted;

  return (
    <Box
      borderStyle='single'
      borderColor={borderColor}
      paddingX={1}
      marginBottom={0}
      gap={2}
    >
      {/* Left: animated indicator */}
      {isRecording && (
        <Text color={theme.danger} bold>
          {wave}
        </Text>
      )}
      {isSpeaking && !isRecording && (
        <Text color={theme.secondary}>{pulse}</Text>
      )}
      {!isRecording && !isSpeaking && <Text color={theme.muted}>🎤</Text>}

      {/* Status text */}
      <Text
        color={
          isRecording
            ? theme.danger
            : isSpeaking
              ? theme.secondary
              : theme.muted
        }
      >
        {statusLine}
      </Text>

      {/* Right: F2 hint when idle */}
      {!isRecording && !isSpeaking && (
        <Box marginLeft={1}>
          <Text color={theme.muted} dimColor>
            F2 push-to-talk · /voice off to disable
          </Text>
        </Box>
      )}
    </Box>
  );
}
