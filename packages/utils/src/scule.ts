import { camelCase } from "scule";

export function toCamelCaseAttributeKey(word: string) {
  return camelCase(word.trim().split(/\s+/), { normalize: true });
}
