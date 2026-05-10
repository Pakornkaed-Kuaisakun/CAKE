// src/cli/components/InputBar.tsx

import React, { useState, useEffect } from "react";

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
}

export function InputBar({ value, onChange, onSubmit, loading }: Props) {
  const suggestions = useAutocomplete(value);
  const { theme } = useTheme();

  const [selectedIndex, setSelectedIndex] = useState(0);

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
      borderColor={loading ? theme.muted : theme.border}
      paddingX={1}
    >
      <CommandPopup suggestions={suggestions} selectedIndex={selectedIndex} />
      <Box>
        <TextEditor
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={loading ? "Waiting..." : `Ask ${APP_NAME} anything...`}
        />
      </Box>
    </Box>
  );
}
