// src/agent/autonomous/checkpoint.ts
import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import type { ExecutionState } from "./executionState.js";

export interface ExecutionCheckpoint {
  goalId: string;
  goal: string;
  stepNum: number;
  state: ExecutionState;
  timestamp: number;
}

export class CheckpointManager {
  private dir: string;

  constructor(dir = path.join(CAKE_DIR, 'checkpoints')) {
    this.dir = dir;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Checkpoints are best-effort; autonomous execution should still work.
    }
  }

  save(checkpoint: ExecutionCheckpoint): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, `${checkpoint.goalId}.json`);
      fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2));
    } catch {
      // Non-fatal: losing resume data is better than failing the user goal.
    }
  }

  load(goalId: string): ExecutionCheckpoint | null {
    const file = path.join(this.dir, `${goalId}.json`);
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }
  }

  cleanup(goalId: string): void {
    const file = path.join(this.dir, `${goalId}.json`);
    try { fs.unlinkSync(file); } catch {}
  }
}
