import cron from "node-cron";
import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";

export interface ScheduledJob {
  id: string;
  name: string;
  cronExpression: string; // e.g., "0 8 * * *"
  taskDescription: string; // e.g., "Summarize my emails"
  enabled: boolean;
  lastRun?: string;
}

const JOBS_FILE = path.join(CAKE_DIR, "cron-jobs.json");

export class CronManager {
  private jobs: ScheduledJob[] = [];
  private runningJobs: Map<string, cron.ScheduledTask> = new Map();
  private executeCallback: (job: ScheduledJob) => Promise<void>;

  constructor(executeCallback: (job: ScheduledJob) => Promise<void>) {
    this.executeCallback = executeCallback;
    this.load();
  }

  private load() {
    if (fs.existsSync(JOBS_FILE)) {
      try {
        this.jobs = JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8"));
      } catch (err) {
        console.error("Failed to load cron jobs:", err);
        this.jobs = [];
      }
    }
  }

  private save() {
    if (!fs.existsSync(CAKE_DIR)) fs.mkdirSync(CAKE_DIR, { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify(this.jobs, null, 2));
  }

  /**
   * Start all enabled jobs
   */
  startAll() {
    for (const job of this.jobs) {
      if (job.enabled) {
        this.schedule(job);
      }
    }
  }

  private schedule(job: ScheduledJob) {
    // Stop if already running
    if (this.runningJobs.has(job.id)) {
      this.runningJobs.get(job.id)?.stop();
    }

    const task = cron.schedule(job.cronExpression, async () => {
      console.log(`[CRON] Executing job: ${job.name}`);
      await this.executeCallback(job);
      job.lastRun = new Date().toISOString();
      this.save();
    });

    this.runningJobs.set(job.id, task);
  }

  async addJob(name: string, expression: string, taskDescription: string) {
    const job: ScheduledJob = {
      id: Date.now().toString(),
      name,
      cronExpression: expression,
      taskDescription,
      enabled: true
    };
    this.jobs.push(job);
    this.save();
    this.schedule(job);
    return job;
  }

  listJobs() {
    return this.jobs;
  }

  removeJob(id: string) {
    const task = this.runningJobs.get(id);
    if (task) {
      task.stop();
      this.runningJobs.delete(id);
    }
    this.jobs = this.jobs.filter(j => j.id !== id);
    this.save();
  }
}
