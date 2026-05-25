// src/cli/App.tsx
//
// Claude Code-style layout:
//   - Full welcome card on first load (two-column with pixel art cake + tips)
//   - Collapses to compact header bar once user starts chatting
//   - Warm orange/tomato accent palette on dark background

import React, { useEffect, useState } from "react";
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

  // Collapse welcome card once user has sent at least one message
  const [compactHeader, setCompactHeader] = useState(false);

  useEffect(() => {
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length > 0 && !compactHeader) {
      setCompactHeader(true);
    }
  }, [messages]);

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
    if (handleVoiceKey(input, key)) return;
    if (isSpeaking && !key.ctrl) {
      stopSpeaking();
    }
  });

  const hasUsage = stats.totalInputTokens > 0 || stats.totalOutputTokens > 0;

  // Recent activity: last few assistant messages summaries
  const recentActivity = messages
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .map((m) => `▶ ${m.content.slice(0, 55).replace(/\n/g, " ")}…`);

  return (
    <Box flexDirection='column'>
      {/* Welcome card or compact bar */}
      <Header
        provider={providerName}
        model={model}
        // compact={compactHeader}
        // recentActivity={recentActivity}
      />

      {/* Message history */}
      <MessageList messages={messages} version={msgVersion} />

      {/* Locker flow prompt */}
      {locker.lockerState.step !== "idle" && (
        <LockerBar
          step={locker.lockerState.step}
          prompt={locker.lockerState.prompt}
        />
      )}

      {/* Voice status bar */}
      {voiceEnabled && (
        <VoiceBar
          isRecording={isRecording}
          isSpeaking={isSpeaking}
          statusLine={statusLine}
        />
      )}

      {/* Thinking indicator */}
      {loading && (
        <Box marginBottom={1} gap={1}>
          <Text color='#e85d4a'>
            <Spinner type='dots' />
          </Text>
          <Text color='#e85d4a'>Thinking…</Text>
          {thinkingMs !== null && (
            <Text color='gray'>{formatMs(thinkingMs)}</Text>
          )}
        </Box>
      )}

      {/* Input bar */}
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

      {/* Token / cost footer */}
      {hasUsage && (
        <Box marginTop={1} gap={2}>
          <Text color='gray'>
            Tokens: {stats.totalInputTokens}↑ {stats.totalOutputTokens}↓
          </Text>
          {stats.totalCachedTokens > 0 && (
            <Text color='#4caf50'>
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
