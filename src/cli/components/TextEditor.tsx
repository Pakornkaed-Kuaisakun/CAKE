// src/cli/components/TextEditor.tsx

import React, { useEffect, useMemo, useState, useRef } from "react";

import { Box, Text, useInput } from "ink";

interface Props {
  value: string;

  onChange: (value: string) => void;

  onSubmit: (value: string) => void;

  placeholder?: string;

  disabled?: boolean;
}

export function TextEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
}: Props) {
  /**
   * Cursor position
   */

  const [cursor, setCursor] = useState(value.length);

  /**
   * Cursor blink
   */

  const [cursorVisible, setCursorVisible] = useState(true);

  /**
   * Selection
   */

  const [selection, setSelection] = useState<{
    start: number;

    end: number;
  } | null>(null);

  /**
   * Undo / redo
   */

  const [undoStack, setUndoStack] = useState<string[]>([]);

  const [redoStack, setRedoStack] = useState<string[]>([]);

  /**
   * Clipboard
   */

  const [clipboard, setClipboard] = useState("");

  /**
   * Blink animation
   */

  useEffect(() => {
    if (disabled) {
      return;
    }

    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 530);

    return () => clearInterval(interval);
  }, [disabled]);

  /**
   * Reset cursor blink when typing
   */

  function resetCursorBlink() {
    setCursorVisible(true);
  }

  /**
   * Sync cursor
   */

  const lastValueRef = useRef(value);

  useEffect(() => {
    if (cursor > value.length) {
      setCursor(value.length);
    }

    // If value changed significantly (e.g. autocomplete) and not via internal updateText
    if (Math.abs(value.length - lastValueRef.current.length) > 1) {
      setCursor(value.length);
    }
    lastValueRef.current = value;
  }, [value, cursor]);

  /**
   * Save history
   */

  function pushUndo(text: string) {
    setUndoStack((prev) => [...prev.slice(-100), text]);
  }

  /**
   * Replace text
   */

  function updateText(next: string, nextCursor?: number) {
    pushUndo(value);

    setRedoStack([]);

    onChange(next);

    if (nextCursor !== undefined) {
      setCursor(nextCursor);
    }

    resetCursorBlink();
  }

  /**
   * Word movement
   */

  function moveWordLeft() {
    const left = value.slice(0, cursor);

    const match = left.match(/\S+\s*$/);

    if (match) {
      setCursor(cursor - match[0].length);
    } else {
      setCursor(0);
    }

    resetCursorBlink();
  }

  function moveWordRight() {
    const right = value.slice(cursor);

    const match = right.match(/^\s*\S+/);

    if (match) {
      setCursor(cursor + match[0].length);
    } else {
      setCursor(value.length);
    }

    resetCursorBlink();
  }

  /**
   * Delete word
   */

  function deleteWordLeft() {
    const left = value.slice(0, cursor);

    const right = value.slice(cursor);

    const nextLeft = left.replace(/\s*\S+$/, "");

    const next = nextLeft + right;

    updateText(next, nextLeft.length);
  }

  /**
   * Select all
   */

  function selectAll() {
    setSelection({
      start: 0,
      end: value.length,
    });

    setCursor(value.length);

    resetCursorBlink();
  }

  /**
   * Undo
   */

  function undo() {
    const prev = undoStack[undoStack.length - 1];

    if (prev == null) {
      return;
    }

    setRedoStack((r) => [...r, value]);

    setUndoStack((u) => u.slice(0, -1));

    onChange(prev);

    setCursor(prev.length);

    resetCursorBlink();
  }

  /**
   * Redo
   */

  function redo() {
    const next = redoStack[redoStack.length - 1];

    if (next == null) {
      return;
    }

    pushUndo(value);

    setRedoStack((r) => r.slice(0, -1));

    onChange(next);

    setCursor(next.length);

    resetCursorBlink();
  }

  /**
   * Clipboard
   */

  function getSelectedText() {
    if (!selection) {
      return "";
    }

    return value.slice(selection.start, selection.end);
  }

  function copySelection() {
    const text = getSelectedText();

    if (text) {
      setClipboard(text);
    }
  }

  function cutSelection() {
    if (!selection) {
      return;
    }

    copySelection();

    const next = value.slice(0, selection.start) + value.slice(selection.end);

    updateText(next, selection.start);

    setSelection(null);
  }

  function pasteClipboard() {
    if (!clipboard) {
      return;
    }

    const next = value.slice(0, cursor) + clipboard + value.slice(cursor);

    updateText(next, cursor + clipboard.length);
  }

  /**
   * Keyboard controls
   */

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    /**
     * ENTER
     */

    if (key.return) {
      onSubmit(value);

      return;
    }

    /**
     * CTRL+A
     */

    if (key.ctrl && input === "a") {
      selectAll();

      return;
    }

    /**
     * CTRL+Z
     */

    if (key.ctrl && input === "z") {
      undo();

      return;
    }

    /**
     * CTRL+Y
     */

    if (key.ctrl && input === "y") {
      redo();

      return;
    }

    /**
     * CTRL+C
     */

    if (key.ctrl && input === "c") {
      copySelection();

      return;
    }

    /**
     * CTRL+X
     */

    if (key.ctrl && input === "x") {
      cutSelection();

      return;
    }

    /**
     * CTRL+V
     */

    if (key.ctrl && input === "v") {
      pasteClipboard();

      return;
    }

    /**
     * LEFT
     */

    if (key.leftArrow) {
      if (key.ctrl) {
        moveWordLeft();
      } else {
        setCursor((c) => Math.max(0, c - 1));

        resetCursorBlink();
      }

      return;
    }

    /**
     * RIGHT
     */

    if (key.rightArrow) {
      if (key.ctrl) {
        moveWordRight();
      } else {
        setCursor((c) => Math.min(value.length, c + 1));

        resetCursorBlink();
      }

      return;
    }

    /**
     * BACKSPACE / DELETE
     */

    if (key.backspace || key.delete) {
      if (selection) {
        const next =
          value.slice(0, selection.start) + value.slice(selection.end);

        updateText(next, selection.start);

        setSelection(null);

        return;
      }

      if (value.length === 0) {
        return;
      }

      if (key.ctrl) {
        deleteWordLeft();

        return;
      }

      if (key.backspace) {
        const next =
          value.slice(0, Math.max(0, cursor - 1)) + value.slice(cursor);

        updateText(next, Math.max(0, cursor - 1));
      } else {
        const next = value.slice(0, cursor) + value.slice(cursor + 1);

        updateText(next, cursor);
      }

      return;
    }

    /**
     * NORMAL INPUT
     */

    if (input && !key.ctrl && !key.meta) {
      let next: string;

      let nextCursor: number;

      if (selection) {
        next =
          value.slice(0, selection.start) + input + value.slice(selection.end);

        nextCursor = selection.start + input.length;

        setSelection(null);
      } else {
        next = value.slice(0, cursor) + input + value.slice(cursor);

        nextCursor = cursor + input.length;
      }

      updateText(next, nextCursor);
    }
  });

  /**
   * Render
   */

  const rendered = useMemo(() => {
    if (value.length === 0) {
      return (
        <>
          <Text inverse={cursorVisible}> </Text>

          {placeholder && <Text color='gray'>{placeholder}</Text>}
        </>
      );
    }

    return (
      <>
        {value.split("").map((char, index) => {
          const isCursor = index === cursor && cursorVisible;

          const isSelected =
            selection && index >= selection.start && index < selection.end;

          return (
            <Text
              key={index}
              inverse={Boolean(isCursor)}
              backgroundColor={isSelected ? "blue" : undefined}
            >
              {char}
            </Text>
          );
        })}

        {cursor === value.length && <Text inverse={cursorVisible}> </Text>}
      </>
    );
  }, [value, cursor, selection, placeholder, cursorVisible]);

  return (
    <Box>
      <Text color='green'>›</Text>

      <Box marginLeft={1}>{rendered}</Box>
    </Box>
  );
}
