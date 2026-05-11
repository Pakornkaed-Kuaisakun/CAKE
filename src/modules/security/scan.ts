import fg from "fast-glob";

import path from "path";

import { analyzeFile } from "./heuristics.js";

export interface MalwareResult {
  file: string;

  findings: unknown[];
}

const DANGEROUS_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js",
  ".scr",
  ".dll",
];

export async function scanDirectory(root: string): Promise<MalwareResult[]> {
  const files = await fg("**/*", {
    cwd: root,

    absolute: true,

    onlyFiles: true,

    suppressErrors: true,

    ignore: ["**/node_modules/**", "**/.git/**"],
  });

  const results: MalwareResult[] = [];

  for (const file of files) {
    const ext = path.extname(file);

    if (!DANGEROUS_EXTENSIONS.includes(ext.toLowerCase())) {
      continue;
    }

    const findings = await analyzeFile(file);

    if (findings.length > 0) {
      results.push({
        file,
        findings,
      });
    }
  }

  return results;
}
