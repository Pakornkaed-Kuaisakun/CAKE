// src/modules/news/index.ts
export { fetchFeeds } from "./fetch.js";
export { extractTopic } from "./extractTopic.js";
export { summarizeArticle, buildDigest } from "./summarize.js";
export type { RawArticle } from "./fetchHelper/types.js";
export type { NewsItem } from "./summarize.js";
