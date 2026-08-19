import type { Parser } from "prosemirror-highlight";
import { Decoration } from "prosemirror-view";
import { tokenize } from "rangi";

import { normalizeCodeBlockLanguage } from "./languages.js";

/**
 * A prosekit/prosemirror-highlight `Parser` that turns code block text into
 * inline decorations using [rangi](https://rangi.dev) as the tokenizer.
 *
 * Replaces the previous Shiki-based highlighter (`defineCodeBlockShiki`),
 * which pulled in Shiki (~600KB of Oniguruma wasm plus a grammar chunk per
 * language). Rangi is a synchronous, zero-dependency highlighter (~13kB gzipped
 * for all 46 languages) and never needs a wasm engine or dynamic imports, so it
 * removes all of that from the editor bundle.
 *
 * Tokens are emitted as `shj-<type>` classes (e.g. `shj-kwd`, `shj-str`); their
 * colors are themed in `@feeblo/web-shared` (`styles.css`), keeping light/dark
 * mode working through the app's existing theme variables instead of inlining
 * colors.
 */
export const createRangiParser =
  (): Parser =>
  ({ content, pos, language }) => {
    // Plain-text code blocks get no highlighting.
    if (!language) {
      return [];
    }

    const tokens = tokenize(content, {
      lang: normalizeCodeBlockLanguage(language),
    });
    const decorations: Decoration[] = [];

    // Inline decoration positions are relative to the document, and the code
    // block's text starts one position after the node start. Token `text`
    // values are raw and cover the input in source order (including newlines),
    // so advancing by each token's length keeps positions exact.
    let from = pos + 1;
    for (const token of tokens) {
      const to = from + token.text.length;
      if (token.type) {
        decorations.push(
          Decoration.inline(from, to, {
            class: `shj-${token.type}`,
          })
        );
      }
      from = to;
    }

    return decorations;
  };
