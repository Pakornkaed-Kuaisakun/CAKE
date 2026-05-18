import { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "ink";
import { createProvider } from "../../providers/index.js";
import type { ProviderName, TokenUsage } from "../../providers/types.js";
import { CakeAgent } from "../../agent/index.js";
import type { RunOptions } from "../../agent/index.js";
import fs from "fs";
import {
  runAuthFlow,
  listUpcoming,
  createEvent,
  deleteEvent,
} from "../../modules/calendar/index.js";
import { TOKEN_FILE, APP_NAME } from "../../config/constants.js";
import type { ChatMessage } from "../components/MessageList.js";
import type { UseVoiceReturn } from "./useVoice.js";
import { env } from "../../config/env.js";
import {
  loadPrefs,
  savePrefs,
  prefsFilePath,
} from "../../config/preferences.js";
import { useTheme } from "../theme/useTheme.js";
import { THEMES } from "../theme/theme.js";
import { COMMANDS } from "../data/commands.js";
import {
  addCost,
  loadCosts,
  resetCosts,
  costsFilePath,
} from "../../config/costs.js";
import { consumeEmbedWarning } from "../../modules/memory/index.js";
import { handleSessionCommand } from "../../agent/handlers/session.js";
import { usePermission } from "./usePermission.js";
import { handlePermissionsCommand } from "../../agent/handlers/permissions.js";
import { useLocker } from "./useLocker.js";
import { NEEDS_PASSWORD, NEEDS_VALUE } from "../../agent/handlers/locker.js";

const API_KEY_MAP: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const PREFS = loadPrefs();
const INIT_PROVIDER = (PREFS.provider || env.defaultProvider) as ProviderName;
const INIT_MODEL = PREFS.model || env.defaultModel || undefined;

const HELP = [
  `🍰 ${APP_NAME} - The Ultimate AI Assistant`,
  "",
  "SLASH COMMANDS:",
  ...COMMANDS.filter((c) => c.command.startsWith("/"))
    .filter(
      (c, i, self) => i === self.findIndex((t) => t.command === c.command),
    )
    .map(
      (c) =>
        `  ${c.command.split(" ")[0].padEnd(20)} ${c.description.split("\n")[0]}`,
    ),
  "",
  "AGENT CAPABILITIES:",
  ...COMMANDS.filter(
    (c) => !c.command.startsWith("/") && !c.command.includes("|"),
  )
    .filter(
      (c, i, self) => i === self.findIndex((t) => t.command === c.command),
    )
    .map(
      (c) =>
        `  ${c.command.split(" ")[0].padEnd(20)} ${c.description.split("\n")[0]}`,
    ),
  "",
  `Tip: ${APP_NAME} has Long-term Memory and can run automated background tasks!`,
].join("\n");

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

  const voiceRef = useRef<UseVoiceReturn | null>(null);
  const registerVoice = useCallback((v: UseVoiceReturn) => {
    voiceRef.current = v;
  }, []);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamingIdRef = useRef<string | null>(null);

  const [providerName, setProviderName] = useState<ProviderName>(INIT_PROVIDER);
  const [model, setModel] = useState<string | undefined>(INIT_MODEL);

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
    if (consumeEmbedWarning()) {
      addMsg(
        "system",
        "⚠️  Memory disabled — this provider does not support embeddings.\n" +
          "   Long-term memory will not be saved this session.\n" +
          "   Use openai or ollama (+ nomic-embed-text) to enable it.",
      );
    }
  }, [addMsg]);

  // ─── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setInput("");
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
      const t0 = Date.now();

      if (lower === "cls" || lower === "clear") {
        setMsgVersion((v) => v + 1);
        setMessages([
          { id: makeId(), role: "system", content: "Conversation cleared." },
        ]);
        agent.clearHistory();
        return;
      }

      // ── Slash commands ──────────────────────────────────────────────────
      if (trimmed.startsWith("/")) {
        const [cmd, ...args] = trimmed.slice(1).split(" ");

        if (cmd === "stop") {
          if (loading && abortControllerRef.current) {
            abortControllerRef.current.abort();
            addMsg("system", "🛑 AI Thinking stopped by user.");
            setLoading(false);
            stopTimer();
          } else {
            addMsg("system", "Nothing is currently running.");
          }
          return;
        }

        if (cmd === "cost") {
          if (args[0] === "--reset") {
            resetCosts();
            addMsg(
              "system",
              "✅ All historical costs and usage have been reset.",
            );
            return;
          }
          const historical = loadCosts();
          const cacheHitPct =
            historical.totalInputTokens > 0
              ? (
                  (historical.totalCachedTokens / historical.totalInputTokens) *
                  100
                ).toFixed(1)
              : "0.0";

          addMsg(
            "system",
            [
              `💰 Historical Token Usage & Costs (${APP_NAME})`,
              `----------------------------------------`,
              `Total Input Tokens  : ${historical.totalInputTokens.toLocaleString()}`,
              `  ↳ Cache Reads     : ${historical.totalCachedTokens.toLocaleString()} (${cacheHitPct}% hit rate)`,
              `  ↳ Cache Writes    : ${historical.totalCacheWriteTokens.toLocaleString()}`,
              `Total Output Tokens : ${historical.totalOutputTokens.toLocaleString()}`,
              `Total Cost (USD)    : $${historical.totalCostUsd.toFixed(4)}`,
              `Last Updated        : ${new Date(historical.lastUpdated).toLocaleString()}`,
              `----------------------------------------`,
              `Data stored in: ${costsFilePath()}`,
              `Tip: Use /cost --reset to clear history.`,
            ].join("\n"),
          );
          return;
        }

        switch (cmd) {
          case "permissions": {
            const result = await handlePermissionsCommand(
              createProvider(providerName),
              args,
            );
            addMsg("system", result.text);
            return;
          }

          case "exit":
          case "quit":
            exit();
            return;
          case "help":
            addMsg("system", HELP);
            return;
          case "cls":
          case "clear":
            setMsgVersion((v) => v + 1);
            setMessages([
              {
                id: makeId(),
                role: "system",
                content: "Conversation cleared.",
              },
            ]);
            agent.clearHistory();
            return;
          case "reboost": {
            process.stdout.write("\x1Bc");
            const { spawn } = await import("child_process");
            spawn("npm", ["run", "dev"], {
              detached: true,
              stdio: "inherit",
              cwd: process.cwd(),
              shell: process.platform === "win32",
            }).unref();
            process.exit(0);
          }
          case "provider": {
            const name = args[0] as ProviderName;
            if (!name) {
              addMsg(
                "system",
                "Usage: /provider <claude|openai|gemini|ollama>",
              );
              return;
            }
            const keyName = API_KEY_MAP[name];
            if (keyName && !process.env[keyName]) {
              addMsg(
                "system",
                `⚠  Warning: ${keyName} is not set. Requests to "${name}" will fail.\n   Set it in your .env file and restart.`,
              );
            }
            try {
              setProviderName(name);
              setAgent(buildAgent(name, model));
              addMsg(
                "system",
                `Switched to provider: ${name}${model ? ` (model: ${model})` : ""}\n  Tip: run /default to save.`,
              );
            } catch {
              addMsg("system", `Unknown provider: ${name}`);
            }
            return;
          }
          case "model":
            if (!args[0]) {
              addMsg("system", "Usage: /model <model-name>");
              return;
            }
            setModel(args[0]);
            agent.setModel(args[0]);
            addMsg(
              "system",
              `Model set to: ${args[0]}\n  Tip: run /default to save.`,
            );
            return;
          case "default": {
            const sub = args[0];

            if (sub === "--reset") {
              const dProv = (env.defaultProvider || "claude") as ProviderName;
              const dMod = env.defaultModel || null;
              savePrefs({ provider: dProv, model: dMod });
              setProviderName(dProv);
              setModel(dMod || undefined);
              setAgent(buildAgent(dProv, dMod || undefined));
              addMsg(
                "system",
                `✅ Defaults reset to: provider=${dProv}, model=${dMod ?? "(none)"}`,
              );
              return;
            }

            if (sub === "set") {
              const p = args[1] as ProviderName;
              const m = args[2];
              if (!p) {
                addMsg("system", "Usage: /default set <provider> [model]");
                return;
              }
              try {
                createProvider(p);
                const update: any = { provider: p };
                if (m) update.model = m;
                savePrefs(update);
                setProviderName(p);
                if (m) {
                  setModel(m);
                  setAgent(buildAgent(p, m));
                } else {
                  setModel(undefined);
                  setAgent(buildAgent(p, undefined));
                }
                addMsg(
                  "system",
                  `✅ Default set to: provider=${p}${m ? `, model=${m}` : ""}`,
                );
              } catch {
                addMsg("system", `❌ Unknown provider: ${p}`);
              }
              return;
            }

            if (sub === "provider") {
              const p = args[1] as ProviderName;
              if (!p) {
                addMsg("system", "Usage: /default provider <name>");
                return;
              }
              try {
                createProvider(p);
                savePrefs({ provider: p });
                setProviderName(p);
                setModel(undefined);
                setAgent(buildAgent(p, undefined));
                addMsg("system", `✅ Default provider set to: ${p}`);
              } catch {
                addMsg("system", `❌ Unknown provider: ${p}`);
              }
              return;
            }

            if (sub === "model") {
              const m = args[1];
              if (!m) {
                addMsg("system", "Usage: /default model <name>");
                return;
              }
              savePrefs({ model: m });
              setModel(m);
              agent.setModel(m);
              addMsg("system", `✅ Default model set to: ${m}`);
              return;
            }

            savePrefs({
              provider: providerName,
              model: model ?? null,
              theme: theme.name,
            });
            addMsg(
              "system",
              `✅ Saved current session as default: provider=${providerName}${model ? `, model=${model}` : ", model=(none)"}\n   Stored in: ${prefsFilePath()}`,
            );
            return;
          }
          case "theme": {
            const name = args[0];
            if (!name) {
              addMsg(
                "system",
                `Available themes: ${Object.keys(THEMES).join(", ")}\nUsage: /theme <name>`,
              );
              return;
            }
            if (THEMES[name]) {
              setAppTheme(name);
              addMsg("system", `✅ Theme switched to: ${name}`);
            } else {
              addMsg(
                "system",
                `Unknown theme: ${name}. Available: ${Object.keys(THEMES).join(", ")}`,
              );
            }
            return;
          }
          case "prefs": {
            const current = loadPrefs();
            addMsg(
              "system",
              [
                `Preferences file: ${prefsFilePath()}`,
                `  provider : ${current.provider}`,
                `  model    : ${current.model ?? "(none)"}`,
                `  theme    : ${theme.name}`,
                ``,
                `Active this session:`,
                `  provider : ${providerName}`,
                `  model    : ${model ?? "(none)"}`,
                `  theme    : ${theme.name}`,
              ].join("\n"),
            );
            return;
          }
          case "calendar": {
            const sub = args[0];
            if (sub === "auth") {
              try {
                addMsg("system", await runAuthFlow());
              } catch (e) {
                addMsg("system", `Auth failed: ${e}`);
              }
            } else if (sub === "list") {
              try {
                const events = await listUpcoming();
                setLastEvents(events);
                if (events.length === 0)
                  addMsg("system", "No upcoming events found.");
                else
                  addMsg(
                    "system",
                    `Upcoming Events:\n\n${events.map((e, i) => `[${i + 1}] ${e.summary}\n    Start: ${e.start}\n    ID: ${e.id}`).join("\n\n")}\n\nTip: /calendar delete <number>`,
                  );
              } catch (e) {
                addMsg("system", `Failed to list events: ${e}`);
              }
            } else if (sub === "delete") {
              const arg = args[1];
              if (!arg) {
                addMsg("system", "Usage: /calendar delete <number | eventId>");
                return;
              }
              let eventId = arg;
              const index = parseInt(arg, 10);
              if (!isNaN(index) && index > 0 && index <= lastEvents.length)
                eventId = lastEvents[index - 1].id;
              try {
                await deleteEvent(eventId);
                addMsg("system", `✅ Event deleted: ${eventId}`);
              } catch (e) {
                addMsg("system", `Failed to delete event: ${e}`);
              }
            } else {
              addMsg(
                "system",
                "Usage:\n  /calendar auth\n  /calendar list\n  /calendar delete <id>",
              );
            }
            return;
          }
          case "auth-status": {
            const hasToken = fs.existsSync(TOKEN_FILE);
            if (!hasToken)
              addMsg(
                "system",
                "❌ Google Calendar: Not authenticated. Run /calendar auth",
              );
            else {
              try {
                const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
                const expiry = tokens.expiry_date
                  ? new Date(tokens.expiry_date).toLocaleString()
                  : "Unknown";
                addMsg(
                  "system",
                  `✅ Google Calendar: Authenticated\nToken Expiry: ${expiry}`,
                );
              } catch {
                addMsg(
                  "system",
                  "⚠️ Google Calendar: Token file found but unparseable.",
                );
              }
            }
            return;
          }

          case "agent": {
            if (!args.length) {
              addMsg("system", "Usage: /agent <goal>");
              return;
            }
            const goal = args.join(" ");
            addMsg("user", `auto ${goal}`);
            setLoading(true);
            startTimer();
            const controller = new AbortController();
            abortControllerRef.current = controller;
            const streamId = makeId();
            streamingIdRef.current = streamId;
            setMessages((prev) => [
              ...prev,
              { id: streamId, role: "assistant", content: "" },
            ]);
            try {
              const resp = await agent.run(`auto ${goal}`, {
                signal: controller.signal,
              });
              const finalTime = Date.now() - t0;
              stopTimer();
              checkEmbedWarning();
              accumulateUsage(resp.usage);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId
                    ? { ...m, content: resp.text, thinkingTime: finalTime }
                    : m,
                ),
              );
              // Speak tool response (non-streamed)
              voiceRef.current?.speakText(resp.text, false);
            } catch (err: any) {
              stopTimer();
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
              if (!err.message?.includes("abort"))
                addMsg("system", `Agent error: ${err.message}`);
            } finally {
              setLoading(false);
              setThinkingMs(null);
              abortControllerRef.current = null;
              streamingIdRef.current = null;
            }
            return;
          }

          case "plugins": {
            const result = await agent.run("plugins");
            addMsg("system", result.text);
            return;
          }
          case "session": {
            // BUG FIX: handleSessionCommand expects Message[] (role+content),
            // but messages is ChatMessage[] (id+role+content+thinkingTime).
            // Strip the extra fields before passing to the session handler.
            const sessionMessages = messages.map(({ role, content }) => ({
              role,
              content,
            }));
            const result = handleSessionCommand(
              args,
              sessionMessages,
              providerName,
              model,
            );

            if (result.kind === "error") {
              addMsg("system", result.text);
              return;
            }

            if (result.kind === "load") {
              const loadedMessages = result.session.messages;
              agent.clearHistory();
              agent.loadHistory(loadedMessages);
              setMsgVersion((v) => v + 1);
              setMessages([
                {
                  id: makeId(),
                  role: "system",
                  content: result.text,
                },
                ...loadedMessages.map((m) => ({
                  id: makeId(),
                  role: m.role as "user" | "assistant" | "system",
                  content: m.content,
                })),
              ]);
              return;
            }

            addMsg("system", result.text);
            return;
          }

          case "voice": {
            const sub = args[0]?.toLowerCase();
            const voice = voiceRef.current;

            if (!voice) {
              addMsg(
                "system",
                "❌ Voice system not initialized. Try again in a moment.",
              );
              return;
            }

            if (!sub || sub === "on") {
              if (!voice.voiceEnabled) voice.toggleVoice();
              addMsg(
                "system",
                voice.voiceEnabled
                  ? "Voice mode already on. F2 = push-to-talk."
                  : "🎤 Voice mode ON. Press F2 to start recording.",
              );
            } else if (sub === "off") {
              if (voice.voiceEnabled) voice.toggleVoice();
              addMsg("system", "🔇 Voice mode OFF.");
            } else if (sub === "status") {
              addMsg("system", voice.statusLine || "Voice mode is off.");
            } else {
              addMsg(
                "system",
                [
                  "Usage:",
                  "  /voice on      — enable voice mode",
                  "  /voice off     — disable voice mode",
                  "  /voice status  — show current backend info",
                ].join("\n"),
              );
            }
            return;
          }
          case "mode": {
            const sub = args[0]?.toLowerCase();
            if (sub === "debug") {
              const debugEnabled = process.env.CAKE_DEBUG !== "true";
              process.env.CAKE_DEBUG = debugEnabled ? "true" : "false";
              addMsg(
                "system",
                debugEnabled
                  ? "⚙️ Debug mode is now ON. Force thinking/reasoning and verbose AI responses are active."
                  : "⚙️ Debug mode is now OFF. Standard concise responses.",
              );
            } else {
              addMsg(
                "system",
                `Current Mode:\n  Debug: ${process.env.CAKE_DEBUG === "true" ? "ON" : "OFF"}\n\nUsage:\n  /mode debug  — toggle AI debug response mode`,
              );
            }
            return;
          }

          default:
            addMsg("system", `Unknown command: ${trimmed}. Type /help.`);
            return;
        }
      }

      // ── Agent call with streaming ─────────────────────────────────────────
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
      setMessages((prev) => [
        ...prev,
        { id: streamId, role: "assistant", content: "" },
      ]);

      try {
        // BUG FIX: Wire voice into onChunk so streaming responses are spoken.
        // Previously makeSpeakingOnChunk was never called here — voice was
        // entirely disconnected from the main agent.run() path.
        const baseOnChunk = (chunk: string) => {
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
        const wasStreamed = Boolean(
          messages.find((m) => m.id === streamId)?.content,
        );

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
        abortControllerRef.current = null;
        streamingIdRef.current = null;
      }
    },
    [
      agent,
      addMsg,
      exit,
      model,
      providerName,
      startTimer,
      stopTimer,
      accumulateUsage,
      loading,
      theme,
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
    providerName,
    model,
    handleSubmit,
    stats,
    registerVoice,
    locker,
    addMsg,
  };
}
