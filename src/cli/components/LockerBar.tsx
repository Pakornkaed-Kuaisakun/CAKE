// src/cli/components/LockerBar.tsx
//
// Shown in App.tsx when the locker flow is active.
// Renders the current prompt and masks input during password entry.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/useTheme.js";
import type { LockerStep } from "../hooks/useLocker.js";

interface Props {
  step: LockerStep;
  prompt: string;
}

export function LockerBar({ step, prompt }: Props) {
  const { theme } = useTheme();

  if (step === "idle") return null;

  const icon = step === "needs_password" ? "🔑" : "✏️";
  const borderColor =
    step === "needs_password" ? theme.warning : theme.secondary;

  return (
    <Box
      borderStyle='single'
      borderColor={borderColor}
      paddingX={1}
      marginBottom={0}
      flexDirection='column'
    >
      <Box gap={1}>
        <Text color={borderColor} bold>
          {icon} LOCKER
        </Text>
        <Text color={theme.text}>{prompt}</Text>
      </Box>
      {step === "needs_password" && (
        <Text color={theme.muted} dimColor>
          Input is hidden • Press Enter to confirm
        </Text>
      )}
      {step === "needs_value" && (
        <Text color={theme.muted} dimColor>
          Type the secret value • Press Enter to confirm (next: password)
        </Text>
      )}
    </Box>
  );
}
