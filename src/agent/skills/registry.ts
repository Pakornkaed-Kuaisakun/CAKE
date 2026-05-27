// src/agent/skills/registry.ts
//
// Singleton registry for loaded skills + fast matching.
//
// Matching priority:
//   1. Exact intent match  (skill.meta.triggers.intents)
//   2. Keyword pre-filter  (skill.meta.triggers.keywords)  ← O(n) substring
//   3. Regex patterns      (skill.compiledPatterns)        ← O(n) regex

import type { LoadedSkill } from "./loader.js";

// ── State ─────────────────────────────────────────────────────────────────────

let _skills: LoadedSkill[] = [];
let _initialized = false;

// ── Registry API ──────────────────────────────────────────────────────────────

export function registerSkills(skills: LoadedSkill[]): void {
  _skills = skills;
  _initialized = true;
}

export function getSkills(): LoadedSkill[] {
  return _skills;
}

export function isInitialized(): boolean {
  return _initialized;
}

export function getSkillByName(name: string): LoadedSkill | undefined {
  return _skills.find((s) => s.meta.name === name);
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Find all skills that match the current request context.
 * Returns skills ordered by specificity (intent match > keyword > pattern).
 *
 * A skill passes the gate check before being returned:
 *   - minInputLength satisfied
 *   - cooldown not exceeded
 *   - required env vars present
 */
export function matchSkills(input: string, intent?: string): LoadedSkill[] {
  if (!_initialized || _skills.length === 0) return [];

  const lower = input.toLowerCase();
  const matched: Array<{ skill: LoadedSkill; score: number }> = [];

  for (const skill of _skills) {
    // ── Gate checks ──────────────────────────────────────────────────────────
    const gate = skill.meta.gate;
    if (gate?.minInputLength && input.length < gate.minInputLength) continue;

    if (gate?.cooldownMs && skill.lastActivated) {
      const elapsed = Date.now() - skill.lastActivated;
      if (elapsed < gate.cooldownMs) continue;
    }

    if (skill.meta.env?.required) {
      const missingEnv = skill.meta.env.required.filter(
        (key) => !process.env[key],
      );
      if (missingEnv.length > 0) continue;
    }

    // ── Scoring ──────────────────────────────────────────────────────────────
    let score = 0;

    // 1. Intent match (highest specificity)
    if (intent && skill.meta.triggers?.intents?.includes(intent)) {
      score += 100;
    }

    // 2. Keyword match (fast substring)
    if (skill.meta.triggers?.keywords) {
      for (const kw of skill.meta.triggers.keywords) {
        if (lower.includes(kw.toLowerCase())) {
          score += 50;
          break; // one keyword match is enough
        }
      }
    }

    // 3. Regex pattern match
    for (const pattern of skill.compiledPatterns) {
      if (pattern.test(input)) {
        score += 25;
        break;
      }
    }

    if (score > 0) {
      matched.push({ skill, score });
    }
  }

  // Sort by score descending
  return matched.sort((a, b) => b.score - a.score).map(({ skill }) => skill);
}

/**
 * Get the single best-matching skill (or null if none match).
 */
export function findBestSkill(
  input: string,
  intent?: string,
): LoadedSkill | null {
  return matchSkills(input, intent)[0] ?? null;
}

/**
 * Mark a skill as activated (for cooldown tracking).
 */
export function markActivated(skillName: string): void {
  const skill = getSkillByName(skillName);
  if (skill) skill.lastActivated = Date.now();
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Build the system-prompt injection for a matched skill.
 * This is injected into the agent's system prompt alongside the static core.
 *
 * Returns empty string if no skill matches.
 */
export function buildSkillContext(skill: LoadedSkill): string {
  const parts: string[] = [];

  // Skill workflow / behavior guidance
  if (skill.body.trim()) {
    parts.push(`[SKILL: ${skill.meta.name}]\n${skill.body.trim()}`);
  }

  // Constraints as explicit rules
  if (skill.meta.constraints && skill.meta.constraints.length > 0) {
    const rules = skill.meta.constraints.map((c) => `- ${c}`).join("\n");
    parts.push(`Skill constraints (MUST follow):\n${rules}`);
  }

  // Output contract
  if (skill.meta.output?.sections && skill.meta.output.sections.length > 0) {
    const sections = skill.meta.output.sections
      .map((s) => `## ${s}`)
      .join("\n");
    parts.push(`Expected output structure:\n${sections}`);
  }

  // Model preferences hint (informational — actual model selection happens upstream)
  if (skill.meta.model?.prefer) {
    parts.push(
      `Preferred response depth: ${skill.meta.model.prefer} (${
        skill.meta.model.prefer === "fast" ? "concise" : "thorough"
      })`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Get the rendered content of a named prompt from a skill.
 * Returns null if the prompt doesn't exist.
 */
export function getSkillPrompt(
  skill: LoadedSkill,
  promptName: string,
  vars: Record<string, string> = {},
): string | null {
  const template = skill.prompts[promptName];
  if (!template) return null;

  // Simple {{var}} interpolation
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Get the rendered content of a named template from a skill.
 */
export function getSkillTemplate(
  skill: LoadedSkill,
  templateName: string,
  vars: Record<string, string> = {},
): string | null {
  const template = skill.templates[templateName];
  if (!template) return null;

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}
