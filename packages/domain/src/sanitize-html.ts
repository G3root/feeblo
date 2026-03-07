import sanitizeHtml from "sanitize-html";

/**
 * Strips any HTML that cannot be produced by the TipTap rich-text editor,
 * and removes all event handlers / javascript: URLs to prevent XSS.
 */
export function sanitizeRichText(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      // Block
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "pre",
      "ul",
      "ol",
      "li",
      "hr",
      // Table
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      // Inline
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "code",
      "mark",
      "sub",
      "sup",
      "br",
      // Media
      "img",
      "a",
    ],
    allowedAttributes: {
      // Links — only safe protocols (no javascript:, data:, etc.)
      a: ["href", "title", "target", "rel"],
      // Images — only https / relative URLs; no data: URIs to avoid base64 payloads
      img: ["src", "alt", "title", "width", "height"],
      // TipTap uses class/colwidth on table cells and code blocks
      code: ["class"],
      pre: ["class"],
      th: ["colspan", "rowspan", "colwidth"],
      td: ["colspan", "rowspan", "colwidth"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    // Force links to be safe
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}
