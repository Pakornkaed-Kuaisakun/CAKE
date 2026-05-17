import { useMemo } from "react";

import { COMMANDS } from "../data/commands.js";

function stripPlaceholders(cmd: string): string {
  // Replace <value> and [optional] with nothing, then trim and add a trailing space
  const cleaned = cmd.replace(/(<[^>]+>|\[[^\]]+\])/g, "").trimEnd();
  return cleaned + " ";
}

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
    const words = lastPart.split(" ");
    const baseCommand = words[0].toLowerCase();

    // Check if we are typing parameters for a command
    const exactCmd = COMMANDS.find(
      (cmd) =>
        (cmd.command.toLowerCase() === baseCommand ||
          cmd.command.toLowerCase().split(" ")[0] === baseCommand) &&
        cmd.parameters,
    );

    if (exactCmd && words.length > 1) {
      const rawParams = exactCmd.parameters || [];
      
      let params: string[] = [];
      let is2D = Array.isArray(rawParams[0]);
      
      if (is2D) {
        const paramIndex = words.length - 2;
        const rawItem = rawParams[paramIndex];
        params = Array.isArray(rawItem) ? rawItem : [];
        
        const paramInput = words[words.length - 1].toLowerCase();
        const filteredParams = params.filter((p) =>
          p.toLowerCase().includes(paramInput),
        );

        if (filteredParams.length > 0) {
          return filteredParams.map((p) => {
            const completedPrefix = words.slice(0, words.length - 1).join(" ");
            return {
              command: p,
              description: `Parameter for ${exactCmd.command}`,
              fullCommand: prefix
                ? `${prefix} | ${completedPrefix} ${p} `
                : `${completedPrefix} ${p} `,
            };
          });
        }
      } else {
        const paramInput = words.slice(1).join(" ").toLowerCase();
        params = rawParams.filter((p): p is string => typeof p === "string");
        const filteredParams = params.filter((p) =>
          p.toLowerCase().includes(paramInput),
        );

        if (filteredParams.length > 0) {
          return filteredParams.map((p) => ({
            command: p,
            description: `Parameter for ${exactCmd.command}`,
            fullCommand: prefix
              ? `${prefix} | ${words[0]} ${p} `
              : `${words[0]} ${p} `,
          }));
        }
      }
    }

    const filtered = COMMANDS.filter((cmd) =>
      cmd.command.toLowerCase().includes(lower),
    );

    return filtered.map((cmd) => {
      const cleaned = stripPlaceholders(cmd.command);
      return {
        ...cmd,
        // Create the full string to be used when this suggestion is selected
        fullCommand: prefix ? `${prefix} | ${cleaned}` : cleaned,
      };
    });
  }, [input]);
}
