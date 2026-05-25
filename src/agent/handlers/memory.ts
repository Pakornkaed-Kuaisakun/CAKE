import path from "path";
import type { AIProvider, ChatResult, Message } from "../../providers/types.js";
import { readDocument, chunkText } from "../../modules/documents/index.js";
import { MemoryManager } from "../../modules/memory/index.js";
import { text } from "../utils/text.js";
import { EpisodeStore, DecisionStore } from "../../modules/memory/episodes.js";

export async function handleIndexDocument(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:index|learn|remember)\s+(.+)/i);
    if (!match) return text("Please specify a document to index.");

    const rawPath = match[1].trim().replace(/^["']|["']$/g, "");
    const filePath = path.resolve(rawPath);
    
    const content = await readDocument(filePath);
    const chunks = chunkText(content, 2000, 200); // ใช้ chunk เล็กสำหรับการเก็บจำ

    const memory = new MemoryManager(provider);
    
    // Index แต่ละ chunk ลงใน Vector Store
    for (const chunk of chunks) {
      await memory.remember(chunk, { 
        source: "file-index", 
        fileName: path.basename(filePath),
        fullPath: filePath 
      });
    }

    return text(`✅ Learned ${chunks.length} segments from ${path.basename(filePath)}. I will remember this context in future conversations.`);
  } catch (error: any) {
    return text(`Failed to index document.\n${error.message}`);
  }
}

export async function handleForgetMemory(
  provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  // ฟีเจอร์ลบความจำ (Optional)
  return text("Memory clearing feature is not implemented yet but can be done by deleting data/memory/vectors.json");
}

export async function handleMemorySearch(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:memory_search|memory search)\s+(.+)/i);
    if (!match) return text("Please specify a query for memory_search.");

    const query = match[1].trim();
    const memory = new MemoryManager(provider);
    const results = await memory.retrieve(query, 5);

    if (!results || results.length === 0)
      return text("No relevant long-term memories found.");

    const body = results.map((r, i) => `${i + 1}. ${r}`).join("\n\n");
    return text(`Found ${results.length} memory items:\n\n${body}`);
  } catch (err: any) {
    return text(`Memory search failed: ${err.message}`);
  }
}

export async function handleSessionSearch(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:session_search|session search)\s+(.+)/i);
    if (!match) return text("Please specify a query for session_search.");

    const query = match[1].trim();
    const memory = new MemoryManager(provider);
    // retrieveSession filters recent conversation-sourced memories
    const results = await (memory as any).retrieveSession(query, 24, 5);

    if (!results || results.length === 0)
      return text("No recent session memories found.");

    const body = results.map((r: any, i: any) => `${i + 1}. ${r}`).join("\n\n");
    return text(`Found ${results.length} recent memory items:\n\n${body}`);
  } catch (err: any) {
    return text(`Session memory search failed: ${err.message}`);
  }
}

export async function handleEpisodeStart(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:episode_start|start episode)\s+(.+)/i);
    if (!match) return text("Please provide an episode title. Usage: episode_start <title>");

    const title = match[1].trim();
    const store = new EpisodeStore();
    const ep = store.startEpisode(title, { createdBy: "user" });
    return text(`Started episode '${title}' (id: ${ep.id}).`);
  } catch (err: any) {
    return text(`Failed to start episode: ${err.message}`);
  }
}

export async function handleEpisodeEnd(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:episode_end|end episode)\s+([\w-]+)/i);
    if (!match) return text("Please provide an episode id. Usage: episode_end <id> [summary]");

    const id = match[1].trim();
    const summaryMatch = input.match(/(?:episode_end|end episode)\s+[\w-]+\s+([\s\S]+)/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

    const store = new EpisodeStore();
    const ep = store.endEpisode(id, summary);
    if (!ep) return text(`Episode id not found: ${id}`);
    return text(`Ended episode '${ep.title}' (id: ${ep.id}).`);
  } catch (err: any) {
    return text(`Failed to end episode: ${err.message}`);
  }
}

export async function handleEpisodeList(
  provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const store = new EpisodeStore();
    const list = store.listEpisodes();
    if (!list.length) return text("No episodes recorded.");
    const body = list.map((e) => `- ${e.title} (id: ${e.id}) ${e.end ? `ended` : `active`}`).join("\n");
    return text(`Episodes:\n${body}`);
  } catch (err: any) {
    return text(`Failed to list episodes: ${err.message}`);
  }
}

