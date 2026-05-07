import type { AIProvider, ChatResult } from "../../providers/types.js";
import { CronManager } from "../../modules/cron/index.js";
import { text } from "../utils/text.js";

import { getFastModel } from "../../providers/utils.js";

// Singleton manager instance - ในระบบจริงควรส่งผ่าน Agent
let manager: CronManager | null = null;


export function initCronManager(executeCallback: (job: any) => Promise<void>) {
  manager = new CronManager(executeCallback);
  manager.startAll();
  return manager;
}

export async function handleScheduleTask(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  if (!manager) return text("Cron system not initialized.");

  // ให้ AI ช่วยตีความเวลาและเนื้อหางาน
  const prompt = `
    Extract scheduling details from this request: "${input}"
    Current Time: ${new Date().toLocaleString()}
    
    Return ONLY a raw JSON object. Do NOT include comments, explanations, or any text outside the JSON.
    {
      "name": "Brief name",
      "cronExpression": "0 8 * * *",
      "task": "command string"
    }
  `;

  const fastModel = model || getFastModel(provider.name);
  const response = await provider.chat([{ role: "user", content: prompt }], { 
    model: fastModel 
  });
  
  try {

    // 1. ลบ Markdown blocks
    let cleaned = response.text.replace(/```json|```/g, "").trim();
    
    // 2. ลบ Single line comments (// ...) ที่ AI ชอบใส่มาใน JSON
    cleaned = cleaned.replace(/\/\/.*$/gm, "");

    const data = JSON.parse(cleaned);


    const job = await manager.addJob(data.name, data.cronExpression, data.task);

    return text(`✅ Scheduled: "${job.name}"\n📅 Cron: ${job.cronExpression}\n📝 Task: ${job.taskDescription}`);
  } catch (err) {
    return text(`Failed to parse schedule request.\nAI Response: ${response.text}`);
  }
}

export async function handleListCron(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  if (!manager) return text("Cron system not initialized.");
  const jobs = manager.listJobs();
  if (jobs.length === 0) return text("No scheduled jobs found.");

  const list = jobs.map(j => `• [${j.id}] ${j.name}\n  Time: ${j.cronExpression}\n  Task: ${j.taskDescription}`).join("\n\n");
  return text(`🕒 Active Cron Jobs:\n\n${list}\n\nTip: Use "remove job <id>" to delete a task.`);
}

export async function handleRemoveCron(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  if (!manager) return text("Cron system not initialized.");

  const match = input.match(/(?:remove|delete|cancel)\s+(?:job|task|cron)\s+(\S+)/i);
  if (!match) return text('Usage: remove job <id>');

  const id = match[1].trim();
  manager.removeJob(id);

  return text(`✅ Job [${id}] has been removed.`);
}

