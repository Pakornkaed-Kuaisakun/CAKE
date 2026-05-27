// src/agent/skills/index.ts
export { loadAllSkills, SKILLS_DIR } from "./loader.js";
export type { LoadedSkill, SkillFrontmatter } from "./loader.js";
export {
  registerSkills,
  getSkills,
  isInitialized,
  getSkillByName,
  matchSkills,
  findBestSkill,
  markActivated,
  buildSkillContext,
  getSkillPrompt,
  getSkillTemplate,
} from "./registry.js";
export {
  runWithSkill,
  skillNeedsConfirmation,
  buildConfirmationPrompt,
} from "./handler.js";
export type { SkillRunOptions } from "./handler.js";
