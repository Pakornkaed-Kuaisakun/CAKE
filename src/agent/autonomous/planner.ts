// src/agent/autonomous/planner.ts
//
// FIX 1: Goal Decomposition — upfront planning creates a mental model of
//         "done" before execution starts, preventing aimless step-by-step.
//
// FIX 2: Async Awareness — planner receives explicit async task status so it
//         knows whether to wait, poll, or proceed without blocking.
//
// FIX 3: Context Compression — full output is only passed for the IMMEDIATELY
//         preceding step; older steps get summaries to keep context < 2000 chars.
//
// FIX 4: Retry Classification — planner sees failure category (transient vs
//         permanent) and chooses retry, replan, or skip accordingly.
//
// FIX 5: Separated Planning/Execution — planGoal() decomposes upfront;
//         planNextStep() just selects the next move from the existing plan.

import type { AIProvider } from "../../providers/types.js";
import type { ThoughtStep } from "./types.js";
import { AGENT_TOOLS } from "./toolRegistry.js";
import { getFastModel } from "../../providers/utils.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlannedStep {
  /** Human-readable description of what this step achieves */
  objective: string;
  /** Suggested tool to use */
  tool: string;
  /** Dependency: index of a prior step this one needs (or -1 for none) */
  dependsOn: number;
  /** Whether this step can run while an async task is still in flight */
  allowedDuringAsync: boolean;
}

export interface GoalPlan {
  /** Decomposed high-level steps, in logical order */
  steps: PlannedStep[];
  /** One-sentence success criterion — what "done" looks like */
  successCriterion: string;
}

// ── Failure categorisation ───────────────────────────────────────────────────

export type FailureCategory =
  | "transient" // network glitch, rate-limit — retry same tool
  | "permanent" // wrong tool, bad input — need different approach
  | "async_pending" // async task launched but not yet done — wait/poll
  | "unknown";

const TOOL_NAMES = new Set(AGENT_TOOLS.map((tool) => tool.name));

const ASYNC_TASK_ID_RE =
  /(?:queued background task|task(?:\s+id)?[:\s]+)\s*([a-f0-9-]{36})/i;

export function categoriseFailure(
  tool: string,
  output: string,
): FailureCategory {
  const lower = output.toLowerCase();

  // Async task queued but not finished — planner should poll or wait
  if (
    lower.includes("queued background task") ||
    lower.includes("task id") ||
    lower.includes("async_status")
  ) {
    return "async_pending";
  }

  // Transient: retry-safe errors
  if (
    lower.includes("timeout") ||
    lower.includes("rate limit") ||
    lower.includes("network") ||
    lower.includes("econnreset") ||
    lower.includes("503") ||
    lower.includes("429")
  ) {
    return "transient";
  }

  // Permanent: wrong tool / bad args
  if (
    lower.includes("unknown tool") ||
    lower.includes("not found") ||
    lower.includes("invalid") ||
    lower.includes("missing required") ||
    lower.includes("usage:") // tool printed its own usage hint
  ) {
    return "permanent";
  }

  return "unknown";
}

// ── Goal decomposition prompt ────────────────────────────────────────────────

const DECOMPOSE_SYSTEM = `You are a planning AI. Break a user goal into ≤8 high-level steps.

Output ONLY a raw JSON object (no markdown, no explanation):
{
  "steps": [
    {
      "objective": "<what this step achieves>",
      "tool": "<best tool name>",
      "dependsOn": <index of prior step this needs, or -1>,
      "allowedDuringAsync": <true if this step can run while an async task runs>
    }
  ],
  "successCriterion": "<one sentence: what done looks like>"
}

Rules:
1. Keep steps coarse — combine trivial sub-tasks.
2. Mark dependsOn accurately to enable parallelism checks later.
3. "finish" is always the last implied step; do NOT include it explicitly.
4. If the goal is simple (1-2 steps), keep it simple.
5. Prefer chat_export over the two-step chat→export pattern.`;

/**
 * FIX 5: Upfront goal decomposition.
 * Returns a GoalPlan with ordered steps and a success criterion.
 * Called ONCE before execution begins.
 */
