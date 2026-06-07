// src/agent/handlers/skills.ts
//
// /skills slash command — list, inspect, and reload skills at runtime.
//
// Usage:
//   /skills               — list all loaded skills
//   /skills info <name>   — show full skill detail
//   /skills reload        — hot-reload skills from disk
//   /skills test <name> <input>  — test-run a skill against input

import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  getSkills,
  getSkillByName,
  matchSkills,
  buildSkillContext,
} from "../skills/registry.js";
import { loadAllSkills } from "../skills/loader.js";
import { registerSkills } from "../skills/registry.js";
import { formatChatResult } from "../../shared/utils/utils.js";

function fmtList(items: string[]): string {
  return items.map((i) => `  - ${i}`).join("\n");
}

export async function handleSkillsCommand(
  _provider: AIProvider,
  args: string[],
  _model?: string,
): Promise<ChatResult> {
  const sub = args[0]?.toLowerCase() ?? "list";

  // ── /skills list ─────────────────────────────────────────────────────────
  if (!args.length || sub === "list" || sub === "ls") {
    const skills = getSkills();

    if (skills.length === 0) {
      return formatChatResult(
        [
          "[SKILLS] No skills loaded.",
          "",
          `To add a skill, create a directory in ~/.cake/skills/<name>/`,
          `with a SKILL.md file inside.`,
          "",
          "Example:",
          "  ~/.cake/skills/stock-analyzer/SKILL.md",
          "",
          "Run /skills reload after adding a new skill.",
        ].join("\n"),
      );
    }

    const rows = skills.map((s, i) => {
      const triggers: string[] = [];
      if (s.meta.triggers?.intents?.length) {
        triggers.push(`intents: ${s.meta.triggers.intents.join(", ")}`);
      }
      if (s.meta.triggers?.keywords?.length) {
        triggers.push(
          `keywords: ${s.meta.triggers.keywords.slice(0, 3).join(", ")}…`,
        );
      }
      const trigStr =
        triggers.length > 0 ? `\n   Triggers: ${triggers.join(" | ")}` : "";
      const model = s.meta.model?.prefer ? ` [${s.meta.model.prefer}]` : "";

      const desc =
        typeof s.meta.description === "string"
          ? s.meta.description.slice(0, 100)
          : "(no description or not a string)";

      return (
        `${String(i + 1).padStart(2)}. ${s.meta.name}${model} v${s.meta.version ?? "?"}\n` +
        `   ${desc}` +
        trigStr
      );
    });

    return formatChatResult(
      [
        `[SKILLS] ${skills.length} skill${skills.length !== 1 ? "s" : ""} loaded`,
        "─".repeat(50),
        ...rows,
        "",
        "Commands: /skills info <name> · /skills reload · /skills match <input>",
      ].join("\n"),
    );
  }

  // ── /skills info <name> ───────────────────────────────────────────────────
  if (sub === "info" || sub === "show") {
    const name = args[1];
    if (!name) return formatChatResult("Usage: /skills info <skill-name>");

    const skill = getSkillByName(name);
    if (!skill) {
      return formatChatResult(
        `❌ Skill "${name}" not found.\nRun /skills to see available skills.`,
      );
    }

    const lines: string[] = [
      `[SKILL] ${skill.meta.name} v${skill.meta.version ?? "?"}`,
      "─".repeat(50),
    ];

    if (skill.meta.description) {
      lines.push(`Description: ${skill.meta.description}`);
    }
    if (skill.meta.author) lines.push(`Author: ${skill.meta.author}`);
    if (skill.meta.license) lines.push(`License: ${skill.meta.license}`);

    if (skill.meta.triggers) {
      lines.push("", "Triggers:");
      if (skill.meta.triggers.intents?.length) {
        lines.push(`  Intents  : ${skill.meta.triggers.intents.join(", ")}`);
      }
      if (skill.meta.triggers.keywords?.length) {
        lines.push(`  Keywords : ${skill.meta.triggers.keywords.join(", ")}`);
      }
      if (skill.meta.triggers.patterns?.length) {
        lines.push(
          `  Patterns : ${skill.meta.triggers.patterns.length} regex(es)`,
        );
      }
    }

    if (skill.meta.tools) {
      lines.push("", "Tools:");
      if (skill.meta.tools.required?.length) {
        lines.push(`  Required : ${skill.meta.tools.required.join(", ")}`);
      }
      if (skill.meta.tools.optional?.length) {
        lines.push(`  Optional : ${skill.meta.tools.optional.join(", ")}`);
      }
    }

    if (skill.meta.env) {
      lines.push("", "Environment:");
      if (skill.meta.env.required?.length) {
        const envStatus = skill.meta.env.required.map((key) => {
          const has = !!process.env[key];
          return `${has ? "✅" : "❌"} ${key}`;
        });
        lines.push(`  Required : ${envStatus.join(", ")}`);
      }
    }

    if (skill.meta.output) {
      lines.push("", "Output:");
      if (skill.meta.output.format) {
        lines.push(`  Format   : ${skill.meta.output.format}`);
      }
      if (skill.meta.output.sections?.length) {
        lines.push(`  Sections : ${skill.meta.output.sections.join(", ")}`);
      }
    }

    if (skill.meta.constraints?.length) {
      lines.push("", "Constraints:");
      skill.meta.constraints.forEach((c) => lines.push(`  • ${c}`));
    }

    if (skill.meta.model) {
      lines.push("", "Model preferences:");
      lines.push(`  Prefer     : ${skill.meta.model.prefer ?? "auto"}`);
      if (skill.meta.model.maxTokens) {
        lines.push(`  Max tokens : ${skill.meta.model.maxTokens}`);
      }
      if (skill.meta.model.temperature != null) {
        lines.push(`  Temperature: ${skill.meta.model.temperature}`);
      }
    }

    // Asset inventory
    const assets: string[] = [];
    if (Object.keys(skill.prompts).length > 0) {
      assets.push(`prompts: ${Object.keys(skill.prompts).join(", ")}`);
    }
    if (Object.keys(skill.templates).length > 0) {
      assets.push(`templates: ${Object.keys(skill.templates).join(", ")}`);
    }
    if (Object.keys(skill.config).length > 0) {
      assets.push("config.json");
    }
    if (assets.length > 0) {
      lines.push("", `Files: ${assets.join(" · ")}`);
    }

    lines.push("", `Loaded at: ${skill.loadedAt}`);
    lines.push(`Directory : ${skill.dir}`);

    return formatChatResult(lines.join("\n"));
  }

  // ── /skills reload ────────────────────────────────────────────────────────
  if (sub === "reload") {
    const freshSkills = loadAllSkills();
    registerSkills(freshSkills);
    return formatChatResult(
      freshSkills.length > 0
        ? `✅ Reloaded ${freshSkills.length} skill${freshSkills.length !== 1 ? "s" : ""}: ` +
            freshSkills.map((s) => s.meta.name).join(", ")
        : "✅ Skills reloaded (none found in ~/.cake/skills/)",
    );
  }

  // ── /skills match <input> ─────────────────────────────────────────────────
  if (sub === "match") {
    const input = args.slice(1).join(" ");
    if (!input) return formatChatResult("Usage: /skills match <input text>");

    const matches = matchSkills(input);
    if (matches.length === 0) {
      return formatChatResult(`No skills matched for: "${input}"`);
    }

    const rows = matches.map((s, i) => {
      const desc =
        typeof s.meta.description === "string"
          ? s.meta.description.slice(0, 60)
          : "";

      return `${i + 1}. ${s.meta.name} — ${desc}`;
    });
    return formatChatResult(
      `[SKILLS] ${matches.length} skill(s) matched "${input}":\n${rows.join("\n")}`,
    );
  }

  // ── /skills context <name> ────────────────────────────────────────────────
  if (sub === "context") {
    const name = args[1];
    if (!name) return formatChatResult("Usage: /skills context <skill-name>");

    const skill = getSkillByName(name);
    if (!skill) return formatChatResult(`Skill "${name}" not found.`);

    const ctx = buildSkillContext(skill);
    return formatChatResult(
      ctx
        ? `[SKILL CONTEXT: ${name}]\n${"─".repeat(40)}\n${ctx}`
        : `Skill "${name}" produces no context.`,
    );
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return formatChatResult(
    [
      `Unknown sub-command: /skills ${sub}`,
      "",
      "Available commands:",
      "  /skills              — list all loaded skills",
      "  /skills info <name>  — show skill details",
      "  /skills reload       — hot-reload from disk",
      "  /skills match <text> — test which skills would activate",
      "  /skills context <name> — show system-prompt injection",
    ].join("\n"),
  );
}
