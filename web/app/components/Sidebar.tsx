"use client";

import type { ReactNode } from "react";
import {
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { Conversation } from "../store/chat-store";
import { useChatStore } from "../store/chat-store";

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const {
    conversations,
    currentConversationId,
    sidebarCollapsed,
    createConversation,
    switchConversation,
    deleteConversation,
    clearConversations,
    setSidebarCollapsed,
  } = useChatStore();

  const widthClass = sidebarCollapsed ? "md:w-[72px]" : "md:w-76.5";

  const content = (
    <aside
      className={`flex h-full w-76.5 flex-col border-r border-hairline bg-sidebar ${widthClass}`}
    >
      <div className="flex h-14 items-center gap-3 px-3">
        <Logo compact={sidebarCollapsed} />
        <button
          type="button"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="ml-auto hidden h-9 w-9 items-center justify-center rounded-sm text-ash hover:bg-surface-dark-elevated hover:text-canvas md:flex"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
      </div>

      <nav className="space-y-1 px-2 py-2">
        <SidebarButton
          collapsed={sidebarCollapsed}
          label="New Chat"
          icon={<SquarePen size={19} />}
          onClick={() => {
            createConversation();
            onMobileClose();
          }}
        />
        <SidebarButton
          collapsed={sidebarCollapsed}
          label="Search"
          icon={<Search size={19} />}
        />
        <SidebarButton
          collapsed={sidebarCollapsed}
          label="Workspace"
          icon={<Sparkles size={19} />}
        />
      </nav>

      {!sidebarCollapsed && <SidebarSections />}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
        {!sidebarCollapsed && (
          <div className="px-2 pb-2 text-[14px] font-medium leading-6 text-ash">
            Chats
          </div>
        )}
        <div className="space-y-1">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              collapsed={sidebarCollapsed}
              active={conversation.id === currentConversationId}
              conversation={conversation}
              onOpen={() => {
                switchConversation(conversation.id);
                onMobileClose();
              }}
              onDelete={() => deleteConversation(conversation.id)}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-hairline p-2">
        {!sidebarCollapsed && conversations.length > 1 && (
          <button
            type="button"
            onClick={clearConversations}
            className="mb-1 flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-[14px] text-danger hover:bg-danger/10"
          >
            <Trash2 size={17} />
            Clear conversations
          </button>
        )}
        <SidebarButton
          collapsed={sidebarCollapsed}
          label="Settings"
          icon={<Settings2 size={18} />}
        />
        {!sidebarCollapsed && <SidebarAccount />}
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:block">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            className="absolute inset-0 bg-black/60"
            onClick={onMobileClose}
          />
          <div className="relative h-full">{content}</div>
        </div>
      )}
    </>
  );
}

function SidebarButton({
  collapsed,
  label,
  icon,
  onClick,
}: {
  collapsed: boolean;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-10 w-full items-center rounded-sm text-[15px] text-canvas hover:bg-surface-dark-elevated ${
        collapsed ? "justify-center" : "gap-3 px-3"
      }`}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function ConversationRow({
  collapsed,
  active,
  conversation,
  onOpen,
  onDelete,
}: {
  collapsed: boolean;
  active: boolean;
  conversation: Conversation;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        title={conversation.title}
        onClick={onOpen}
        className={`flex h-10 w-full items-center rounded-sm text-left text-[14px] ${
          collapsed ? "justify-center px-0" : "gap-2 px-3 pr-9"
        } ${
          active
            ? "bg-surface-dark-elevated text-canvas"
            : "text-ash hover:bg-surface-dark hover:text-canvas"
        }`}
      >
        {collapsed ? (
          <MessageSquareText size={17} />
        ) : (
          <>
            <span className="text-ash w-5 h-5 flex items-center justify-center">
              <MessageSquareText size={16} />
            </span>
            <span className="truncate">{conversation.title}</span>
          </>
        )}
      </button>
      {!collapsed && (
        <button
          type="button"
          aria-label={`Delete ${conversation.title}`}
          title="Delete chat"
          onClick={onDelete}
          className="absolute right-1 top-1 hidden h-8 w-8 items-center justify-center rounded-sm text-ash hover:bg-danger/10 hover:text-danger group-hover:flex"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function Logo({ compact }: { compact: boolean }) {
  return (
    <div className="min-w-0">
      {!compact && (
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-[13px] font-bold text-ink">
            CA
          </div>
          <p className="truncate text-[16px] font-bold leading-5">CAKE Core</p>
          {/* <p className="truncate text-[11px] leading-4 text-ash">
            OpenWebUI shell
          </p> */}
        </div>
      )}
    </div>
  );
}

function SidebarSections() {
  return (
    <div className="px-4 py-3 text-[14px] leading-7 text-ash">
      <p className="font-medium text-canvas">Channels</p>
      <p># core</p>
      <p># tools</p>
      <p className="mt-3 font-medium text-canvas">Folders</p>
      <p>[+] Finance</p>
      <p>[+] Study</p>
    </div>
  );
}

function SidebarAccount() {
  return (
    <div className="mt-2 flex items-center gap-3 px-2 py-2 text-[14px] text-canvas">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-warning text-[12px] font-bold text-ink">
        CA
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">CAKE Core</p>
        <p className="truncate text-[12px] text-ash">local runtime</p>
      </div>
    </div>
  );
}
