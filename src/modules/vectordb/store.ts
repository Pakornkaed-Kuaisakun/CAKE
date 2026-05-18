// Persistent file-backed vector store.
// Each collection lives at ~/.cake/vectordb/<collection>.json
// Operations are sync-to-disk after every write (small datasets, safe defaults).

import fs from "fs";
import path from "path";
import crypto from "crypto";

import { CAKE_DIR } from "../../config/constants.js";
import type {
  VectorDocument,
  Collection,
  CollectionStore,
  SearchResult,
} from "./types.js";

// Paths
export const VECTORDB_DIR = path.join(CAKE_DIR, "vectordb");

function ensureDir(): void {
  if (!fs.existsSync(VECTORDB_DIR)) {
    fs.mkdirSync(VECTORDB_DIR, { recursive: true });
  }
}

function collectionPath(name: string): string {
  // Sanitise: only alphanumeric, dash, underscore, dot
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  if (!safe) throw new Error("Collection name cannot be empty.");
  return path.join(VECTORDB_DIR, `${safe}.json`);
}

// I/O helpers
function loadCollection(name: string): CollectionStore | null {
  ensureDir();
  const fp = collectionPath(name);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as CollectionStore;
  } catch {
    return null;
  }
}

function saveCollection(store: CollectionStore): void {
  ensureDir();
  const fp = collectionPath(store.meta.name);
  store.meta.documentCount = store.documents.length;
  store.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), "utf-8");
}

// Math
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Collection management
export function createCollection(name: string, description = ""): Collection {
  const existing = loadCollection(name);
  if (existing) return existing.meta; // idempotent

  const store: CollectionStore = {
    meta: {
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0,
    },
    documents: [],
  };
  saveCollection(store);
  return store.meta;
}

export function listCollections(): Collection[] {
  ensureDir();
  const files = fs.readdirSync(VECTORDB_DIR).filter((f) => f.endsWith(".json"));
  const collections: Collection[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(VECTORDB_DIR, file), "utf-8"),
      ) as CollectionStore;
      if (raw.meta) collections.push(raw.meta);
    } catch {
      // Skip corrupt files
      continue;
    }
  }
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export function deleteCollection(name: string): boolean {
  const fp = collectionPath(name);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

export function collectionExists(name: string): boolean {
  return fs.existsSync(collectionPath(name));
}

// Document CRUD

/**
 * Add a new document (with pre-computed embedding) to a collection.
 * Creates the collection if it doesn't exist.
 */
export function addDocument(
  collectionName: string,
  text: string,
  embedding: number[],
  metadata: Record<string, unknown> = {},
  id?: string,
): VectorDocument {
  let store = loadCollection(collectionName);
  if (!store) {
    createCollection(collectionName);
    store = loadCollection(collectionName);
    if (!store) {
      throw new Error(`Failed to load or create collection: ${collectionName}`);
    }
  }

  const now = new Date().toISOString();
  const docId = id ?? crypto.randomUUID();

  // If updating an existing doc, replace it
  const existingIdx = store.documents.findIndex((d) => d.id === docId);
  const doc: VectorDocument = {
    id: docId,
    text,
    embedding,
    metadata,
    createdAt: existingIdx >= 0 ? store.documents[existingIdx].createdAt : now,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    store.documents[existingIdx] = doc;
  } else {
    store.documents.push(doc);
  }

  saveCollection(store);
  return doc;
}

export function getDocument(
  collectionName: string,
  id: string,
): VectorDocument | null {
  const store = loadCollection(collectionName);
  return store?.documents.find((d) => d.id === id) ?? null;
}

export function listDocuments(
  collectionName: string,
  limit = 20,
  offset = 0,
): VectorDocument[] {
  const store = loadCollection(collectionName);
  if (!store) return [];
  return store.documents.slice(offset, offset + limit);
}

export function deleteDocument(collectionName: string, id: string): boolean {
  const store = loadCollection(collectionName);
  if (!store) return false;

  const before = store.documents.length;
  store.documents = store.documents.filter((d) => d.id !== id);
  if (store.documents.length === before) return false;
  saveCollection(store);
  return true;
}

export function clearDocuments(collectionName: string): number {
  const store = loadCollection(collectionName);
  if (!store) return 0;
  const count = store.documents.length;
  store.documents = [];
  saveCollection(store);
  return count;
}

// Semantic search
/**
 * Search across one named collection (or ALL collections if collectionName is null).
 */
export function searchDocuments(
  queryEmbedding: number[],
  options: {
    collectionName?: string | null;
    limit?: number;
    minScore?: number;
  } = {},
): SearchResult[] {
  const { collectionName = null, limit = 5, minScore = 0.3 } = options;

  let collections: string[];
  if (collectionName) {
    collections = [collectionName];
  } else {
    ensureDir();
    collections = fs
      .readdirSync(VECTORDB_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  const results: SearchResult[] = [];

  for (const col of collections) {
    const store = loadCollection(col);
    if (!store) continue;

    for (const doc of store.documents) {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      if (score >= minScore) {
        results.push({ document: doc, score, collection: col });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Full-text keyword search (fallback when no embed provider is available).
 */
export function keywordSearch(
  query: string,
  options: {
    collectionName?: string | null;
    limit?: number;
  } = {},
): SearchResult[] {
  const { collectionName = null, limit = 5 } = options;
  const lower = query.toLocaleLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 2);

  let collections: string[];
  if (collectionName) {
    collections = [collectionName];
  } else {
    ensureDir();
    collections = fs
      .readdirSync(VECTORDB_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  const results: SearchResult[] = [];

  for (const col of collections) {
    const store = loadCollection(col);
    if (!store) continue;

    for (const doc of store.documents) {
      const store = loadCollection(col);
      if (!store) continue;

      for (const doc of store.documents) {
        const text = doc.text.toLocaleLowerCase();
        let score = 0;
        for (const word of words) {
          if (text.includes(word)) score += 1 / words.length;
        }
        if (score > 0) {
          results.push({ document: doc, score, collection: col });
        }
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
