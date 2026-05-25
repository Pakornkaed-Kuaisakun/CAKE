// src/modules/deepSearch/types.ts

export interface DeepSearchOptions {
  /** Max number of sub-questions to generate and search (default 5) */
  maxQueries?: number;
  /** Max search results to fetch per sub-question (default 4) */
  resultsPerQuery?: number;
  /** If true, export to a markdown file automatically */
  autoExport?: boolean;
  /** Export filename (default: deep-search-<timestamp>.md) */
  exportFilename?: string;
  /** Model to use for planning and synthesis */
  model?: string;
  /** Called after each sub-search completes (for streaming progress) */
  onProgress?: (step: DeepSearchProgress) => void;
}

export interface DeepSearchProgress {
  phase: "planning" | "searching" | "synthesizing" | "done";
  message: string;
  /** 0-100 */
  pct: number;
}

export interface SubQuery {
  question: string;
  rationale: string;
}

export interface SearchHit {
  query: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface DeepSearchResult {
  query: string;
  subQueries: SubQuery[];
  hits: SearchHit[];
  report: string;
  /** ISO timestamp */
  completedAt: string;
  /** Path to exported file, if autoExport was used */
  exportPath?: string;
}
