import type { Element, ElementContent, Root } from "hast";
import { tokenize, type ShjTokenized } from "rangi";
import { visit } from "unist-util-visit";

/**
 * Language ids that older documents stored using Shiki's canonical names, which
 * rangi spells differently. Rangi understands most of them already; this only
 * remaps the ones whose ids differ. Anything unknown is passed through and
 * rangi safely falls back to plain text for it.
 */
const SHIKI_TO_RANGI = {
  shellscript: "bash",
  typescriptreact: "tsx",
  javascriptreact: "jsx",
} as const;

const normalizeCodeBlockLanguage = (language: string): string =>
  // SAFETY: SHIKI_TO_RANGI is a narrow (as const) map; indexing with an
  // arbitrary string is safe because the `?? language` fallback keeps the
  // returned value valid regardless of whether the key exists.
  SHIKI_TO_RANGI[language as keyof typeof SHIKI_TO_RANGI] ?? language;

/** Concatenate the readable text of a `code` element's children. */
const codeText = (code: Element): string => {
  let text = "";
  for (const child of code.children) {
    if (child.type === "text") {
      text += child.value;
    }
  }
  return text;
};

/** Render rangi tokens as hast `<span class="shj-*">` children. */
const tokensToNodes = (tokens: ShjTokenized[]): ElementContent[] =>
  tokens.map((token) => ({
    type: "element",
    tagName: "span",
    properties: token.type ? { className: [`shj-${token.type}`] } : {},
    children: [{ type: "text", value: token.text }],
  }));

/**
 * A rehype plugin that syntax-highlights fenced code blocks
 * (`<pre><code class="language-*">`) in the read-only Markdown renderer using
 * rangi, so public/post pages get the same highlighting as the dashboard
 * editor. Emits `shj-<type>` spans colored by the shared theme (styles.css).
 */
export function rehypeCodeHighlight(): (tree: Root) => void {
  return (tree: Root) => {
    visit(tree, "element", (code: Element) => {
      if (code.tagName !== "code") {
        return;
      }

      const className = code.properties?.className;
      const classNameList = Array.isArray(className) ? className : [];
      let languageClass: string | null = null;
      for (const value of classNameList) {
        // hast className values can be primitives; only strings carry a
        // `language-` prefix, so coerce then check.
        const name = String(value);
        if (name.startsWith("language-")) {
          languageClass = name;
          break;
        }
      }
      if (languageClass === null) {
        return;
      }

      const language = normalizeCodeBlockLanguage(
        languageClass.slice("language-".length)
      );
      const tokens = tokenize(codeText(code), { lang: language });
      code.children = tokensToNodes(tokens);
    });
  };
}
