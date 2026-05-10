import type { Theme } from "./types.js";

export const THEMES: Record<string, Theme> = {
  dark: {
    name: "dark",
    primary: "#10b981", // Emerald 500
    secondary: "#06b6d4", // Cyan 500
    border: "#059669", // Emerald 600
    text: "#f8fafc", // Slate 50
    muted: "#64748b", // Slate 500
    danger: "#f43f5e", // Rose 500
    success: "#10b981", // Emerald 500
    warning: "#f59e0b", // Amber 500
    info: "#3b82f6", // Blue 500
    background: "#0f172a", // Slate 900
    foreground: "#f8fafc", // Slate 50
    parameter: "#f472b6", // Pink 400
  },

  light: {
    name: "light",
    primary: "#2563eb", // Blue 600
    secondary: "#0891b2", // Cyan 600
    border: "#3b82f6", // Blue 500
    text: "#ffffff", // Slate 900
    muted: "#94a3b8", // Slate 400
    danger: "#e11d48", // Rose 600
    success: "#16a34a", // Green 600
    warning: "#d97706", // Amber 600
    info: "#2563eb", // Blue 600
    background: "#ffffff", // White
    foreground: "#0f172a", // Slate 900
    parameter: "#db2777", // Pink 600
  },

  neon: {
    name: "neon",
    primary: "#ff00ff", // Magenta
    secondary: "#00ffff", // Cyan
    border: "#d946ef", // Fuchsia 500
    text: "#ffffff", // White
    muted: "#a855f7", // Purple 500
    danger: "#ff0000", // Red
    success: "#4ade80", // Green 400
    warning: "#fbbf24", // Amber 400
    info: "#38bdf8", // Sky 400
    background: "#000000", // Black
    foreground: "#ffffff", // White
    parameter: "#facc15", // Yellow 400
  },

  dracula: {
    name: "dracula",
    primary: "#bd93f9", // Purple
    secondary: "#8be9fd", // Cyan
    border: "#6272a4", // Comment
    text: "#f8f8f2", // Foreground
    muted: "#44475a", // Selection
    danger: "#ff5555", // Red
    success: "#50fa7b", // Green
    warning: "#ffb86c", // Orange
    info: "#8be9fd", // Cyan
    background: "#282a36", // Background
    foreground: "#f8f8f2", // Foreground
    parameter: "#f1fa8c", // Yellow
  },
};
