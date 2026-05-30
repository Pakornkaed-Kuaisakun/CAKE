import crypto from "crypto";
import type { SubQuery } from "./types.js";

export type DeepSearchPhase = "planning" | "searching" | "synthesizing";
export type DeepSearchRunStatus =
  | "pending"
  | "running"
  | "searching"
  | "synthesizing"
  | "completed"
  | "failed";
export type DeepSearchTimelineEntryStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface DeepSearchTimelineEntry {
  id: string;
  name: string;
  phase: DeepSearchPhase;
  status: DeepSearchTimelineEntryStatus;
  startedAt?: string;
  completedAt?: string;
  progressPct?: number;
  details?: string;
}

export interface DeepSearchRunRecord {
  id: string;
  topic: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  status: DeepSearchRunStatus;
  currentPhase: DeepSearchPhase;
  progressPct: number;
  message?: string;
  subQueries: SubQuery[];
  hitsCount?: number;
  error?: string;
  timeline: DeepSearchTimelineEntry[];
}

const runs = new Map<string, DeepSearchRunRecord>();
const MAX_RUNS = 100;

function ensureRun(runId: string): DeepSearchRunRecord {
  const run = runs.get(runId);
  if (!run) throw new Error(`DeepSearch run not found: ${runId}`);
  return run;
}

export function createDeepSearchRun(topic: string): string {
  if (runs.size >= MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest) runs.delete(oldest);
  }
  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  runs.set(runId, {
    id: runId,
    topic,
    createdAt,
    status: "running",
    currentPhase: "planning",
    progressPct: 0,
    timeline: [
      {
        id: "planning",
        name: "Planning research strategy",
        phase: "planning",
        status: "running",
        startedAt: createdAt,
        progressPct: 5,
      },
    ],
    subQueries: [],
  });
  return runId;
}

export function updateDeepSearchRun(
  runId: string,
  update: Partial<
    Pick<
      DeepSearchRunRecord,
      | "status"
      | "currentPhase"
      | "progressPct"
      | "message"
      | "hitsCount"
      | "completedAt"
      | "error"
    >
  >,
): void {
  const run = ensureRun(runId);
  Object.assign(run, update);
}

export function addDeepSearchTimelineEntry(
  runId: string,
  entry: Omit<DeepSearchTimelineEntry, "id"> & { id?: string },
): string {
  const run = ensureRun(runId);
  const entryId = entry.id ?? crypto.randomUUID();
  run.timeline.push({ ...entry, id: entryId });
  return entryId;
}

export function updateDeepSearchTimelineEntry(
  runId: string,
  entryId: string,
  update: Partial<Omit<DeepSearchTimelineEntry, "id">>,
): void {
  const run = ensureRun(runId);
  const entry = run.timeline.find((item) => item.id === entryId);
  if (!entry) throw new Error(`Timeline entry not found: ${entryId}`);
  Object.assign(entry, update);
}

export function addSubQueryTimelineEntries(
  runId: string,
  subQueries: SubQuery[],
): void {
  const run = ensureRun(runId);
  run.subQueries = subQueries;
  subQueries.forEach((sq, index) => {
    run.timeline.push({
      id: `search-${index}`,
      name: `Search sub-query: ${sq.question}`,
      phase: "searching",
      status: "pending",
      progressPct: 0,
    });
  });
}

export function completeDeepSearchRun(runId: string, hitsCount: number): void {
  const run = ensureRun(runId);
  run.status = "completed";
  run.currentPhase = "synthesizing";
  run.progressPct = 100;
  run.hitsCount = hitsCount;
  run.completedAt = new Date().toISOString();
  const synthesis = run.timeline.find((entry) => entry.id === "synthesis");
  if (synthesis) {
    synthesis.status = synthesis.status === "failed" ? "failed" : "completed";
    synthesis.completedAt = run.completedAt;
    synthesis.progressPct = 100;
  }
}

export function failDeepSearchRun(runId: string, error: string): void {
  const run = ensureRun(runId);
  run.status = "failed";
  run.currentPhase = "synthesizing";
  run.progressPct = 100;
  run.error = error;
  run.completedAt = new Date().toISOString();
  run.timeline.push({
    id: "failed",
    name: "Deep search failed",
    phase: "synthesizing",
    status: "failed",
    startedAt: new Date().toISOString(),
    completedAt: run.completedAt,
    details: error,
  });
}

export function getDeepSearchRun(
  runId: string,
): DeepSearchRunRecord | undefined {
  return runs.get(runId);
}

export function listDeepSearchRuns(): DeepSearchRunRecord[] {
  return [...runs.values()];
}
