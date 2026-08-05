import type { ComponentProps } from "react";
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
  return (
    <div
      className={cn("typeset", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized Markdown rendered to HTML
      dangerouslySetInnerHTML={{ __html: content }}
      {...props}
    />
  );
}
