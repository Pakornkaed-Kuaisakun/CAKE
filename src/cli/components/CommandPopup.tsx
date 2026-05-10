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

function CommandWithPlaceholders({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const { theme } = useTheme();
  // Split by <...>, [...]
  const parts = text.split(/(<[^>]+>|\[[^\]]+\])/g);

  return (
    <Text color={active ? theme.primary : theme.text}>
      {parts.map((part, i) => {
        if (part.startsWith("<") && part.endsWith(">")) {
          return (
            <Text key={i} color={theme.parameter}>
              {part}
            </Text>
          );
        }
        if (part.startsWith("[") && part.endsWith("]")) {
          return (
            <Text key={i} color={theme.muted}>
              {part}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

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
          <Box key={suggestion.command} flexDirection='row'>
            <Text color={active ? theme.primary : theme.text}>
              {active ? "❯ " : "  "}
            </Text>
            <CommandWithPlaceholders
              text={suggestion.command}
              active={active}
            />
            {suggestion.description && (
              <Box marginLeft={2}>
                <Text color={theme.muted} dimColor={!active}>
                  {suggestion.description}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {start + MAX_VISIBLE < suggestions.length && (
        <Text color={theme.muted}>↓ more</Text>
      )}
    </Box>
  );
}
