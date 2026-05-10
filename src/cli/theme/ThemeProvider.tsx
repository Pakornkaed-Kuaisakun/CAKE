import React, { createContext, useContext, useMemo, useState } from "react";

import { THEMES } from "./theme.js";
import type { Theme } from "./types.js";
import { loadPrefs, savePrefs } from "../../config/preferences.js";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState(() => loadPrefs().theme || "dark");

  function setTheme(name: string) {
    if (THEMES[name]) {
      setCurrent(name);
      savePrefs({ theme: name });
    }
  }

  const value = useMemo(
    () => ({
      theme: THEMES[current],
      setTheme,
    }),
    [current],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return ctx;
}
