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
import { loadAllPlugins } from "./plugins/loader.js";
import { registerPlugins } from "./plugins/registry.js";
import { UserAwarenessManager } from "../modules/userAwareness/index.js";

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
          const result = await directHandler(
            this.provider,
            trimmed,
            this.model,
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

  private isComplexTask(input: string): boolean {
    if (process.env.CAKE_DEBUG === "true") return true;

    const trimmed = input.trim();
    if (trimmed.length < 25) return false;

    const lower = trimmed.toLowerCase();

    // Direct simple conversational phrases or greetings
    const simpleConversations = [
      "hello",
      "hi",
      "hey",
      "how are you",
      "what is your name",
      "who are you",
      "thank you",
      "thanks",
      "bye",
      "good morning",
      "good afternoon",
      "good evening",
      "สวัสดี",
      "ขอบคุณ",
      "หวัดดี",
      "สบายดีไหม",
    ];

    if (simpleConversations.some((c) => lower.startsWith(c) || lower === c)) {
      return false;
    }

    // Key terms that imply programming, math, logic, analysis, or detailed explanation
    const complexKeywords = [
      "code",
      "program",
      "script",
      "implement",
      "function",
      "class",
      "algorithm",
      "solve",
      "calculate",
      "math",
      "logic",
      "proof",
      "debug",
      "error",
      "fix",
      "why",
      "how to",
      "explain",
      "compare",
      "analyze",
      "evaluate",
      "design",
      "architecture",
      "วิเคราะห์",
      "อธิบาย",
      "แก้ปัญหา",
      "เขียนโค้ด",
      "โปรแกรม",
      "สูตร",
      "สมการ",
    ];

    if (complexKeywords.some((keyword) => lower.includes(keyword))) {
      return true;
    }

    // Default to true for long queries as they generally request comprehensive details
    return trimmed.length > 80;
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

    const shouldThink = this.isComplexTask(input);

    const awarenessContext = this.awareness.getContextString(input);

    const chatOpts = {
      systemPrompt: SYSTEM_PROMPT + contextString + awarenessContext,
      model: this.model,
      signal: opts.signal,
      maxTokens: shouldThink ? 4096 : 1024,
      thinking: {
        enabled: shouldThink,
        budgetTokens: shouldThink ? 2048 : 0,
      },
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
    this.awareness.observe(input, result.text);
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
