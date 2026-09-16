import { describe, expect, it } from "vitest";

import { sanitizeMarkdown } from "./markdown-sanitizer";
import { markdownToHtml } from "./markdown/index";
import { attributeViolations } from "./test-helpers/hast-safety";

describe("markdownToHtml URL safety", () => {
  it("strips javascript: link destinations", () => {
    const html = markdownToHtml("[click](javascript:alert(1))");
    expect(html).toContain("click");
    expect(attributeViolations(html)).toEqual([]);
  });

  it("strips data: link destinations and image sources", () => {
    const html = markdownToHtml(
      "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)\n\n![x](data:image/svg+xml,<svg onload=alert(1)>)"
    );
    expect(attributeViolations(html)).toEqual([]);
  });

  it("keeps http, https, mailto, and relative destinations", () => {
    const html = markdownToHtml(
      "[a](https://example.com) [b](/pricing) [c](#anchor) [d](mailto:a@b.c)"
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="#anchor"');
    expect(html).toContain('href="mailto:a@b.c"');
  });

  it("drops raw HTML instead of rendering it", () => {
    const html = markdownToHtml(`before <img src=x onerror=alert(1)> after`);
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<img");
  });
});

describe("sanitizeMarkdown XSS regression", () => {
  it("does not persist javascript: links in markdown or html", () => {
    const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
      "[Important update](javascript:alert(document.domain))"
    );
    expect(sanitizedMarkdown).not.toContain("javascript:");
    expect(attributeViolations(sanitizedHtml)).toEqual([]);
  });

  it("does not persist data: links", () => {
    const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
      "[x](data:text/html,<script>alert(1)</script>)"
    );
    expect(sanitizedMarkdown).not.toContain("data:");
    expect(attributeViolations(sanitizedHtml)).toEqual([]);
  });
});
