// src/cli/components/MessageList.tsx
import React from "react";
import { Box, Text } from "ink";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinkingTime?: number;
}

interface Props {
  messages: ChatMessage[];
  /** Bump this key to hard-reset the list (used by /clear) */
  version?: number;
}

/** Wrap long text to a given column width */
function wrapText(text: string, width = 72): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const words = line.split(" ");
      const wrapped: string[] = [];
      let current = "";
      for (const word of words) {
        if ((current + (current ? " " : "") + word).length > width) {
          if (current) wrapped.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) wrapped.push(current);
      return wrapped.join("\n  ");
    })
    .join("\n");
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function UserMessage({ content }: { content: string }) {
  return (
    <Box marginBottom={1}>
      <Text color='green' bold>
        You ›{" "}
      </Text>
      <Text wrap='wrap'>{content}</Text>
    </Box>
  );
}

function AssistantMessage({
  content,
  thinkingTime,
}: {
  content: string;
  thinkingTime?: number;
}) {
  const wrapped = wrapText(content);
  return (
    <Box flexDirection='column' marginBottom={1}>
      <Text color='cyan' bold>
        {"CAKE "}
        {thinkingTime !== undefined ? `(${formatTime(thinkingTime)}) ` : ""}
        {"›"}
      </Text>
      <Box paddingLeft={2} flexDirection='column'>
        {wrapped.split("\n").map((line, i) => (
          <Text key={i} wrap='wrap'>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function SystemMessage({ content }: { content: string }) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  return (
    <Box
      marginBottom={1}
      borderStyle='round'
      borderColor='yellow'
      paddingX={1}
      flexDirection='column'
    >
      {content.split("\n").map((line, i) => {
        const parts = line.split(urlRegex);
        return (
          <Text key={i} color='yellow'>
            {parts.map((part, j) =>
              // Render URLs in a brighter color so they stand out, but stay as plain text
              // (Ink does not support clickable hyperlinks natively)
              urlRegex.test(part) ? (
                <Text key={j} color='cyanBright'>
                  {part}
                </Text>
              ) : (
                part
              ),
            )}
          </Text>
        );
      })}
    </Box>
  );
}

export function MessageList({ messages, version }: Props) {
  return (
    <Box key={version} flexDirection='column'>
      {messages.map((msg) => {
        if (msg.role === "user")
          return <UserMessage key={msg.id} content={msg.content} />;
        if (msg.role === "assistant")
          return (
            <AssistantMessage
              key={msg.id}
              content={msg.content}
              thinkingTime={msg.thinkingTime}
            />
          );
        return <SystemMessage key={msg.id} content={msg.content} />;
      })}
    </Box>
  );
}
