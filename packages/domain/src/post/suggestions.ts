import { postEmbeddingInput } from "./embedding-service";

export const MIN_SUGGESTION_SIMILARITY = 0.3;

export const SUGGESTION_MAX_DISTANCE = 1 - MIN_SUGGESTION_SIMILARITY;

const words = (value: string): ReadonlySet<string> =>
  new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export const lexicalSimilarity = (left: string, right: string): number => {
  const leftWords = words(left);
  const rightWords = words(right);
  const intersection = [...leftWords].filter((word) =>
    rightWords.has(word)
  ).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return union === 0 ? 0 : intersection / union;
};

export const postLexicalSimilarity = (
  input: string,
  post: { readonly content: string; readonly title: string }
): number => lexicalSimilarity(input, postEmbeddingInput(post));
