import fs from "fs";

import { SUSPICIOUS_PATTERNS } from "./signatures.js";

export interface ScanFinding {
  type: string;

  severity: "low" | "medium" | "high";

  message: string;
}

export async function analyzeFile(filePath: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  const stat = fs.statSync(filePath);

  /**
   * Huge executable
   */

  if (stat.size > 200 * 1024 * 1024) {
    findings.push({
      type: "large_binary",

      severity: "medium",

      message: "Very large executable",
    });
  }

  /**
   * Read content (only if file is < 10MB to avoid OOM)
   */
  if (stat.size > 10 * 1024 * 1024) {
    findings.push({
      type: "large_file_skipped",
      severity: "low",
      message: "File too large for deep content analysis (>10MB)",
    });
    return findings;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lowerContent = content.toLowerCase();

    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (lowerContent.includes(pattern.toLowerCase())) {
        findings.push({
          type: "suspicious_pattern",
          severity: "high",
          message: `Matched pattern: ${pattern}`,
        });
      }
    }
  } catch {
    // Binary or unreadable file
  }

  return findings;
}
