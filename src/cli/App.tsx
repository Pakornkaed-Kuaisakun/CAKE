// src/cli/App.tsx
import React, { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { Header } from "./components/Header.js";
import { MessageList } from "./components/MessageList.js";
import { InputBar } from "./components/InputBar.js";
import { useAgent } from "./hooks/useAgent.js";
import { VoiceBar } from "./components/VoiceBar.js";
import { useVoice } from "./hooks/useVoice.js";
import { LockerBar } from "./components/LockerBar.js";

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `<$0.001`;
  return `$${usd.toFixed(4)}`;
}

export function App() {
  const {
    messages,
    msgVersion,
    input,
    setInput,
    loading,
    thinkingMs,
    providerName,
    model,
    handleSubmit,
    stats,
    registerVoice,
    locker,
    addMsg,
    commandHistory,
  } = useAgent();

  // BUG FIX: useVoice's speakText and makeSpeakingOnChunk signatures changed.
  // The hook no longer accepts an `onResponseEnd` callback in makeSpeakingOnChunk
  // (that was an unused parameter in the original signature).
  // speakText now requires a `wasStreamed` boolean argument.
  // App.tsx wires the voice hook to useAgent via registerVoice — the actual
  // calls happen inside useAgent.ts, so App.tsx only needs to handle F2 and UI.
  const voice = useVoice(handleSubmit);
  const {
    voiceEnabled,
    isRecording,
    isSpeaking,
    statusLine,
    toggleVoice,
    handleVoiceKey,
    stopSpeaking,
  } = voice;

  useEffect(() => {
    registerVoice(voice);
  }, [voice, registerVoice]);

  useInput((input, key) => {
    if (handleVoiceKey(input, key)) return; // F2 consumed

    // Stop speaking on any regular key press
    if (isSpeaking && !key.ctrl) {
      stopSpeaking();
    }
  });

  const hasUsage = stats.totalInputTokens > 0 || stats.totalOutputTokens > 0;

  return (
    <Box flexDirection='column'>
      <Header provider={providerName} model={model} />

      <MessageList messages={messages} version={msgVersion} />

      {locker.lockerState.step !== "idle" && (
        <LockerBar
          step={locker.lockerState.step}
          prompt={locker.lockerState.prompt}
        />
      )}

      {voiceEnabled && (
        <VoiceBar
          isRecording={isRecording}
          isSpeaking={isSpeaking}
          statusLine={statusLine}
        />
      )}

      {/* ── Thinking indicator ── */}
      {loading && (
        <Box marginBottom={1} gap={1}>
          <Text color='cyan'>
            <Spinner type='dots' />
          </Text>
          <Text color='cyan'>Thinking…</Text>
          {thinkingMs !== null && (
            <Text color='gray'>{formatMs(thinkingMs)}</Text>
          )}
        </Box>
      )}

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        loading={loading}
        masked={locker.shouldMask}
        onCancelLocker={() => {
          locker.cancelLockerFlow();
          addMsg("system", "🔐 Locker flow cancelled.");
        }}
        lockerActive={locker.lockerState.step !== "idle"}
        commandHistory={commandHistory}
      />

      {/* ── Session token/cost footer ── */}
      {hasUsage && (
        <Box marginTop={1} gap={2}>
          <Text color='gray'>
            Tokens: {stats.totalInputTokens}↑ {stats.totalOutputTokens}↓
          </Text>
          {stats.totalCachedTokens > 0 && (
            <Text color='green'>
              ⚡ cached: {stats.totalCachedTokens.toLocaleString()} (
              {(
                (stats.totalCachedTokens / stats.totalInputTokens) *
                100
              ).toFixed(0)}
              %)
            </Text>
          )}
          {stats.totalCostUsd > 0 && (
            <Text color='gray'>cost: {formatCost(stats.totalCostUsd)}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
