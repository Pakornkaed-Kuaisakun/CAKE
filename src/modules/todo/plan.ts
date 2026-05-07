import type { AIProvider } from "../../providers/types.js";
import { add, type TodoItem } from "./store.js";

interface PlannedTask {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  dueDate?: string;
}

export async function generatePlan(
  provider: AIProvider,
  goal: string,
  model?: string,
): Promise<TodoItem[]> {
  const prompt: string = `Break down this goal into 5-8 actionable tasks. Return ONLY a JSON array where each object has: title, description, priority (low|medium|high), dueDate (ISO string, optional). Goal: ${goal}`;

  const result = await provider.chat([{ role: "user", content: prompt }], { model });
  const clean = result.text.replace(/```json|```/g, "").trim();

  let tasks: PlannedTask[] = [];
  try {
    tasks = JSON.parse(clean);
  } catch {
    throw new Error(
      "AI returned an unparseable plan. Try rephrasing your goal.",
    );
  }

  return tasks.map((t) =>
    add(t.title, {
      description: t.description,
      priority: t.priority,
      dueDate: t.dueDate,
    }),
  );
}
