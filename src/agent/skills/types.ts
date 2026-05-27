export interface SkillFrontmatter {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;

  /** What activates this skill */
  triggers?: {
    intents?: string[]; // IntentMap keys
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
  /** Loadded prompt files: name -> content */
  prompts: Record<string, string>;
  /** Loaded template files: name -> content */
  templates: Record<string, string>;
  /** Parsed config.json (if present) */
  config: Record<string, unknown>;
  /** ISO timestamp of when this skill was loaded */
  loadedAt: string;
  /** Last time this skill was activated (for cooldown) */
  lastActivated?: number;
}
