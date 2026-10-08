import { tokenize } from "rangi";
import type React from "react";

import { cn } from "./utils";

export interface CodeBlockProps {
  className?: string;
  /** The code to render. */
  code: string;
  /**
   * Rangi language id (`tsx`, `bash`, `html`, ...). Omit to render the code
   * without highlighting.
   */
  language?: string;
}

/**
 * Read-only code block with rangi highlighting, the same highlighter the
 * editor uses. Tokens carry the shared `shj-<type>` classes, so their colors
 * come from the app theme (see the `@feeblo/web-shared` stylesheet) and
 * light/dark mode keeps working.
 *
 * Rangi returns tokens in source order and never throws: an unknown language
 * comes back as one untyped token covering the whole input.
 */
export function CodeBlock({
  className,
  code,
  language,
}: CodeBlockProps): React.ReactElement {
  return (
    <pre className={cn("font-mono", className)} tabIndex={0}>
      <code>
        {language === undefined
          ? code
          : tokenize(code, { lang: language }).map((token, index) =>
              token.type === undefined ? (
                token.text
              ) : (
                <span className={`shj-${token.type}`} key={index}>
                  {token.text}
                </span>
              )
            )}
      </code>
    </pre>
  );
}
