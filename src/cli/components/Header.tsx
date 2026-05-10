import React from "react";
import { Box, Text } from "ink";
import { APP_NAME, APP_VERSION } from "../../config/constants.js";
import type { ProviderName } from "../../providers/types.js";
import { useTheme } from "../theme/useTheme.js";
import { getFastModel } from "../../providers/utils.js";

interface Props {
  provider: ProviderName;
  model?: string;
}

export function Header({ provider, model }: Props) {
  const { theme } = useTheme();

  return (
    <Box
      borderStyle='double'
      borderColor={theme.border}
      paddingX={1}
      marginBottom={1}
      justifyContent='space-between'
    >
      <Text bold color={theme.secondary}>
        ⚡ {APP_NAME} v{APP_VERSION}
      </Text>
      <Text color={theme.muted}>
        {" "}
        [{provider}
        {model ? ` (${model} / ${getFastModel(provider)})` : ""}]{" "}
      </Text>
      <Text color={theme.muted} dimColor>
        /help for commands
      </Text>
    </Box>
  );
}
