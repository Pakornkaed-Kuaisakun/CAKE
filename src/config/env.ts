// Single place for all environment variable access.
// Import from here — never from process.env directly.

import "dotenv/config";

function get(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const env = {
  // AI providers
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  openaiApiKey: optional("OPENAI_API_KEY"),
  geminiApiKey: optional("GEMINI_API_KEY"),
  ollamaBaseUrl: optional("OLLAMA_BASE_URL", "http://localhost:11434"),

  // Defaults
  defaultProvider: optional("DEFAULT_PROVIDER", "claude"),
  defaultModel: optional("DEFAULT_MODEL"),

  // Discord
  discordToken: optional("DISCORD_TOKEN"),
  discordClientId: optional("DISCORD_CLIENT_ID"),
  discordGuildId: optional("DISCORD_GUILD_ID"),

  // Email
  emailHost: optional("EMAIL_HOST", "imap.gmail.com"),
  emailPort: optionalInt("EMAIL_PORT", 993),
  emailUser: optional("EMAIL_USER"),
  emailPass: optional("EMAIL_PASS"),

  // Google OAuth
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  // googleRedirectUri: optional(
  //   "GOOGLE_REDIRECT_URI",
  //   "http://localhost:3000/oauth2callback",
  // ),

  // News feeds (comma-separated URLs)
  newsFeeds: optional(
    "NEWS_FEEDS",
    "https://feeds.bbci.co.uk/news/rss.xml,https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
