import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  list as listTodos,
  add as addTodo,
  remove as removeTodo,
  removeAll as removeAllTodos,
  generatePlan,
} from "../../modules/todo/index.js";
import { text } from "../utils/text.js";
import { stripVerb } from "../../shared/utils/utils.js";

export async function handleTodoList(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const todos = listTodos("pending");
  if (todos.length === 0) return text("No pending tasks!");
  const out = todos
    .map(
      (t) =>
        `  • [${t.priority}] ${t.title}${t.dueDate ? ` (due: ${t.dueDate})` : ""}`,
    )
    .join("\n");
  return text(`[TODO] Pending tasks:\n${out}`);
}

export async function handleTodoAdd(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const title = stripVerb(input, [
    "add todo:", "create todo:", "new todo:",
    "add task:", "create task:", "new task:",
    "add todo", "create todo", "new todo",
    "add task", "create task", "new task",
    "todo_add", "todo add"
  ]);
  const todo = addTodo(title);
  return text(`✅ Added: ${todo.title}`);
}

export async function handlePlan(
  provider: AIProvider,
  input: string,
  model?: string,
): Promise<ChatResult> {
  const goal = stripVerb(input, [
    "plan for goal", "planning for goal", "breakdown for goal", "break down for goal",
    "plan for", "planning for", "breakdown for", "break down for",
    "plan goal", "planning goal", "breakdown goal", "break down goal",
    "plan", "planning", "breakdown", "break down"
  ]);
  const todos = await generatePlan(provider, goal, model);
  const list = todos.map((t, i) => `  ${i + 1}. [${t.priority}] ${t.title}`).join("\n");
  return text(`[TODO] Created ${todos.length} tasks for "${goal}":\n${list}`);
}

export async function handleTodoRemove(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const id = stripVerb(input, ["todo_remove", "todo remove", "remove todo", "delete todo", "remove task", "delete task"]);
  if (!id) return text("Please provide a task ID to remove.");
  const success = removeTodo(id);
  return text(success ? `✅ Removed task: ${id}` : `❌ Task not found: ${id}`);
}

export async function handleTodoRemoveAll(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  removeAllTodos();
  return text("✅ All tasks removed.");
}