export async function handleDecisionRecord(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:decision_record|record decision)\s+(.+)/i);
    if (!match) return text("Please provide a decision text. Usage: decision_record <text> [--episode=<id>] [--rationale=<text>]");

    // naive parsing: look for --episode= and --rationale=
    let payload = match[1].trim();
    let episodeId: string | undefined;
    const epMatch = payload.match(/--episode=([\w-]+)/);
    if (epMatch) {
      episodeId = epMatch[1];
      payload = payload.replace(epMatch[0], "").trim();
    }
    let rationale: string | undefined;
    const rMatch = payload.match(/--rationale=(.+)/);
    if (rMatch) {
      rationale = rMatch[1].trim();
      payload = payload.replace(rMatch[0], "").trim();
    }

    const store = new DecisionStore();

    // Try to link to memory entries
    const memory = new MemoryManager(provider);
    let linked: string[] = [];
    try {
      // retrieveEntries returns MemoryEntry[] with ids
      const entries = await (memory as any).retrieveEntries(payload, 5);
      linked = entries.map((e: any) => e.id).slice(0, 5);
    } catch (e) {
      // ignore failures to link
    }

    const d = store.addDecision(payload, rationale, episodeId, { recordedBy: "user", linkedMemoryIds: linked });
    return text(`Recorded decision (id: ${d.id}).`);
  } catch (err: any) {
    return text(`Failed to record decision: ${err.message}`);
  }
}

export async function handleDecisionList(
  provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:decision_list|list decisions)(?:\s+([\w-]+))?/i);
    const episodeId = match && match[1] ? match[1] : undefined;
    const store = new DecisionStore();
    const list = episodeId ? store.listForEpisode(episodeId) : store.listDecisions(50);
    if (!list.length) return text("No decisions recorded.");
    const body = list.map((d) => `- ${new Date(d.timestamp).toISOString()} ${d.episodeId ? `(ep:${d.episodeId}) ` : ""}${d.text}${d.rationale ? ` — rationale: ${d.rationale}` : ""}`).join("\n\n");
    return text(`Decisions:\n\n${body}`);
  } catch (err: any) {
    return text(`Failed to list decisions: ${err.message}`);
  }
}

export async function handleSelfReflect(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:self_reflect|self-reflect|reflect memories|reflect_memories)(?:\s+(\d+))?/i);
    // optional number = max entries to process
    const limit = match && match[1] ? parseInt(match[1], 10) : 50;

    const memory = new (await import("../../modules/memory/index.js")).MemoryManager(provider);
    // call reflectAndUpdate on TieredMemoryManager
    const updated = await (memory as any).reflectAndUpdate(model, limit);

    return text(`Self-reflection completed. Updated ${updated} memory entries.`);
  } catch (err: any) {
    return text(`Self-reflection failed: ${err.message}`);
  }
}

export async function handleEpisodeSummary(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  try {
    const match = input.match(/(?:episode_summary|summary episode)\s+([\w-]+)/i);
    if (!match) return text("Please provide an episode id. Usage: episode_summary <id>");

    const id = match[1];
    const store = new EpisodeStore();
    const ep = store.getEpisode(id);
    if (!ep) return text(`Episode not found: ${id}`);

    const msgs = store.readMessages(id);
    if (!msgs || msgs.length === 0) return text("No messages found for this episode.");

    // Build content for summarization (cap length)
    const joined = msgs
      .map((m: any) => `${m.role.toUpperCase()}: ${m.displayContent ?? m.content}`)
      .join("\n\n");

    const content = joined.length > 30_000 ? joined.slice(-30_000) : joined;

    const systemPrompt = `You are a helpful assistant that summarizes conversations into concise meeting notes and action items. Produce: 1) short summary, 2) key decisions, 3) action items with owners if present.`;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Summarize the following conversation (episode: ${ep.title}):\n\n${content}` },
    ];

    const chatOpts = { model };
    const result = await provider.chat(messages, chatOpts as any);

    if (result && result.text) {
      // Save summary back to episode
      store.endEpisode(id, result.text);
      return text(`Episode summary:\n\n${result.text}`);
    }

    return text("Failed to summarize episode.");
  } catch (err: any) {
    return text(`Episode summary failed: ${err.message}`);
  }
}
