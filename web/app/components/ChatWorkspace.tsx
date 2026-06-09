"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeChat,
  fetchModels,
  getApiBase,
  streamChat,
  type CakeModel,
} from "../lib/cake-api";
import { makeMessage, useChatStore } from "../store/chat-store";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { NavBar } from "./NavBar";
import type { ServerState } from "./types";
import { WelcomePanel } from "./WelcomePanel";

export function ChatWorkspace() {
  const {
    currentConversationId,
    getCurrentConversation,
    selectedModel,
    setSelectedModel,
    addMessage,
    updateMessage,
    toApiMessages,
  } = useChatStore();
  const [models, setModels] = useState<CakeModel[]>([]);
  const [serverState, setServerState] = useState<ServerState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversation = getCurrentConversation();

  const loadModels = useCallback(async () => {
    const controller = new AbortController();
    setServerState("checking");
    try {
      const nextModels = await fetchModels(controller.signal);
      setModels(nextModels);
      setServerState("online");
      if (
        nextModels.length > 0 &&
        !nextModels.some((model) => model.id === selectedModel)
      ) {
        setSelectedModel(nextModels[0].id);
      }
    } catch (err) {
      setServerState("offline");
      setError(err instanceof Error ? err.message : "Unable to reach CAKE core");
    }
  }, [selectedModel, setSelectedModel]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadModels]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const submitMessage = async () => {
    const content = input.trim();
    if (!content || !currentConversationId || sending) {
      return;
    }

    const userMessage = makeMessage("user", content);
    const assistantMessage = {
      ...makeMessage("assistant", ""),
      streaming: true,
    };
    addMessage(currentConversationId, userMessage);
    addMessage(currentConversationId, assistantMessage);
    setInput("");
    setError(null);
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const apiMessages = [
      ...toApiMessages(currentConversationId),
      { role: "user" as const, content },
    ];

    console.log("API messages", apiMessages);

    try {
      let streamed = "";
      await streamChat(
        apiMessages,
        selectedModel,
        (token) => {
          streamed += token;
          updateMessage(currentConversationId, assistantMessage.id, {
            content: streamed,
            streaming: true,
          });
        },
        controller.signal,
      );

      updateMessage(currentConversationId, assistantMessage.id, {
        content: streamed || "[empty response]",
        streaming: false,
      });
    } catch (streamErr) {
      if (controller.signal.aborted) {
        updateMessage(currentConversationId, assistantMessage.id, {
          content: "[stopped]",
          streaming: false,
        });
        setSending(false);
        return;
      }

      try {
        const fallback = await completeChat(
          apiMessages,
          selectedModel,
          controller.signal,
        );
        updateMessage(currentConversationId, assistantMessage.id, {
          content: fallback,
          streaming: false,
        });
      } catch (fallbackErr) {
        const message =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : streamErr instanceof Error
              ? streamErr.message
              : "CAKE core request failed";
        updateMessage(currentConversationId, assistantMessage.id, {
          content: `[error] ${message}`,
          streaming: false,
        });
        setError(message);
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NavBar
        models={models}
        selectedModel={selectedModel}
        serverState={serverState}
        onSelectModel={setSelectedModel}
        onRefreshModels={loadModels}
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {conversation && conversation.messages.length > 0 ? (
          <MessageList messages={conversation.messages} />
        ) : (
          <WelcomePanel selectedModel={selectedModel} onPick={setInput} />
        )}
      </div>
      {error && (
        <div className="mx-auto w-full max-w-230 px-4 pb-3">
          <div className="border border-danger/60 bg-danger/10 px-3 py-2 text-[13px] leading-5 text-canvas">
            [!] {error} · API {getApiBase()}
          </div>
        </div>
      )}
      <Composer
        value={input}
        disabled={sending}
        onChange={setInput}
        onSubmit={submitMessage}
        onStop={stop}
      />
    </div>
  );
}
