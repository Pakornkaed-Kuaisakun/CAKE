export interface ToolContext {
  input?: string;
  args?: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  type: "text" | "file" | "json";
}

export type Tool = (ctx: ToolContext) => Promise<ToolResult>;
