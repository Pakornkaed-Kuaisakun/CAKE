export type FeedSource = {
  name: string;
  url: string;

  category:
    | "general"
    | "economy"
    | "tech"
    | "gold"
    | "war"
    | "sports"
    | "entertainment"
    | "crypto"
    | "world"
    | "ai";

  priority?: number;
  unreliable?: boolean;

  tags?: string[];
};

export interface RawArticle {
  title: string;
  source: string;
  link: string;
  content: string;
  publishedAt?: string;
  category?: string;
  score?: number;
}
