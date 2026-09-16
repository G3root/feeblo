import { describe, expect, it } from "vitest";

import { HtmlSanitizer, secureBlankTarget } from "./html-sanitizer";
import { attributeViolations } from "./test-helpers/hast-safety";

const sanitize = (html: string) => new HtmlSanitizer().sanitizeHtml(html);

/**
 * Regression corpus for the sanitizer engine. These payloads previously
 * survived the DOMPurify-under-happy-dom implementation for any element that
 * was not the sole root node, so every case is wrapped in a parent element to
 * pin the nested-node behavior.
 */
const dangerousPayloads: ReadonlyArray<readonly [string, string]> = [
  ["nested img onerror", `<p><img src=x onerror=alert(1)></p>`],
  [
    "nested img onerror with text",
    `<p>text <img src=x onerror=alert(1)> more</p>`,
  ],
  ["nested svg onload", `<p><svg onload=alert(1)></svg></p>`],
  [
    "nested iframe srcdoc",
    `<p><iframe srcdoc="<script>alert(1)</script>"></iframe></p>`,
  ],
  [
    "nested details ontoggle",
    `<p><details open ontoggle=alert(1)></details></p>`,
  ],
  ["nested javascript href", `<p><a href="javascript:alert(1)">click</a></p>`],
  [
    "uppercase javascript href",
    `<div><a href="JaVaScRiPt:alert(1)">click</a></div>`,
  ],
  [
    "entity javascript href",
    `<p><a href="&#106;avascript:alert(1)">click</a></p>`,
  ],
  [
    "data uri href",
    `<p><a href="data:text/html,<script>alert(1)</script>">click</a></p>`,
  ],
  [
    "data uri img",
    `<p><img src="data:image/svg+xml,<svg onload=alert(1)>"></p>`,
  ],
  ["vbscript href", `<ul><li><a href="vbscript:msgbox(1)">click</a></li></ul>`],
  [
    "event handler on allowed tag",
    `<table><tbody><tr><td><div onclick="alert(1)">x</div></td></tr></tbody></table>`,
  ],
  [
    "math mXSS",
    `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">`,
  ],
  [
    "form action",
    `<p><form action="javascript:alert(1)"><button>go</button></form></p>`,
  ],
  [
    "meta refresh",
    `<p><meta http-equiv="refresh" content="0;url=https://evil.example"></p>`,
  ],
  ["base tag", `<p><base href="https://evil.example/"></p>`],
  [
    "style tag",
    `<p><style>body{background:url(javascript:alert(1))}</style></p>`,
  ],
];

describe("HtmlSanitizer", () => {
  for (const [name, payload] of dangerousPayloads) {
    it(`removes dangerous content: ${name}`, () => {
      expect(attributeViolations(sanitize(payload))).toEqual([]);
    });
  }

  it("keeps allowed formatting and safe attributes", () => {
    const output = sanitize(
      `<h2>Title</h2><p><strong>bold</strong> <em>italic</em> <code>x = 1</code></p><ul><li>one</li></ul><a href="https://example.com" title="ok">link</a><img src="https://example.com/a.png" alt="a" width="10" height="10">`
    );
    expect(output).toContain("<h2>Title</h2>");
    expect(output).toContain("<strong>bold</strong>");
    expect(output).toContain("<code>x = 1</code>");
    expect(output).toContain(
      '<a href="https://example.com" title="ok">link</a>'
    );
    expect(output).toContain('alt="a"');
    expect(output).toContain('src="https://example.com/a.png"');
  });

  it("keeps relative and mailto links", () => {
    expect(sanitize(`<a href="/pricing">p</a>`)).toContain('href="/pricing"');
    expect(sanitize(`<a href="#section">s</a>`)).toContain('href="#section"');
    expect(sanitize(`<a href="mailto:a@b.c">m</a>`)).toContain(
      'href="mailto:a@b.c"'
    );
  });

  it("hardens target=_blank links after sanitization", () => {
    const output = sanitize(
      `<p><a href="https://example.com" target="_blank" rel="nofollow">x</a></p>`
    );
    expect(output).toContain('rel="nofollow noopener noreferrer"');
  });

  it("returns an empty string for oversized input", () => {
    expect(sanitize("a".repeat(10_001))).toBe("");
  });

  it("secures uppercase blank targets while preserving existing rel tokens", () => {
    const attributes = new Map<string, string>([
      ["target", "_BLANK"],
      ["rel", "opener nofollow"],
    ]);
    const node = {
      tagName: "A",
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
    };

    secureBlankTarget(node);

    expect(attributes.get("rel")).toBe("opener nofollow noopener noreferrer");
  });
});
