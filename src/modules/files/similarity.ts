import stringSimilarity from "string-similarity";

export function similarityScore(a: string, b: string): number {
  return stringSimilarity.compareTwoStrings(
    a.toLocaleLowerCase(),
    b.toLocaleLowerCase(),
  );
}
