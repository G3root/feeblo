import { Editor, EditorProvider } from "@feeblo/ui/editor";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// Load the same stylesheets a host does: Tailwind utilities for the editor's
// node-view classes, then the shared typeset stylesheet. `styles.css` (the
// app theme) is deliberately not imported here: the parity assertions below
// compare geometry, and a synthetic token override covers dark mode.
import "../tailwind.css";
import "@feeblo/web-shared/typeset.css";

// The editor exposes only this module boundary for its upload schema + RPC
// transport; the stubs are faithful pass-throughs of the runtime's contracts.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/auth-client", () => ({
  editorMediaUploadEndpoint: "/api/media/upload",
  uploadedEditorMediaSchema: {
    // SAFETY: the stub replaces the zod parser with an identity pass-through.
    parse: <T,>(value: T) => value,
  },
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: vi.fn(),
}));

const sample = `# Heading one

Paragraph with **bold**, *italic*, \`inline code\`, and a [link](https://example.com).

A second paragraph, so a paragraph break is part of the comparison.

## Heading two

- first item
- second item
  - nested item

1. ordered one
2. ordered two

> A quote block.

\`\`\`ts
const answer = 42;
\`\`\`

| Column A | Column B |
| -------- | -------- |
| Value A  | Value B  |

---

![Alt text](https://assets.example/image.png)
`;

const styleKeys = [
  "backgroundColor",
  "borderBlockStartColor",
  "borderBlockStartWidth",
  "color",
  "display",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "marginBlockEnd",
  "marginBlockStart",
  "outlineColor",
  "paddingBlockEnd",
  "paddingBlockStart",
  "paddingInlineStart",
  "textDecorationColor",
  "whiteSpace",
] as const;

const probeTargets = [
  ["blockquote", "blockquote"],
  ["code", ":not(pre) > code"],
  ["h1", "h1"],
  ["h2", "h2"],
  ["hr", "hr"],
  ["img", "img"],
  ["p", "p"],
  ["pre", "pre"],
  ["table", "table"],
  ["td", "td"],
  ["th", "th"],
] as const;

type StyleKey = (typeof styleKeys)[number];
type StyleValues = {
  backgroundColor: string;
  borderBlockStartColor: string;
  borderBlockStartWidth: string;
  color: string;
  display: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  marginBlockEnd: string;
  marginBlockStart: string;
  outlineColor: string;
  paddingBlockEnd: string;
  paddingBlockStart: string;
  paddingInlineStart: string;
  textDecorationColor: string;
  whiteSpace: string;
};
type ProbeTarget = (typeof probeTargets)[number][0];
type Difference = {
  editor: string;
  field: StyleKey;
  key: ProbeTarget;
  rendered: string;
};

