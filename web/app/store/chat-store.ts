"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "../lib/cake-api";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  streaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  selectedModel: string;
  sidebarCollapsed: boolean;
  createConversation: (title?: string) => string;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  setSelectedModel: (model: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<Message>,
  ) => void;
  renameConversation: (conversationId: string, title: string) => void;
  getCurrentConversation: () => Conversation | undefined;
  toApiMessages: (conversationId: string) => ChatMessage[];
}

const initialConversation = (): Conversation => ({
  id: makeId(),
  title: "CAKE Core Session",
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      const firstConversation = initialConversation();

      return {
        conversations: [firstConversation],
        currentConversationId: firstConversation.id,
        selectedModel: "cake",
        sidebarCollapsed: false,

        createConversation: (title) => {
          const conversation: Conversation = {
            id: makeId(),
            title: title || "New CAKE Chat",
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          set((state) => ({
            conversations: [conversation, ...state.conversations],
            currentConversationId: conversation.id,
          }));

          return conversation.id;
        },

        switchConversation: (id) => {
          set({ currentConversationId: id });
        },

        deleteConversation: (id) => {
          set((state) => {
            const remaining = state.conversations.filter(
              (conversation) => conversation.id !== id,
            );
            const fallback = remaining[0] ?? initialConversation();

            return {
              conversations: remaining.length > 0 ? remaining : [fallback],
              currentConversationId:
                state.currentConversationId === id
                  ? fallback.id
                  : state.currentConversationId,
            };
          });
        },

        clearConversations: () => {
          const conversation = initialConversation();
          set({
            conversations: [conversation],
            currentConversationId: conversation.id,
          });
        },

        setSelectedModel: (model) => set({ selectedModel: model }),
        setSidebarCollapsed: (collapsed) =>
          set({ sidebarCollapsed: collapsed }),

        addMessage: (conversationId, message) => {
          set((state) => ({
            conversations: state.conversations.map((conversation) =>
              conversation.id === conversationId
                ? {
                    ...conversation,
                    title:
                      conversation.messages.length === 0 &&
                      message.role === "user"
                        ? makeTitle(message.content)
                        : conversation.title,
                    messages: [...conversation.messages, message],
                    updatedAt: Date.now(),
                  }
                : conversation,
            ),
          }));
        },

        updateMessage: (conversationId, messageId, patch) => {
          set((state) => ({
            conversations: state.conversations.map((conversation) =>
              conversation.id === conversationId
                ? {
                    ...conversation,
                    messages: conversation.messages.map((message) =>
                      message.id === messageId
                        ? { ...message, ...patch }
                        : message,
                    ),
                    updatedAt: Date.now(),
                  }
                : conversation,
            ),
          }));
        },

        renameConversation: (conversationId, title) => {
          set((state) => ({
            conversations: state.conversations.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, title, updatedAt: Date.now() }
                : conversation,
            ),
          }));
        },

        getCurrentConversation: () => {
          const state = get();
          return state.conversations.find(
            (conversation) => conversation.id === state.currentConversationId,
          );
        },

        toApiMessages: (conversationId) => {
          const conversation = get().conversations.find(
            (item) => item.id === conversationId,
          );

          if (!conversation) {
            return [];
          }

          return conversation.messages
            .filter((message) => message.content.trim().length > 0)
            .map((message) => ({
              role: message.role,
              content: message.content,
            }));
        },
      };
    },
    {
      name: "cake-web-chat-v1",
      partialize: (state) => ({
        conversations: state.conversations,
        currentConversationId: state.currentConversationId,
        selectedModel: state.selectedModel,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);

export function makeMessage(role: Message["role"], content: string): Message {
  return {
    id: makeId(),
    role,
    content,
    createdAt: Date.now(),
  };
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New CAKE Chat";
  }

  return normalized.length > 42 ? `${normalized.slice(0, 39)}...` : normalized;
}
