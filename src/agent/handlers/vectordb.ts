// src/agent/handlers/vectordb.ts
//
// Handler for all local-vector-database operations.
//
// Intents / commands:
//   vdb_query    <collection?> <question>     — semantic search + LLM answer
//   vdb_add      <collection> <text>          — ingest a text snippet
//   vdb_ingest   <collection> <file_path>     — ingest a file (chunked)
//   vdb_list     [collection]                 — list collections or documents
//   vdb_delete   <collection> <doc_id>        — delete one document
//   vdb_drop     <collection>                 — delete entire collection
//   vdb_create   <collection> [description]   — create an empty collection
//   vdb_clear    <collection>                 — remove all docs from collection
//   vdb_info     <collection>                 — show collection metadata + samples
//
// All intents are also reachable via natural-language routing through AiRouter.

import type { AIProvider, ChatResult } from "../../providers/types.js";
import { text } from "../utils/text.js";
import {
  ingestText,
  ingestFile,
  queryAndAnswer,
  createCollection,
  listCollections,
  listDocuments,
  deleteDocument,
  deleteCollection,
  clearDocuments,
  collectionExists,
  VECTORDB_DIR,
} from "../../modules/vectordb/index.js";
import {
  stripVerb,
  splitCollectionPayload,
  formatScore,
} from "../../shared/utils/utils.js";

// ── vdb_query ─────────────────────────────────────────────────────────────────

export async function handleVdbQuery(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  // Patterns:
  //   vdb_query <question>                     → search ALL collections
  //   vdb_query <collection> <question>        → search specific collection
  //   vdb_query in <collection> <question>
  //   ask <collection> <question>              (natural language)

  let raw = stripVerb(input, [
    "vdb_query",
    "vdb_search",
    "vdb_ask",
    "vectordb_query",
    "query",
  ]);

  let collectionName: string | null = null;

  // "in <collection>" pattern
  const inMatch = raw.match(/^in\s+(\S+)\s+([\s\S]+)/i);
  if (inMatch) {
    collectionName = inMatch[1];
    raw = inMatch[2];
  } else {
    // Try "first word is a known collection" heuristic
    const { collection, payload } = splitCollectionPayload(raw);
    if (payload && collectionExists(collection)) {
      collectionName = collection;
      raw = payload;
    }
  }

  if (!raw) {
    return text(
      "Usage: vdb_query [collection] <question>\n" +
        "Example: vdb_query diseases What are the symptoms of malaria?\n" +
        "         vdb_query What is dengue fever?",
    );
  }

  const { answer, sources, usedEmbedding } = await queryAndAnswer(
    provider,
    raw,
    { collectionName, limit: 5, model },
  );

  const searchType = usedEmbedding ? "semantic" : "keyword";
  const scope = collectionName
    ? `collection "${collectionName}"`
    : "all collections";

  const sourceLines =
    sources.length > 0
      ? "\n\nSources:\n" +
        sources
          .map(
            (s, i) =>
              `  [${i + 1}] ${s.collection} — ${formatScore(s.score)} match\n` +
              `       "${s.document.text.slice(0, 80).replace(/\n/g, " ")}${s.document.text.length > 80 ? "…" : ""}"`,
          )
          .join("\n")
      : "";

  return text(
    `[VDB] ${searchType} search in ${scope}\n` +
      "─".repeat(50) +
      "\n" +
      answer +
      sourceLines,
  );
}

// ── vdb_add ───────────────────────────────────────────────────────────────────

export async function handleVdbAdd(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_add", "vdb_insert", "vdb_store"]);
  const { collection, payload } = splitCollectionPayload(raw);

  if (!collection || !payload) {
    return text(
      "Usage: vdb_add <collection> <text>\n" +
        'Example: vdb_add diseases "Malaria is caused by Plasmodium parasites…"',
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(collection)) {
    return text(
      `[VDB] Invalid collection name "${collection}". ` +
        `Collection names must contain only letters, numbers, underscores, and hyphens.\n` +
        `Did you mean: vdb_add <collection> <text>?`,
    );
  }

  const { id, usedEmbedding } = await ingestText(provider, collection, payload);
  const embeddingNote = usedEmbedding
    ? "embedded ✓"
    : "stored (no embedding — keyword-only)";

  return text(
    `[VDB] Added to "${collection}"\n` +
      `  ID        : ${id}\n` +
      `  Embedding : ${embeddingNote}\n` +
      `  Preview   : "${payload.slice(0, 100)}${payload.length > 100 ? "…" : ""}"`,
  );
}

// ── vdb_ingest ────────────────────────────────────────────────────────────────

export async function handleVdbIngest(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, [
    "vdb_ingest",
    "vdb_import",
    "vdb_load",
    "vdb_index",
  ]);
  const { collection, payload: filePath } = splitCollectionPayload(raw);

  if (!collection || !filePath) {
    return text(
      "Usage: vdb_ingest <collection> <file_path>\n" +
        "Example: vdb_ingest diseases /data/medical-reference.pdf\n" +
        "Supported: .pdf .docx .txt .md",
    );
  }

  try {
    const { chunks, usedEmbedding } = await ingestFile(
      provider,
      collection,
      filePath,
    );
    const embeddingNote = usedEmbedding
      ? "semantic embeddings ✓"
      : "keyword-only (switch to openai or ollama for embeddings)";

    return text(
      `[VDB] Ingested file into "${collection}"\n` +
        `  File      : ${filePath}\n` +
        `  Chunks    : ${chunks}\n` +
        `  Embedding : ${embeddingNote}`,
    );
  } catch (err: any) {
    return text(`[VDB] Failed to ingest file.\n${err.message}`);
  }
}

