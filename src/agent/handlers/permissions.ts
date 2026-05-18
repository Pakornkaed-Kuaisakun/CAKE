// src/agent/handlers/permissions.ts
//
// Handler for the /permissions slash command.
//
// Usage:
//   /permissions                          — show current permission table
//   /permissions <category> <level>       — set a specific permission
//   /permissions reset                    — reset all to defaults
//
// Categories : bash | file_write | file_delete | file_edit | export
// Levels     : deny | ask | allow

import type { AIProvider, ChatResult } from "../../providers/types.js";
import {
  loadPermissions,
  savePermissions,
  setPermission,
  formatPermissionsTable,
  permissionsFilePath,
  CATEGORY_LABELS,
  LEVEL_ICONS,
  type OperationCategory,
  type PermissionLevel,
} from "../permissions/index.js";
import { text } from "../utils/text.js";

const VALID_CATEGORIES = new Set<OperationCategory>([
  "bash",
  "file_write",
  "file_delete",
  "file_edit",
  "export",
]);

const VALID_LEVELS = new Set<PermissionLevel>(["deny", "ask", "allow"]);

const DEFAULTS: Record<OperationCategory, PermissionLevel> = {
  bash: "ask",
  file_write: "ask",
  file_delete: "ask",
  file_edit: "ask",
  export: "allow",
  finance: "ask",
};

export async function handlePermissionsCommand(
  _provider: AIProvider,
  args: string[],
  _model?: string,
): Promise<ChatResult> {
  // /permissions  (no args) → show table
  if (args.length === 0) {
    return showTable();
  }

  const sub = args[0].toLowerCase();

  // /permissions reset
  if (sub === "reset") {
    savePermissions({ ...DEFAULTS });
    return text(
      [
        `✅ All permissions reset to defaults.`,
        ``,
        formatPermissionsTable(loadPermissions()),
      ].join("\n"),
    );
  }

  // /permissions <category> <level>
  const category = sub as OperationCategory;
  const level = args[1]?.toLowerCase() as PermissionLevel | undefined;

  if (!VALID_CATEGORIES.has(category)) {
    return text(
      [
        `Unknown category: "${category}"`,
        `Valid categories: ${[...VALID_CATEGORIES].join(", ")}`,
        ``,
        `Usage: /permissions <category> <level>`,
        `       /permissions reset`,
      ].join("\n"),
    );
  }

  if (!level || !VALID_LEVELS.has(level)) {
    // Show current level for that category
    const current = loadPermissions()[category];
    return text(
      [
        `${CATEGORY_LABELS[category]}: ${LEVEL_ICONS[current]} ${current.toUpperCase()}`,
        ``,
        `Set with: /permissions ${category} deny | ask | allow`,
      ].join("\n"),
    );
  }

  setPermission(category, level);
  return text(
    [
      `✅ ${CATEGORY_LABELS[category]} → ${LEVEL_ICONS[level]} ${level.toUpperCase()}`,
      `Stored in: ${permissionsFilePath()}`,
    ].join("\n"),
  );
}

function showTable(): ChatResult {
  const perms = loadPermissions();
  return text(
    [
      `🔐 CAKE Permission Levels`,
      `File: ${permissionsFilePath()}`,
      ``,
      formatPermissionsTable(perms),
      ``,
      `Levels:`,
      `  ${LEVEL_ICONS.allow} allow  — always permitted silently`,
      `  ${LEVEL_ICONS.ask}  ask    — prompt before each operation`,
      `  ${LEVEL_ICONS.deny} deny   — always blocked`,
      ``,
      `Usage: /permissions <category> <level>`,
      `       /permissions bash deny`,
      `       /permissions file_delete ask`,
      `       /permissions reset`,
    ].join("\n"),
  );
}
