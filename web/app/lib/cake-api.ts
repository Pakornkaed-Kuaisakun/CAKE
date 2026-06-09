export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CakeModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: ChatRole;
      content?: string;
    };
  }>;
}

const DEFAULT_API_BASE = "http://localhost:8000";

export function getApiBase() {
  return (
    process.env.NEXT_PUBLIC_CAKE_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_API_BASE
  ).replace(/\/$/, "");
}

export async function fetchModels(signal?: AbortSignal): Promise<CakeModel[]> {
  const response = await fetch(`${getApiBase()}/v1/models`, {
    method: "GET",
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`CAKE server returned ${response.status}`);
  }

  const payload = (await response.json()) as { data?: CakeModel[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function completeChat(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`${getApiBase()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `CAKE server returned ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("CAKE server returned an empty assistant message");
  }

  return content;
}

export async function streamChat(
  messages: ChatMessage[],
  model: string,
  onToken: (token: string) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${getApiBase()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await safeReadError(response);
    throw new Error(detail || `CAKE stream returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          return;
        }

        const token = parseStreamToken(data);
        if (token) {
          onToken(token);
        }
      }
    }
  }
}

function parseStreamToken(data: string) {
  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string;
        };
      }>;
    };

    return payload.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

async function safeReadError(response: Response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") {
      return payload.error;
    }
    return JSON.stringify(payload);
  } catch {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}
