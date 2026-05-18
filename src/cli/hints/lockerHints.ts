// src/cli/hooks/useLockerHints.ts
//
// React hook that returns live LockerListResult[] for the locker autocomplete.
// Polls every 2 seconds while a locker command is active.

import { useState, useEffect } from "react";
import { lockerList } from "../../modules/locker/index.js";
import type { LockerListResult } from "../../modules/locker/types.js";

export function useLockerHints(active: boolean): LockerListResult[] {
  const [hints, setHints] = useState<LockerListResult[]>(() =>
    active ? lockerList() : [],
  );

  useEffect(() => {
    if (!active) {
      setHints([]);
      return;
    }
    setHints(lockerList());

    const id = setInterval(() => {
      setHints(lockerList());
    }, 2_000);

    return () => clearInterval(id);
  }, [active]);

  return hints;
}
