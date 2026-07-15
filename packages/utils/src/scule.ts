import { camelCase } from "scule";

export function toCamelCase(word: string) {
  return camelCase(word, { normalize: true });
}
