export interface VectorDocument {
  id: string;
  /** The plain-text content that was embedded */
  text: string;
  /** The embedding vector */
  embedding: number[];
  /** Arbitrary JSON metadata (tags, source, date, etc.) */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** Number of documents (denormalised for fast listing) */
  documentCount: number;
}

export interface CollectionStore {
  meta: Collection;
  documents: VectorDocument[];
}

export interface SearchResult {
  document: VectorDocument;
  score: number; // cosine similarity 0-1
  collection: string;
}

export interface UpsertOptions {
  /** If provided, update an existing document; otherwise create a new one */
  id?: string;
  metadata?: Record<string, unknown>;
}
