// Puter.js provider — free, unlimited AI API via puter.ai
//
// Puter.js exposes Claude, GPT-4o, Gemini and other models for free
// with no API key required (uses Puter's auth instead).
//
// Auth:
//   Browser: window.puter.auth (OAuth popup)
//   Node/CLI: PUTER_API_KEY env var  OR  anonymous (some models)
//
//   For the CAKE CLI use-case, set PUTER_API_KEY in .env:
//     PUTER_API_KEY=your-puter-jwt-token
//   Or leave blank — many Puter models work without auth in a server context.
//
// Default model: claude-sonnet-4-5  (best free Anthropic model on Puter)
//
// Supported free models (via puter.ai endpoint):
//   claude-sonnet-4-5         ← default (best quality)
//   claude-haiku-3-5
//   gpt-4o
//   gpt-4o-mini
//   gemini-2-0-flash
//   gemini-1-5-flash
//   meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
//   mistralai/Mixtral-8x7B-Instruct-v0.1
//
// Embedding:
//   Puter does not expose an embedding endpoint.
//   We fall back to the same deterministic hash-based vector used by ClaudeProvider.
//
// Streaming:
//   Puter supports SSE streaming on /drivers/call — implemented below.
//
// Pricing:
//   Free and unlimited (as of 2025).
//   No cost tracking is applicable; costUsd is always null.
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StreamChunkCallback,
} from "./types.js";

// Constants

const PUTER_BASE = "https://api.puter.com";
const PUTER_CHAT_PATH = "/drivers/call";

// Default model: best free Anthropic model available on Puter
const DEFAULT_MODEL = "claude-sonnet-4-6";

// Hash-based fallback embedding (copied from claude.ts)

const EMBED_DIMS = 256;

