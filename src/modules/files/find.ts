import fg from "fast-glob";
import fs from "fs";
import path from "path";
import { similarityScore } from "./similarity.js";

export interface FileSearchResult {
  path: string;
  name: string;
  size: number;
  modified: Date;
  similarity: number;
}

export interface FindOptions {
  root?: string;
  limit?: number;
  fuzzy?: boolean;
}

/**
 * Search files recursively
 */

export async function findFiles(
  query: string,
  options: FindOptions = {},
): Promise<FileSearchResult[]> {
  let root = options.root || process.cwd();
  if (root.match(/^[a-zA-Z]:$/)) {
    root += "/";
  }
  const limit = options.limit || 20;
  const fuzzy = options.fuzzy ?? true;

  // Scan every files
  const entries = await fg("**/*", {
    cwd: root,
    absolute: true,
    dot: false,
    onlyFiles: true,
    suppressErrors: true,
    deep: Infinity,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
  });

  const results: FileSearchResult[] = [];

  for (const filePath of entries) {
    try {
      const stat = fs.statSync(filePath);
      const name = path.basename(filePath);

      // Exact match
      if (name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        results.push({
          path: filePath,
          name,
          size: stat.size,
          modified: stat.mtime,
          similarity: 1,
        });
        continue;
      }

      if (fuzzy) {
        const similarity = similarityScore(name, query);

        if (similarity > 0.35) {
          results.push({
            path: filePath,
            name,
            size: stat.size,
            modified: stat.mtime,
            similarity,
          });
        }
      }
    } catch (err) {
      continue;
    }
  }

  // Sort by similarity, then by name
  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, limit);
}
