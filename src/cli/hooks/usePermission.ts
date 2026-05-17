// src/cli/hooks/usePermission.ts
//
// Wires the permission "ask" callbacks for bash, file, and export handlers
// into the Ink UI. When a guarded operation fires, it:
//   1. Appends a system message asking the user y/n
//   2. Waits for the user to type "y" or "n" (intercepted before normal submit)
//   3. Resolves the pending promise and resumes the operation
//
// Usage in useAgent.ts:
//   const { wirePermissions, interceptPermission } = usePermission(addMsg);
//   wirePermissions();   // call once at startup
//   // In handleSubmit, before routing: if (interceptPermission(value)) return;

import { useCallback, useRef } from "react";
import { setBashAskHandler } from "../../agent/handlers/bash.js";
import { setFileAskHandler } from "../../agent/handlers/file.js";
import { setExportAskHandler } from "../../agent/handlers/export.js";
import type {
  PermissionRequest,
  PermissionDecision,
} from "../../agent/permissions/index.js";

type AddMsg = (role: "user" | "assistant" | "system", content: string) => void;

export interface UsePermissionReturn {
  /** Call once at startup to wire ask handlers into all guarded handlers */
  wirePermissions(): void;
  /**
   * Call at the top of handleSubmit with the raw input value.
   * Returns true if the input was consumed as a permission answer
   * (caller should return early and not process it as a normal message).
   */
  interceptPermission(value: string): boolean;
}

export function usePermission(addMsg: AddMsg): UsePermissionReturn {
  // Pending ask: resolve fn waiting for user's y/n
  const pendingRef = useRef<((d: PermissionDecision) => void) | null>(null);

  const makeAskHandler = useCallback(
    (req: PermissionRequest): Promise<PermissionDecision> => {
      return new Promise<PermissionDecision>((resolve) => {
        pendingRef.current = resolve;

        addMsg(
          "system",
          [
            `⚠️  Permission required`,
            `   Operation : ${req.description}`,
            `   Detail    : ${req.detail}`,
            ``,
            `   Type  y  to allow  |  n  to deny`,
          ].join("\n"),
        );
      });
    },
    [addMsg],
  );

  const wirePermissions = useCallback(() => {
    setBashAskHandler(makeAskHandler);
    setFileAskHandler(makeAskHandler);
    setExportAskHandler(makeAskHandler);
  }, [makeAskHandler]);

  const interceptPermission = useCallback(
    (value: string): boolean => {
      if (!pendingRef.current) return false;

      const lower = value.trim().toLowerCase();
      if (lower !== "y" && lower !== "n" && lower !== "yes" && lower !== "no") {
        return false; // not a permission answer — pass through normally
      }

      const decision: PermissionDecision =
        lower === "y" || lower === "yes" ? "allow" : "deny";

      const resolve = pendingRef.current;
      pendingRef.current = null;

      addMsg(
        "system",
        decision === "allow"
          ? "✅ Allowed — proceeding."
          : "🚫 Denied — operation cancelled.",
      );

      resolve(decision);
      return true; // consumed
    },
    [addMsg],
  );

  return { wirePermissions, interceptPermission };
}
