// src/agent/skills/loader.ts
//
// Discovers and loads CAKE skills from ~/.cake/skills/<name>/SKILL.md
// at startup. Skills extend the agent with structured behavior packages.
//
// A skill is different from a plugin:
//   - Plugin: adds a new intent handler (code)
//   - Skill:  bundles prompts, workflows, templates, and constraints
//             that guide HOW the agent handles an existing intent
//
// Skills are loaded non-blocking and failures are isolated.

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";

export const SKILLS_DIR = path.join(CAKE_DIR, "skills");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;

  /** What activates this skill */
  triggers?: {
    intents?: string[]; // intentMap keys
    patterns?: string[]; // regex strings
    keywords?: string[]; // substring matches (fast pre-filter)
  };

  /** Tools this skill requires/uses */
  tools?: {
    required?: string[];
    optional?: string[];
  };

  /** Environment variables needed */
  env?: {
    required?: string[];
    optional?: string[];
  };

  /** Desired output shape */
  output?: {
    format?: "markdown" | "json" | "plain";
    template?: string; // path relative to skill dir
    sections?: string[];
  };

  /** Safety rules injected into system prompt */
  constraints?: string[];

  /** Model preferences */
  model?: {
    prefer?: "fast" | "full" | "auto";
    maxTokens?: number;
    temperature?: number;
  };

  /** Activation gating */
  gate?: {
    minInputLength?: number;
    requiresConfirmation?: boolean;
    cooldownMs?: number;
  };
}

export interface LoadedSkill {
  /** Parsed frontmatter */
  meta: SkillFrontmatter;
  /** Full markdown body (below the frontmatter) */
  body: string;
  /** Compiled trigger patterns */
  compiledPatterns: RegExp[];
  /** Absolute path to skill directory */
  dir: string;
  /** Raw content of SKILL.md */
  raw: string;
  /** Loaded prompt files: name → content */
  prompts: Record<string, string>;
  /** Loaded template files: name → content */
  templates: Record<string, string>;
  /** Parsed config.json (if present) */
  config: Record<string, unknown>;
  /** ISO timestamp of when this skill was loaded */
  loadedAt: string;
  /** Last time this skill was activated (for cooldown) */
  lastActivated?: number;
}

// ── YAML frontmatter parser ───────────────────────────────────────────────────
// Minimal hand-rolled parser — avoids adding a yaml dependency.
// Supports: strings, booleans, numbers, simple arrays (- item), nested objects.

function parseFrontmatter(raw: string): {
  meta: SkillFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: { name: "unknown" }, body: raw };
  }

  const yamlStr = match[1];
  const body = match[2].trim();

  const meta: Record<string, any> = {};
  const lines = yamlStr.split("\n");
  let i = 0;

  function parseValue(val: string): any {
    const trimmed = val.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== "") return num;
    // Strip surrounding quotes
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function getCurrentIndent(line: string): number {
    return line.match(/^(\s*)/)?.[1].length ?? 0;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const indent = getCurrentIndent(line);
    const keyMatch = line.match(/^(\s*)(\w[\w-]*):\s*(.*)?$/);

    if (!keyMatch) {
      i++;
      continue;
    }

    const [, , key, rest] = keyMatch;
    const restTrimmed = rest?.trim() ?? "";

    if (restTrimmed === "" || restTrimmed === "|" || restTrimmed === ">") {
      // Possibly an object or block scalar
      i++;
      const nested: Record<string, any> = {};
      const arr: any[] = [];
      let isArray = false;

      while (i < lines.length) {
        const subLine = lines[i];
        if (!subLine.trim()) {
          i++;
          continue;
        }
        const subIndent = getCurrentIndent(subLine);
        if (subIndent <= indent) break;

        const listMatch = subLine.match(/^\s*-\s+(.+)$/);
        const objMatch = subLine.match(/^\s+(\w[\w-]*):\s*(.*)$/);

        if (listMatch) {
          isArray = true;
          arr.push(parseValue(listMatch[1]));
          i++;
        } else if (objMatch) {
          const [, subKey, subVal] = objMatch;
          // Check if sub-value is itself an array
          i++;
          const subArr: any[] = [];
          let isSubArray = false;
          while (i < lines.length) {
            const subSubLine = lines[i];
            if (!subSubLine.trim()) {
              i++;
              continue;
            }
            const subSubIndent = getCurrentIndent(subSubLine);
            if (subSubIndent <= subIndent) break;
            const subListMatch = subSubLine.match(/^\s*-\s+(.+)$/);
            if (subListMatch) {
              isSubArray = true;
              subArr.push(parseValue(subListMatch[1]));
              i++;
            } else break;
          }
          nested[subKey] = isSubArray ? subArr : parseValue(subVal);
        } else {
          i++;
        }
      }

      meta[key] = isArray ? arr : Object.keys(nested).length > 0 ? nested : {};
    } else {
      // Inline value or block string
      let value = restTrimmed;
      // Handle multiline > (folded) or | (literal) — simplified: just collect lines
      if (value.endsWith(">")) {
        i++;
        const parts: string[] = [];
        while (i < lines.length && getCurrentIndent(lines[i]) > indent) {
          parts.push(lines[i].trim());
          i++;
        }
        meta[key] = parts.join(" ");
      } else {
        meta[key] = parseValue(value);
        i++;
      }
    }
  }

  return { meta: meta as SkillFrontmatter, body };
}

