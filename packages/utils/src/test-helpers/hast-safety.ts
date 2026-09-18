import type { Element, Properties, Root } from "hast";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { isString } from "../runtime-kind";

const DANGEROUS_SCHEME = /^\s*(?:javascript|vbscript|data)\s*:/i;

const DISALLOWED_TAGS = new Set([
  "script",
  "iframe",
  "base",
  "meta",
  "style",
  "form",
  "object",
  "embed",
  "template",
]);

/** Removes whitespace and control characters the URL parser ignores. */
const collapseIgnoredUrlCharacters = (value: string): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x20;
    })
    .join("");

const rawUrl = (value: Properties[string]): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => (isString(entry) ? entry : "")).join(" ");
  }
  return isString(value) ? value : "";
};

/**
 * Collects executable/attribute-level violations from sanitized HTML. Text
 * nodes are ignored on purpose: inert text that spells a dangerous URL (for
 * example the body of a stripped `<style>` tag) is not a vulnerability.
 */
export const attributeViolations = (html: string): string[] => {
  const violations: string[] = [];
  const tree: Root = unified().use(rehypeParse, { fragment: true }).parse(html);
  visit(tree, "element", (node: Element) => {
    if (DISALLOWED_TAGS.has(node.tagName)) {
      violations.push(`tag <${node.tagName}>`);
    }
    for (const [name, value] of Object.entries(node.properties ?? {})) {
      if (/^on/i.test(name)) {
        violations.push(`${node.tagName}[${name}]`);
      }
      if (name === "srcdoc") {
        violations.push(`${node.tagName}[srcdoc]`);
      }
      if (name === "href" || name === "src") {
        const url = rawUrl(value);
        if (DANGEROUS_SCHEME.test(collapseIgnoredUrlCharacters(url))) {
          violations.push(`${node.tagName}[${name}]=${url}`);
        }
      }
    }
  });
  return violations;
};
