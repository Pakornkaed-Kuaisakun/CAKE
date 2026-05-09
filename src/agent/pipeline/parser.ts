import type { PipelineStep } from "./types.js";

// Separators we recognise: '|', '|>', '->', '=>'
const PIPE_RE = /\s+(?:\|>?|->|=>)\s+/;

/**
 * Parse a composed command string into an ordered list of pipeline steps.
 *
 * Examples:
 *   "directory_tree src"                     → [{command:"directory_tree", args:"src"}]
 *   "directory_tree src | export txt out.txt" → [{command:"directory_tree", args:"src"},
 *                                                {command:"export",         args:"txt out.txt"}]
 *   "email | export md inbox.md"             → [...]
 */

export function parsePipeline(input: string): PipelineStep[] {
  const segments = input
    .split(PIPE_RE)
    .map((s) => s.trim())
    .filter(Boolean);

  return segments.map((raw) => {
    const spaceIdx = raw.search(/\s/);
    if (spaceIdx === -1) {
      return { command: raw.toLocaleLowerCase(), args: "", raw };
    }
    return {
      command: raw.slice(0, spaceIdx).toLocaleLowerCase(),
      args: raw.slice(spaceIdx + 1).trim(),
      raw,
    };
  });
}

// Return true only when input contains a pipe separator
export function hasPipe(input: string): boolean {
  return PIPE_RE.test(input);
}
