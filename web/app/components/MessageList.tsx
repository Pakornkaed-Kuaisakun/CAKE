"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Message } from "../store/chat-store";

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className='mx-auto flex w-full max-w-230 flex-col gap-5 px-4 py-8'>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const rendered = useMemo(() => message.content || " ", [message.content]);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const time = new Date(message.createdAt).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article
      className={`group flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
      data-message-id={message.id}
    >
      <div
        className={`flex flex-row gap-4 ${isUser ? "flex-row-reverse" : ""}`}
      >
        {!isUser && (
          <div className='mt-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-[12px] font-bold text-ink mb-2'>
            CA
          </div>
        )}
        <div className='flex flex-col gap-0.5'>
          <div
            className={`max-w-[min(720px,calc(100vw-2rem))] border px-4 py-2 text-[15px] leading-7 rounded-lg ${
              isUser
                ? "border-hairline bg-surface-dark-elevated text-canvas"
                : "border-hairline bg-transparent text-canvas"
            }`}
          >
            <div
              className={`prose-message whitespace-pre-wrap wrap-break-word ${
                message.streaming ? "typing-caret" : ""
              }`}
            >
              {rendered.trim()}
            </div>
          </div>
          {message.content && (
            <div
              className={`flex items-center ${
                isUser ? "justify-end" : "justify-start"
              } opacity-100 md:opacity-0 md:group-hover:opacity-100`}
            >
              <button
                type='button'
                onClick={copy}
                className='mt-1 flex h-7 items-center gap-1 rounded-sm px-2 text-[6px] text-ash opacity-100 hover:bg-surface-dark-elevated hover:text-canvas md:opacity-0 md:group-hover:opacity-100'
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {/* {copied ? "Copied" : "Copy"} */}
              </button>
              <div className='text-xs mt-1 text-ash ml-1'>{time}</div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
