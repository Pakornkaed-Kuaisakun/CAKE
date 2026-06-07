import { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "ink";
import type { ProviderName, TokenUsage } from "../../providers/types.js";
import { CakeAgent } from "../../agent/index.js";
import type { RunOptions, TaskStep } from "../../agent/index.js";
import { APP_NAME } from "../../config/constants.js";
import type { ChatMessage } from "../components/MessageList.js";
import type { UseVoiceReturn } from "./useVoice.js";
import { env } from "../../config/env.js";
import { loadPrefs, prefsFilePath } from "../../config/preferences.js";
import { useTheme } from "../theme/useTheme.js";
import { addCost } from "../../config/costs.js";
import { getEmbedQualityWarning } from "../../modules/memory/index.js";
import { usePermission } from "./usePermission.js";
import { useLocker } from "./useLocker.js";
import { useSlashCommands } from "./useSlashCommands.js";
import { createProvider } from "../../providers/index.js";

const PREFS = loadPrefs();
const INIT_PROVIDER = (PREFS.provider || env.defaultProvider) as ProviderName;
const INIT_MODEL = PREFS.model || env.defaultModel || undefined;

function makeId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

export interface SessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
}

export function useAgent() {
  const { exit } = useApp();
  const locker = useLocker();
  const { theme, setTheme: setAppTheme } = useTheme();

  const [msgVersion, setMsgVersion] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content: [
        `${APP_NAME} ready.`,
        `Provider: ${INIT_PROVIDER}${INIT_MODEL ? ` · model: ${INIT_MODEL}` : ""}`,
        `Defaults loaded from: ${prefsFilePath()}`,
        `Type /help for commands.`,
      ].join("  "),
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [thinkingMs, setThinkingMs] = useState<number | null>(null);
  const [taskStep, setTaskStep] = useState<TaskStep | null>(null);

  const voiceRef = useRef<UseVoiceReturn | null>(null);
  const registerVoice = useCallback((v: UseVoiceReturn) => {
    voiceRef.current = v;
  }, []);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamingIdRef = useRef<string | null>(null);
  const streamedRef = useRef(false);

  const [providerName, setProviderName] = useState<ProviderName>(INIT_PROVIDER);
  const [model, setModel] = useState<string | undefined>(INIT_MODEL);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const addMsg = useCallback(
    (role: ChatMessage["role"], content: string, thinkingTime?: number) => {
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role, content, thinkingTime },
      ]);
    },
    [],
  );

  const { wirePermissions, interceptPermission } = usePermission(addMsg);

  // Wire permission ask handlers once on mount (stable because makeAskHandler
  // is memoised inside usePermission)
  useEffect(() => {
    wirePermissions();
  }, [wirePermissions]);

  const buildAgent = useCallback(
    (provName: ProviderName, mod?: string) => {
      return new CakeAgent(createProvider(provName), mod, (msg) => {
        addMsg("system", msg);
      });
    },
    [addMsg],
  );

  const [agent, setAgent] = useState<CakeAgent>(() =>
    buildAgent(INIT_PROVIDER, INIT_MODEL),
  );
  const [stats, setStats] = useState<SessionStats>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalCostUsd: 0,
  });
  const [lastEvents, setLastEvents] = useState<any[]>([]);

  const startTimer = useCallback(() => {
    setThinkingMs(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setThinkingMs(Date.now() - t0), 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const accumulateUsage = useCallback((usage?: TokenUsage) => {
    if (!usage) return;
    setStats((prev) => ({
      totalInputTokens: prev.totalInputTokens + usage.inputTokens,
      totalOutputTokens: prev.totalOutputTokens + usage.outputTokens,
      totalCachedTokens: prev.totalCachedTokens + (usage.cachedTokens ?? 0),
      totalCostUsd: prev.totalCostUsd + (usage.costUsd ?? 0),
    }));
    addCost({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: usage.costUsd,
    });
  }, []);

  const checkEmbedWarning = useCallback(() => {
    const warning = getEmbedQualityWarning(providerName);
    if (warning) addMsg("system", warning);
  }, [addMsg, providerName]);

  // ─── Slash command hook ────────────────────────────────────────────────────
  const handleSlash = useSlashCommands({
    agent,
    addMsg,
    exit,
    providerName,
    model,
    setProviderName,
    setModel,
    setAgent,
    buildAgent,
    messages,
    setMessages,
    setMsgVersion,
    locker,
    theme,
    setAppTheme,
    loading,
    setLoading,
    abortControllerRef,
    startTimer,
    stopTimer,
    setTaskStep,
    accumulateUsage,
    checkEmbedWarning,
    voiceRef,
    lastEvents,
    setLastEvents,
    streamingIdRef,
  });

  // ─── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setInput("");
      setCommandHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last === trimmed) return prev;
        return [...prev, trimmed];
      });
      if (interceptPermission(trimmed)) return;
      // Intercept locker multi-step flow
      if (
        locker.interceptLockerInput(trimmed, handleSubmit, () => {
          addMsg("system", "🔐 Locker flow cancelled.");
        })
      ) {
        return;
      }
      const lower = trimmed.toLowerCase();

      if (lower === "cls" || lower === "clear") {
        setMsgVersion((v) => v + 1);
        setMessages([
          { id: makeId(), role: "system", content: "Conversation cleared." },
        ]);
        agent.clearHistory();
        return;
      }

      // ── Slash commands ────────────────────────────────────────────────────
      if (trimmed.startsWith("/")) {
        await handleSlash(trimmed);
        return;
      }

      // ── Agent call with streaming ─────────────────────────────────────────
      const t0 = Date.now();

      let chatInput = trimmed;
      if (trimmed.includes("__value__:") || trimmed.includes("__password__:")) {
        chatInput = trimmed
          .split("__value__:")[0]
          .split("__password__:")[0]
          .trim();
      }
      addMsg("user", chatInput);
      setLoading(true);
      startTimer();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const streamId = makeId();
      streamingIdRef.current = streamId;
      streamedRef.current = false;
      setMessages((prev) => [
        ...prev,
        { id: streamId, role: "assistant", content: "" },
      ]);

      try {
        // BUG FIX: Wire voice into onChunk so streaming responses are spoken.
        // Previously makeSpeakingOnChunk was never called here — voice was
        // entirely disconnected from the main agent.run() path.
        const baseOnChunk = (chunk: string) => {
          if (chunk) streamedRef.current = true;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId ? { ...m, content: m.content + chunk } : m,
            ),
          );
        };

        const voice = voiceRef.current;
        const onChunk = voice
          ? voice.makeSpeakingOnChunk(baseOnChunk)
          : baseOnChunk;

        const runOpts: RunOptions = {
          signal: controller.signal,
          onChunk,
          onStep: setTaskStep,
        };

        const resp = await agent.run(trimmed, runOpts);
        const lockerPrompt = locker.detectLockerSignal(resp.text, trimmed);
        if (lockerPrompt) {
          // Show the locker prompt instead of the raw signal text
          addMsg("system", lockerPrompt);
          setLoading(false);
          stopTimer();
          return;
        }
        const finalTime = Date.now() - t0;
        stopTimer();
        checkEmbedWarning();
        accumulateUsage(resp.usage);

        if (process.env.CAKE_DEBUG === "true" && resp.usage) {
          const u = resp.usage;
          addMsg(
            "system",
            `🔧 DEBUG RESPONSE STATS:\n` +
              `  Time Elapsed   : ${(finalTime / 1000).toFixed(2)}s\n` +
              `  Prompt Tokens  : ${u.inputTokens.toLocaleString()}` +
              (u.cachedTokens
                ? ` (${u.cachedTokens.toLocaleString()} cached)`
                : "") +
              `\n` +
              `  Output Tokens  : ${u.outputTokens.toLocaleString()}\n` +
              `  Cost (USD)     : $${(u.costUsd || 0).toFixed(5)}`,
          );
        }

        // Determine if the response was streamed (content already in message)
        // or came back as a single tool result (placeholder still empty).
        const wasStreamed = streamedRef.current;
        streamedRef.current = false;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId
              ? {
                  ...m,
                  content: resp.text || m.content,
                  thinkingTime: finalTime,
                }
              : m,
          ),
        );

        // Flush sentence buffer / speak tool response
        if (voice) {
          await voice.speakText(resp.text, wasStreamed);
        }
      } catch (err: any) {
        stopTimer();
        setMessages((prev) => prev.filter((m) => m.id !== streamId));
        if (err.name === "AbortError" || err.message?.includes("abort")) return;
        addMsg(
          "system",
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoading(false);
        setThinkingMs(null);
        setTaskStep(null);
        abortControllerRef.current = null;
        streamingIdRef.current = null;
        streamedRef.current = false;
      }
    },
    [
      agent,
      addMsg,
      handleSlash,
      startTimer,
      stopTimer,
      accumulateUsage,
      checkEmbedWarning,
      messages,
      locker,
      interceptPermission,
    ],
  );

  return {
    messages,
    msgVersion,
    input,
    setInput,
    loading,
    thinkingMs,
    taskStep,
    providerName,
    model,
    handleSubmit,
    stats,
    registerVoice,
    locker,
    addMsg,
    commandHistory,
  };
}