function fnv1a(s: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function hashEmbed(text: string): number[] {
  const lower = text.toLowerCase();
  const words = lower.match(/\b\w+\b/g) ?? [];
  const tokens: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(words[i] + "_" + words[i + 1]);
  }
  for (let i = 0; i < lower.length - 2; i++) {
    tokens.push(lower.slice(i, i + 3));
  }

  const vec = new Float64Array(EMBED_DIMS);
  for (const token of tokens) {
    for (let seed = 0; seed < 4; seed++) {
      const h = fnv1a(token, 2166136261 + seed * 1000003);
      const dim = h % EMBED_DIMS;
      const sign = (h >> 16) & 1 ? 1 : -1;
      vec[dim] += sign;
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const result: number[] = new Array(EMBED_DIMS);
  for (let i = 0; i < EMBED_DIMS; i++) result[i] = vec[i] / norm;
  return result;
}

// Request Builder

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const key = apiKey ?? process.env.PUTER_API_KEY;
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

/**
 * Build the Puter /drivers/call request body.
 * Puter uses a driver-style API wrapping the underlying model.
 */

function buildRequestBody(
  messages: Message[],
  options: ChatOptions,
  stream: boolean = false,
): Record<string, unknown> {
  const model = options.model ?? DEFAULT_MODEL;

  // Separate system messages
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const systemText =
    options.systemPrompt ?? systemMessages.map((m) => m.content).join("\n");

  // Puter expects OpenAI-style messages array
  const formattedMessages: Array<{ role: string; content: string }> = [];

  if (systemText.trim()) {
    formattedMessages.push({ role: "system", content: systemText });
  }

  for (const m of chatMessages) {
    formattedMessages.push({ role: m.role, content: m.content });
  }

  return {
    interface: "puter-chat-completion",
    driver: "claude", // Puter routes by driver name; "claude" for Anthropic models
    test_mode: false,
    method: "complete",
    args: {
      messages: formattedMessages,
      model,
      stream,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
    },
  };
}

/**
 * Some models on Puter use different driver names.
 * This maps model ID prefixes to driver names.
 */

function resolveDriver(model: string): string {
  if (model.startsWith("claude")) return "claude";
  if (
    model.startsWith("gpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  )
    return "openai";
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("meta-llama") || model.startsWith("mistralai"))
    return "together-ai";
  return "claude"; // default to claude driver
}

function buildRequestBodyV2(
  messages: Message[],
  options: ChatOptions,
  stream = false,
): Record<string, unknown> {
  const model = options.model ?? DEFAULT_MODEL;
  // const driver = resolveDriver(model);
  const driver = "ai-chat";

  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const systemText =
    options.systemPrompt ?? systemMessages.map((m) => m.content).join("\n");

  const formattedMessages: Array<{ role: string; content: string }> = [];

  if (systemText.trim()) {
    formattedMessages.push({ role: "system", content: systemText });
  }

  for (const m of chatMessages) {
    formattedMessages.push({ role: m.role, content: m.content });
  }

  return {
    interface: "puter-chat-completion",
    driver,
    test_mode: false,
    method: "complete",
    args: {
      messages: formattedMessages,
      model,
      stream,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
    },
  };
}

// ── Response parsing ──────────────────────────────────────────────────────────

function extractTextFromResponse(data: any): string {
  // Puter response wraps the provider's native response under result / success
  const result = data?.result ?? data;

  // OpenAI-style (used for Claude, GPT, Gemini on Puter)
  const choice = result?.choices?.[0];
  if (choice) {
    return choice.message?.content ?? choice.delta?.content ?? "";
  }

  // Fallback: direct text field
  if (typeof result?.text === "string") return result.text;
  if (typeof result?.content === "string") return result.content;

  // Anthropic-style content blocks
  if (Array.isArray(result?.content)) {
    return result.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  return "";
}

function extractUsageFromResponse(data: any): {
  inputTokens: number;
  outputTokens: number;
} {
  const result = data?.result ?? data;
  const usage = result?.usage ?? result?.usage_metadata ?? {};
  return {
    inputTokens:
      usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0,
    outputTokens:
      usage.completion_tokens ??
      usage.output_tokens ??
      usage.candidatesTokenCount ??
      0,
  };
}

// ── SSE stream parser ─────────────────────────────────────────────────────────

async function* parseSSE(
  response: Response,
): AsyncGenerator<string, void, unknown> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class PuterProvider implements AIProvider {
  name = "puter" as const;
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.PUTER_API_KEY;
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  async chat(
    messages: Message[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const body = buildRequestBodyV2(messages, options, false);
    const headers = buildHeaders(this.apiKey);

    let response: Response;
    try {
      response = await fetch(`${PUTER_BASE}${PUTER_CHAT_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err: any) {
      throw new Error(`Puter.js API request failed: ${err.message}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Puter.js API error ${response.status}: ${errText}\n` +
          `Tip: Set PUTER_API_KEY in .env or check https://puter.com for free account.`,
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error("Puter.js returned non-JSON response.");
    }

    const text = extractTextFromResponse(data);
    const { inputTokens, outputTokens } = extractUsageFromResponse(data);

    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: null, // Puter is free
      },
    };
  }

  // ── stream ────────────────────────────────────────────────────────────────

  async stream(
    messages: Message[],
    options: ChatOptions,
    onChunk: StreamChunkCallback,
  ): Promise<ChatResult> {
    const body = buildRequestBodyV2(messages, options, true);
    const headers = buildHeaders(this.apiKey);

    let response: Response;
    try {
      response = await fetch(`${PUTER_BASE}${PUTER_CHAT_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err: any) {
      throw new Error(`Puter.js stream request failed: ${err.message}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Puter.js stream error ${response.status}: ${errText}`);
    }

    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const rawData of parseSSE(response)) {
      let parsed: any;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        continue;
      }

      // Extract streaming delta
      const delta =
        parsed?.choices?.[0]?.delta?.content ??
        parsed?.result?.choices?.[0]?.delta?.content ??
        parsed?.delta?.text ??
        "";

      if (delta) {
        fullText += delta;
        onChunk(delta);
      }

      // Accumulate usage from final chunk
      const usage = parsed?.usage ?? parsed?.result?.usage ?? {};
      if (usage.prompt_tokens) inputTokens = usage.prompt_tokens;
      if (usage.completion_tokens) outputTokens = usage.completion_tokens;
    }

    // If streaming produced no text, fall back to non-streaming
    if (!fullText) {
      return this.chat(messages, options);
    }

    return {
      text: fullText,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: null,
      },
    };
  }

  // ── Embeddings ────────────────────────────────────────────────────────────
  //
  // Puter does not expose an embedding endpoint.
  // We use the same deterministic hash-based fallback as ClaudeProvider
  // so memory/search features still work (with reduced semantic quality).

  async embed(text: string): Promise<number[]> {
    return hashEmbed(text);
  }

  // ── Model listing ─────────────────────────────────────────────────────────

  async listModels(): Promise<string[]> {
    return [
      "claude-sonnet-4-5",
      "claude-haiku-3-5",
      "gpt-4o",
      "gpt-4o-mini",
      "gemini-2-0-flash",
      "gemini-1-5-flash",
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ];
  }
}
