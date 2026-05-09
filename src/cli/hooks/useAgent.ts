// src/cli/hooks/useAgent.ts
// Owns: provider state, agent instance, message list, slash commands.

import { useState, useCallback, useRef } from "react";
import { useApp } from "ink";
import { createProvider } from "../../providers/index.js";
import type { ProviderName, TokenUsage } from "../../providers/types.js";
import { CakeAgent } from "../../agent/index.js";
import fs from "fs";
import {
  runAuthFlow,
  listUpcoming,
  createEvent,
  deleteEvent,
} from "../../modules/calendar/index.js";
import { TOKEN_FILE } from "../../config/constants.js";
import type { ChatMessage } from "../components/MessageList.js";
import { env } from "../../config/env.js";
import {
  loadPrefs,
  savePrefs,
  prefsFilePath,
} from "../../config/preferences.js";

const API_KEY_MAP: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

// Load persisted prefs once at module level (before first render)
const PREFS = loadPrefs();
// env vars override prefs if explicitly set
const INIT_PROVIDER = (PREFS.provider || env.defaultProvider) as ProviderName;
const INIT_MODEL = PREFS.model || env.defaultModel || undefined;

const HELP = `
🍰 CAKE - The Ultimate AI Assistant

SLASH COMMANDS:
  /help                    Show this help message
  /clear                   Reset conversation & clear screen
  /reboost                 Re-initialize agent & clear session
  /exit                    Quit CAKE

CONFIGURATION:
  /provider <name>         Switch: claude | openai | gemini | ollama
  /model <name>            Set model (e.g. gpt-4o, llama3)
  /prefs                   Show current session & default settings
  /default [--save]        Save current session as your default
  /default --reset         Clear all saved defaults

INTEGRATIONS:
  /calendar auth           Connect to Google Calendar
  /calendar list           View upcoming schedule
  /auth-status             Check API & OAuth connections

NATURAL LANGUAGE CAPABILITIES:
  📧 Email & News          "Read my emails", "Today's news digest"
  ✅ Productivity           "Add todo: fix bug", "List my tasks", "Plan a project"
  🌐 Web & Search          "Search for latest AI news", "Who is...?"
  📂 Files & Folders       "ls src", "tree .", "cat report.txt", "summarize code.js"
  📄 Documents (RAG)       "read doc.pdf", "summarize book.docx", "ask doc.pdf <question>"
  🧠 Memory (Learning)     "Learn manual.pdf" (Index to memory for future retrieval)
  ⚙️ System                "Diagnose system", "Performance check"
  🕒 Automation (Cron)     "Schedule: summarize emails every morning at 8am", "List my cron jobs", "test notify"


    Tip: CAKE has Long-term Memory and can run automated background tasks!
    `.trim();

function makeId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

export interface SessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

function buildAgent(provName: ProviderName, mod?: string): CakeAgent {
  const provider = createProvider(provName);
  return new CakeAgent(provider, mod);
}

