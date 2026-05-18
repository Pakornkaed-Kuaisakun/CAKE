// src/cli/hooks/useVdbDocuments.ts
//
// Reads document IDs and short preview text from a single collection file
// so the autocomplete popup can show real doc IDs when the user is typing
// the second argument of vdb_delete.
//
// Design:
//   • Input: a collection name string (empty string = disabled).
//   • Reads ~/.cake/vectordb/<collection>.json synchronously on every change
//     of `collection` (the file is small — typically <1 MB).
//   • Returns VdbDocHint[] — id + a trimmed 60-char preview of the text.
//   • Returns [] gracefully if the file doesn't exist or can't be parsed.

import { useState, useEffect } from "react";
import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../../config/constants.js";

const VECTORDB_DIR = path.join(CAKE_DIR, "vectordb");

export interface VdbDocHint {
  /** Full UUID, e.g. "3f2a1b4c-..." */
  id: string;
  /** Short preview shown next to the ID in the suggestion popup */
  preview: string;
  /** Formatted label: first 8 chars of ID + preview — shown as the suggestion command */
  label: string;
}

function readDocHints(collection: string): VdbDocHint[] {
  if (!collection) return [];
  const fp = path.join(VECTORDB_DIR, `${collection}.json`);
  try {
    if (!fs.existsSync(fp)) return [];
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
    const docs: any[] = raw?.documents ?? [];
    return docs.map((d) => {
      const preview = String(d.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      return {
        id: String(d.id ?? ""),
        preview: preview
          ? `"${preview}${d.text?.length > 60 ? "…" : ""}"`
          : "(no text)",
        label: String(d.id ?? "").slice(0, 8),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Returns document hints for `collection`.
 * Re-reads from disk whenever `collection` changes.
 * Also polls every 2 s so deletes/adds mid-session are reflected.
 */
export function useVdbDocuments(collection: string): VdbDocHint[] {
  const [hints, setHints] = useState<VdbDocHint[]>(() =>
    readDocHints(collection),
  );

  useEffect(() => {
    // Immediate read on collection change
    setHints(readDocHints(collection));

    if (!collection) return;

    // Poll every 2 s while a collection is active
    const id = setInterval(() => {
      setHints(readDocHints(collection));
    }, 2_000);

    return () => clearInterval(id);
  }, [collection]);

  return hints;
}
