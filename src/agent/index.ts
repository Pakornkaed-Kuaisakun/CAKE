// src/agent/index.ts
import crypto from "crypto";
import { SYSTEM_PROMPT } from "../config/constants.js";
import type {
  AIProvider,
  TokenUsage,
  StreamChunkCallback,
} from "../providers/types.js";
import { ConversationHistory } from "./history.js";
import { EpisodeStore, DecisionStore } from "../modules/memory/episodes.js";
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
import { AsyncExecutionQueue, type AsyncTaskRecord } from "./asyncExecution.js";
import {
  STATIC_CORE_PROMPT,
  buildProfileLayer,
  buildRetrievedContextLayer,
  buildIntentGuardrailLayer,
  assembleSystemPrompt,
} from "./promptAssembler.js";
import { getMCPManager } from "../modules/mcp/manager.js";
import {
  detectHallucination,
  postProcess,
  trackEvent,
  annotateHighRiskClaims,
} from "../modules/hallucination/index.js";
import { hallucinationConfig } from "./handlers/hallucination.js";
import { AutoMemoryManager } from "./autoMemory.js";
import {
  loadAllSkills,
  registerSkills,
  findBestSkill,
  runWithSkill,
  skillNeedsConfirmation,
} from "./skills/index.js";

export { TokenBudgetTracker } from "./tokenBudgetTracker.js";

export interface AgentResponse {
  text: string;
  usage?: TokenUsage;
}

export interface TaskStep {
  /** Current execution phase */
  phase: "routing" | "tool" | "chat" | "pipeline" | "done" | "error";
  /** Human-readable label shown in the spinner */
  label: string;
  /** The resolved tool / intent name, if applicable */
  tool?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with each text chunk as it arrives. Enables streaming for chat. */
  onChunk?: StreamChunkCallback;
  /** Called at each meaningful phase change so the UI can show live progress. */
  onStep?: (step: TaskStep) => void;
}

const UNCACHEABLE_INTENTS = new Set([
  "chat",
  "email",
  "news",
  "weather",
  "calendar_list",
  "todo_list",
  "cron_list",
  "bash",
  "auto",
  "agent",
  "autonomous",
  "plugins",
  "tq_add",
  "tq_list",
  "tq_status",
  "tq_drain",
  "tq_stats",
]);

// Intents that skip hallucination checks (tool outputs, not LLM-generated text)
const SKIP_HALLUCINATION_INTENTS = new Set([
  "todo_list",
  "todo_add",
  "todo_remove",
  "todo_remove_all",
  "calendar_list",
  "calendar_create",
  "calendar_remove",
  "cron_list",
  "cron_schedule",
  "cron_remove",
  "file_list",
  "directory_tree",
  "notify",
  "test_notify",
  "export",
  "bash",
  "locker_list",
  "locker_add",
  "locker_get",
  "locker_delete",
  "locker_update",
  "locker_clear",
  "locker_info",
  "mcp",
  "mcp_list",
  "mcp_connect",
  "mcp_disconnect",
  "mcp_add",
  "mcp_remove",
  "mcp_tools",
  "plugins",
  "screenshot",
  "vision",
  "vdb_list",
  "vdb_create",
  "vdb_drop",
  "vdb_clear",
  "tq_add",
  "tq_list",
  "tq_status",
  "tq_cancel",
  "tq_pause",
  "tq_resume",
  "tq_retry",
  "tq_priority",
  "tq_purge",
  "tq_stats",
  "tq_drain",
  "weather", // delegated to API
]);

export class CakeAgent {
  private provider: AIProvider;
  private history: ConversationHistory;
  private memory: MemoryManager;
  private model: string | undefined;
  private fastModel: string | undefined;
  private responseCache: ResponseCache;
  private awareness: UserAwarenessManager;
  private autoMemory: AutoMemoryManager;
  private budgetTracker = new TokenBudgetTracker();
  private asyncQueue = new AsyncExecutionQueue();

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
    this.autoMemory = new AutoMemoryManager(provider, {
      decisionConfidence: 0.65, // Threshold for auto-record decision
      memoryConfidence: 0.55, // Threshold for auto-index fact
      reflectionInterval: 20, // turn between self-reflection
      autoEpisode: true, // toggle auto-episode tracking
      episodeInactivityTurns: 10, // auto-end episode after N turns inactive
    });

