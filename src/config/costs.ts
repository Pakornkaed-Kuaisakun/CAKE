// src/config/costs.ts
// Persistent tracking of AI costs and token usage — now includes cache stats.

import fs from "fs";
import path from "path";
import { CAKE_DIR } from "./constants.js";

export interface CostStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCacheWriteTokens: number;
  totalCostUsd: number;
  lastUpdated: string;
}

const COSTS_FILE = path.join(CAKE_DIR, "costs.json");

const DEFAULTS: CostStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCachedTokens: 0,
  totalCacheWriteTokens: 0,
  totalCostUsd: 0,
  lastUpdated: new Date().toISOString(),
};

export function loadCosts(): CostStats {
  try {
    if (!fs.existsSync(COSTS_FILE)) return { ...DEFAULTS };
    const raw = fs.readFileSync(COSTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CostStats>;
    return {
      totalInputTokens: parsed.totalInputTokens ?? 0,
      totalOutputTokens: parsed.totalOutputTokens ?? 0,
      totalCachedTokens: parsed.totalCachedTokens ?? 0,
      totalCacheWriteTokens: parsed.totalCacheWriteTokens ?? 0,
      totalCostUsd: parsed.totalCostUsd ?? 0,
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function addCost(usage: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number | null;
}): CostStats {
  const current = loadCosts();
  const next: CostStats = {
    totalInputTokens: current.totalInputTokens + usage.inputTokens,
    totalOutputTokens: current.totalOutputTokens + usage.outputTokens,
    totalCachedTokens: current.totalCachedTokens + (usage.cachedTokens ?? 0),
    totalCacheWriteTokens:
      current.totalCacheWriteTokens + (usage.cacheWriteTokens ?? 0),
    totalCostUsd: current.totalCostUsd + (usage.costUsd ?? 0),
    lastUpdated: new Date().toISOString(),
  };

  if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
  fs.writeFileSync(COSTS_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function resetCosts(): void {
  if (fs.existsSync(COSTS_FILE)) {
    fs.writeFileSync(COSTS_FILE, JSON.stringify(DEFAULTS, null, 2), "utf-8");
  }
}

export function costsFilePath(): string {
  return COSTS_FILE;
}
