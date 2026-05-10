// src/cli/components/CommandPopUp.tsx
import type { ComponentProps } from "react";
import React from "react";
import { useTheme } from "../theme/useTheme.js";

import { Box, Text } from "ink";

interface Suggestion {
  command: string;

  description?: string;
}

interface Props {
  suggestions: Suggestion[];

  selectedIndex: number;
}

const MAX_VISIBLE = 4;

export function CommandPopup({ suggestions, selectedIndex }: Props) {
  const { theme } = useTheme();

  if (suggestions.length === 0) {
    return null;
  }

  /**
   * Scroll window
   */

  const start = Math.max(0, selectedIndex - MAX_VISIBLE + 1);

  const visible = suggestions.slice(start, start + MAX_VISIBLE);

  return (
    <Box flexDirection='column' marginTop={0.5} marginBottom={1}>
      <Text color={theme.muted}>Suggestions ({suggestions.length})</Text>

      {start > 0 && <Text color={theme.muted}>↑ more</Text>}

      {visible.map((suggestion, index) => {
        const realIndex = start + index;

        const active = realIndex === selectedIndex;

        return (
          <Text
            key={suggestion.command}
            color={active ? theme.primary : theme.text}
          >
            {active ? "❯ " : "  "}

            {suggestion.command}
          </Text>
        );
      })}

      {start + MAX_VISIBLE < suggestions.length && (
        <Text color={theme.muted}>↓ more</Text>
      )}
    </Box>
  );
}