export async function planGoal(
  provider: AIProvider,
  goal: string,
  model?: string,
): Promise<GoalPlan> {
  const fastModel = model || getFastModel(provider.name);

  const toolList = AGENT_TOOLS.slice(0, 20)
    .map((t) => t.name)
    .join(", ");

  try {
    const result = await provider.chat(
      [
        {
          role: "user",
          content: `Goal: "${goal}"\n\nAvailable tools (partial list): ${toolList}\n\nDecompose this goal.`,
        },
      ],
      {
        model: fastModel,
        systemPrompt: DECOMPOSE_SYSTEM,
        temperature: 0.1,
        maxTokens: 800,
      },
    );

    const raw = result.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as GoalPlan;

    // Validate & clamp
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return fallbackPlan(goal);
    }

    const steps = parsed.steps
      .slice(0, 8)
      .map((step, index) => normalisePlannedStep(step, index))
      .filter((step): step is PlannedStep => step !== null);

    if (steps.length === 0) {
      return fallbackPlan(goal);
    }

    return {
      steps,
      successCriterion:
        parsed.successCriterion || "Goal completed successfully.",
    };
  } catch {
    return fallbackPlan(goal);
  }
}

function normalisePlannedStep(step: PlannedStep, index: number): PlannedStep | null {
  if (!step || typeof step.objective !== "string") return null;

  const tool =
    typeof step.tool === "string" && TOOL_NAMES.has(step.tool.toLowerCase())
      ? step.tool.toLowerCase()
      : "chat";
  const dependsOn =
    Number.isInteger(step.dependsOn) && step.dependsOn >= -1 && step.dependsOn < index
      ? step.dependsOn
      : index > 0
        ? index - 1
        : -1;

  return {
    objective: step.objective.slice(0, 240),
    tool,
    dependsOn,
    allowedDuringAsync: Boolean(step.allowedDuringAsync),
  };
}

function fallbackPlan(goal: string): GoalPlan {
  return {
    steps: [
      {
        objective: "Research or gather information needed for the goal",
        tool: "search",
        dependsOn: -1,
        allowedDuringAsync: false,
      },
      {
        objective: "Produce and save the final output",
        tool: "chat_export",
        dependsOn: 0,
        allowedDuringAsync: false,
      },
    ],
    successCriterion: `Complete the goal: ${goal}`,
  };
}

// ── Next-step planning prompt ────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const toolList = AGENT_TOOLS.map(
    (t) => `  - ${t.name}: ${t.description}\n    example input: "${t.example}"`,
  ).join("\n");

  return `You are an autonomous AI agent. Select the NEXT single step to take.

  AVAILABLE TOOLS:
  ${toolList}

  RULES:
  1. Output ONLY a JSON object — no extra text, no markdown.
    { "thought": "<reasoning>", "tool": "<tool name>", "input": "<exact string to pass>" }
  2. Follow the plan. Deviate only if a step failed permanently.
  3. export / chat_export:
     - Use "chat_export <fmt> <file>|<prompt>" for reports, essays, summaries, research writeups, or any long generated content.
     - Use "export <fmt> <file>|{{step:N.output}}" when saving the complete output of a previous step.
     - Use "export <fmt> <file>|<literal content>" only for short literal content under 500 characters.
     Never generate a long report inline inside export; planner JSON can be token-truncated.
     If exporting the full output of a previous step, use the placeholder {{step:N.output}} after "|"; the executor will replace it with the complete raw output.
  4. async tasks: if the last step returned a task ID, your next step MUST be async_status <id> to check completion before depending on its result.
  5. Use "finish" only when successCriterion is met — include a brief summary.
  6. Do NOT repeat a failed (permanent) tool call with the same input.
  7. For content-producing steps, prefer chat_export over separate chat→export.`;
}

// ── Context builder (FIX 3) ──────────────────────────────────────────────────
//
// Keeps prompt context under ~2000 chars by:
//   - Summarising steps older than the sliding window (1 line each)
//   - Only including full output for the single most-recent step
//   - Showing the async task ID if one is in flight

export interface PlannerContext {
  goal: string;
  plan: GoalPlan;
  currentPlanIndex: number;
  completedSteps: Array<{
    step: number;
    tool: string;
    inputPreview: string;
    outputSummary: string;
    /** Full output, only for the immediately prior step */
    fullOutput?: string;
    success: boolean;
    failureCategory?: FailureCategory;
  }>;
  /** If an async task is in flight, its ID so the planner knows to poll */
  pendingAsyncId?: string;
  /** Consecutive failures on the current planned step */
  retryCount: number;
}

