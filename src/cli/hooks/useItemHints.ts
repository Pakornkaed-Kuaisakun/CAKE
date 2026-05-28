// src/cli/hooks/useItemHints.ts
//
// React hook that returns live ItemHint[] for whichever "remove <id>" command
// the user is currently typing.  A single hook instance covers all three:
//
//   todo_remove     → reads ~/.cake/todos.json
//   cron_remove     → reads ~/.cake/cron-jobs.json
//   calendar_remove → reads ~/.cake/cache/calendar-events.json
//
// Usage:
//   const hints = useItemHints(activeCommand);
//   // activeCommand = "todo_remove" | "cron_remove" | "calendar_remove" | ""
//
// Polls every 2 s while a command is active so mid-session adds/deletes
// are reflected without restarting.

import { useState, useEffect } from "react";
import {
  readTodoHints,
  readCronHints,
  readCalendarHints,
  readAsyncHints,
  readAsyncPendingHints,
  readTqHints,
  readTqPendingHints,
  type ItemHint,
} from "../hints/itemHintReaders.js";

// Commands that have a live <id> completion slot
export type RemoveCommand =
  | "todo_remove"
  | "cron_remove"
  | "calendar_remove"
  | "async_status"
  | "async_cancel"
  | "tq_status"
  | "tq_cancel"
  | "tq_pause"
  | "tq_resume"
  | "tq_retry"
  | "tq_priority"
  | "";

function read(cmd: RemoveCommand): ItemHint[] {
  switch (cmd) {
    case "todo_remove":
      return readTodoHints();
    case "cron_remove":
      return readCronHints();
    case "calendar_remove":
      return readCalendarHints();
    case "async_status":
      return readAsyncHints();
    case "async_cancel":
      return readAsyncPendingHints();
    case "tq_status":
      return readTqHints();
    case "tq_cancel":
    case "tq_pause":
    case "tq_resume":
    case "tq_retry":
    case "tq_priority":
      return readTqPendingHints();
    default:
      return [];
  }
}

export function useItemHints(activeCommand: RemoveCommand): ItemHint[] {
  const [hints, setHints] = useState<ItemHint[]>(() => read(activeCommand));

  useEffect(() => {
    setHints(read(activeCommand));
    if (!activeCommand) return;

    const id = setInterval(() => setHints(read(activeCommand)), 2_000);
    return () => clearInterval(id);
  }, [activeCommand]);

  return hints;
}