// ── vdb_create ────────────────────────────────────────────────────────────────

export async function handleVdbCreate(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_create", "vdb_new", "vdb_init"]);
  const { collection, payload: description } = splitCollectionPayload(raw);

  if (!collection) {
    return text(
      "Usage: vdb_create <collection> [description]\n" +
        "Example: vdb_create diseases Medical disease reference database",
    );
  }

  const col = createCollection(collection, description || "");
  return text(
    `[VDB] Collection created\n` +
      `  Name        : ${col.name}\n` +
      `  Description : ${col.description || "(none)"}\n` +
      `  Path        : ${VECTORDB_DIR}/${col.name}.json\n\n` +
      `Add data with: vdb_add ${col.name} <text>`,
  );
}

// ── vdb_list ──────────────────────────────────────────────────────────────────

export async function handleVdbList(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_list", "vdb_ls", "vdb_show"]);

  // If a collection name follows, list its documents
  if (raw && !raw.match(/^--?h(elp)?$/i)) {
    const { collection } = splitCollectionPayload(raw);

    if (!collectionExists(collection)) {
      return text(`[VDB] Collection "${collection}" not found.`);
    }

    const docs = listDocuments(collection, 20);
    if (docs.length === 0) {
      return text(
        `[VDB] Collection "${collection}" is empty.\n` +
          `Add data with: vdb_add ${collection} <text>`,
      );
    }

    const rows = docs.map((d, i) => {
      const meta =
        Object.keys(d.metadata).length > 0
          ? `  metadata: ${JSON.stringify(d.metadata).slice(0, 60)}`
          : "";
      return (
        `${String(i + 1).padStart(3)}. [${d.id.slice(0, 8)}] ` +
        `"${d.text.slice(0, 70).replace(/\n/g, " ")}${d.text.length > 70 ? "…" : ""}"\n` +
        (meta ? `       ${meta}\n` : "")
      );
    });

    return text(
      `[VDB] "${collection}" — ${docs.length} document(s)\n` +
        "─".repeat(50) +
        "\n" +
        rows.join("\n") +
        (docs.length === 20 ? "\n(Showing first 20 — there may be more)" : ""),
    );
  }

  // List all collections
  const collections = listCollections();
  if (collections.length === 0) {
    return text(
      "[VDB] No collections yet.\n\n" +
        "Create one with: vdb_create <name> [description]\n" +
        "Or add directly: vdb_add <collection> <text>",
    );
  }

  const rows = collections.map(
    (c, i) =>
      `${String(i + 1).padStart(3)}. ${c.name.padEnd(20)} ${String(c.documentCount).padStart(5)} docs` +
      (c.description ? `\n       ${c.description}` : ""),
  );

  return text(
    `[VDB] ${collections.length} collection(s) — ${VECTORDB_DIR}\n` +
      "─".repeat(50) +
      "\n" +
      rows.join("\n") +
      "\n\nQuery with: vdb_query [collection] <question>",
  );
}

// ── vdb_delete ────────────────────────────────────────────────────────────────

export async function handleVdbDelete(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_delete", "vdb_remove", "vdb_del"]);
  const parts = raw.split(/\s+/);

  if (parts.length < 2) {
    return text(
      "Usage: vdb_delete <collection> <doc_id>\n" +
        "Tip: Use vdb_list <collection> to see document IDs",
    );
  }

  const [collection, docId] = parts;
  const success = deleteDocument(collection, docId);

  if (!success) {
    return text(
      `[VDB] Document not found.\n  Collection: ${collection}\n  ID: ${docId}`,
    );
  }

  return text(
    `[VDB] ✅ Deleted document\n  Collection: ${collection}\n  ID: ${docId}`,
  );
}

// ── vdb_drop ──────────────────────────────────────────────────────────────────

