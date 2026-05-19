// src/cli/data/vdbCommands.ts
//
// Builds the VectorDB command suggestion list dynamically so that the
// <collection> parameter slot is always populated with real collection
// names read from disk — not hard-coded placeholders.
//
// vdb_delete is special: its second parameter slot uses the sentinel
// DOC_ID_SENTINEL so useAutocomplete knows to fetch live document IDs
// from the collection chosen in the first slot.

import type { CommandSuggestion } from "./commands.js";

/**
 * Sentinel value placed in parameters[1] of vdb_delete.
 * useAutocomplete detects this and replaces it with real doc IDs
 * read from the collection named in words[1].
 */
export const DOC_ID_SENTINEL = "__VDB_DOC_IDS__";

/**
 * Build the full VDB command list.
 * @param collections  Live list of collection names read from ~/.cake/vectordb/
 */
export function buildVdbCommands(collections: string[]): CommandSuggestion[] {
  // The "select a collection" parameter slot.
  // Always include a generic placeholder so commands appear before any
  // collection has been created.
  const colParams: string[] =
    collections.length > 0 ? collections : ["<collection>"];

  return [
    // ── Query / search ───────────────────────────────────────────────────────
    {
      command: "vdb_query <collection> <question>",
      description: "Semantic search in a collection + AI answer",
      parameters: [colParams],
    },
    {
      command: "vdb_query",
      description: "Search ALL collections in local vector DB",
    },

    // ── Add / ingest ─────────────────────────────────────────────────────────
    {
      command: "vdb_add <collection> <text>",
      description: "Add a text snippet to a collection",
      parameters: [colParams],
    },
    {
      command: "vdb_ingest <collection> <path>",
      description: "Ingest a PDF/DOCX/TXT file into a collection (chunked)",
      parameters: [colParams],
    },

    // ── Create ───────────────────────────────────────────────────────────────
    {
      command: "vdb_create <collection>",
      description: "Create a new empty collection",
    },

    // ── List / inspect ───────────────────────────────────────────────────────
    {
      command: "vdb_list",
      description: "List all collections",
    },
    {
      command: "vdb_list <collection>",
      description: "List documents inside a collection",
      parameters: [colParams],
    },
    {
      command: "vdb_info <collection>",
      description: "Show collection statistics + sample documents",
      parameters: [colParams],
    },

    // ── Delete ───────────────────────────────────────────────────────────────
    // parameters is a 2D array:
    //   slot 0 → collection names  (live list)
    //   slot 1 → DOC_ID_SENTINEL   (replaced at runtime by useAutocomplete
    //                               with real IDs from the chosen collection)
    {
      command: "vdb_delete <collection> <doc_id>",
      description: "Delete a document by ID from a collection",
      parameters: [colParams, [DOC_ID_SENTINEL]],
    },

    // ── Drop / clear ─────────────────────────────────────────────────────────
    {
      command: "vdb_drop <collection>",
      description: "Delete an entire collection and all its data",
      parameters: [colParams],
    },
    {
      command: "vdb_clear <collection>",
      description: "Remove all documents from a collection",
      parameters: [colParams],
    },
  ];
}
