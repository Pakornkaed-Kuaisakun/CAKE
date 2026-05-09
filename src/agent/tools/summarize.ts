import type { Tool } from "../types.js";

export const summarizeTool: Tool = async (ctx) => {
  const text = String(ctx.input ?? "");
  const summary = text.split("\n").slice(0, 10).join("\n");

  return {
    success: true,
    output: summary,
    type: "text",
  };
};