export async function handleVdbDrop(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_drop", "vdb_destroy"]);
  const { collection } = splitCollectionPayload(raw);

  if (!collection) {
    return text(
      "Usage: vdb_drop <collection>\n" +
        "⚠️  This deletes the entire collection and all its documents.",
    );
  }

  const success = deleteCollection(collection);
  if (!success) {
    return text(`[VDB] Collection "${collection}" not found.`);
  }

  return text(
    `[VDB] ✅ Dropped collection "${collection}" (all data deleted).`,
  );
}

// ── vdb_clear ─────────────────────────────────────────────────────────────────

export async function handleVdbClear(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_clear", "vdb_empty", "vdb_flush"]);
  const { collection } = splitCollectionPayload(raw);

  if (!collection) {
    return text(
      "Usage: vdb_clear <collection>\n" +
        "This removes all documents but keeps the collection.",
    );
  }

  if (!collectionExists(collection)) {
    return text(`[VDB] Collection "${collection}" not found.`);
  }

  const count = clearDocuments(collection);
  return text(
    `[VDB] ✅ Cleared "${collection}" — removed ${count} document(s).`,
  );
}

// ── vdb_info ──────────────────────────────────────────────────────────────────

export async function handleVdbInfo(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const raw = stripVerb(input, ["vdb_info", "vdb_stat", "vdb_stats"]);
  const { collection } = splitCollectionPayload(raw);

  if (!collection) {
    return text("Usage: vdb_info <collection>");
  }

  if (!collectionExists(collection)) {
    return text(`[VDB] Collection "${collection}" not found.`);
  }

  const docs = listDocuments(collection, 3);
  const allDocs = listDocuments(collection, 9999);
  const totalDocs = allDocs.length;

  // Check if embeddings exist
  const hasEmbeddings = docs.some(
    (d) => d.embedding.length > 1 && d.embedding.some((v) => v !== 0),
  );

  const samples =
    docs.length > 0
      ? "\nSample documents:\n" +
        docs
          .map(
            (d, i) =>
              `  ${i + 1}. [${d.id.slice(0, 8)}] ` +
              `"${d.text.slice(0, 80).replace(/\n/g, " ")}${d.text.length > 80 ? "…" : ""}"`,
          )
          .join("\n")
      : "\n(empty)";

  return text(
    `[VDB] Collection: ${collection}\n` +
      "─".repeat(50) +
      "\n" +
      `  Documents   : ${totalDocs}\n` +
      `  Embeddings  : ${hasEmbeddings ? "yes (semantic search enabled)" : "no (keyword search only)"}\n` +
      `  Storage     : ${VECTORDB_DIR}/${collection}.json\n` +
      samples,
  );
}

// ── Dispatch helper (used by intentMap) ───────────────────────────────────────

/**
 * Natural-language router dispatcher — called when AiRouter emits "vdb".
 * Parses the sub-intent from the input and delegates to the right handler.
 */
export async function handleVdbDispatch(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const lower = input.toLowerCase().trim();

  if (/\bvdb_add\b|\badd\b.*\bvdb\b|\bvdb_insert\b|\bvdb_store\b/i.test(lower))
    return handleVdbAdd(provider, input, model);

  if (
    /\bvdb_ingest\b|\bingest\b.*\bvdb\b|\bvdb_import\b|\bvdb_index\b/i.test(
      lower,
    )
  )
    return handleVdbIngest(provider, input, model);

  if (
    /\bvdb_create\b|\bcreate\b.*\bcollection\b|\bnew\b.*\bcollection\b/i.test(
      lower,
    )
  )
    return handleVdbCreate(provider, input, model);

  if (
    /\bvdb_list\b|\bvdb_ls\b|\blist\b.*\bcollection\b|\bshow\b.*\bcollection\b/i.test(
      lower,
    )
  )
    return handleVdbList(provider, input, model);

  if (/\bvdb_delete\b|\bvdb_remove\b|\bdelete\b.*\bdocument\b/i.test(lower))
    return handleVdbDelete(provider, input, model);

  if (
    /\bvdb_drop\b|\bdrop\b.*\bcollection\b|\bdelete\b.*\bcollection\b/i.test(
      lower,
    )
  )
    return handleVdbDrop(provider, input, model);

  if (
    /\bvdb_clear\b|\bclear\b.*\bcollection\b|\bempty\b.*\bcollection\b/i.test(
      lower,
    )
  )
    return handleVdbClear(provider, input, model);

  if (
    /\bvdb_info\b|\binfo\b.*\bcollection\b|\bstats?\b.*\bcollection\b/i.test(
      lower,
    )
  )
    return handleVdbInfo(provider, input, model);

  // Default: treat as a query
  return handleVdbQuery(provider, input, model);
}