export function useAgent() {
  const { exit } = useApp();

  // ─── Message list ────────────────────────────────────────
  const [msgVersion, setMsgVersion] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content: [
        `CAKE ready.`,
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

  // ─── Helpers ─────────────────────────────────────────────
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
    timerRef.current = setInterval(() => {
      setThinkingMs(Date.now() - t0);
    }, 100);
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
  }, []);

  // ─── Submit handler ───────────────────────────────────────
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setInput("");

      if (trimmed.startsWith("/")) {
        const [cmd, ...args] = trimmed.slice(1).split(" ");

        switch (cmd) {
          // ── exit ──────────────────────────────────────────
          case "exit":
          case "quit":
            exit();
            return;

          // ── help ──────────────────────────────────────────
          case "help":
            addMsg("system", HELP);
            return;

          // ── clear ─────────────────────────────────────────
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

          // ── reboost ───────────────────────────────────────
          case "reboost": {
            setLoading(true);
            try {
              const newAgent = buildAgent(providerName, model);
              setAgent(newAgent);
              setMsgVersion((v) => v + 1);
              setMessages([
                {
                  id: makeId(),
                  role: "system",
                  content: "🚀 System reboosted. Agent re-initialized.",
                },
              ]);
            } catch (err: any) {
              addMsg("system", `Reboost failed: ${err.message}`);
            } finally {
              setLoading(false);
            }
            return;
          }

          // ── provider ──────────────────────────────────────
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
              const newAgent = buildAgent(name, model);
              setAgent(newAgent);
              addMsg(
                "system",
                `Switched to provider: ${name}${model ? ` (model: ${model})` : ""}\n  Tip: run /default to make this the default for next time.`,
              );
            } catch {
              addMsg("system", `Unknown provider: ${name}`);
            }
            return;
          }

          // ── model ─────────────────────────────────────────
          case "model":
            if (!args[0]) {
              addMsg("system", "Usage: /model <model-name>");
              return;
            }
            setModel(args[0]);
            agent.setModel(args[0]);
            addMsg(
              "system",
              `Model set to: ${args[0]}\n  Tip: run /default to save this for next time.`,
            );
            return;

          // ── default ───────────────────────────────────────
          // Syntax: /default [--save] [--set] [--reset]
          //                  [--provider <name>] [--model <name>]
          case "default": {
            // Parse flags from args array
            const flags = new Set<string>();
            const flagValues: Record<string, string> = {};
            for (let i = 0; i < args.length; i++) {
              const a = args[i];
              if (a === "--save" || a === "--set" || a === "--reset") {
                flags.add(a.slice(2));
              } else if (
                a === "--provider" &&
                args[i + 1] &&
                !args[i + 1].startsWith("-")
              ) {
                flagValues["provider"] = args[++i];
              } else if (
                a === "--model" &&
                args[i + 1] &&
                !args[i + 1].startsWith("-")
              ) {
                flagValues["model"] = args[++i];
              } else if (!a.startsWith("-")) {
                // Bare unknown word — treat as error below
                flags.add(`__unknown:${a}`);
              }
            }

            const isReset = flags.has("reset");
            const isSet = flags.has("set");
            const isSave = flags.has("save");
            const hasUnknown = [...flags].find((f) =>
              f.startsWith("__unknown:"),
            );

            if (hasUnknown) {
              addMsg(
                "system",
                `Unknown flag "${hasUnknown.replace("__unknown:", "")}". Try /help.`,
              );
              return;
            }

            // ── /default --reset [--provider] [--model] ──
            if (isReset) {
              const resetProvider =
                "--provider" in flagValues ||
                flagValues["provider"] !== undefined ||
                (flags.has("reset") &&
                  !flagValues["model"] &&
                  !flagValues["provider"] &&
                  !isSet &&
                  !isSave);
              const onlyProvider =
                "provider" in flagValues &&
                !("model" in flagValues) &&
                !isSave &&
                !isSet;
              const onlyModel =
                "model" in flagValues &&
                !("provider" in flagValues) &&
                !isSave &&
                !isSet;

              if (onlyProvider) {
                savePrefs({ provider: "claude" });
                addMsg("system", `✅ Default provider reset to: claude`);
              } else if (onlyModel) {
                savePrefs({ model: null });
                addMsg("system", `✅ Default model reset (none)`);
              } else {
                // reset everything
                savePrefs({ provider: "claude", model: null });
                addMsg(
                  "system",
                  `✅ Defaults reset: provider=claude, model=(none)`,
                );
              }
              return;
            }

            // ── /default --set --provider <p> [--model <m>] ──
            if (isSet) {
              if (!flagValues["provider"] && !flagValues["model"]) {
                addMsg(
                  "system",
                  "Usage: /default --set --provider <name> [--model <name>]\n" +
                    "       /default --set --model <name>",
                );
                return;
              }
              const toSave: { provider?: string; model?: string | null } = {};
              if (flagValues["provider"])
                toSave.provider = flagValues["provider"];
              if (flagValues["model"]) toSave.model = flagValues["model"];
              savePrefs(toSave);
              const parts: string[] = [];
              if (toSave.provider) parts.push(`provider=${toSave.provider}`);
              if (toSave.model) parts.push(`model=${toSave.model}`);
              addMsg(
                "system",
                `✅ Default set: ${parts.join(", ")}\n   Stored in: ${prefsFilePath()}`,
              );
              return;
            }

            // ── /default [--save] — save current session values ──
            savePrefs({ provider: providerName, model: model ?? null });
            addMsg(
              "system",
              `✅ Saved default: provider=${providerName}${model ? `, model=${model}` : ", model=(none)"}\n   Stored in: ${prefsFilePath()}`,
            );
            return;
          }

          // ── prefs ─────────────────────────────────────────
          case "prefs": {
            const current = loadPrefs();
            addMsg(
              "system",
              [
                `Preferences file: ${prefsFilePath()}`,
                `  provider : ${current.provider}`,
                `  model    : ${current.model ?? "(none)"}`,
                ``,
                `Active this session:`,
                `  provider : ${providerName}`,
                `  model    : ${model ?? "(none)"}`,
              ].join("\n"),
            );
            return;
          }

          // ── calendar ──────────────────────────────────────
          case "calendar": {
            const sub = args[0];
            if (sub === "auth") {
              try {
                const message = await runAuthFlow();
                addMsg("system", message);
              } catch (error) {
                addMsg("system", `Auth failed: ${error}`);
              }
            } else if (sub === "list") {
              try {
                const events = await listUpcoming();
                setLastEvents(events);
                if (events.length === 0) {
                  addMsg("system", "No upcoming events found.");
                } else {
                  const list = events
                    .map(
                      (e, i) =>
                        `[${i + 1}] ${e.summary}\n    Start: ${e.start}\n    ID: ${e.id}`,
                    )
                    .join("\n\n");
                  addMsg(
                    "system",
                    `Upcoming Events:\n\n${list}\n\nTip: Use /calendar delete <number> to remove an event.`,
                  );
                }
              } catch (error) {
                addMsg("system", `Failed to list events: ${error}`);
              }
            } else if (sub === "create") {
              // Usage: /calendar create "Summary" "2024-05-06T12:00:00" "2024-05-06T13:00:00"
              const match = trimmed.match(
                /\/calendar create "([^"]+)" "([^"]+)" "([^"]+)"(?: "([^"]+)")?/,
              );
              if (!match) {
                addMsg(
                  "system",
                  'Usage: /calendar create "Summary" "StartISO" "EndISO" ["Description"]\n\nExample: /calendar create "Team Meeting" "2024-05-06T12:00:00" "2024-05-06T13:00:00" "Weekly team sync"',
                );
                return;
              }
              const [, summary, start, end, description] = match;
              try {
                const link = await createEvent({
                  summary,
                  start,
                  end,
                  description,
                });
                addMsg("system", `✅ Event created! View here: ${link}`);
              } catch (error) {
                addMsg("system", `Failed to create event: ${error}`);
              }
            } else if (sub === "delete") {
              const arg = args[1];
              if (!arg) {
                addMsg("system", "Usage: /calendar delete <number | eventId>");
                return;
              }

              let eventId = arg;
              const index = parseInt(arg, 10);

              if (!isNaN(index) && index > 0 && index <= lastEvents.length) {
                eventId = lastEvents[index - 1].id;
              }

              try {
                await deleteEvent(eventId);
                addMsg("system", `✅ Event deleted: ${eventId}`);
                // Refresh list in background or just clear lastEvents?
                // setLastEvents(prev => prev.filter(e => e.id !== eventId));
              } catch (error) {
                addMsg("system", `Failed to delete event: ${error}`);
              }
            } else {
              addMsg(
                "system",
                'Usage:\n  /calendar auth\n  /calendar list\n  /calendar create "Title" "Start" "End"\n  /calendar delete <id>',
              );
            }
            return;
          }

          // ── auth-status ──────────────────────────────────
          case "auth-status": {
            const hasToken = fs.existsSync(TOKEN_FILE);
            if (!hasToken) {
              addMsg(
                "system",
                "❌ Google Calendar: Not authenticated. Run /calendar auth",
              );
            } else {
              try {
                const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
                const tokens = JSON.parse(raw);
                const expiry = tokens.expiry_date
                  ? new RegExp(/^[0-9]+$/).test(tokens.expiry_date.toString())
                    ? new Date(tokens.expiry_date).toLocaleString()
                    : "Unknown"
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

          default:
            addMsg("system", `Unknown command: ${trimmed}. Type /help.`);
            return;
        }
      }

      // ── Agent ─────────────────────────────────────────────
      addMsg("user", trimmed);
      setLoading(true);
      const t0 = Date.now(); // เริ่มจับเวลาตรงนี้
      startTimer();
      try {
        const resp = await agent.run(trimmed);
        const finalTime = Date.now() - t0; // คำนวณเวลาที่ใช้ไปจริง
        stopTimer();
        accumulateUsage(resp.usage);
        addMsg("assistant", resp.text, finalTime);
      } catch (err) {

        stopTimer();
        addMsg(
          "system",
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoading(false);
        setThinkingMs(null);
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
