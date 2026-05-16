// src/cli/hooks/useRawKey.ts
import { useEffect, useRef } from "react";

// Known F2 escape sequences across terminals / OS
const F2_SEQUENCES = new Set([
  "\x1b[12~", // xterm, Windows Terminal
  "\x1bOQ", // VT100 / some Linux terms
  "\x1b[[B", // Linux console
  "\x00;68", // old Windows cmd.exe
  "\x00B", // older Windows cmd.exe scan code
]);

type RawKeyCallback = (seq: string) => void;

/**
 * Fires `onF2` every time the terminal sends an F2 sequence over raw stdin.
 * Safe to call multiple times — only one listener is registered.
 */
export function useRawF2(onF2: () => void) {
  const cbRef = useRef(onF2);
  cbRef.current = onF2;

  useEffect(() => {
    if (!process.stdin.isTTY) return;

    // Save and enable raw mode (Ink may already have done this, but be safe)
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch {}
    process.stdin.resume();

    const onData = (buf: Buffer) => {
      const seq = buf.toString("binary"); // keep raw bytes
      // Match against known F2 sequences
      if (F2_SEQUENCES.has(seq)) {
        cbRef.current();
      }
    };

    process.stdin.on("data", onData);

    return () => {
      process.stdin.off("data", onData);
      // Restore raw mode only if we changed it
      if (!wasRaw) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
    };
  }, []); // runs once
}
