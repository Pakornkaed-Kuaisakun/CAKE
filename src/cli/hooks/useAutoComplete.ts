// src/cli/hooks/useAutoComplete.ts
//
// Changes vs original:
//   1. Imports useVdbCollections() and buildVdbCommands() for live collection names.
//   2. Imports useVdbDocuments() for live document IDs on vdb_delete.
//   3. Imports useItemHints() for live IDs on todo_remove / cron_remove / calendar_remove.
//   4. Detects which <id> slot is active and injects live hints from disk.
//   5. Everything else is identical to the original implementation.

import { useMemo } from "react";
import { COMMANDS } from "../data/commands.js";
import { buildVdbCommands, DOC_ID_SENTINEL } from "../data/vdbCommands.js";
import { useVdbCollections } from "./vdb/useVdbCollections.js";
import { useVdbDocuments } from "./vdb/useVdbDocuments.js";
import { useItemHints, type RemoveCommand } from "./useItemHints.js";

function stripPlaceholders(cmd: string): string {
  const cleaned = cmd.replace(/(<[^>]+>|\[[^\]]+\])/g, "").trimEnd();
  return cleaned + " ";
}

// ── Slot detectors ────────────────────────────────────────────────────────────

/**
 * vdb_delete <collection> <typing…>
 * Returns collection name when cursor is at word[2], else "".
 */
function detectVdbDeleteSlot(words: string[]): string {
  if (
    words.length === 3 &&
    words[0].toLowerCase() === "vdb_delete" &&
    words[1].length > 0
  ) {
    return words[1];
  }
  return "";
}

/**
 * todo_remove|cron_remove|calendar_remove <typing…>
 * Returns the command name when cursor is at word[1], else "".
 */
const REMOVE_COMMANDS = new Set([
  "todo_remove",
  "cron_remove",
  "calendar_remove",
]);

function detectRemoveSlot(words: string[]): RemoveCommand {
  if (words.length === 2 && REMOVE_COMMANDS.has(words[0].toLowerCase())) {
    return words[0].toLowerCase() as RemoveCommand;
  }
  return "";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAutocomplete(input: string) {
  // ── Parse last pipeline segment once (Rules of Hooks: no conditional calls) ─
  const { lastPart, prefix } = useMemo(() => {
    const parts = input.split("|");
    return {
      prefix: parts.slice(0, -1).join("|"),
      lastPart: parts[parts.length - 1].trimStart(),
    };
  }, [input]);

  const words = useMemo(() => lastPart.split(" "), [lastPart]);

  // ── Live data sources ─────────────────────────────────────────────────────

  const collections = useVdbCollections();
  const activeVdbCol = useMemo(() => detectVdbDeleteSlot(words), [words]);
  const activeRemoveCmd = useMemo(() => detectRemoveSlot(words), [words]);

  const docHints = useVdbDocuments(activeVdbCol);
  const removeHints = useItemHints(activeRemoveCmd);

  // ── Merged command list ───────────────────────────────────────────────────

  const ALL_COMMANDS = useMemo(
    () => {
      const staticNonVdb = COMMANDS.filter(
        (c) => !c.command.toLowerCase().startsWith("vdb"),
      );
      return [...staticNonVdb, ...buildVdbCommands(collections)];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections.join(",")],
  );

  // ── Suggestion computation ────────────────────────────────────────────────

  return useMemo(() => {
    if (!input) return [];
    if (!lastPart && !input.includes("|")) return [];

    const lower = lastPart.toLowerCase();
    const baseCommand = words[0].toLowerCase();

    // ── 1. todo_remove / cron_remove / calendar_remove <id> ─────────────────
    if (activeRemoveCmd && removeHints.length > 0) {
      const typed = words[1]?.toLowerCase() ?? "";
      const matched = removeHints.filter(
        (h) =>
          h.id.toLowerCase().includes(typed) ||
          h.preview.toLowerCase().includes(typed),
      );

      return matched.map((h) => ({
        command: h.id,
        description: h.preview,
        fullCommand: prefix
          ? `${prefix} | ${activeRemoveCmd} ${h.id} `
          : `${activeRemoveCmd} ${h.id} `,
      }));
    }

    // ── 2. vdb_delete <collection> <doc_id> ─────────────────────────────────
    if (activeVdbCol && docHints.length > 0) {
      const typed = words[2]?.toLowerCase() ?? "";
      const matched = docHints.filter(
        (h) =>
          h.id.toLowerCase().includes(typed) ||
          h.preview.toLowerCase().includes(typed),
      );

      if (matched.length > 0) {
        return matched.map((h) => ({
          command: h.id,
          description: h.preview,
          fullCommand: prefix
            ? `${prefix} | vdb_delete ${activeVdbCol} ${h.id} `
            : `vdb_delete ${activeVdbCol} ${h.id} `,
        }));
      }
      return [];
    }

    // ── 3. Generic 2D / 1D parameter completion ──────────────────────────────
    const exactCmd = ALL_COMMANDS.find(
      (cmd) =>
        (cmd.command.toLowerCase() === baseCommand ||
          cmd.command.toLowerCase().split(" ")[0] === baseCommand) &&
        cmd.parameters,
    );

    if (exactCmd && words.length > 1) {
      const rawParams = exactCmd.parameters || [];
      const is2D = Array.isArray(rawParams[0]);

      if (is2D) {
        const paramIndex = words.length - 2;
        const rawItem = rawParams[paramIndex];
        let params: string[] = Array.isArray(rawItem) ? rawItem : [];

        if (params.includes(DOC_ID_SENTINEL)) {
          params = docHints.map((h) => h.id);
        }

        const paramInput = words[words.length - 1].toLowerCase();
        const filteredParams = params.filter((p) =>
          p.toLowerCase().includes(paramInput),
        );

        if (filteredParams.length > 0) {
          return filteredParams.map((p) => {
            const completedPrefix = words.slice(0, words.length - 1).join(" ");
            const descLabel = paramIndex === 0 ? "collection" : "parameter";
            return {
              command: p,
              description: `${descLabel} for ${exactCmd.command.split(" ")[0]}`,
              fullCommand: prefix
                ? `${prefix} | ${completedPrefix} ${p} `
                : `${completedPrefix} ${p} `,
            };
          });
        }
      } else {
        const paramInput = words.slice(1).join(" ").toLowerCase();
        const params = rawParams.filter(
          (p): p is string => typeof p === "string",
        );
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

    // ── 4. Command name prefix match ──────────────────────────────────────────
    const filtered = ALL_COMMANDS.filter((cmd) =>
      cmd.command.toLowerCase().includes(lower),
    );

    return filtered.map((cmd) => {
      const cleaned = stripPlaceholders(cmd.command);
      return {
        ...cmd,
        fullCommand: prefix ? `${prefix} | ${cleaned}` : cleaned,
      };
    });
  }, [
    input,
    lastPart,
    words,
    prefix,
    ALL_COMMANDS,
    docHints,
    removeHints,
    activeRemoveCmd,
    activeVdbCol,
  ]);
}