function find(root: Element, selector: string): Element {
  const element = root.querySelector(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

function readStyles(element: Element): StyleValues {
  const computed = getComputedStyle(element);
  // SAFETY: every key in `styleKeys` is a string-valued CSSStyleDeclaration
  // property, so the indexed reads fill the whole record.
  const styles = {} as StyleValues;

  for (const key of styleKeys) {
    styles[key] = computed[key];
  }

  return styles;
}

function rectWidth(root: Element, selector: string): number {
  const { width } = find(root, selector).getBoundingClientRect();

  return Math.round(width * 100) / 100;
}

function gapBefore(root: Element, selector: string): number | null {
  const element = find(root, selector);
  const previous = element.previousElementSibling;

  if (!previous) {
    return null;
  }

  return (
    Math.round(
      (element.getBoundingClientRect().top -
        previous.getBoundingClientRect().bottom) *
        100
    ) / 100
  );
}

function collectDifferences(editor: Element, rendered: Element): Difference[] {
  const differences: Difference[] = [];

  for (const [key, selector] of probeTargets) {
    const editorStyles = readStyles(find(editor, selector));
    const renderedStyles = readStyles(find(rendered, selector));

    for (const field of styleKeys) {
      // ProseMirror must break spaces while editing.
      if (field === "whiteSpace" && key !== "pre") {
        continue;
      }
      // ProseMirror's scroll wrapper owns the table's flow margin.
      if (field === "marginBlockStart" && key === "table") {
        continue;
      }

      if (editorStyles[field] !== renderedStyles[field]) {
        differences.push({
          editor: editorStyles[field],
          field,
          key,
          rendered: renderedStyles[field],
        });
      }
    }
  }

  return differences;
}

async function renderBoth() {
  const screen = await render(
    <div>
      <div data-testid="rendered">
        <MarkdownContent content={sample} />
      </div>
      <EditorProvider defaultValue={{ postContent: sample }}>
        <Editor />
      </EditorProvider>
    </div>
  );

  await expect.element(screen.getByRole("textbox")).toBeVisible();

  await vi.waitFor(() => {
    if (document.querySelector(".ProseMirror table") === null) {
      throw new Error("editor not ready");
    }
  });

  const renderedRoot = document.querySelector('[data-testid="rendered"]');
  const editorRoot = document.querySelector(".ProseMirror");

  if (!renderedRoot || !editorRoot) {
    throw new Error("editor and rendered markdown roots are missing");
  }

  return { editorRoot, renderedRoot };
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.innerHTML = "";
  document.head.querySelector("[data-typeset-test]")?.remove();
});

describe("typeset parity", () => {
  it("renders the editor and rendered markdown with the same typography", async () => {
    const { editorRoot, renderedRoot } = await renderBoth();

    expect(collectDifferences(editorRoot, renderedRoot)).toEqual([]);

    // A standalone image must not leave an empty paragraph behind (the block
    // image node replaced the `<p><img></p>` wrapper when the editor parsed
    // the Markdown).
    const emptyParagraphs = Array.from(editorRoot.querySelectorAll("p")).filter(
      (paragraph) => (paragraph.textContent ?? "").trim() === ""
    );
    expect(emptyParagraphs.length).toBe(0);
    expect(
      editorRoot.querySelector("div[data-node-view-root]:has(img)")
        ?.previousElementSibling
    ).toBe(editorRoot.querySelector(".prosekit-horizontal-rule"));

    // Layout-box assertions for the two places where the DOM differs: the
    // editor's image node view is a block sibling of the paragraph that owns
    // the rendered image, and tables sit inside ProseMirror's scroll wrapper.
    expect(gapBefore(editorRoot, "div[data-node-view-root]:has(img)")).toBe(
      gapBefore(renderedRoot, "p:has(img)")
    );
    expect(gapBefore(editorRoot, ".tableWrapper")).toBe(
      gapBefore(renderedRoot, "table")
    );
    expect(gapBefore(editorRoot, "p + p")).toBe(
      gapBefore(renderedRoot, "p + p")
    );
    expect(rectWidth(editorRoot, "table")).toBe(
      rectWidth(renderedRoot, "table")
    );
    expect(readStyles(find(editorRoot, "pre")).whiteSpace).toBe("pre");
    expect(readStyles(find(editorRoot, "td")).paddingInlineStart).toBe("18px");
    expect(readStyles(find(editorRoot, "th")).paddingInlineStart).toBe("18px");
    expect(readStyles(find(editorRoot, "table")).borderBlockStartWidth).toBe(
      "1px"
    );
  });

  it("maps editor chrome and typeset content onto the dark theme tokens", async () => {
    const theme = document.createElement("style");
    theme.dataset.typesetTest = "";
    theme.textContent = `
      :root {
        --border: rgb(60, 61, 62);
        --color-border: var(--border);
        --color-foreground: rgb(240, 241, 242);
        --color-muted: rgb(30, 31, 32);
        --color-muted-foreground: rgb(160, 161, 162);
        --color-primary: rgb(70, 71, 72);
        --color-ring: rgb(80, 81, 82);
        --foreground: rgb(240, 241, 242);
        --muted: rgb(30, 31, 32);
        --muted-foreground: rgb(160, 161, 162);
        --primary: rgb(70, 71, 72);
        --ring: rgb(80, 81, 82);
      }
    `;
    document.head.append(theme);
    document.documentElement.classList.add("dark");

    const { editorRoot, renderedRoot } = await renderBoth();

    // Content follows the theme instead of a fixed light palette.
    expect(readStyles(find(renderedRoot, ".typeset")).color).toBe(
      "rgb(240, 241, 242)"
    );
    expect(
      readStyles(find(renderedRoot, ":not(pre) > code")).backgroundColor
    ).toBe("rgb(30, 31, 32)");
    expect(readStyles(find(renderedRoot, "hr")).borderBlockStartColor).toBe(
      "rgb(60, 61, 62)"
    );

    // ProseKit's own table/node selection chrome is themed too. Insert the
    // class a real table selection would carry and read the computed border.
    const selectedCell = document.createElement("div");
    selectedCell.className = "selectedCell";
    editorRoot.append(selectedCell);

    expect(getComputedStyle(selectedCell).borderBlockStartColor).toBe(
      "rgb(80, 81, 82)"
    );
  });
});
