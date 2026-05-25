// src/cli/theme/theme.ts
//
// Claude Code-inspired themes.
// "cake" (default) mirrors Claude Code's warm dark palette:
//   - Deep black/near-black background
//   - Warm tomato-orange (#e85d4a) as primary accent
//   - Monochrome text with subtle muted tones

import type { Theme } from "./types.js";

export const THEMES: Record<string, Theme> = {
  // ── cake: Claude Code-style warm dark (DEFAULT) ───────────────────────────
  // Deep black bg, tomato-red/orange accents, cream text — mirrors the
  // strawberry cake pixel art's color language
  cake: {
    name: "cake",
    primary: "#e85d4a", // Tomato red (accent — borders, highlights, logo)
    secondary: "#f4a7b9", // Soft pink (secondary actions, cake cream layer)
    border: "#e85d4a", // Warm red borders
    text: "#f0ede8", // Warm off-white (main text)
    muted: "#6b6560", // Warm gray (hints, secondary info)
    danger: "#ff4444", // Bright red (errors)
    success: "#7ec77e", // Muted green
    warning: "#f5a623", // Amber
    info: "#7ab8d4", // Muted blue
    background: "#0c0a09", // Near black with warm undertone
    foreground: "#f0ede8",
    parameter: "#f4a7b9", // Pink for placeholders
  },

  // ── dark: Original emerald dark ───────────────────────────────────────────
  dark: {
    name: "dark",
    primary: "#10b981",
    secondary: "#06b6d4",
    border: "#059669",
    text: "#f8fafc",
    muted: "#64748b",
    danger: "#f43f5e",
    success: "#10b981",
    warning: "#f59e0b",
    info: "#3b82f6",
    background: "#0f172a",
    foreground: "#f8fafc",
    parameter: "#f472b6",
  },

  // ── light ─────────────────────────────────────────────────────────────────
  light: {
    name: "light",
    primary: "#2563eb",
    secondary: "#0891b2",
    border: "#3b82f6",
    text: "#ffffff",
    muted: "#94a3b8",
    danger: "#e11d48",
    success: "#16a34a",
    warning: "#d97706",
    info: "#2563eb",
    background: "#ffffff",
    foreground: "#0f172a",
    parameter: "#db2777",
  },

  // ── neon ──────────────────────────────────────────────────────────────────
  neon: {
    name: "neon",
    primary: "#ff00ff",
    secondary: "#00ffff",
    border: "#d946ef",
    text: "#ffffff",
    muted: "#a855f7",
    danger: "#ff0000",
    success: "#4ade80",
    warning: "#fbbf24",
    info: "#38bdf8",
    background: "#000000",
    foreground: "#ffffff",
    parameter: "#facc15",
  },

  // ── dracula ───────────────────────────────────────────────────────────────
  dracula: {
    name: "dracula",
    primary: "#bd93f9",
    secondary: "#8be9fd",
    border: "#6272a4",
    text: "#f8f8f2",
    muted: "#44475a",
    danger: "#ff5555",
    success: "#50fa7b",
    warning: "#ffb86c",
    info: "#8be9fd",
    background: "#282a36",
    foreground: "#f8f8f2",
    parameter: "#f1fa8c",
  },
};
