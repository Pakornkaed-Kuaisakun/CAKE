// src/agent/index.ts
import type {
  AIProvider,
  TokenUsage,
  StreamChunkCallback,
} from "../providers/types.js";
import { ConversationHistory } from "./history.js";
import { MemoryManager } from "../modules/memory/index.js";
import { matchRoute, isChatFastPath } from "./router.js";
import { aiIntentRouter } from "./AiRouter.js";
import { intentMap } from "./intentMap.js";
import { preClassify } from "./preClassifier.js";
import { SYSTEM_PROMPT } from "../config/constants.js";
import { initCronManager } from "./handlers/cron.js";
import { ResponseCache } from "./responseCache.js";
import { getFastModel } from "../providers/utils.js";
import { hasPipe, parsePipeline, executePipeline } from "./pipeline/index.js";
import { clearIntentCache } from "./intentCache.js";

export interface AgentResponse {
  text: string;
  usage?: TokenUsage;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with each text chunk as it arrives. Enables streaming for chat. */
  onChunk?: StreamChunkCallback;
}

const UNCACHEABLE_INTENTS = new Set([
  "chat",
  "email",
  "news",
  "weather",
  "calendar_list",
  "todo_list",
  "cron_list",
  "finance",
  "search",
  "bash",
  "auto",
  "agent",
  "autonomous",
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
    this.responseCache = new ResponseCache(100, 5 * 60_000);

    initCronManager(async (job) => {
      console.log(`[CRON] Running scheduled task: ${job.taskDescription}`);
      await this.run(job.taskDescription);
    });
  }

  setModel(model: string | undefined): void {
    this.model = model;
    // Intent cache is model-agnostic (intents don't change per model),
    // but clear it when provider changes to avoid stale routing decisions.
  }

  setProvider(provider: AIProvider, model?: string): void {
    this.provider = provider;
    this.model = model;
    this.fastModel = getFastModel(provider.name);
    this.memory = new MemoryManager(provider);
    clearIntentCache(); // new provider may handle different intents
    this.responseCache = new ResponseCache(100, 5 * 60_000);
  }

  clearHistory(): void {
    this.history.clear();
  }

  // Accepts AbortSignal directly (old callers: cron, Discord) or RunOptions
  async run(
    input: string,
    signalOrOpts?: AbortSignal | RunOptions,
  ): Promise<AgentResponse> {
    const opts: RunOptions =
      signalOrOpts instanceof AbortSignal
        ? { signal: signalOrOpts }
        : (signalOrOpts ?? {});

    const trimmed = input.trim();
    const cacheKey = `${this.provider.name}:${this.model ?? "default"}:${trimmed.toLowerCase()}`;

    // ── 0) Pipeline ───────────────────────────────────────────────────────────
    if (hasPipe(trimmed)) {
      const steps = parsePipeline(trimmed);
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

    // ── 1) Greeting fast-path (streams if onChunk provided) ───────────────────
    if (isChatFastPath(trimmed)) return this.runChat(trimmed, opts);

    // ── 2) Zero-latency pre-classifier ────────────────────────────────────────
    const preClass = preClassify(trimmed);

    if (preClass === "chat") return this.runChat(trimmed, opts);

    if (preClass === "tool") {
      const regexHandler = matchRoute(trimmed);
      if (regexHandler) {
        const cached = this.responseCache.get(cacheKey);
        if (cached) return cached;
        const result = await regexHandler(this.provider, trimmed, this.model);
        const response = { text: result.text, usage: result.usage };
        this.maybeCacheToolResult(cacheKey, trimmed, response);
        this.rememberAsync(`User asked: ${trimmed}\nResult: ${result.text}`, {
          source: "tool",
        });
        return response;
      }

      // Try direct intentMap lookup:
      // 1. Exact first word ("bash", "weather", "news" …)
      // 2. First two words joined with underscore ("todo_remove", "cron_list" …)
      //    This lets snake_case intent IDs typed verbatim bypass the AI router.
      const words = trimmed.toLowerCase().split(/\s+/);
      const candidates = [
        words[0],
        words.length >= 2 ? `${words[0]}_${words[1]}` : "",
        words.length >= 3 ? `${words[0]}_${words[1]}_${words[2]}` : "",
      ];
      for (const candidate of candidates) {
        const directHandler = intentMap[candidate];
        if (directHandler) {
          if (!UNCACHEABLE_INTENTS.has(candidate)) {
            const cached = this.responseCache.get(cacheKey);
            if (cached) return cached;
          }
          const result = await directHandler(this.provider, trimmed, this.model);
          const response = { text: result.text, usage: result.usage };
          if (!UNCACHEABLE_INTENTS.has(candidate))
            this.responseCache.set(cacheKey, response);
          return response;
        }
      }
    }

    // ── 3) AI intent router — only truly ambiguous inputs reach here ──────────
    // At this point preClass is either "tool" (no regex/direct match found) or
    // "ambiguous". If preClass was "tool" and we got here, the pre-classifier
    // over-fired — safest to chat rather than waste another LLM call.
    if (preClass === "tool") {
      // The pre-classifier thought it was a tool, but no handler matched.
      // Treat as chat to avoid burning an AI router token on a false positive.
      return this.runChat(trimmed, opts);
    }

    const regexHandler = matchRoute(trimmed);
    if (regexHandler) {
      const cached = this.responseCache.get(cacheKey);
      if (cached) return cached;
      const result = await regexHandler(this.provider, trimmed, this.model);
      const response = { text: result.text, usage: result.usage };
      this.maybeCacheToolResult(cacheKey, trimmed, response);
      if (result.text.length > 50) {
        this.rememberAsync(`User asked: ${trimmed}\nResult: ${result.text}`, {
          source: "tool",
        });
      }
      return response;
    }

    const intent = await aiIntentRouter(this.provider, trimmed, this.fastModel);
    const aiHandler = intentMap[intent];

    if (aiHandler) {
      if (!UNCACHEABLE_INTENTS.has(intent)) {
        const cached = this.responseCache.get(cacheKey);
        if (cached) return cached;
      }
      const result = await aiHandler(this.provider, trimmed, this.fastModel);
      const response = { text: result.text, usage: result.usage };
      if (!UNCACHEABLE_INTENTS.has(intent))
        this.responseCache.set(cacheKey, response);
      return response;
    }

    // ── 4) Fallback ───────────────────────────────────────────────────────────
    return this.runChat(trimmed, opts);
  }

  // ─── Unified chat runner ────────────────────────────────────────────────────
  private async runChat(
    input: string,
    opts: RunOptions,
  ): Promise<AgentResponse> {
    let contextString = "";
    if (input.length > 30 && this.provider.embed) {
      const relevantContext = await Promise.race([
        this.memory.retrieve(input),
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 600)),
      ]);
      if (relevantContext.length > 0) {
        contextString =
          "\n\nRelevant context from past interactions:\n" +
          relevantContext.map((c) => `- ${c}`).join("\n");
      }
    }

    this.history.push("user", input);

    const chatOpts = {
      systemPrompt: SYSTEM_PROMPT + contextString,
      model: this.model,
      signal: opts.signal,
    };

    const result =
      opts.onChunk && this.provider.stream
        ? await this.provider.stream(
            this.history.getAll(),
            chatOpts,
            opts.onChunk,
          )
        : await this.provider.chat(this.history.getAll(), chatOpts);

    this.history.push("assistant", result.text);
    this.rememberAsync(`User: ${input}\nAssistant: ${result.text}`, {
      source: "conversation",
    });

    return { text: result.text, usage: result.usage };
  }

  private maybeCacheToolResult(
    key: string,
    input: string,
    response: AgentResponse,
  ): void {
    const isLive = [
      "email",
      "news",
      "weather",
      "calendar",
      "todo",
      "cron",
      "finance",
      "search",
      "notify",
    ].some((k) => input.toLowerCase().includes(k));
    if (!isLive) this.responseCache.set(key, response);
  }

  private rememberAsync(text: string, metadata: Record<string, any>): void {
    this.memory.remember(text, metadata).catch((err) => {
      if (process.env.DEBUG)
        console.warn("[memory] write failed:", err.message);
    });
  }
}
