import type { AIProvider, ChatResult } from "../../providers/types.js";
import { diagnoseSystem, diagnosePerformance } from "../../modules/system/index.js";

export async function handleDiagnoseSystem(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const results = await diagnoseSystem();
    const text = results
      .map((r) => {
        const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
        return `${icon} [${r.category}] ${r.message}`;
      })
      .join("\n");

    return { text: `> System Diagnosis\n\n` + text };
  } catch (err: any) {
    return { text: `Failed to diagnose system.\n\n` + err.message };
  }
}

export async function handleDiagnosePerformance(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  try {
    const results = await diagnosePerformance();
    const text = results
      .map((r) => {
        const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
        return `${icon} [${r.category}] ${r.message}`;
      })
      .join("\n");

    return { text: `Performance Diagnosis\n\n` + text };
  } catch (err: any) {
    return { text: `Failed to diagnose system.` + err.message };
  }
}
