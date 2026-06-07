import { useCallback } from "react";
import fs from "fs";
import { useApp } from "ink";
import { createProvider } from "../../providers/index.js";
import type { ProviderName, TokenUsage } from "../../providers/types.js";
import { CakeAgent } from "../../agent/index.js";
import type { RunOptions, TaskStep } from "../../agent/index.js";
import {
  runAuthFlow,
  listUpcoming,
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
import { THEMES } from "../theme/theme.js";
import { COMMANDS } from "../data/commands.js";
import { loadCosts, resetCosts, costsFilePath } from "../../config/costs.js";
import { handleSessionCommand } from "../../agent/handlers/session.js";
import { handlePermissionsCommand } from "../../agent/handlers/permissions.js";
import type { UseLockerReturn } from "./useLocker.js";
import type { Theme } from "../theme/types.js";

const API_KEY_MAP: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

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

export interface SlashCommandDeps {
  agent: CakeAgent;
  addMsg: (
    role: ChatMessage["role"],
    content: string,
    thinkingTime?: number,
  ) => void;
  exit: () => void;
  providerName: ProviderName;
  model: string | undefined;
  setProviderName: (name: ProviderName) => void;
  setModel: (model: string | undefined) => void;
  setAgent: (agent: CakeAgent) => void;
  buildAgent: (provName: ProviderName, mod?: string) => CakeAgent;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setMsgVersion: React.Dispatch<React.SetStateAction<number>>;
  locker: UseLockerReturn;
  theme: Theme;
  setAppTheme: (themeName: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  startTimer: () => void;
  stopTimer: () => void;
  setTaskStep: (step: TaskStep | null) => void;
  accumulateUsage: (usage?: TokenUsage) => void;
  checkEmbedWarning: () => void;
  voiceRef: React.MutableRefObject<UseVoiceReturn | null>;
  lastEvents: any[];
  setLastEvents: React.Dispatch<React.SetStateAction<any[]>>;
  streamingIdRef: React.MutableRefObject<string | null>;
}

export function useSlashCommands({
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
}: SlashCommandDeps) {
  return useCallback(
    async (trimmed: string): Promise<boolean> => {
      if (!trimmed.startsWith("/")) return false;
      const [cmd, ...args] = trimmed.slice(1).split(" ");
      const t0 = Date.now();

      if (cmd === "stop") {
        if (loading && abortControllerRef.current) {
          abortControllerRef.current.abort();
          addMsg("system", "🛑 AI Thinking stopped by user.");
          setLoading(false);
          stopTimer();
        } else {
          addMsg("system", "Nothing is currently running.");
        }
        return true;
      }

      if (cmd === "cost") {
        if (args[0] === "--reset") {
          resetCosts();
          addMsg(
            "system",
            "✅ All historical costs and usage have been reset.",
          );
          return true;
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
        return true;
      }

      switch (cmd) {
        case "permissions": {
          const result = await handlePermissionsCommand(
            createProvider(providerName),
            args,
          );
          addMsg("system", result.text);
          return true;
        }

        case "hallucination": {
          const { handleHallucinationCommand } =
            await import("../../agent/handlers/hallucination.js");
          const result = await handleHallucinationCommand(
            createProvider(providerName),
            args,
          );
          addMsg("system", result.text);
          return true;
        }

        case "memory": {
          const { handleAutoMemoryStatus } =
            await import("../../agent/handlers/autoMemoryStatus.js");
          const result = await handleAutoMemoryStatus(
            createProvider(providerName),
            args,
          );
          addMsg("system", result.text);
          return true;
        }

        case "skills": {
          const { handleSkillsCommand } =
            await import("../../agent/handlers/skills.js");
          const result = await handleSkillsCommand(
            createProvider(providerName),
            args,
          );
          addMsg("system", result.text);
          return true;
        }

        case "exit":
        case "quit":
          exit();
          return true;
        case "help":
          addMsg("system", HELP);
          return true;
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
          return true;
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
            addMsg("system", "Usage: /provider <claude|openai|gemini|ollama>");
            return true;
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
          return true;
        }
        case "model":
          if (!args[0]) {
            addMsg("system", "Usage: /model <model-name>");
            return true;
          }
          setModel(args[0]);
          agent.setModel(args[0]);
          addMsg(
            "system",
            `Model set to: ${args[0]}\n  Tip: run /default to save.`,
          );
          return true;
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
            return true;
          }

          if (sub === "set") {
            const p = args[1] as ProviderName;
            const m = args[2];
            if (!p) {
              addMsg("system", "Usage: /default set <provider> [model]");
              return true;
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
            return true;
          }

          if (sub === "provider") {
            const p = args[1] as ProviderName;
            if (!p) {
              addMsg("system", "Usage: /default provider <name>");
              return true;
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
            return true;
          }

          if (sub === "model") {
            const m = args[1];
            if (!m) {
              addMsg("system", "Usage: /default model <name>");
              return true;
            }
            savePrefs({ model: m });
            setModel(m);
            agent.setModel(m);
            addMsg("system", `✅ Default model set to: ${m}`);
            return true;
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
          return true;
        }
        case "theme": {
          const name = args[0];
          if (!name) {
            addMsg(
              "system",
              `Available themes: ${Object.keys(THEMES).join(", ")}\nUsage: /theme <name>`,
            );
            return true;
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
          return true;
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
          return true;
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
              return true;
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
          return true;
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
          return true;
        }

        case "agent": {
          if (!args.length) {
            addMsg("system", "Usage: /agent <goal>");
            return true;
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
              onStep: setTaskStep,
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
            setTaskStep(null);
            abortControllerRef.current = null;
            streamingIdRef.current = null;
          }
          return true;
        }

        case "plugins": {
          const result = await agent.run("plugins");
          addMsg("system", result.text);
          return true;
        }
        case "session": {
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
            return true;
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
            return true;
          }

          addMsg("system", result.text);
          return true;
        }

        case "voice": {
          const sub = args[0]?.toLowerCase();
          const voice = voiceRef.current;

          if (!voice) {
            addMsg(
              "system",
              "❌ Voice system not initialized. Try again in a moment.",
            );
            return true;
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
          return true;
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
          return true;
        }

        default:
          addMsg("system", `Unknown command: ${trimmed}. Type /help.`);
          return true;
      }
    },
    [
      loading,
      abortControllerRef,
      addMsg,
      setLoading,
      stopTimer,
      providerName,
      model,
      setProviderName,
      setAgent,
      buildAgent,
      setMsgVersion,
      setMessages,
      agent,
      exit,
      theme,
      setAppTheme,
      startTimer,
      setTaskStep,
      checkEmbedWarning,
      accumulateUsage,
      voiceRef,
      lastEvents,
      setLastEvents,
      streamingIdRef,
      messages,
    ],
  );
}