    const cronManager = initCronManager(async (job) => {
      const msg = `[CRON] Running scheduled task: ${job.taskDescription}`;
      if (onLog) onLog(msg);
      else console.log(msg);
      await this.run(job.taskDescription);
    });

    if (cronManager.listJobs().length === 0) {
      cronManager
        .addJob("Daily memory reflection", "0 5 * * *", "self_reflect 25")
        .catch((err) => {
          const msg = `[CRON] Failed to register built-in reflection job: ${err.message}`;
          if (onLog) onLog(msg);
          else console.warn(msg);
        });
    }

    getMCPManager()
      .init()
      .catch((err) => {
        if (onLog) onLog(`[mcp] init error: ${err.message}`);
      });

    // Load user plugins asynchronously (non-blocking)
    loadAllPlugins(onLog)
      .then((plugins) => {
        registerPlugins(plugins);
      })
      .catch((err) => {
        const msg = `[plugins] Plugin load error: ${err.message}`;
        if (onLog) onLog(msg);
        else console.warn(msg);
      });

    try {
      const skills = loadAllSkills((msg) => onLog?.(msg));
      registerSkills(skills);
    } catch (err: any) {
      onLog?.(`[skills] Load error: ${err.message}`);
    }
  }

  setModel(model: string | undefined): void {
    this.model = model;
    this.awareness.setProvider(this.provider, model);
  }

  setProvider(provider: AIProvider, model?: string): void {
    this.provider = provider;
    this.model = model;
    this.fastModel = getFastModel(provider.name);
    this.memory = new MemoryManager(provider);
    this.awareness.setProvider(provider, model);
    this.autoMemory.setProvider(provider);
    clearIntentCache();
    this.responseCache = new ResponseCache(100, 5 * 60_000);
  }

  clearHistory(): void {
    this.history.clear();
    this.awareness.clearProfile();
    this.autoMemory.resetSession();
  }

  private extractListItems(text: string): string[] {
    const lines = text.split("\n");
    const items: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // match: "1. Song name", "- Song name", "• Song name", "* Song name"
      const match = trimmed.match(/^(?:\d+[\.\)]\s+|[-•*]\s+)(.+)/);
      if (match) {
        // ตัด markdown formatting ออก เช่น **bold** "quotes"
        const clean = match[1]
          .replace(/\*\*/g, "")
          .replace(/^[""]|[""]$/g, "")
          .trim();
        if (clean.length > 0) items.push(clean);
      }
    }

    return items;
  }

  private resolveConversationalReferences(input: string): string {
    const hasReference =
      /\b(this|it|the list|that|these|those|above|the result)\b/i.test(input);
    if (!hasReference) return input;

    const messages = this.history.getAllForDisplay();
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.length > 50);

    if (!lastAssistant) return input;

    const context = (
      lastAssistant.displayContent ?? lastAssistant.content
    ).slice(0, 3000);

    // ตรวจว่าเป็น numbered/bulleted list ไหม
    const listItems = this.extractListItems(context);

    if (listItems.length > 0) {
      // ถ้าเจอ list ให้บอก agent ชัดๆ ว่ามีกี่ items และต้องบันทึกแต่ละอัน
      const itemsText = listItems
        .map((item, i) => `${i + 1}. ${item}`)
        .join("\n");

      const safeList = listItems.join(", ").slice(0, 800); // hard cap to avoid truncation
      return `${input}

      Use exactly this command (copy verbatim):
      vdb_add sad_songs ${safeList}

      Collection name is: sad_songs (no spaces, no modification)
      Do NOT split this into multiple vdb_add calls.`;
    }

    // ถ้าไม่ใช่ list ส่ง context ธรรมดา
    return `${input}

      Context from previous response:
      ${context}`;
  }

  shouldRetrieveMemory(inputLength: number): boolean {
    return (
      inputLength > 30 &&
      !!this.provider.embed &&
      !this.budgetTracker.isNearLimit()
    );
  }

  getTokenBudgetReport(): string {
    return this.budgetTracker.reportSummary();
  }

  loadHistory(messages: import("../providers/types.js").Message[]): void {
    this.history.clear();
    for (const m of messages) {
      this.history.push(m.role, m.content);
    }
  }

  // ── Hallucination check helper ────────────────────────────────────────────
  private runHallucinationCheck(
    input: string,
    rawText: string,
    intent: string,
  ): string {
    // Skip if disabled or for tool outputs
    if (!hallucinationConfig.enabled) return rawText;
    if (SKIP_HALLUCINATION_INTENTS.has(intent)) return rawText;
    if (!rawText || rawText.length < 50) return rawText;

    const score = detectHallucination(rawText, input);

    // Apply verbose annotation for critical responses
    let processedText = rawText;
    if (hallucinationConfig.verbose) {
      processedText = annotateHighRiskClaims(processedText, score);
    }

    // Apply post-processing (hedging)
    const { response: finalText, hedged } = postProcess(
      processedText,
      score,
      hallucinationConfig.threshold,
    );

    // Track event asynchronously (non-blocking)
    // Only track flagged events unless trackAll is enabled
    if (hallucinationConfig.trackAll || score.risk !== "low") {
      setImmediate(() => {
        trackEvent(input, rawText, score, finalText, hedged);
      });
    }

    return finalText;
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
    const emit = (step: TaskStep) => opts.onStep?.(step);

    const asyncRequest = trimmed.match(/^(?:async|background)\s+(.+)$/i);
    if (asyncRequest) {
      const description = asyncRequest[1].trim();
      if (!description) {
        return {
          text: "Please provide a task to run in the background. Usage: async <task>",
        };
      }
      const taskId = this.enqueueBackgroundTask(description);
      return {
        text: `Queued background task ${taskId}. Use async_status ${taskId} or async_list to track it.`,
      };
    }

    if (/^(?:async_list|background_list)$/i.test(trimmed)) {
      return { text: this.formatAsyncTaskList() };
    }

    const asyncStatus = trimmed.match(
      /^(?:async_status|background_status)\s+(\S+)$/i,
    );
    if (asyncStatus) {
      return { text: this.formatAsyncTaskStatus(asyncStatus[1]) };
    }

    const asyncCancel = trimmed.match(
      /^(?:async_cancel|background_cancel)\s+(\S+)$/i,
    );
    if (asyncCancel) {
      return { text: this.formatAsyncTaskCancel(asyncCancel[1]) };
    }
    // Automatic episode lifecycle detection (start / end)
    try {
      const startMatch = trimmed.match(
        /^(?:start|begin)\s+(?:episode|meeting|session)\s+(.+)/i,
      );
      if (startMatch) {
        const title = startMatch[1].trim();
        const store = new EpisodeStore();
        const ep = store.startEpisode(title, { autoStarted: true });
        return { text: `Started episode '${title}' (id: ${ep.id}).` };
      }

      const endMatch = trimmed.match(
        /^(?:end|stop|finish)\s+(?:episode|meeting|session)(?:\s+([\w-]+))?/i,
      );
      if (endMatch) {
        const maybeId = endMatch[1];
        const store = new EpisodeStore();
        let ep;
        if (maybeId) ep = store.endEpisode(maybeId);
        else {
          const active = store.getActiveEpisode();
          if (active) ep = store.endEpisode(active.id);
        }
        if (ep) return { text: `Ended episode '${ep.title}' (id: ${ep.id}).` };
        return { text: `No active episode found to end.` };
      }
    } catch (e) {
      // ignore episode lifecycle errors
    }

    // ── Cache key ─────────────────────────────────────────────────────────────
    const intentForGuardrail = this.inferIntentForGuardrail(trimmed);
    const intentGuardrail = buildIntentGuardrailLayer(intentForGuardrail);
    const profileSummary = this.awareness.getSummary();
    const promptHash = crypto
      .createHash("md5")
      .update(profileSummary + intentGuardrail)
      .digest("hex")
      .slice(0, 8);
    const cacheKey = `${this.provider.name}:${this.model ?? "default"}:${promptHash}:${trimmed.toLowerCase()}`;

    // ── 0) Pipeline ───────────────────────────────────────────────────────────
    if (hasPipe(trimmed)) {
      emit({ phase: "pipeline", label: "Running pipeline..." });
      const steps = parsePipeline(trimmed);
      const pipeResult = await executePipeline(
        steps,
        this.provider,
        this.model,
      );
      emit({ phase: "done", label: "Done" });
      const header = pipeResult.steps.length
        ? `[PIPELINE] ${pipeResult.steps.join(" → ")}\n\n`
        : "";
      return { text: header + pipeResult.text };
    }

    // ── 1) Greeting fast-path ─────────────────────────────────────────────────
    if (isChatFastPath(trimmed)) return this.runChat(trimmed, opts);

    // ── 2) Zero-latency pre-classifier ────────────────────────────────────────
    emit({ phase: "routing", label: "Routing intent..." });
    const preClass = preClassify(trimmed);

    if (preClass === "chat") return this.runChat(trimmed, opts);

    if (preClass === "tool") {
      const regexHandler = matchRoute(trimmed);
      if (regexHandler) {
        const cached = this.responseCache.get(cacheKey);
        if (cached) return cached;
        emit({ phase: "tool", label: "Running tool...", tool: "regex" });
        const result = await regexHandler(
          this.provider,
          trimmed,
          this.model,
          opts,
        );
        emit({ phase: "done", label: "Done" });
        const finalText = this.runHallucinationCheck(
          trimmed,
          result.text,
          "tool",
        );
        const response = { text: finalText, usage: result.usage };
        this.maybeCacheToolResult(cacheKey, trimmed, response);
        this.rememberAsync(`User asked: ${trimmed}\nResult: ${result.text}`, {
          source: "tool",
        });
        return response;
      }

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
          emit({
            phase: "tool",
            label: `Running ${candidate}...`,
            tool: candidate,
          });
          const result = await directHandler(
            this.provider,
            trimmed,
            this.model,
            opts,
          );
          emit({ phase: "done", label: "Done" });
          const finalText = this.runHallucinationCheck(
            trimmed,
            result.text,
            candidate,
          );
          const response = { text: finalText, usage: result.usage };
          if (!UNCACHEABLE_INTENTS.has(candidate))
            this.responseCache.set(cacheKey, response);
          return response;
        }
      }
    }

    // ── 3) AI intent router ───────────────────────────────────────────────────
    if (preClass === "tool") {
      return this.runChat(trimmed, opts);
    }

    const regexHandler = matchRoute(trimmed);
    if (regexHandler) {
      const cached = this.responseCache.get(cacheKey);
      if (cached) return cached;
      emit({
        phase: "tool",
        label: "Running tool...",
        tool: "regex",
      });
      const result = await regexHandler(
        this.provider,
        trimmed,
        this.model,
        opts,
      );
      emit({ phase: "done", label: "Done" });
      const finalText = this.runHallucinationCheck(
        trimmed,
        result.text,
        "tool",
      );
      const response = { text: finalText, usage: result.usage };
      this.maybeCacheToolResult(cacheKey, trimmed, response);
      if (result.text.length > 50) {
        this.rememberAsync(`User asked: ${trimmed}\nResult: ${result.text}`, {
          source: "tool",
        });
      }
      return response;
    }

    emit({ phase: "routing", label: "Classifying with AI..." });

    const intent = await aiIntentRouter(this.provider, trimmed, this.fastModel);
    const aiHandler = intentMap[intent];

    const matchedSkill = findBestSkill(trimmed, intent);
    if (matchedSkill && aiHandler) {
      if (!UNCACHEABLE_INTENTS.has(intent)) {
        const cached = this.responseCache.get(cacheKey);
        if (cached) return cached;
      }

      emit({
        phase: "tool",
        label: `${matchedSkill.meta.name} skill…`,
        tool: intent,
      });

      const rawResult = await runWithSkill(
        matchedSkill,
        trimmed,
        this.provider,
        this.model,
        opts,
        {
          baseSystemPrompt: STATIC_CORE_PROMPT,
          baseHandler: aiHandler,
        },
      );

      emit({ phase: "done", label: "Done" });
      return { text: rawResult.text, usage: rawResult.usage };
    }

    if (aiHandler) {
      if (!UNCACHEABLE_INTENTS.has(intent)) {
        const cached = this.responseCache.get(cacheKey);
        if (cached) return cached;
      }
      emit({
        phase: "tool",
        label: `Running: ${intent}`,
        tool: intent,
      });

      const effectiveInput = ["autonomous", "auto", "agent"].includes(intent)
        ? this.resolveConversationalReferences(trimmed)
        : trimmed;

      const rawResult = await aiHandler(
        this.provider,
        effectiveInput,
        this.fastModel,
        opts,
      );
      emit({ phase: "done", label: "Done" });
      const compressed = compressToolOutput(intent, rawResult.text);

      // Run hallucination check on full output (not compressed)
      const finalText = this.runHallucinationCheck(
        trimmed,
        rawResult.text,
        intent,
      );

      this.rememberAsync(compressed.fullOutput, {
        source: "tool",
        tool: intent,
      });

      const response = { text: finalText, usage: rawResult.usage };

      // Store compressed summary in history
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
    const retrievalBaselineTokens = 250;
    if (input.length > 30 && this.provider.embed) {
      if (!this.budgetTracker.isNearLimit()) {
        memories = await Promise.race([
          this.autoMemory.getRelevantContext(input),
          new Promise<string[]>((resolve) =>
            setTimeout(() => resolve([]), 600),
          ),
        ]);

        const actualChars = memories
          .slice(0, 2)
          .reduce((sum, m) => sum + Math.min(100, m.length), 0);
        const actualTokens = Math.ceil(actualChars / 4);
        this.budgetTracker.recordSavings(
          retrievalBaselineTokens - actualTokens,
        );
      } else {
        this.budgetTracker.recordSavings(retrievalBaselineTokens);
      }
    }

    this.history.push("user", input);

    const complexity = classifyComplexity(input, this.model);
    const awarenessContext = this.awareness.getContextString(input);

    const intentForGuardrail = this.inferIntentForGuardrail(input);
    const intentGuardrail = buildIntentGuardrailLayer(intentForGuardrail);

    const layers = {
      staticCore: STATIC_CORE_PROMPT,
      profileSnapshot: awarenessContext,
      retrievedContext: buildRetrievedContextLayer(memories),
      intentGuardrail: intentGuardrail || undefined,
    };

    const systemPrompt = assembleSystemPrompt({
      staticCore: layers.staticCore,
      profileSnapshot: layers.profileSnapshot,
      retrievedContext: "",
      intentGuardrail: layers.intentGuardrail,
    });

    const chatOpts = {
      systemPrompt,
      model: this.model ?? this.fastModel,
      signal: opts.signal,
      maxTokens: complexity.maxTokens,
      thinking: {
        enabled: complexity.thinkingBudget > 0,
        budgetTokens: complexity.thinkingBudget,
      },
    };

    const messages = this.history.getAll();
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      let enrichedContent = input;
      if (layers.retrievedContext) {
        enrichedContent += `\n\n${layers.retrievedContext.trim()}`;
      }
      messages[messages.length - 1].content = enrichedContent;
    }

    opts.onStep?.({ phase: "chat", label: "Generating response..." });

    const result =
      opts.onChunk && this.provider.stream
        ? await this.provider.stream(messages, chatOpts, opts.onChunk)
        : await this.provider.chat(messages, chatOpts);

    // Run hallucination check on chat responses
    const finalText = this.runHallucinationCheck(input, result.text, "chat");

    this.history.push("assistant", result.text);
    this.awareness.observe(input, result.text);
    this.autoMemory.processTurn(input, result.text);

    if (result.usage) {
      this.budgetTracker.record(
        result.usage.inputTokens + result.usage.outputTokens,
      );
    }

    return { text: finalText, usage: result.usage };
  }

  /**
   * Heuristic: infer a guardrail intent from the raw user input without
   * waiting for the AI router. Used only for system-prompt guardrail injection.
   * Falls back to "chat" (which has a generic guardrail).
   */
  private enqueueBackgroundTask(description: string): string {
    return this.asyncQueue.enqueue(description, async () => {
      const result = await this.run(description);
      return result.text;
    });
  }

  public listBackgroundTasks(): AsyncTaskRecord[] {
    return this.asyncQueue.list();
  }

  public getBackgroundTask(taskId: string): AsyncTaskRecord | undefined {
    return this.asyncQueue.get(taskId);
  }

  public cancelBackgroundTask(taskId: string): boolean {
    return this.asyncQueue.cancel(taskId);
  }

  private formatAsyncTaskList(): string {
    const tasks = this.asyncQueue.list();
    if (tasks.length === 0) return "No background tasks queued.";

    return tasks
      .map((task) => {
        const note =
          task.status === "completed"
            ? ` result=${this.shorten(task.result ?? "(empty)", 120)}`
            : task.status === "failed"
              ? ` error=${this.shorten(task.error ?? "unknown", 120)}`
              : "";
        return `${task.id} | ${task.status} | ${task.description}${note}`;
      })
      .join("\n");
  }

  private formatAsyncTaskStatus(taskId: string): string {
    const task = this.asyncQueue.get(taskId);
    if (!task) return `Task not found: ${taskId}`;

    const details = [
      `Task: ${task.description}`,
      `Status: ${task.status}`,
      `Created: ${new Date(task.createdAt).toISOString()}`,
    ];
    if (task.startedAt)
      details.push(`Started: ${new Date(task.startedAt).toISOString()}`);
    if (task.completedAt)
      details.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
    if (task.result) details.push(`Result: ${this.shorten(task.result, 200)}`);
    if (task.error) details.push(`Error: ${this.shorten(task.error, 200)}`);
    return details.join("\n");
  }

  private formatAsyncTaskCancel(taskId: string): string {
    const cancelled = this.asyncQueue.cancel(taskId);
    return cancelled
      ? `Cancelled background task ${taskId}.`
      : `Could not cancel task ${taskId}. It may already be running, completed, or not exist.`;
  }

  private shorten(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
  }

  private inferIntentForGuardrail(input: string): string {
    const lower = input.toLowerCase();
    if (/\b(finance|stock|ticker|price|market)\b/.test(lower)) return "finance";
    if (/\b(search|find|look up|google)\b/.test(lower)) return "search";
    if (/\b(news|headlines)\b/.test(lower)) return "news";
    if (/\b(summarize|summary)\b.*\.(pdf|docx|txt)\b/.test(lower))
      return "document_summarize";
    if (/\b(ask|question)\b.*\.(pdf|docx|txt)\b/.test(lower))
      return "document_ask";
    if (/\b(deep.?search|research)\b/.test(lower)) return "deep_search";
    if (/\b(bash|run|shell|cmd)\b/.test(lower)) return "bash";
    return "chat";
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
      "deep_search",
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

  private async detectAndRecordDecisionsAsync(
    input: string,
    responseText: string,
  ): Promise<void> {
    if (!this.provider.chat) return;

    // Fast heuristic keyword match to minimize API calls
    const keywords = [
      "decided",
      "agreed",
      "resolution",
      "action item",
      "ตกลง",
      "ตัดสินใจ",
      "ข้อตกลง",
      "อนุมัติ",
      "agree",
      "choose",
      "selected",
      "เลือก",
      "เคาะ",
    ];
    const combined = (input + " " + responseText).toLowerCase();
    const hasKeyword = keywords.some((kw) => combined.includes(kw));
    if (!hasKeyword) return;

    // Use LLM to extract decisions/agreements
    const systemPrompt = `You are a precision decision-extraction system. Your job is to analyze the conversation turn and detect if a firm decision, agreement, or action item was finalized.
    If a decision or agreement was finalized, reply with a JSON object ONLY:
    {
      "hasDecision": true,
      "decision": "Brief, clear statement of the decision made",
      "rationale": "Optional brief explanation of why/how this decision was reached (or null if none)"
    }
    If no firm decision, agreement, or action item was finalized, reply ONLY with:
    {
      "hasDecision": false
    }
    Do NOT include markdown wrapping (like \`\`\`json), just raw JSON. Be conservative: only record actual agreements/resolutions.`;

    const userMessage = `User: ${input}\nAssistant: ${responseText}`;
    try {
      const resp = await this.provider.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        { model: this.fastModel || this.model },
      );

      if (!resp || !resp.text) return;
      const trimmed = resp.text.trim();
      const cleanJson = trimmed.replace(/^```json\s*|```$/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.hasDecision && parsed.decision) {
        const store = new DecisionStore();
        const activeEpisode = new EpisodeStore().getActiveEpisode();

        let linkedMemoryIds: string[] = [];
        try {
          const entries = await this.memory.retrieveEntries(parsed.decision, 5);
          linkedMemoryIds = entries.map((e) => e.id);
        } catch {
          // ignore linking errors
        }

        store.addDecision(
          parsed.decision,
          parsed.rationale || undefined,
          activeEpisode?.id,
          {
            recordedBy: "auto",
            linkedMemoryIds,
            timestamp: Date.now(),
          },
        );
      }
    } catch (err: any) {
      if (process.env.DEBUG) {
        console.warn(
          "[memory] detectAndRecordDecisionsAsync failed:",
          err.message,
        );
      }
    }
  }
}
