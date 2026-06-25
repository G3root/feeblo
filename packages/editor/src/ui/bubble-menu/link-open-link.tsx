import { useEditorState } from "@tiptap/react";
import type * as React from "react";
import { ExternalLinkIcon } from "../icons";
import { useBubbleMenuContext } from "./context";

export interface BubbleMenuLinkOpenLinkProps
  extends Omit<React.ComponentProps<"a">, "href" | "target" | "rel"> {}

export function BubbleMenuLinkOpenLink({
  className,
  children,
  ...rest
}: BubbleMenuLinkOpenLinkProps) {
  const { editor } = useBubbleMenuContext();

  const linkHref = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      (e?.getAttributes("link").href as string) ?? "",
  });

  return (
    <a
      {...rest}
      aria-label="Open link"
      className={className}
      data-item="open-link"
      data-re-link-bm-item=""
      href={linkHref ?? ""}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children ?? <ExternalLinkIcon />}
    </a>
  );
}
