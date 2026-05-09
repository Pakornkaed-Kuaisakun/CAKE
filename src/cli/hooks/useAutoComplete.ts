import { useMemo } from "react";

import { COMMANDS } from "../data/commands.js";

export function useAutocomplete(input: string) {
  return useMemo(() => {
    if (!input) {
      return [];
    }

    const parts = input.split("|");
    const prefix = parts.slice(0, -1).join("|");
    const lastPart = parts[parts.length - 1].trimStart();

    if (!lastPart && !input.includes("|")) {
      return [];
    }

    const lower = lastPart.toLowerCase();

    const filtered = COMMANDS.filter((cmd) =>
      cmd.command.toLowerCase().includes(lower),
    );

    return filtered.map((cmd) => ({
      ...cmd,
      // Create the full string to be used when this suggestion is selected
      fullCommand: prefix ? `${prefix} | ${cmd.command}` : cmd.command,
    }));
  }, [input]);
}
