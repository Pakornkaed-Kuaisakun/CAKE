// src/cli/hooks/useMcpResources.ts
import { useState, useEffect } from "react";
import { getMCPManager } from "../../modules/mcp/manager.js";

export interface McpResourceHint {
  uri: string;
  name: string;
  server: string;
}

export function useMcpResources(): McpResourceHint[] {
  const [resources, setResources] = useState<McpResourceHint[]>([]);

  useEffect(() => {
    const fetchResources = () => {
      try {
        const manager = getMCPManager();
        const all = manager.getAllResources();
        return all.map((r) => ({
          uri: r.resource.uri,
          name: r.resource.name,
          server: r.server,
        }));
      } catch {
        return [];
      }
    };

    setResources(fetchResources());

    // Refresh every 3 s to pick up resources from newly connected servers
    const id = setInterval(() => {
      setResources(fetchResources());
    }, 3_000);
    return () => clearInterval(id);
  }, []);

  return resources;
}
