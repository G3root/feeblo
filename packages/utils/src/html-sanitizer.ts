import type { Element, Properties, Root } from "hast";
import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { isString } from "./runtime-kind";

const REL_TOKEN_SEPARATOR = /\s+/;

/**
 * Adds safe opener isolation to links targeting a new browsing context.
 *
 * Works on the minimal DOM-node shape (astring for tests and callers that
 * already parsed HTML) as well as being reused conceptually by the hast
 * plugin below, which applies the same rule after sanitization.
 */
export const secureBlankTarget = (node: {
  readonly tagName: string;
  readonly getAttribute: (name: string) => string | null;
  readonly setAttribute: (name: string, value: string) => void;
}): void => {
  const target = node.getAttribute("target")?.trim().toLowerCase();
  if (node.tagName !== "A" || target !== "_blank") {
    return;
  }

  const existingRel = node.getAttribute("rel") ?? "";
  const relTokens = new Set(
    existingRel.split(REL_TOKEN_SEPARATOR).filter(Boolean)
  );
  relTokens.add("noopener");
  relTokens.add("noreferrer");
  node.setAttribute("rel", [...relTokens].join(" "));
};

// Configure the sanitizer allow-list
export const ALLOWED_TAGS = [
  // Text formatting
  "strong",
  "b",
  "em",
  "i",
  "code",
  "tt",
  "s",
  "strike",
  "del",
  "ins",
  "sub",
  "sup",

  // Links and images
  "a",
  "img",

  // Lists
  "ul",
  "ol",
  "li",

  // Headers and text structure
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "q",

  // Line breaks and horizontal rules
  "br",
  "hr",

  // Code blocks and preformatted text
  "pre",
  "samp",
  "kbd",
  "var",

  // Tables
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",

  // Definition lists
  "dl",
  "dt",
  "dd",

  // Details/summary
  "details",
  "summary",

  // Div and span with restrictions
  "div",
  "span",
];

export const ALLOWED_ATTR = [
  // Link attributes
  "href",
  "title",
  "target",
  "rel",

  // Image attributes
  "src",
  "alt",
  "width",
  "height",

  // List attributes
  "start",
  "reversed",
  "value",

  // Table attributes
  "colspan",
  "rowspan",
  "headers",

  // Details attributes
  "open",

  // General attributes
  "class",
  "id",
];

// hast property names (camelCase) map to the HTML attributes above: `class` is
// `className`, `colspan` is `colSpan`, `rowspan` is `rowSpan`.
const SHARED_ATTRIBUTES = ["className", "id"] as const;

/**
 * Schema for `hast-util-sanitize`. The sanitizer runs on a parsed hast tree,
 * not on an emulated browser DOM: unlike DOMPurify-under-happy-dom it walks
 * every node deterministically and cannot fail open for nested elements.
 *
 * Dangerous URL schemes are handled by `protocols`, which rejects
 * `javascript:`, `vbscript:`, and `data:` URLs while keeping relative links.
 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: ALLOWED_TAGS.filter((tag) => tag !== "#text"),
  attributes: {
    ...defaultSchema.attributes,
    "*": [...SHARED_ATTRIBUTES],
    a: ["href", "title", "target", "rel", ...SHARED_ATTRIBUTES],
    img: ["src", "alt", "width", "height", ...SHARED_ATTRIBUTES],
    ol: ["start", "reversed", ...SHARED_ATTRIBUTES],
    li: ["value", ...SHARED_ATTRIBUTES],
    td: ["colSpan", "rowSpan", "headers", ...SHARED_ATTRIBUTES],
    th: ["colSpan", "rowSpan", "headers", ...SHARED_ATTRIBUTES],
    details: ["open", ...SHARED_ATTRIBUTES],
  },
  protocols: {
    href: ["http", "https", "mailto", "tel"],
    src: ["http", "https"],
  },
};

const relTokens = (value: Properties[string]): Set<string> => {
  const tokens = new Set<string>();
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) {
    if (isString(entry)) {
      for (const token of entry.split(REL_TOKEN_SEPARATOR)) {
        if (token) {
          tokens.add(token);
        }
      }
    }
  }
  return tokens;
};

/**
 * hast counterpart of {@link secureBlankTarget}, applied after
 * `rehype-sanitize` so `rel="noopener noreferrer"` is always present on
 * `target="_blank"` links.
 */
const rehypeSecureBlankTarget = () => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "a") {
      return;
    }
    const target = node.properties?.target;
    if (!isString(target) || target.trim().toLowerCase() !== "_blank") {
      return;
    }
    const tokens = relTokens(node.properties.rel);
    tokens.add("noopener");
    tokens.add("noreferrer");
    node.properties.rel = [...tokens];
  });
};

const sanitizer = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(rehypeSecureBlankTarget)
  .use(rehypeStringify)
  .freeze();

export class HtmlSanitizer {
  sanitizeHtml(html: string): string {
    // Reject overly large content without parsing to avoid performance issues
    if (html.length > 10_000) {
      // 10KB limit
      return "";
    }

    const result = String(sanitizer.processSync(html));

    // Post-process to ensure trailing newlines match expected output
    // Only add newline if result is not empty
    if (!result) {
      return result;
    }
    return result.endsWith("\n") ? result : `${result}\n`;
  }
}
