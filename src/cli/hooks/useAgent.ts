import { useState, useCallback, useRef } from "react";
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
  totalCostUsd: number;
}

function buildAgent(provName: ProviderName, mod?: string): CakeAgent {
  return new CakeAgent(createProvider(provName), mod);
}

export function useAgent() {
  const { exit } = useApp();
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Tracks the id of the message currently being streamed into
  const streamingIdRef = useRef<string | null>(null);

  const [providerName, setProviderName] = useState<ProviderName>(INIT_PROVIDER);
  const [model, setModel] = useState<string | undefined>(INIT_MODEL);
  const [agent, setAgent] = useState<CakeAgent>(() =>
    buildAgent(INIT_PROVIDER, INIT_MODEL),
  );
  const [stats, setStats] = useState<SessionStats>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
  });
  const [lastEvents, setLastEvents] = useState<any[]>([]);

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
      totalCostUsd: prev.totalCostUsd + (usage.costUsd ?? 0),
    }));
    addCost({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
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

      // ── Slash commands (unchanged from original) ──────────────────────────
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
          addMsg(
            "system",
            [
              `💰 Historical Token Usage & Costs (${APP_NAME})`,
              `----------------------------------------`,
              `Total Input Tokens  : ${historical.totalInputTokens.toLocaleString()}`,
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
              shell: process.platform === "win32", // needed on Windows
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
                // Validate by trying to create it
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
                // Clear model when provider changes via explicit command for safety
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

            // Fallback: Save current session as default
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
            } else
              addMsg(
                "system",
                `Unknown theme: ${name}. Available: ${Object.keys(THEMES).join(", ")}`,
              );
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
            // Route through the normal agent.run so streaming works
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

          default:
            addMsg("system", `Unknown command: ${trimmed}. Type /help.`);
            return;
        }
      }

      // ── Agent call with streaming ─────────────────────────────────────────
      addMsg("user", trimmed);
      setLoading(true);
      startTimer();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Create a placeholder assistant message that we'll stream into
      const streamId = makeId();
      streamingIdRef.current = streamId;
      setMessages((prev) => [
        ...prev,
        { id: streamId, role: "assistant", content: "" },
      ]);

      try {
        const runOpts: RunOptions = {
          signal: controller.signal,
          onChunk: (chunk: string) => {
            // Append each chunk to the streaming message in real time
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId ? { ...m, content: m.content + chunk } : m,
              ),
            );
          },
        };

        const resp = await agent.run(trimmed, runOpts);
        const finalTime = Date.now() - t0;
        stopTimer();
        checkEmbedWarning();
        accumulateUsage(resp.usage);

        // For tool responses (non-streamed), replace the empty placeholder
        // with the actual result. For streamed responses the content is
        // already correct, just update the thinkingTime.
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
      } catch (err: any) {
        stopTimer();
        // Remove the empty placeholder on error
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
  };
}