function buildPlannerMessage(ctx: PlannerContext, stepNum: number): string {
  const parts: string[] = [
    `GOAL: ${ctx.goal}`,
    `SUCCESS WHEN: ${ctx.plan.successCriterion}`,
    "",
    `PLAN (${ctx.plan.steps.length} steps):`,
    ...ctx.plan.steps.map(
      (s, i) =>
        `  [${i}] ${s.objective} → tool: ${s.tool}${i === ctx.currentPlanIndex ? " ← CURRENT" : ""}`,
    ),
    "",
  ];

  // FIX 3: Older steps — one line each (no full output)
  const recentWindow = 2;
  const olderSteps = ctx.completedSteps.slice(0, -recentWindow);
  if (olderSteps.length > 0) {
    parts.push("COMPLETED (summary only):");
    for (const s of olderSteps) {
      const icon = s.success ? "✓" : "✗";
      parts.push(
        `  ${icon} Step ${s.step} [${s.tool}]: ${s.outputSummary.slice(0, 120)}`,
      );
    }
    parts.push("");
  }

  // Recent steps — show full output only for the last one
  const recentSteps = ctx.completedSteps.slice(-recentWindow);
  if (recentSteps.length > 0) {
    parts.push("RECENT STEPS:");
    for (let i = 0; i < recentSteps.length; i++) {
      const s = recentSteps[i];
      const icon = s.success ? "✓" : "✗";
      const isLast = i === recentSteps.length - 1;

      // FIX 3: Full output only for the immediately prior step
      const outputText =
        isLast && s.fullOutput
          ? s.fullOutput.slice(0, 1500) // hard cap at 1500 chars
          : s.outputSummary.slice(0, 200);

      parts.push(
        `${icon} Step ${s.step} [${s.tool}]: ${s.inputPreview}\n   → ${outputText}`,
      );
      if (s.fullOutput) {
        parts.push(`   Full output reference: {{step:${s.step}.output}}`);
      }

      // FIX 4: Show failure category to help planner choose retry vs replan
      if (!s.success && s.failureCategory) {
        parts.push(`   ⚠ Failure type: ${s.failureCategory}`);
        if (s.failureCategory === "transient" && ctx.retryCount < 2) {
          parts.push(`   → Retry suggested (attempt ${ctx.retryCount + 1}/2)`);
        } else if (s.failureCategory === "permanent") {
          parts.push(`   → Try a different approach or tool`);
        }
      }
    }
    parts.push("");
  }

  // FIX 1 + FIX 2: Async awareness
  if (ctx.pendingAsyncId) {
    parts.push(
      `⚠ ASYNC TASK IN FLIGHT: ${ctx.pendingAsyncId}`,
      `  → Your next step MUST be: async_status ${ctx.pendingAsyncId}`,
      `  → Only proceed to dependent steps once status = "completed"`,
      "",
    );
  }

  parts.push(`What is step ${stepNum}?`);
  return parts.join("\n");
}

// ── Main planner entry point ─────────────────────────────────────────────────

/**
 * FIX 5: planNextStep now receives full PlannerContext (including the upfront
 * GoalPlan) instead of a raw string. This lets it make decisions relative to
 * the overall plan rather than just the last few steps.
 */
export async function planNextStep(
  provider: AIProvider,
  plannerMessage: string,
  model?: string,
): Promise<ThoughtStep> {
  const fastModel = model || getFastModel(provider.name);

  const result = await provider.chat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: plannerMessage },
    ],
    {
      model: fastModel,
      temperature: 0.2,
      maxTokens: 4000,
    },
  );

  const step = extractThoughtStep(result.text);
  if (step) return step;

  // One retry with explicit JSON demand
  const retry = await provider.chat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: plannerMessage },
      { role: "assistant", content: result.text },
      {
        role: "user",
        content:
          "Output ONLY the raw JSON object. No tags, no prose. " +
          'Example: {"thought":"...","tool":"...","input":"..."}',
      },
    ],
    {
      model: fastModel,
      temperature: 0,
      maxTokens: 4000,
    },
  );

  const retryStep = extractThoughtStep(retry.text);
  if (retryStep) return retryStep;

  return {
    thought: "Could not parse planner output.",
    tool: "__planner_parse_error",
    input: retry.text.trim() || result.text.trim(),
  };
}

/**
 * Variant that accepts a rich PlannerContext and builds the message internally.
 * Use this instead of planNextStep() when the executor has a full plan.
 *
 * FIX 2: Extracts pendingAsyncId from completed steps automatically,
 * so the planner always knows when it must poll before proceeding.
 */
