import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CAKE_DIR } from "../../config/constants.js";

export interface Episode {
  id: string;
  title: string;
  start: number;
  end?: number;
  summary?: string;
  metadata?: Record<string, any>;
}

export interface Decision {
  id: string;
  text: string;
  rationale?: string;
  timestamp: number;
  episodeId?: string;
  metadata?: Record<string, any>;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class EpisodeStore {
  private filePath: string;
  private episodes: Episode[] = [];
  private messagesDir: string;

  constructor(storageDir = path.join(CAKE_DIR, "memory")) {
    ensureDir(storageDir);
    this.filePath = path.join(storageDir, "episodes.json");
    this.messagesDir = path.join(storageDir, "episodes");
    ensureDir(this.messagesDir);
    this.load();
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        this.episodes = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      } catch (err) {
        this.episodes = [];
      }
    }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.episodes, null, 2));
  }

  startEpisode(title: string, metadata: Record<string, any> = {}): Episode {
    const e: Episode = {
      id: crypto.randomUUID(),
      title,
      start: Date.now(),
      metadata,
    };
    this.episodes.push(e);
    this.save();
    return e;
  }

  endEpisode(id: string, summary?: string): Episode | null {
    const ep = this.episodes.find((x) => x.id === id);
    if (!ep) return null;
    ep.end = Date.now();
    if (summary) ep.summary = summary;
    this.save();
    return ep;
  }

  listEpisodes(): Episode[] {
    return [...this.episodes].sort((a, b) => b.start - a.start);
  }

  getEpisode(id: string): Episode | null {
    return this.episodes.find((x) => x.id === id) ?? null;
  }

  getActiveEpisode(): Episode | null {
    return this.episodes.find((e) => !e.end) ?? null;
  }

  private messagesPath(id: string) {
    return path.join(this.messagesDir, `${id}.json`);
  }

  appendMessage(id: string, message: { role: string; content: string; displayContent?: string; timestamp?: number }) {
    const p = this.messagesPath(id);
    let arr: any[] = [];
    if (fs.existsSync(p)) {
      try { arr = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { arr = []; }
    }
    arr.push({ ...message, timestamp: message.timestamp ?? Date.now() });
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  }

  readMessages(id: string): any[] {
    const p = this.messagesPath(id);
    if (!fs.existsSync(p)) return [];
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
  }
}

export class DecisionStore {
  private filePath: string;
  private decisions: Decision[] = [];

  constructor(storageDir = path.join(CAKE_DIR, "memory")) {
    ensureDir(storageDir);
    this.filePath = path.join(storageDir, "decisions.json");
    this.load();
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        this.decisions = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      } catch (err) {
        this.decisions = [];
      }
    }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.decisions, null, 2));
  }

  addDecision(text: string, rationale?: string, episodeId?: string, metadata: Record<string, any> = {}): Decision {
    const d: Decision = {
      id: crypto.randomUUID(),
      text,
      rationale,
      timestamp: Date.now(),
      episodeId,
      metadata,
    };
    this.decisions.push(d);
    this.save();
    return d;
  }

  listDecisions(limit = 50): Decision[] {
    return [...this.decisions].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  listForEpisode(episodeId: string): Decision[] {
    return this.decisions.filter((d) => d.episodeId === episodeId).sort((a,b)=>b.timestamp-a.timestamp);
  }
}

export default EpisodeStore;
