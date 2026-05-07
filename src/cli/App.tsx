// src/cli/App.tsx
import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Header } from "./components/Header.js";
import { MessageList } from "./components/MessageList.js";
import { InputBar } from "./components/InputBar.js";
import { useAgent } from "./hooks/useAgent.js";

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
  } = useAgent();

  const hasUsage = stats.totalInputTokens > 0 || stats.totalOutputTokens > 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Header provider={providerName} model={model} />

      <MessageList messages={messages} version={msgVersion} />

      {/* ── Thinking indicator ── */}
      {loading && (
        <Box marginBottom={1} gap={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text color="cyan">Thinking…</Text>
          {thinkingMs !== null && (
            <Text color="gray">{formatMs(thinkingMs)}</Text>
          )}
        </Box>
      )}

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        loading={loading}
      />

      {/* ── Session token/cost footer ── */}
      {hasUsage && (
        <Box marginTop={1} gap={2}>
          <Text color="gray">
            Tokens: {stats.totalInputTokens}↑ {stats.totalOutputTokens}↓
          </Text>
          {stats.totalCostUsd > 0 && (
            <Text color="gray">
              Session cost: {formatCost(stats.totalCostUsd)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
