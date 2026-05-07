import fs from "fs";
import { TODO_FILE, CAKE_DIR } from "../../config/constants.js";

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  done: boolean;
  priority: "low" | "medium" | "high";
  dueDate?: string;
  createdAt: string;
}

export function loadAll(): TodoItem[] {
  if (!fs.existsSync(TODO_FILE)) return [];
  return JSON.parse(fs.readFileSync(TODO_FILE, "utf-8")) as TodoItem[];
}

function saveAll(todos: TodoItem[]): void {
  fs.mkdirSync(CAKE_DIR, { recursive: true });
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

export function list(filter?: "done" | "pending"): TodoItem[] {
  const all = loadAll();
  if (filter === "done") return all.filter((t) => t.done);
  if (filter === "pending") return all.filter((t) => !t.done);
  return all;
}

export function add(
  title: string,
  opts: Partial<Omit<TodoItem, "id" | "title" | "done" | "createdAt">> = {},
): TodoItem {
  const todos = loadAll();
  const todo: TodoItem = {
    id: Date.now().toString(),
    title,
    done: false,
    priority: opts.priority ?? "medium",
    description: opts.description,
    dueDate: opts.dueDate,
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  saveAll(todos);
  return todo;
}

export function complete(id: string): boolean {
  const todos = loadAll();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return false;
  todo.done = true;
  saveAll(todos);
  return true;
}

export function remove(id: string): boolean {
  const todos = loadAll();
  const idx = todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  todos.splice(idx, 1);
  saveAll(todos);
  return true;
}
