import { markdownToHtml } from "@feeblo/utils/markdown";
import { type ComponentProps, useMemo } from "react";

import { cn } from "./utils";

type MarkdownContentProps = Omit<
  ComponentProps<"div">,
  "children" | "dangerouslySetInnerHTML"
> & {
  content: string;
  /**
   * Give every heading an `id`, so an outline beside the body can link to it.
   *
   * Opt-in because the anchors are only useful where something links to them;
   * a body rendered on its own should not carry attributes no reader can reach.
   * The ids themselves come from the render pipeline (`@feeblo/utils/markdown`),
   * which is also what `markdownHeadings` reads, so the outline and the page
   * cannot disagree about what a section is called.
   */
  headingAnchors?: boolean;
};

export function MarkdownContent({
  className,
  content,
  headingAnchors = false,
  ...props
}: MarkdownContentProps) {
  const html = useMemo(
    () => markdownToHtml(content, { headingIds: headingAnchors }),
    [content, headingAnchors]
  );

  return (
    <div
      className={cn("typeset", className)}
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  );
}
