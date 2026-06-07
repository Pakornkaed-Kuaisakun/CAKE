import type { AIProvider, ChatResult } from "../../providers/types.js";
import { getFastModel } from "../../providers/utils.js";
import { asyncExecutionQueue } from "../asyncExecution.js";
import { formatChatResult } from "../../shared/utils/utils.js";

const BACKGROUND_SYSTEM_PROMPT = `
You are a background task runner. Execute the user's request as a short, focused task and return the result. Keep output concise.
`;

export async function handleAsync(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const match = input.match(/^(?:async|background)\s+(.+)$/i);
  if (!match)
    return formatChatResult(
      "Please provide a task to run in the background. Usage: async <task>",
    );

  const description = match[1].trim();
  if (!description) {
    return formatChatResult(
      "Please provide a task to run in the background. Usage: async <task>",
    );
  }

  const taskId = asyncExecutionQueue.enqueue(description, async () => {
    const fastModel = model || getFastModel(provider.name);
    const result = await provider.chat(
      [
        { role: "system", content: BACKGROUND_SYSTEM_PROMPT },
        { role: "user", content: description },
      ],
      { model: fastModel, temperature: 0.2, maxTokens: 800 },
    );
    return result.text;
  });

  return formatChatResult(
    `Queued background task ${taskId}. Use async_status ${taskId} or async_list to track progress.`,
  );
}

export async function handleAsyncList(
  _provider: AIProvider,
  _input: string,
): Promise<ChatResult> {
  const tasks = asyncExecutionQueue.list();
  if (tasks.length === 0)
    return formatChatResult("No background tasks queued.");

  const body = tasks
    .map((task) => {
      const note =
        task.status === "completed"
          ? ` result=${task.result ? task.result.slice(0, 120) : "(empty)"}`
          : task.status === "failed"
            ? ` error=${task.error ?? "unknown"}`
            : "";
      return `${task.id} | ${task.status} | ${task.description}${note}`;
    })
    .join("\n");

  return formatChatResult(body);
}

export async function handleAsyncStatus(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const match = input.match(/^(?:async_status|background_status)\s+(\S+)$/i);
  if (!match) return formatChatResult("Usage: async_status <taskId>");

  const taskId = match[1];
  const task = asyncExecutionQueue.get(taskId);
  if (!task) return formatChatResult(`Task not found: ${taskId}`);

  const lines = [
    `Task: ${task.description}`,
    `Status: ${task.status}`,
    `Created: ${new Date(task.createdAt).toISOString()}`,
  ];
  if (task.startedAt)
    lines.push(`Started: ${new Date(task.startedAt).toISOString()}`);
  if (task.completedAt)
    lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
  if (task.result) lines.push(`Result: ${task.result.slice(0, 500)}`);
  if (task.error) lines.push(`Error: ${task.error}`);

  return formatChatResult(lines.join("\n"));
}

export async function handleAsyncCancel(
  _provider: AIProvider,
  input: string,
): Promise<ChatResult> {
  const match = input.match(/^(?:async_cancel|background_cancel)\s+(\S+)$/i);
  if (!match) return formatChatResult("Usage: async_cancel <taskId>");

  const taskId = match[1];
  const cancelled = asyncExecutionQueue.cancel(taskId);
  return formatChatResult(
    cancelled
      ? `Cancelled background task ${taskId}.`
      : `Could not cancel task ${taskId}. It may already be running, completed, or not exist.`,
  );
}
