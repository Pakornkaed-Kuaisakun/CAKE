import type { Tool } from "../types.js";

import { writeFile } from "../../modules/files/operations.js";

export const exportFileTool: Tool = async (ctx) => {
  const content = String(ctx.input ?? "");
  const output = String(ctx.args?.output ?? `output-${Date.now()}.txt`);
  const file = writeFile(output, content);

  return {
    success: true,
    output: file,
    type: "file",
  };
};
