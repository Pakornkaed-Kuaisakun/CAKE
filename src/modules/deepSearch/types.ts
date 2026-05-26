// src/modules/deepSearch/types.ts

export interface DeepSearchOptions {
  /** Max number of sub-questions to generate and search (default 5) */
  maxQueries?: number;
  /** Max sub-queries to run in parallel (default 5) */
  maxConcurrentSubQueries?: number;
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
  runId?: string;
  phase: "planning" | "searching" | "synthesizing" | "done";
  message: string;
  /** 0-100 */
  pct: number;
  taskId?: string;
  query?: string;
}

export interface DeepSearchTimelineEntry {
  id: string;
  name: string;
  phase: "planning" | "searching" | "synthesizing";
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  progressPct?: number;
  details?: string;
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
  summary?: string;
  sourceType?: import("../search/searchEngine.js").SourceType;
  relevance?: number;
  hallucinationRisk?: number;
  metadata?: Record<string, any>;
}

export interface DeepSearchResult {
  query: string;
  runId?: string;
  subQueries: SubQuery[];
  hits: SearchHit[];
  timeline?: DeepSearchTimelineEntry[];
  report: string;
  /** ISO timestamp */
  completedAt: string;
  /** Path to exported file, if autoExport was used */
  exportPath?: string;
}
