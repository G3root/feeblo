import type { ComponentProps } from "react";
import { cn } from "./utils";

type MarkdownContentProps = Omit<
  ComponentProps<"div">,
  "children" | "dangerouslySetInnerHTML"
> & {
  content: string;
};

//TODO: refactor the component to another later. this name is misleading and content is always html
export function MarkdownContent({
  className,
  content,
  ...props
}: MarkdownContentProps) {
  return (
    <div
      className={cn("typeset", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: already sanitized in the server
      dangerouslySetInnerHTML={{ __html: content }}
      {...props}
    />
  );
}
