import type { FeedSource } from "./types.js";

export const FEEDS: FeedSource[] = [
  {
    name: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    category: "world",
    priority: 10,
  },

  {
    name: "Guardian World",
    url: "https://www.theguardian.com/world/rss",
    category: "world",
    priority: 9,
  },

  {
    name: "NYTimes Business",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    category: "economy",
    priority: 10,
  },

  {
    name: "CNBC",
    url: "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    category: "economy",
    priority: 9,
  },

  {
    name: "TechCrunch",
    url: "https://feeds.feedburner.com/TechCrunch/",
    category: "tech",
    priority: 10,
  },

  {
    name: "Hacker News",
    url: "https://hnrss.org/frontpage",
    category: "tech",
    priority: 9,
  },

  {
    name: "Investing Commodities",
    url: "https://www.investing.com/rss/news_95.rss",
    category: "gold",
    priority: 10,
  },

  {
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    category: "war",
    priority: 10,
  },

  //------------------ Crypto ------------------
  {
    name: "CoinTelegraph",
    url: "https://cointelegraph.com/rss",
    category: "crypto",
    priority: 9,
    tags: ["crypto", "bitcoin", "ethereum", "web3", "blockchain", "binance"],
  },
  {
    name: "Decrypt",
    url: "https://decrypt.co/feed",
    category: "crypto",
    priority: 8,
    tags: ["crypto", "bitcoin", "ethereum", "web3"],
  },

  //------------------ AI ------------------
  {
    name: "AI News",
    url: "https://www.artificialintelligence-news.com/feed/",
    category: "ai",
    priority: 10,
    tags: [
      "ai",
      "openai",
      "deeplearning",
      "machinelearning",
      "nvidia",
      "elonmusk",
    ],
  },

  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
    category: "ai",
    priority: 8,
    tags: ["ai", "deeplearning", "nvidia", "google", "meta"],
  },

  //------------------ GENERAL ------------------
  {
    name: "Yahoo News",
    url: "https://news.yahoo.com/rss/",
    category: "general",
    priority: 10,
  },

  {
    name: "Associated Press",
    url: "https://www.apnews.com/rss/APWorld",
    category: "general",
    priority: 9,
  },
];
