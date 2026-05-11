// src/config/costs.ts
// Persistent tracking of AI costs and token usage

import fs from "fs";
import path from "path";
import os from "os";
import { CAKE_DIR } from "./constants.js";

export interface CostStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  lastUpdated: string;
}

const COSTS_FILE = path.join(CAKE_DIR, "costs.json");

const DEFAULTS: CostStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  lastUpdated: new Date().toISOString(),
};

/** Load historical costs from disk. */
export function loadCosts(): CostStats {
  try {
    if (!fs.existsSync(COSTS_FILE)) return { ...DEFAULTS };
    const raw = fs.readFileSync(COSTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CostStats>;
    return {
      totalInputTokens: parsed.totalInputTokens ?? DEFAULTS.totalInputTokens,
      totalOutputTokens: parsed.totalOutputTokens ?? DEFAULTS.totalOutputTokens,
      totalCostUsd: parsed.totalCostUsd ?? DEFAULTS.totalCostUsd,
      lastUpdated: parsed.lastUpdated ?? DEFAULTS.lastUpdated,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Update and save historical costs. */
export function addCost(usage: {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}): CostStats {
  const current = loadCosts();
  const next: CostStats = {
    totalInputTokens: current.totalInputTokens + usage.inputTokens,
    totalOutputTokens: current.totalOutputTokens + usage.outputTokens,
    totalCostUsd: current.totalCostUsd + (usage.costUsd ?? 0),
    lastUpdated: new Date().toISOString(),
  };

  if (!fs.existsSync(CAKE_DIR)) {
    fs.mkdirSync(CAKE_DIR, { recursive: true });
  }
  fs.writeFileSync(COSTS_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** Reset all historical costs. */
export function resetCosts(): void {
  if (fs.existsSync(COSTS_FILE)) {
    fs.writeFileSync(COSTS_FILE, JSON.stringify(DEFAULTS, null, 2), "utf-8");
  }
}

/** Return the path of the costs file. */
export function costsFilePath(): string {
  return COSTS_FILE;
}
