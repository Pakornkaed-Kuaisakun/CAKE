import React from "react";
import { Box, Text } from "ink";
import { APP_NAME, APP_VERSION } from "../../config/constants.js";
import type { ProviderName } from "../../providers/types.js";
import { getFastModel } from "../../providers/utils.js";

interface Props {
  provider: ProviderName;
  model?: string;
}

export function Header({ provider, model }: Props) {
  return (
    <Box
      borderStyle='double'
      borderColor='cyan'
      paddingX={1}
      marginBottom={1}
      justifyContent='space-between'
    >
      <Text bold color='cyan'>
        ⚡ {APP_NAME} v{APP_VERSION}
      </Text>
      <Text color='gray'>
        {" "}
        [{provider}
        {model ? ` (${model} / ${getFastModel(provider)})` : ""}]{" "}
      </Text>
      <Text color='gray' dimColor>
        /help for commands
      </Text>
    </Box>
  );
}
