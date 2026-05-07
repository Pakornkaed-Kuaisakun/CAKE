import { useMemo } from "react";

import { COMMANDS } from "../data/commands.js";

export function useAutocomplete(input: string) {
  return useMemo(() => {
    if (!input.trim()) {
      return [];
    }

    const lower = input.toLowerCase();

    return COMMANDS.filter((cmd) => cmd.command.toLowerCase().includes(lower));
  }, [input]);
}