export async function planNextStepWithContext(
  provider: AIProvider,
  ctx: PlannerContext,
  stepNum: number,
  model?: string,
): Promise<ThoughtStep> {
  // FIX 2: Auto-detect pending async tasks from recent step outputs
  let pendingAsyncId = ctx.pendingAsyncId;
  if (!pendingAsyncId) {
    const lastStep = ctx.completedSteps.at(-1);
    if (lastStep?.tool === "async" || lastStep?.tool === "background") {
      // Extract task ID from output like "Queued background task <uuid>"
      const idMatch = lastStep.fullOutput?.match(ASYNC_TASK_ID_RE);
      if (idMatch) {
        pendingAsyncId = idMatch[1];
      }
    }
    // If the last step was async_status and shows "completed", clear it
    if (lastStep?.tool === "async_status") {
      const output = lastStep.fullOutput ?? "";
      if (/^Status:\s*(?:completed|failed|cancelled)\b/im.test(output)) {
        pendingAsyncId = undefined;
      }
    }
  }

  const message = buildPlannerMessage({ ...ctx, pendingAsyncId }, stepNum);

  const planned = await planNextStep(provider, message, model);
  if (planned.tool === "__planner_parse_error") {
    return fallbackStepFromPlan(ctx, planned.input);
  }

  return planned;
}

function fallbackStepFromPlan(ctx: PlannerContext, rawPlannerText: string): ThoughtStep {
  const currentStep =
    ctx.plan.steps[ctx.currentPlanIndex] ?? ctx.plan.steps.at(-1);

  if (!currentStep) {
    return {
      thought: "Planner output was invalid and no planned steps remain.",
      tool: "chat",
      input: ctx.goal,
    };
  }

  const thought =
    `Planner output was invalid, so following the current plan step: ${currentStep.objective}`;
  const tool = currentStep.tool === "finish" ? "chat" : currentStep.tool;

  if (tool === "chat_export") {
    return {
      thought,
      tool,
      input: buildChatExportFallbackInput(ctx),
    };
  }

  if (tool === "export") {
    const source = [...ctx.completedSteps]
      .reverse()
      .find((step) => step.success && step.fullOutput);
    if (source) {
      return {
        thought,
        tool,
        input: `export md ${slugifyGoal(ctx.goal)}.md|{{step:${source.step}.output}}`,
      };
    }

    return {
      thought,
      tool: "chat_export",
      input: buildChatExportFallbackInput(ctx),
    };
  }

  if (tool === "async_status" && ctx.pendingAsyncId) {
    return {
      thought,
      tool,
      input: ctx.pendingAsyncId,
    };
  }

  return {
    thought,
    tool,
    input: currentStep.objective || ctx.goal || rawPlannerText,
  };
}

function buildChatExportFallbackInput(ctx: PlannerContext): string {
  const sourceSummaries = ctx.completedSteps
    .filter((step) => step.success)
    .map((step) => `Step ${step.step} [${step.tool}]: ${step.outputSummary}`)
    .join("\n");
  const prompt = [
    `Write a complete markdown report for this goal: ${ctx.goal}`,
    "",
    `Success criterion: ${ctx.plan.successCriterion}`,
    sourceSummaries ? `Use these completed-step notes:\n${sourceSummaries}` : "",
    "",
    "Produce a polished report from beginning to end. Include a conclusion and sources or caveats when appropriate.",
  ]
    .filter(Boolean)
    .join("\n");

  return `chat_export md ${slugifyGoal(ctx.goal)}.md|${prompt}`;
}

function slugifyGoal(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "autonomous_report";
}

// ── JSON extraction helpers ──────────────────────────────────────────────────

function extractThoughtStep(raw: string): ThoughtStep | null {
  let text = raw
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  const direct = tryParse(text);
  if (direct) return direct;

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    const block = tryParse(match[0]);
    if (block) return block;
  }

  return null;
}

function tryParse(text: string): ThoughtStep | null {
  const validate = (obj: any): ThoughtStep | null => {
    if (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.thought === "string" &&
      typeof obj.tool === "string" &&
      obj.input !== undefined
    ) {
      return {
        thought: obj.thought,
        tool: String(obj.tool).trim().toLowerCase(),
        input: String(obj.input ?? ""),
      };
    }
    return null;
  };

  try {
    return validate(JSON.parse(text));
  } catch {
    try {
      const sanitized = text.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m, p1) => {
        return '"' + p1.replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
      });
      return validate(JSON.parse(sanitized));
    } catch {
      try {
        return validate(JSON.parse(text.replace(/'/g, '"')));
      } catch {
        return null;
      }
    }
  }
}
