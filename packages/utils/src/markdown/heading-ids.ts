import type { Element, ElementContent, Root } from "hast";
import { visit } from "unist-util-visit";

import { isString } from "../runtime-kind";

/**
 * A heading a reader can jump to.
 *
 * The id is what the outline links to and what the rendered heading carries, so
 * both sides of that link come from this module: an outline that computed its
 * own anchors would drift from the page the moment either slug rule changed.
 */
export type MarkdownHeading = {
  readonly id: string;
  readonly text: string;
  readonly level: number;
};

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Combining marks, which NFKD leaves behind after `résumé` becomes `re´sume´`. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

const NON_ALPHANUMERIC_RUNS = /[^a-z0-9]+/g;

const EDGE_DASHES = /^-+|-+$/g;

/**
 * The anchor for one heading's text.
 *
 * Readable rather than hashed, because the visible URL is the point: a reader
 * who copies `#publish-a-changelog` knows what it points at. De-duplication is
 * the caller's job — this function answers for one text, not for a document.
 */
export function headingAnchor(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "")
      .replace(NON_ALPHANUMERIC_RUNS, "-")
      .replace(EDGE_DASHES, "") || "section"
  );
}

/**
 * The readable text of a heading element.
 *
 * Recursive because a heading may hold inline markup — `Setup` in emphasis,
 * `pnpm check` in code — and the anchor should be built from the words rather
 * than from the first text node. Images contribute their alt text for the same
 * reason: it is the only readable content they have.
 */
function headingText(node: ElementContent): string {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "element") {
    if (node.tagName === "img") {
      const alt = node.properties["alt"];

      return isString(alt) ? alt : "";
    }

    return node.children.map(headingText).join("");
  }

  return "";
}

/**
 * Rehype plugin that gives every heading an `id`.
 *
 * Opt-in, because the rest of the Markdown surfaces in this repo render bodies
 * where an anchor is not a feature — a changelog entry or a feed item — and
 * rewriting every one of them to add unused attributes would be a change
 * nobody asked for.
 *
 * Every assigned id is reserved, including an id the author already put on a
 * heading and one an earlier heading generated. Counting occurrences of a base
 * slug is not enough: `Install`, `Install` and `Install 2` would hand the middle
 * heading `install-2` — the same id the third one slugs to — and both outline
 * links would land on the third. So a candidate is bumped with a numeric suffix
 * until it is unused, which keeps three identical headings at `install`,
 * `install-2`, `install-3`.
 */
export function rehypeHeadingIds(): (tree: Root) => void {
  return (tree: Root) => {
    const headings: Element[] = [];

    visit(tree, "element", (node: Element) => {
      if (HEADING_TAGS.has(node.tagName)) {
        headings.push(node);
      }
    });

    // Reserve what is already taken before generating anything, so a generated
    // anchor cannot take an id a later heading is keeping.
    const used = new Set<string>();

    for (const heading of headings) {
      const id = heading.properties["id"];

      if (isString(id)) {
        used.add(id);
      }
    }

    for (const heading of headings) {
      // A heading an author already anchored keeps its own id: it is the more
      // specific intent, and replacing it would move a link they wrote.
      if (isString(heading.properties["id"])) {
        continue;
      }

      const text = headingText(heading).trim();

      if (text === "") {
        continue;
      }

      const base = headingAnchor(text);
      let candidate = base;
      let suffix = 1;

      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
      }

      used.add(candidate);
      heading.properties["id"] = candidate;
    }
  };
}

/** The headings of a rendered tree, in document order. */
export function collectHeadings(tree: Root): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];

  visit(tree, "element", (node: Element) => {
    const id = node.properties["id"];

    if (!HEADING_TAGS.has(node.tagName) || !isString(id)) {
      return;
    }

    headings.push({
      id,
      level: Number(node.tagName.slice(1)),
      text: headingText(node).trim(),
    });
  });

  return headings;
}
