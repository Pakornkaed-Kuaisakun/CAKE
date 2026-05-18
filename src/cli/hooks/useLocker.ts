// src/cli/hooks/useLocker.ts
//
// Manages the multi-step interactive flow for the locker:
//   1. User types a locker command
//   2. Handler returns NEEDS_VALUE  → show masked text input for the secret value
//   3. Handler returns NEEDS_PASSWORD → show masked text input for the password
//   4. Re-run the original command with __value__:<val> __password__:<pw> injected
//
// The masking is done with a simple asterisk replacement in the TextEditor
// (we render "•" per character).  We control this via a React state flag.

import { useState, useCallback, useRef } from "react";
import {
  NEEDS_PASSWORD,
  NEEDS_NEW_PASSWORD,
  NEEDS_VALUE,
  PASSWORD_MARKER,
} from "../../agent/handlers/locker.js";

export type LockerStep = "idle" | "needs_value" | "needs_password";

export interface LockerState {
  step: LockerStep;
  /** Human-readable prompt shown to user */
  prompt: string;
  /** The original locker command (rebuilt incrementally) */
  pendingCommand: string;
  /** Collected secret value (held in memory only) */
  pendingValue: string;
}

const INITIAL: LockerState = {
  step: "idle",
  prompt: "",
  pendingCommand: "",
  pendingValue: "",
};

export interface UseLockerReturn {
  lockerState: LockerState;
  /** Call with the raw handler output text after every agent.run() */
  detectLockerSignal(resultText: string, originalCommand: string): string | null;
  /** Call in handleSubmit: if true, the input was consumed as a locker step */
  interceptLockerInput(
    value: string,
    handleSubmit: (cmd: string) => void,
    onCancel?: () => void,
  ): boolean;
  /** True when input should be masked (value or password step) */
  shouldMask: boolean;
  /** Cancels the locker flow and resets state to idle */
  cancelLockerFlow(): void;
}

export function useLocker(): UseLockerReturn {
  const [lockerState, setLockerState] = useState<LockerState>(INITIAL);

  // Detect signals from the handler result
  const detectLockerSignal = useCallback(
    (resultText: string, originalCommand: string): string | null => {
      const trimmed = resultText.trim();

      // NEEDS_VALUE:<label>[:<category>] or NEEDS_VALUE:update:<id>:<label>
      if (trimmed.startsWith(NEEDS_VALUE + ":")) {
        const prompt = `Enter the secret value to store (input will be hidden):`;
        setLockerState({
          step: "needs_value",
          prompt,
          pendingCommand: originalCommand,
          pendingValue: "",
        });
        return prompt;
      }

      // NEEDS_PASSWORD:<context> — password collection step
      if (
        trimmed.startsWith(NEEDS_PASSWORD + ":") ||
        trimmed.startsWith(NEEDS_NEW_PASSWORD + ":")
      ) {
        const isEncrypt =
          trimmed.includes(":add") ||
          trimmed.includes(":update") ||
          lockerState.step === "needs_value";
        const prompt = `Enter password to ${isEncrypt ? "encrypt" : "decrypt"} this secret:`;
        setLockerState({
          step: "needs_password",
          prompt,
          pendingCommand: originalCommand,
          pendingValue: lockerState.pendingValue,
        });
        return prompt;
      }

      // No signal — reset if we were in a locker flow
      if (lockerState.step !== "idle") {
        setLockerState(INITIAL);
      }
      return null;
    },
    [lockerState.step, lockerState.pendingValue],
  );

  // Intercept user input when we're in a locker flow
  const interceptLockerInput = useCallback(
    (
      value: string,
      handleSubmit: (cmd: string) => void,
      onCancel?: () => void,
    ): boolean => {
      if (lockerState.step === "idle") return false;

      const trimmed = value.trim();
      const lower = trimmed.toLowerCase();
      if (
        lower === "cancel" ||
        lower === "/cancel" ||
        lower === "cancle" ||
        lower === "/cancle" ||
        lower === "exit"
      ) {
        setLockerState(INITIAL);
        if (onCancel) onCancel();
        return true;
      }

      if (value.includes(PASSWORD_MARKER)) return false;
      if (!trimmed) return true; // suppress empty submit during flow

      if (lockerState.step === "needs_value") {
        // Store the value, advance to password collection
        setLockerState((prev) => ({
          ...prev,
          step: "needs_password",
          pendingValue: trimmed,
          prompt: "Enter password to encrypt this secret:",
        }));
        return true;
      }

      if (lockerState.step === "needs_password") {
        // We have everything — rebuild and submit the full command
        const password = trimmed;
        const cmd = lockerState.pendingCommand;
        const hasValue = lockerState.pendingValue;

        let fullCmd: string;
        if (hasValue) {
          // locker_add / locker_update: inject value + password
          fullCmd = `${cmd} __value__:${lockerState.pendingValue} ${PASSWORD_MARKER}${password}`;
        } else {
          // locker_get: inject only password
          fullCmd = `${cmd} ${PASSWORD_MARKER}${password}`;
        }

        setLockerState(INITIAL);
        handleSubmit(fullCmd);
        return true;
      }

      return false;
    },
    [lockerState],
  );

  const cancelLockerFlow = useCallback(() => {
    setLockerState(INITIAL);
  }, []);

  const shouldMask =
    lockerState.step === "needs_password" ||
    lockerState.step === "needs_value";

  return {
    lockerState,
    detectLockerSignal,
    interceptLockerInput,
    shouldMask,
    cancelLockerFlow,
  };
}
