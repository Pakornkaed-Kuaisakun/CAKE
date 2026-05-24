// src/cli/components/MessageList.tsx
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

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

/** No-op wrap since we use Ink's wrap prop */
function wrapText(text: string): string {
  return text;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

import { useTheme } from "../theme/useTheme.js";
import { APP_NAME } from "../../config/constants.js";

interface ParsedItem {
  type: "text" | "step";
  content?: string;
  header?: string;
  details?: string[];
  stepNum?: number;
  tool?: string;
}

function parseMessageContent(content: string): ParsedItem[] {
  const lines = content.split("\n");
  const items: ParsedItem[] = [];
  let currentStep: ParsedItem | null = null;
  let currentTextLines: string[] = [];

  const stepHeaderRegex = /^(\s*)(?:[^\w\s]+\s+)?Step\s+(\d+):\s+\[(.*?)\]/;
  const separatorRegex = /^[─═\-]{10,}/;
  const finalSummaryRegex = /^(?:✅ Done|⚠️\s+Stopped)/;

  for (const line of lines) {
    const isStepHeader = stepHeaderRegex.test(line);
    const isSeparator = separatorRegex.test(line);
    const isFinalSummary = finalSummaryRegex.test(line);

    if (isStepHeader) {
      if (currentTextLines.length > 0) {
        items.push({ type: "text", content: currentTextLines.join("\n") });
        currentTextLines = [];
      }
      if (currentStep) {
        while (
          currentStep.details!.length > 0 &&
          currentStep.details![currentStep.details!.length - 1].trim() === ""
        ) {
          currentStep.details!.pop();
        }
        items.push(currentStep);
      }
      const match = stepHeaderRegex.exec(line)!;
      currentStep = {
        type: "step",
        header: line,
        details: [],
        stepNum: parseInt(match[2], 10),
        tool: match[3],
      };
    } else if (currentStep && (isSeparator || isFinalSummary)) {
      while (
        currentStep.details!.length > 0 &&
        currentStep.details![currentStep.details!.length - 1].trim() === ""
      ) {
        currentStep.details!.pop();
      }
      items.push(currentStep);
      currentStep = null;
      currentTextLines.push(line);
    } else if (currentStep) {
      currentStep.details!.push(line);
    } else {
      currentTextLines.push(line);
    }
  }

  if (currentStep) {
    while (
      currentStep.details!.length > 0 &&
      currentStep.details![currentStep.details!.length - 1].trim() === ""
    ) {
      currentStep.details!.pop();
    }
    items.push(currentStep);
  }
  if (currentTextLines.length > 0) {
    items.push({ type: "text", content: currentTextLines.join("\n") });
  }

  return items;
}
function UserMessage({ content }: { content: string }) {
  const { theme } = useTheme();
  return (
    <Box marginBottom={1}>
      <Text color={theme.primary} bold>
        You ›{" "}
      </Text>
      <Text color={theme.text} wrap='wrap'>
        {content}
      </Text>
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
  const { theme } = useTheme();
  const [globalExpanded, setGlobalExpanded] = useState<boolean | null>(null);

  useInput((input, key) => {
    if (key.ctrl && input === "t") {
      setGlobalExpanded((prev) => (prev === true ? false : true));
    }
  });

  const parsed = parseMessageContent(content);
  const hasSteps = parsed.some((item) => item.type === "step");

  // The agent is running if the message has steps and does not contain a final summary pattern.
  const isAgentRunning = hasSteps && !/(?:✅ Done|⚠️\s+Stopped)/.test(content);
  const stepItems = parsed.filter((item) => item.type === "step");
  const lastStepNum =
    stepItems.length > 0 ? stepItems[stepItems.length - 1].stepNum : -1;

  return (
    <Box flexDirection='column' marginBottom={1}>
      <Box flexDirection='row' gap={1}>
        <Text color={theme.secondary} bold>
          {`${APP_NAME} `}
          {thinkingTime !== undefined ? `(${formatTime(thinkingTime)}) ` : ""}
          {"›"}
        </Text>
        {hasSteps && (
          <Text color={theme.muted}>(Ctrl+T to toggle details)</Text>
        )}
      </Box>
      <Box paddingLeft={2} flexDirection='column'>
        {parsed.map((item, index) => {
          if (item.type === "text") {
            return (
              <Box key={index} flexDirection='column'>
                {item.content!.split("\n").map((line, i) => (
                  <Text key={i} color={theme.text} wrap='wrap'>
                    {line}
                  </Text>
                ))}
              </Box>
            );
          } else {
            const isActive = isAgentRunning && item.stepNum === lastStepNum;
            const isDefaultExpanded = isActive; // collapsed by default unless active/running
            const isExpanded =
              globalExpanded !== null ? globalExpanded : isDefaultExpanded;

            const indicator = isExpanded ? " ▾" : " ▸";

            return (
              <Box key={index} flexDirection='column' marginY={0}>
                <Text color={theme.text} wrap='wrap'>
                  {item.header}
                  <Text color={theme.muted} dimColor>
                    {indicator}
                  </Text>
                </Text>
                {isExpanded &&
                  item.details &&
                  item.details.map((detail, idx) => (
                    <Text key={idx} color={theme.text} wrap='wrap'>
                      {detail}
                    </Text>
                  ))}
              </Box>
            );
          }
        })}
      </Box>
    </Box>
  );
}

function SystemMessage({ content }: { content: string }) {
  const { theme } = useTheme();
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  return (
    <Box
      marginBottom={1}
      borderStyle='single'
      borderColor={theme.secondary}
      paddingX={1}
      flexDirection='column'
    >
      {content.split("\n").map((line, i) => {
        const parts = line.split(urlRegex);
        return (
          <Text key={i} color={theme.text}>
            {parts.map((part, j) =>
              urlRegex.test(part) ? (
                <Text key={j} color={theme.secondary} bold underline>
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
    <Box flexDirection='column'>
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
