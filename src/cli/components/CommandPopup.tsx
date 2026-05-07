// src/cli/components/CommandPopUp.tsx
import type { ComponentProps } from "react";
import React from "react";

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
      <Text dimColor>Suggestions ({suggestions.length})</Text>

      {start > 0 && <Text dimColor>↑ more</Text>}

      {visible.map((suggestion, index) => {
        const realIndex = start + index;

        const active = realIndex === selectedIndex;

        return (
          <Text key={suggestion.command} color={active ? "green" : "white"}>
            {active ? "❯ " : "  "}

            {suggestion.command}
          </Text>
        );
      })}

      {start + MAX_VISIBLE < suggestions.length && <Text dimColor>↓ more</Text>}
    </Box>
  );
}
