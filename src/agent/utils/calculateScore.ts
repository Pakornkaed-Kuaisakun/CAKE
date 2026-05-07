/**
 * Simple relevance scoring
 *
 * Counts keyword matches
 */
export function calculateScore(text: string, query: string): number {
  const words = query.toLowerCase().split(/\s+/);

  const lower = text.toLowerCase();

  let score = 0;

  for (const word of words) {
    if (lower.includes(word)) {
      score++;
    }
  }

  return score;
}
