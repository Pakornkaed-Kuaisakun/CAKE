// ── Concurrency limiter ────────────────────────────────────────────────────────

/**
 * Run an array of async task thunks with a bounded concurrency limit,
 * returning results in the same order as the input.
 *
 * This avoids the "1000 simultaneous LLM calls" problem that was present
 * in the original history compression code (which used Promise.all).
 *
 * @example
 *   const results = await runConcurrent(
 *     items.map(item => () => fetch(item.url)),
 *     3,   // at most 3 in-flight at once
 *   );
 */
export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── Batch runner (abort-safe) ──────────────────────────────────────────────────

/**
 * Run tasks with bounded concurrency.
 * Unlike `runConcurrent`, this version aborts on the FIRST rejection
 * (no new tasks are launched after any task fails).
 *
 * Fixed version of deepSearch/collector.ts `batchRun` — the original had a
 * race condition where rejected tasks could still call `runNext()` and
 * trigger resolve/reject on an already-settled Promise.
 */
export function batchRun<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (tasks.length === 0) return Promise.resolve([]);

  const results = new Array<T>(tasks.length);

  return new Promise((resolve, reject) => {
    let index = 0;
    let completed = 0;
    let aborted = false;

    const runNext = async () => {
      if (aborted || index >= tasks.length) return;
      const taskIndex = index++;

      try {
        results[taskIndex] = await tasks[taskIndex]();
      } catch (error) {
        if (!aborted) {
          aborted = true;
          reject(error);
        }
        return; // do NOT call runNext() after rejection
      }

      completed++;
      if (completed === tasks.length) {
        resolve(results);
        return;
      }
      runNext();
    };

    const initial = Math.min(concurrency, tasks.length);
    for (let i = 0; i < initial; i++) runNext();
  });
}

// ── Timeout wrapper ────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout, throwing an Error on timeout.
 *
 * @example
 *   const result = await withTimeout(longRunningTask(), 5000, "Task timed out");
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (handle !== undefined) clearTimeout(handle);
  });
}
