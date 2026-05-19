import React, { useState, useEffect, useRef } from "react";

import { Box, Text, useInput } from "ink";

// import TextInput from "ink-text-input";
import { TextEditor } from "./TextEditor.js";

import { useAutocomplete } from "../hooks/useAutoComplete.js";

import { CommandPopup } from "./CommandPopup.js";
import { useTheme } from "../theme/useTheme.js";
import { APP_NAME } from "../../config/constants.js";

interface Props {
  value: string;

  onChange: (v: string) => void;

  onSubmit: (v: string) => void;

  loading: boolean;

  masked?: boolean;
  onCancelLocker?: () => void;
  lockerActive?: boolean;
  commandHistory?: string[];
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  loading,
  masked,
  onCancelLocker,
  lockerActive,
  commandHistory = [],
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const tempInputRef = useRef("");

  const rawSuggestions = useAutocomplete(value);
  const suggestions = (masked || historyIndex !== null) ? [] : rawSuggestions;
  const { theme } = useTheme();

  useEffect(() => {
    if (
      historyIndex !== null &&
      commandHistory &&
      value !== commandHistory[historyIndex]
    ) {
      setHistoryIndex(null);
    }
  }, [value, historyIndex, commandHistory]);

  /**
   * Reset selection when input changes
   */

  useEffect(() => {
    setSelectedIndex(0);
  }, [value]);

  /**
   * Keyboard controls
   */

  useInput((input, key) => {
    if (lockerActive && key.escape && onCancelLocker) {
      onCancelLocker();
      onChange("");
      return;
    }

    // ── History Navigation (Up/Down Arrow when suggestions are empty) ───────
    if (!loading && suggestions.length === 0 && commandHistory.length > 0) {
      if (key.upArrow) {
        if (historyIndex === null) {
          tempInputRef.current = value;
          const nextIndex = commandHistory.length - 1;
          setHistoryIndex(nextIndex);
          onChange(commandHistory[nextIndex]);
        } else if (historyIndex > 0) {
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          onChange(commandHistory[nextIndex]);
        }
        return;
      }

      if (key.downArrow) {
        if (historyIndex !== null) {
          const nextIndex = historyIndex + 1;
          if (nextIndex < commandHistory.length) {
            setHistoryIndex(nextIndex);
            onChange(commandHistory[nextIndex]);
          } else {
            setHistoryIndex(null);
            onChange(tempInputRef.current);
            tempInputRef.current = "";
          }
        }
        return;
      }
    }

    if (loading || suggestions.length === 0) {
      return;
    }

    /**
     * DOWN
     */

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev + 1 >= suggestions.length ? 0 : prev + 1,
      );
    }

    /**
     * UP
     */

    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev - 1 < 0 ? suggestions.length - 1 : prev - 1,
      );
    }

    /**
     * TAB autocomplete
     */

    if (key.tab) {
      const selected = suggestions[selectedIndex];

      if (selected) {
        onChange(selected.fullCommand);
      }
    }

    /**
     * RIGHT arrow autocomplete
     */

    if (key.rightArrow) {
      const selected = suggestions[selectedIndex];

      if (selected) {
        onChange(selected.fullCommand);
      }
    }
  });

  return (
    <Box
      flexDirection='column'
      borderStyle='single'
      borderColor={
        loading
          ? process.env.CAKE_DEBUG === "true"
            ? "red"
            : theme.muted
          : process.env.CAKE_DEBUG === "true"
            ? "red"
            : theme.border
      }
      paddingX={1}
    >
      <CommandPopup suggestions={suggestions} selectedIndex={selectedIndex} />
      <Box>
        <TextEditor
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={
            loading
              ? `Waiting... ${process.env.CAKE_DEBUG === "true" ? "[DEBUG_MODE]" : ""}`
              : `Ask ${APP_NAME} anything... ${process.env.CAKE_DEBUG === "true" ? "[DEBUG_MODE]" : ""}`
          }
          masked={masked}
        />
      </Box>
    </Box>
  );
}
