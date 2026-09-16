import type { Element, Properties, Root } from "hast";
import { visit } from "unist-util-visit";

import { isString } from "../runtime-kind";

/**
 * Schemes that may appear in `href`/`src` attributes of rendered Markdown.
 * Everything else (`javascript:`, `vbscript:`, `data:`, unknown custom
 * schemes) is removed from the attribute so attacker-supplied Markdown can
 * never produce an executable or inline-document URL.
 */
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

const URL_ATTRIBUTES = ["href", "src"] as const;

/**
 * Relative URLs have no scheme once resolved against a base; protocol-relative
 * URLs (`//host/path`) resolve to the base protocol, which is allowed.
 */
const isSafeUrl = (value: Properties[string]): boolean => {
  if (!isString(value)) {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  try {
    return SAFE_URL_SCHEMES.has(
      new URL(trimmed, "https://feeblo.invalid").protocol
    );
  } catch {
    return false;
  }
};

/**
 * Rehype plugin that drops unsafe `href`/`src` values from the rendering
 * pipeline itself. `markdownToHtml` is called directly by clients
 * (`MarkdownContent` uses `dangerouslySetInnerHTML`) and by feeds, so the
 * rendered HTML must be safe even when it is not going through
 * `sanitizeMarkdown` (for example, rows stored before sanitization was
 * fixed).
 */
export function rehypeSafeUrlAttributes(): (tree: Root) => void {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const properties = node.properties;
      if (properties === undefined || properties === null) {
        return;
      }
      for (const attribute of URL_ATTRIBUTES) {
        if (attribute in properties && !isSafeUrl(properties[attribute])) {
          delete properties[attribute];
        }
      }
    });
  };
}
