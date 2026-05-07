// src/modules/system/performance.ts

import fs from "fs";
import path from "path";
import os from "os";

export type PerformanceResult = {
  category: string;
  status: "ok" | "warning" | "error";
  message: string;
};

type ScanOptions = {
  maxFileSizeMB?: number;
  ignore?: string[];
};

export async function diagnosePerformance(
  rootDir = ".",
  options: ScanOptions = {},
): Promise<PerformanceResult[]> {
  const {
    maxFileSizeMB = 5,
    ignore = ["node_modules", ".git", "dist", "build", ".next", "coverage"],
  } = options;

  const results: PerformanceResult[] = [];

  /**
   * =========================================
   * MEMORY
   * =========================================
   */

  const freeMem = os.freemem() / 1024 / 1024 / 1024;

  if (freeMem < 2) {
    results.push({
      category: "memory",
      status: "warning",
      message: `Low free memory (${freeMem.toFixed(1)} GB remaining)`,
    });
  } else {
    results.push({
      category: "memory",
      status: "ok",
      message: `${freeMem.toFixed(1)} GB free memory`,
    });
  }

  /**
   * =========================================
   * CPU LOAD
   * =========================================
   */

  const cpu = os.loadavg()[0];

  if (cpu > 4) {
    results.push({
      category: "cpu",
      status: "warning",
      message: `High CPU load (${cpu.toFixed(2)})`,
    });
  } else {
    results.push({
      category: "cpu",
      status: "ok",
      message: `CPU load normal (${cpu.toFixed(2)})`,
    });
  }

  /**
   * =========================================
   * LARGE FILE DETECTION
   * =========================================
   */

  const largeFiles: {
    file: string;
    sizeMB: number;
  }[] = [];

  function scan(dir: string) {
    const entries = fs.readdirSync(dir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (ignore.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath);
        continue;
      }

      const stat = fs.statSync(fullPath);

      const sizeMB = stat.size / 1024 / 1024;

      if (sizeMB > maxFileSizeMB) {
        largeFiles.push({
          file: fullPath,
          sizeMB,
        });
      }
    }
  }

  scan(rootDir);

  if (largeFiles.length > 0) {
    for (const file of largeFiles) {
      results.push({
        category: "large-file",
        status: "warning",
        message: `${file.file} ` + `(${file.sizeMB.toFixed(2)} MB)`,
      });
    }
  } else {
    results.push({
      category: "large-file",
      status: "ok",
      message: "No unusually large files",
    });
  }

  /**
   * =========================================
   * HUGE SOURCE FILES
   * =========================================
   */

  const hugeSourceFiles: string[] = [];

  function scanSource(dir: string) {
    const entries = fs.readdirSync(dir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (ignore.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanSource(fullPath);
        continue;
      }

      if (
        !fullPath.endsWith(".ts") &&
        !fullPath.endsWith(".tsx") &&
        !fullPath.endsWith(".js")
      ) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf8");

      const lines = content.split("\n").length;

      if (lines > 1000) {
        hugeSourceFiles.push(`${fullPath} (${lines} lines)`);
      }
    }
  }

  scanSource(rootDir);

  if (hugeSourceFiles.length > 0) {
    for (const file of hugeSourceFiles) {
      results.push({
        category: "source-file",
        status: "warning",
        message: `Large source file detected: ${file}`,
      });
    }
  } else {
    results.push({
      category: "source-file",
      status: "ok",
      message: "Source files look healthy",
    });
  }

  /**
   * =========================================
   * DUPLICATE FILE NAMES
   * =========================================
   */

  const names = new Map<string, string[]>();

  function collectNames(dir: string) {
    const entries = fs.readdirSync(dir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (ignore.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        collectNames(fullPath);
        continue;
      }

      if (!names.has(entry.name)) {
        names.set(entry.name, []);
      }

      names.get(entry.name)!.push(fullPath);
    }
  }

  collectNames(rootDir);

  for (const [name, files] of names) {
    if (files.length > 3) {
      results.push({
        category: "duplicate-files",
        status: "warning",
        message: `"${name}" appears ${files.length} times`,
      });
    }
  }

  /**
   * =========================================
   * PACKAGE.JSON SIZE
   * =========================================
   */

  try {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

    const depCount = Object.keys(packageJson.dependencies || {}).length;

    if (depCount > 80) {
      results.push({
        category: "dependencies",
        status: "warning",
        message: `Large dependency count (${depCount})`,
      });
    } else {
      results.push({
        category: "dependencies",
        status: "ok",
        message: `${depCount} dependencies installed`,
      });
    }
  } catch {
    results.push({
      category: "dependencies",
      status: "warning",
      message: "Could not analyze dependencies",
    });
  }

  return results;
}
