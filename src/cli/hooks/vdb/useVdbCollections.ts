// src/cli/hooks/useVdbCollections.ts
//
// Reads the names of all VectorDB collections from disk at runtime so the
// autocomplete popup shows real collection names instead of static placeholders.
//
// Design:
//   • Reads ~/.cake/vectordb/*.json on mount and whenever the input changes
//     (cheap — just fs.readdirSync, no file content read).
//   • Returns an empty array gracefully if the directory doesn't exist yet.
//   • Refresh interval: every 3 s while the component is mounted, so newly
//     created collections appear without a restart.

import { useState, useEffect } from "react";
import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../../config/constants.js";

const VECTORDB_DIR = path.join(CAKE_DIR, "vectordb");

function readCollectionNames(): string[] {
  try {
    if (!fs.existsSync(VECTORDB_DIR)) return [];
    return fs
      .readdirSync(VECTORDB_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export function useVdbCollections(): string[] {
  const [collections, setCollections] = useState<string[]>(() =>
    readCollectionNames(),
  );

  useEffect(() => {
    // Refresh every 3 s to pick up newly created collections
    const id = setInterval(() => {
      setCollections(readCollectionNames());
    }, 3_000);
    return () => clearInterval(id);
  }, []);

  return collections;
}