// ── File loaders ──────────────────────────────────────────────────────────────

function loadDir(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".md", ".txt", ".yaml", ".yml", ".json"].includes(ext)) continue;
    const name = entry.name.replace(/\.[^.]+$/, ""); // strip extension
    try {
      result[name] = fs.readFileSync(path.join(dir, entry.name), "utf-8");
    } catch {}
  }
  return result;
}

function loadConfig(skillDir: string): Record<string, unknown> {
  const fp = path.join(skillDir, "config.json");
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

// ── Pattern compiler ──────────────────────────────────────────────────────────

function compilePatterns(patterns: string[] = []): RegExp[] {
  const compiled: RegExp[] = [];
  for (const p of patterns) {
    try {
      compiled.push(new RegExp(p, "i"));
    } catch {
      // Invalid regex — skip silently
    }
  }
  return compiled;
}

// ── Validator ─────────────────────────────────────────────────────────────────

function isValidSkill(meta: SkillFrontmatter): boolean {
  return typeof meta.name === "string" && meta.name.trim().length > 0;
}

// ── Main loader ───────────────────────────────────────────────────────────────

/**
 * Load all skills from SKILLS_DIR.
 * Non-blocking friendly — each skill is isolated; one bad skill never
 * prevents others from loading.
 */
export function loadAllSkills(onLog?: (msg: string) => void): LoadedSkill[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch (err: any) {
    onLog?.(`[skills] Could not read skills directory: ${err.message}`);
    return [];
  }

  const skillDirs = dirs.filter((d) => d.isDirectory());
  const loaded: LoadedSkill[] = [];

  for (const entry of skillDirs) {
    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMd = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillMd)) {
      // onLog?.(`[skills] Skipping "${entry.name}" — no SKILL.md found`);
      continue;
    }

    try {
      const raw = fs.readFileSync(skillMd, "utf-8");
      const { meta, body } = parseFrontmatter(raw);

      if (!isValidSkill(meta)) {
        onLog?.(
          `[skills] Skipping "${entry.name}" — invalid or missing name field`,
        );
        continue;
      }

      const skill: LoadedSkill = {
        meta,
        body,
        compiledPatterns: compilePatterns(meta.triggers?.patterns),
        dir: skillDir,
        raw,
        prompts: loadDir(path.join(skillDir, "prompts")),
        templates: loadDir(path.join(skillDir, "templates")),
        config: loadConfig(skillDir),
        loadedAt: new Date().toISOString(),
      };

      loaded.push(skill);
      // onLog?.(`[skills] Loaded: ${meta.name} v${meta.version ?? "?"}`);
    } catch (err: any) {
      onLog?.(`[skills] Failed to load "${entry.name}": ${err.message}`);
    }
  }

  return loaded;
}
