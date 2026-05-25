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
import { initCronManager } from "./handlers/cron.js";
import { ResponseCache } from "./responseCache.js";
import { getFastModel } from "../providers/utils.js";
import { hasPipe, parsePipeline, executePipeline } from "./pipeline/index.js";
import { clearIntentCache } from "./intentCache.js";
import { loadAllPlugins } from "./plugins/loader.js";
import { registerPlugins } from "./plugins/registry.js";
import { UserAwarenessManager } from "../modules/userAwareness/index.js";
import { compressToolOutput } from "./toolOutputCompresser.js";
import { classifyComplexity } from "./complexityClassifier.js";
import { TokenBudgetTracker } from "./tokenBudgetTracker.js";
import {
  STATIC_CORE_PROMPT,
  buildProfileLayer,
  buildRetrievedContextLayer,
  assembleSystemPrompt,
} from "./promptAssembler.js";
import { getMCPManager } from "../modules/mcp/manager.js";

export { TokenBudgetTracker } from "./tokenBudgetTracker.js";

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
  "plugins",
]);

export class CakeAgent {
  private provider: AIProvider;
  private history: ConversationHistory;
  private memory: MemoryManager;
  private model: string | undefined;
  private fastModel: string | undefined;
  private responseCache: ResponseCache;
  private awareness: UserAwarenessManager;
  private budgetTracker = new TokenBudgetTracker();

  constructor(
    provider: AIProvider,
    model?: string,
    onLog?: (msg: string) => void,
  ) {
    this.provider = provider;
    this.history = new ConversationHistory();
    this.memory = new MemoryManager(provider);
    this.model = model;
    this.fastModel = getFastModel(this.provider.name);
    this.awareness = new UserAwarenessManager(provider, model);
    this.responseCache = new ResponseCache(100, 5 * 60_000);

    initCronManager(async (job) => {
      const msg = `[CRON] Running scheduled task: ${job.taskDescription}`;
      if (onLog) onLog(msg);
      else console.log(msg);
      await this.run(job.taskDescription);
    });

    getMCPManager()
      .init()
      .catch((err) => {
        if (onLog) onLog(`[mcp] init error: ${err.message}`);
      });

    // Load user plugins asynchronously (non-blocking)
    loadAllPlugins(onLog)
      .then((plugins) => {
        registerPlugins(plugins);
        // if (plugins.length > 0) {
        //   const msg = `[plugins] ${plugins.length} plugin(s) ready.`;
        //   if (onLog) onLog(msg);
        //   else console.log(msg);
        // }
      })
      .catch((err) => {
        const msg = `[plugins] Plugin load error: ${err.message}`;
        if (onLog) onLog(msg);
        else console.warn(msg);
      });
  }

  setModel(model: string | undefined): void {
    this.model = model;
    this.awareness.setProvider(this.provider, model);
    // Intent cache is model-agnostic (intents don't change per model),
    // but clear it when provider changes to avoid stale routing decisions.
  }

  setProvider(provider: AIProvider, model?: string): void {
    this.provider = provider;
    this.model = model;
    this.fastModel = getFastModel(provider.name);
    this.memory = new MemoryManager(provider);
    this.awareness.setProvider(provider, model);
    clearIntentCache(); // new provider may handle different intents
    this.responseCache = new ResponseCache(100, 5 * 60_000);
  }

  clearHistory(): void {
    this.history.clear();
    this.awareness.clearProfile();
  }

  loadHistory(messages: import("../providers/types.js").Message[]): void {
    this.history.clear();
    for (const m of messages) {
      this.history.push(m.role, m.content);
    }
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
        const result = await regexHandler(
          this.provider,
          trimmed,
          this.model,
          opts,
        );
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
          const result = await directHandler(
            this.provider,
            trimmed,
            this.model,
            opts,
          );
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
      const result = await regexHandler(
        this.provider,
        trimmed,
        this.model,
        opts,
      );
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

      // After getting tool result:
      const rawResult = await aiHandler(
        this.provider,
        trimmed,
        this.fastModel,
        opts,
      );
      const compressed = compressToolOutput(intent, rawResult.text);

      // Store FULL output in vector memory
      this.rememberAsync(compressed.fullOutput, {
        source: "tool",
        tool: intent,
      });

      // Return compressed summary to conversation history
      const response = { text: rawResult.text, usage: rawResult.usage };

      // IMPORTANT: what goes into history should be the summary, not the full output
      // This requires separating "what we show user" from "what we add to history"
      this.history.push("assistant", compressed.summary);

      if (rawResult.usage) {
        this.budgetTracker.record(
          rawResult.usage.inputTokens + rawResult.usage.outputTokens,
        );
      }

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
    let memories: string[] = [];
    if (input.length > 30 && this.provider.embed) {
      memories = await Promise.race([
        this.memory.retrieve(input),
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 600)),
      ]);
    }

    this.history.push("user", input);

    const complexity = classifyComplexity(input);
    const awarenessContext = this.awareness.getContextString(input);

    // Build the prompt layers
    const layers = {
      staticCore: STATIC_CORE_PROMPT,
      profileSnapshot: buildProfileLayer(this.awareness.getSummary()),
      retrievedContext: buildRetrievedContextLayer(memories),
    };

    // System prompt only contains staticCore and profileSnapshot to maximize caching
    const systemPrompt = assembleSystemPrompt({
      staticCore: layers.staticCore,
      profileSnapshot: layers.profileSnapshot,
      retrievedContext: "",
    });

    const chatOpts = {
      systemPrompt,
      model: this.model,
      signal: opts.signal,
      maxTokens: complexity.maxTokens,
      thinking: {
        enabled: complexity.thinkingBudget > 0,
        budgetTokens: complexity.thinkingBudget,
      },
    };

    // Enrich the latest user message with Layer 3 (retrieved memories).
    // This keeps the system prompt static while still providing full dynamic context.
    const messages = this.history.getAll();
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      let enrichedContent = input;
      if (layers.retrievedContext) {
        enrichedContent += `\n\n${layers.retrievedContext.trim()}`;
      }
      messages[messages.length - 1].content = enrichedContent;
    }

    const result =
      opts.onChunk && this.provider.stream
        ? await this.provider.stream(messages, chatOpts, opts.onChunk)
        : await this.provider.chat(messages, chatOpts);

    this.history.push("assistant", result.text);
    this.awareness.observe(input, result.text);
    this.rememberAsync(`User: ${input}\nAssistant: ${result.text}`, {
      source: "conversation",
    });

    if (result.usage) {
      this.budgetTracker.record(
        result.usage.inputTokens + result.usage.outputTokens,
      );
    }

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
