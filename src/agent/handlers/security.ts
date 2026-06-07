import { AIProvider, ChatResult } from "../../providers/types.js";
import { scanDirectory } from "../../modules/security/index.js";
import { formatChatResult } from "../../shared/utils/utils.js";

export async function handleSecurityScan(
  _provider: AIProvider,
  input: string,
  _model?: string,
): Promise<ChatResult> {
  const match = input.match(
    /(?:scan|security\s+scan)(?:\s+(?:for|in))?\s*(.+)?/i,
  );
  const dir = match?.[1]?.trim() || ".";

  const results = await scanDirectory(dir);

  if (results.length === 0) {
    return formatChatResult(
      `[SECURITY] Scan complete. No threats found in "${dir}".`,
    );
  }

  const report = results
    .map((r) => {
      const findings = r.findings
        .map((f: any) => `  - [${f.severity.toUpperCase()}] ${f.message}`)
        .join("\n");
      return `File: ${r.file}\n${findings}`;
    })
    .join("\n\n");

  return formatChatResult(
    `[SECURITY] Scan complete. Found ${results.length} suspicious files in "${dir}":\n\n${report}`,
  );
}
