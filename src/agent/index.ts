// src/agent/index.ts
import type { AIProvider, TokenUsage } from "../providers/types.js";
import { ConversationHistory } from "./history.js";
import { MemoryManager } from "../modules/memory/index.js";
import { matchRoute } from "./router.js";
import { aiIntentRouter } from "./AiRouter.js";
import { intentMap } from "./intentMap.js";
import { SYSTEM_PROMPT } from "../config/constants.js";
import { initCronManager } from "./handlers/cron.js";
import { ResponseCache } from "./responseCache.js";
import { getFastModel } from "../providers/utils.js";
import { hasPipe, parsePipeline, executePipeline } from "./pipeline/index.js";

export interface AgentResponse {
  text: string;
  usage?: TokenUsage;
}

// Intents that return live data and must never be cached
const UNCACHEABLE_INTENTS = new Set([
  "email",
  "news",
  "weather",
  "calendar_list",
  "todo_list",
  "cron_list",
  "finance",
  "search",
]);

export class CakeAgent {
  private provider: AIProvider;
  private history: ConversationHistory;
  private memory: MemoryManager;
  private model: string | undefined;
  private fastModel: string | undefined;
  private responseCache: ResponseCache;

  constructor(provider: AIProvider, model?: string) {
    this.provider = provider;
    this.history = new ConversationHistory();
    this.memory = new MemoryManager(provider);
    this.model = model;
    this.fastModel = getFastModel(this.provider.name);
    // 5 min TTL — only used for static/structural commands (tree, file read, etc.)
    this.responseCache = new ResponseCache(100, 5 * 60_000);

    initCronManager(async (job) => {
      console.log(`[CRON] Running scheduled task: ${job.taskDescription}`);
      await this.run(job.taskDescription);
    });
  }

  setModel(model: string | undefined): void {
    this.model = model;
  }

  clearHistory(): void {
    this.history.clear();
  }

  async run(input: string, signal?: AbortSignal): Promise<AgentResponse> {
    const cacheKey = `${this.provider.name}:${this.model ?? "default"}:${input.trim().toLowerCase()}`;

    // 0) Pipeline / composed command — never cache pipelines
    if (hasPipe(input)) {
      const steps = parsePipeline(input);
      const pipeResult = await executePipeline(
        steps,
        this.provider,
        this.model,
      );

      const header = pipeResult.steps.length
        ? `[PIPELINE] ${pipeResult.steps.join(" → ")}\n\n`
        : "";

      return { text: header + pipeResult.text };
    }

    // 1) Fast regex path first (no AI call)
    const regexHandler = matchRoute(input);

    if (regexHandler) {
      // Check cache only for non-live routes
      const cached = this.responseCache.get(cacheKey);
      if (cached) return cached;

      const result = await regexHandler(this.provider, input, this.model);
      const response = { text: result.text, usage: result.usage };

      // Only cache structural/static commands — detect by checking intent keywords
      const lowerInput = input.toLowerCase();
      const isLive = [
        "email",
        "news",
        "weather",
        "calendar",
        "todo",
        "cron",
        "finance",
        "search",
        "file",
        "ls",
        "cat",
        "tree",
        "document",
        "memory",
        "notify",
      ].some((k) => lowerInput.includes(k));
      if (!isLive) {
        this.responseCache.set(cacheKey, response);
      }

      if (result.text.length > 50) {
        await this.memory.remember(
          `User asked: ${input}\nResult: ${result.text}`,
          { source: "tool" },
        );
      }
      return response;
    }

    // 2) AI intent router (fast model) only when regex did not match
    const intent = await aiIntentRouter(this.provider, input, this.fastModel);
    const aiHandler = intentMap[intent];

    if (aiHandler) {
      // Skip cache for live-data intents
      if (!UNCACHEABLE_INTENTS.has(intent)) {
        const cached = this.responseCache.get(cacheKey);
        if (cached) return cached;
      }

      const result = await aiHandler(this.provider, input, this.fastModel);
      const response = { text: result.text, usage: result.usage };

      if (!UNCACHEABLE_INTENTS.has(intent)) {
        this.responseCache.set(cacheKey, response);
      }
      return response;
    }

    // 3) Fallback: general conversation with history + RAG context
    const relevantContext = await this.memory.retrieve(input);
    const contextString =
      relevantContext.length > 0
        ? "\n\nRelevant context from past interactions:\n" +
          relevantContext.map((c) => `- ${c}`).join("\n")
        : "";

    this.history.push("user", input);

    const result = await this.provider.chat(this.history.getAll(), {
      systemPrompt: SYSTEM_PROMPT + contextString,
      model: this.model,
      signal,
    });

    this.history.push("assistant", result.text);

    await this.memory.remember(`User: ${input}\nAssistant: ${result.text}`, {
      source: "conversation",
    });

    return { text: result.text, usage: result.usage };
  }
}
