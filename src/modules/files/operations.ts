import fs from "fs";
import path from "path";

type DirectoryTreeOptions = {
  maxDepth?: number;
  ignore?: string[];
  comments?: Record<string, string>; // optionals: for comments
  showSize?: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

import { readDocument } from "../documents/index.js";

export async function readFile(filePath: string): Promise<string> {
  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) throw new Error("File not found");

  try {
    return await readDocument(p);
  } catch (err) {
    // Fallback to basic text read if readDocument fails (e.g. unknown extension)
    return fs.readFileSync(p, "utf-8");
  }
}

export function writeFile(filePath: string, content: string): string {
  const p = path.resolve(filePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

export function listDirectory(dirPath: string): string[] {
  const p = path.resolve(dirPath);
  if (!fs.existsSync(p)) throw new Error("Directory not found");
  return fs.readdirSync(p).map((name) => {
    const full = path.join(p, name);
    const stat = fs.statSync(full);
    return stat.isDirectory()
      ? `[DIR]  ${name}`
      : `[FILE] ${name} ${formatSize(stat.size)}`;
  });
}

export function createDirectory(dirPath: string): string {
  const p = path.resolve(dirPath);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function createDirectoryTree(
  dirPath: string,
  options: DirectoryTreeOptions = {},
): string {
  const {
    maxDepth = Infinity,
    ignore = ["node_modules", ".git"],
    comments = {},
    showSize = true,
  } = options;

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  function build(currentPath: string, prefix = "", depth = 0): string {
    if (depth > maxDepth) return "";

    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .filter((e) => !ignore.includes(e.name))
      .sort((a, b) => {
        // folder first
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    return entries
      .map((entry, index) => {
        const isLast = index === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const nextPrefix = prefix + (isLast ? "    " : "│   ");

        const fullPath = path.join(currentPath, entry.name);
        const comment = comments[fullPath] || comments[entry.name] || "";

        let sizeStr = "";
        if (showSize && entry.isFile()) {
          const stat = fs.statSync(fullPath);
          sizeStr = ` (${formatSize(stat.size)})`;
        }

        const line =
          prefix +
          connector +
          entry.name +
          (entry.isDirectory() ? "/" : "") +
          sizeStr +
          (comment ? `  # ${comment}` : "");

        if (entry.isDirectory()) {
          return line + "\n" + build(fullPath, nextPrefix, depth + 1);
        }

        return line;
      })
      .join("\n");
  }

  const tree = path.basename(dirPath) + "\n" + build(dirPath);
  return tree;
}

export function deleteFile(filePath: string): void {
  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) throw new Error(`File not found ${p}`);
  fs.rmSync(p, { recursive: true });
}

export function moveFile(src: string, dest: string): void {
  fs.renameSync(path.resolve(src), path.resolve(dest));
}
