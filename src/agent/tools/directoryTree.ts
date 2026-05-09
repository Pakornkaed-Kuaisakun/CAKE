import type { Tool } from "../types.js";

import { createDirectoryTree } from "../../modules/files/operations.js";

export const directoryTreeTool: Tool = async (ctx) => {
  const dir = String(ctx.args?.path ?? ".");
  const tree = createDirectoryTree(dir);

  return {
    success: true,
    output: tree,
    type: "text",
  };
};
