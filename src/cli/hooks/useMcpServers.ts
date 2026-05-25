// src/cli/hooks/useMcpServers.ts
import { useState, useEffect } from "react";
import { listServers } from "../../modules/mcp/registry.js";

export function useMcpServers(): string[] {
  const [servers, setServers] = useState<string[]>(() =>
    listServers().map((s) => s.name),
  );

  useEffect(() => {
    // Refresh every 3 s to pick up newly added/removed servers
    const id = setInterval(() => {
      setServers(listServers().map((s) => s.name));
    }, 3_000);
    return () => clearInterval(id);
  }, []);

  return servers;
}
