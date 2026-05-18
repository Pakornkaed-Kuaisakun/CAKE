// src/modules/vectordb/manager.ts
//
// High-level operations that combine the store with an AI provider.
// Handles:
//   - Ingesting text (embed → store)
//   - Semantic query (embed query → search → answer with LLM)
//   - Bulk import from plain text / markdown files

import path from "path";
import fs from "fs";
import type { AIProvider } from "../../providers/types.js";
import {
  addDocument,
  searchDocuments,
  keywordSearch,
  createCollection,
  listCollections,
  listDocuments,
  deleteDocument,
  deleteCollection,
  clearDocuments,
  collectionExists,
} from "./store.js";
import type { SearchResult, VectorDocument } from "./types.js";
import { chunkText } from "../documents/chunk/chunkText.js";
import { readDocument } from "../documents/index.js";

// ── Embed helper (handles missing embed gracefully) ───────────────────────────

async function embed(
  provider: AIProvider,
  text: string,
): Promise<number[] | null> {
  if (!provider.embed) return null;
  try {
    return await provider.embed(text);
  } catch {
    return null;
  }
}

// ── Ingest ────────────────────────────────────────────────────────────────────

/**
 * Ingest a single text entry into a collection.
 * Returns the created document ID.
 */
export async function ingestText(
  provider: AIProvider,
  collectionName: string,
  text: string,
  metadata: Record<string, unknown> = {},
  id?: string,
): Promise<{ id: string; usedEmbedding: boolean }> {
  // Ensure collection exists
  if (!collectionExists(collectionName)) {
    createCollection(collectionName);
  }

  const vector = await embed(provider, text);
  const usedEmbedding = vector !== null;

  // Fallback: zero-vector so the document is still stored and keyword-searchable
  const embedding = vector ?? new Array(1).fill(0);

  const doc = addDocument(collectionName, text, embedding, metadata, id);
  return { id: doc.id, usedEmbedding };
}

/**
 * Ingest a file (PDF / DOCX / TXT / MD) by chunking it.
 * Returns the number of chunks stored.
 */
export async function ingestFile(
  provider: AIProvider,
  collectionName: string,
  filePath: string,
  chunkSize = 800,
  overlap = 100,
): Promise<{ chunks: number; usedEmbedding: boolean }> {
  const content = await readDocument(filePath);
  const chunks = chunkText(content, chunkSize, overlap);

  const baseName = path.basename(filePath);
  let usedEmbedding = false;

  for (let i = 0; i < chunks.length; i++) {
    const result = await ingestText(provider, collectionName, chunks[i], {
      source: baseName,
      filePath: path.resolve(filePath),
      chunk: i + 1,
      totalChunks: chunks.length,
    });
    if (result.usedEmbedding) usedEmbedding = true;
  }

  return { chunks: chunks.length, usedEmbedding };
}

// ── Search & Answer ────────────────────────────────────────────────────────────

/**
 * Find relevant documents then synthesise an answer with the LLM.
 */
export async function queryAndAnswer(
  provider: AIProvider,
  query: string,
  options: {
    collectionName?: string | null;
    limit?: number;
    minScore?: number;
    model?: string;
  } = {},
): Promise<{
  answer: string;
  sources: SearchResult[];
  usedEmbedding: boolean;
}> {
  const { collectionName = null, limit = 5, minScore = 0.25, model } = options;

  let sources: SearchResult[] = [];
  let usedEmbedding = false;

  // 1. Try semantic search
  const queryVector = await embed(provider, query);
  if (queryVector) {
    usedEmbedding = true;
    sources = searchDocuments(queryVector, { collectionName, limit, minScore });
  }

  // 2. Fallback: keyword search if no embedding or no results
  if (sources.length === 0) {
    sources = keywordSearch(query, { collectionName, limit });
  }

  // 3. No results at all
  if (sources.length === 0) {
    const scope = collectionName
      ? `collection "${collectionName}"`
      : "any collection";
    return {
      answer: `No relevant documents found in ${scope} for: "${query}".\n\nTry ingesting some data first with: vdb_add <collection> <text>`,
      sources: [],
      usedEmbedding,
    };
  }

  // 4. Build context and ask LLM
  const context = sources
    .map(
      (r, i) =>
        `[${i + 1}] (Collection: ${r.collection}, Score: ${(r.score * 100).toFixed(1)}%)\n${r.document.text}`,
    )
    .join("\n\n");

  const prompt = `You are a knowledgeable assistant with access to a local knowledge base.
Answer the user's question ONLY using the provided context below.
If the context doesn't contain enough information, say so clearly.
Cite sources by their [number] where relevant.

QUESTION: ${query}

CONTEXT:
${context}`;

  const result = await provider.chat([{ role: "user", content: prompt }], {
    model,
  });

  return { answer: result.text, sources, usedEmbedding };
}

// ── Re-exports for convenience ────────────────────────────────────────────────

export {
  createCollection,
  listCollections,
  listDocuments,
  deleteDocument,
  deleteCollection,
  clearDocuments,
  collectionExists,
  searchDocuments,
  keywordSearch,
};
export type { SearchResult, VectorDocument };
