import { markdownToHtml } from "@feeblo/utils/markdown";
import { type ComponentProps, useMemo } from "react";

import { cn } from "./utils";

type MarkdownContentProps = Omit<
  ComponentProps<"div">,
  "children" | "dangerouslySetInnerHTML"
> & {
  content: string;
};

export function MarkdownContent({
  className,
  content,
  ...props
}: MarkdownContentProps) {
  const html = useMemo(() => markdownToHtml(content), [content]);

  return (
    <div
      className={cn("typeset", className)}
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  );
}
