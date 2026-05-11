import chokidar from "chokidar";
import { analyzeFile } from "./heuristics.js";

export function startRealtimeMonitor(dir: string, callback: (file: string, findings: any[]) => void) {
  const watcher = chokidar.watch(dir, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
  });

  watcher.on("change", async (path) => {
    const findings = await analyzeFile(path);
    if (findings.length > 0) {
      callback(path, findings);
    }
  });

  return watcher;
}
