export interface MemoryEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    source: string; // 'conversation', 'file', 'news'
    timestamp: number;
    [key: string]: any;
  };
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
}
