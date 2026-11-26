import { describe, expect, it } from "vitest";

import { sanitizeMarkdown } from "./markdown-sanitizer";
import {
  htmlToMarkdown,
  markdownHeadings,
  markdownToHtml,
} from "./markdown/index";
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

describe("markdown paragraph round trip", () => {
  it("keeps adjacent paragraphs as separate Markdown paragraphs", () => {
    expect(htmlToMarkdown("<p>first</p><p>second</p>")).toBe(
      "first\n\nsecond\n"
    );
  });

  it("does not collapse an editor paragraph break into a soft break", () => {
    const markdown = htmlToMarkdown("<p>first</p><p>second</p>");

    expect(markdownToHtml(markdown)).toContain("<p>first</p>");
    expect(markdownToHtml(markdown)).toContain("<p>second</p>");
  });

  it("preserves a hard break as a hard break", () => {
    const markdown = htmlToMarkdown("<p>first<br>second</p>");

    expect(markdown).toBe("first\\\nsecond\n");
    expect(markdownToHtml(markdown)).toContain("<br");
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

describe("markdown heading anchors", () => {
  it("leaves headings unanchored unless asked", () => {
    expect(markdownToHtml("## Install")).not.toContain("id=");
  });

  it("anchors headings with a readable slug", () => {
    expect(markdownToHtml("## Install", { headingIds: true })).toContain(
      '<h2 id="install">Install</h2>'
    );
  });

  it("builds the anchor from the heading's words, not its markup", () => {
    const html = markdownToHtml("## Run `pnpm check` first", {
      headingIds: true,
    });

    expect(html).toContain('id="run-pnpm-check-first"');
  });

  it("suffixes a duplicate heading instead of dropping its anchor", () => {
    const headings = markdownHeadings("## Install\n\n## Install\n\n## Install");

    expect(headings.map((heading) => heading.id)).toEqual([
      "install",
      "install-2",
      "install-3",
    ]);
  });

  it("reports the same ids the rendered page carries", () => {
    const markdown = "# Setup\n\n## Custom domains\n\n### Steps";
    const html = markdownToHtml(markdown, { headingIds: true });

    for (const heading of markdownHeadings(markdown)) {
      expect(html).toContain(`id="${heading.id}"`);
    }

    expect(markdownHeadings(markdown)).toEqual([
      { id: "setup", level: 1, text: "Setup" },
      { id: "custom-domains", level: 2, text: "Custom domains" },
      { id: "steps", level: 3, text: "Steps" },
    ]);
  });

  it("folds accents into the anchor", () => {
    expect(markdownHeadings("## Résumé").at(0)?.id).toBe("resume");
  });

  it("does not hand two headings the same id when a slug collides with a suffix", () => {
    // "Install 2" slugs to `install-2`, which is also what the second "Install"
    // would be given by a counter that only tracked base slugs. Both outline
    // links would then land on the third heading.
    const ids = markdownHeadings(
      "## Install\n\n## Install\n\n## Install 2"
    ).map((heading) => heading.id);

    expect(ids).toEqual(["install", "install-2", "install-2-2"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("numbers three identical headings in order", () => {
    expect(
      markdownHeadings("## Install\n\n## Install\n\n## Install").map(
        (heading) => heading.id
      )
    ).toEqual(["install", "install-2", "install-3"]);
  });
});
