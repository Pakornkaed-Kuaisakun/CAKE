// src/cli/hooks/useMcpTools.ts
import { useState, useEffect } from "react";
import { getMCPManager } from "../../modules/mcp/manager.js";

export interface McpToolHint {
  name: string;
  description: string;
  server: string;
}

export function useMcpTools(): McpToolHint[] {
  const [tools, setTools] = useState<McpToolHint[]>([]);

  useEffect(() => {
    const fetchTools = () => {
      try {
        const manager = getMCPManager();
        const all = manager.getAllTools();
        return all.map((t) => ({
          name: t.tool.name,
          description: t.tool.description ?? "",
          server: t.server,
        }));
      } catch {
        return [];
      }
    };

    setTools(fetchTools());

    // Refresh every 3 s to pick up tools from newly connected servers
    const id = setInterval(() => {
      setTools(fetchTools());
    }, 3_000);
    return () => clearInterval(id);
  }, []);

  return tools;
}
