import { camelCase } from "scule";

/** The separators a `data-` attribute key may use between its words. */
const attributeKeySeparatorPattern = /\s+/;

export function toCamelCaseAttributeKey(word: string) {
  return camelCase(word.trim().split(attributeKeySeparatorPattern), {
    normalize: true,
  });
}
