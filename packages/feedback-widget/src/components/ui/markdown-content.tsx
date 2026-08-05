import { markdownToHtml } from "@feeblo/utils/markdown";
import { type ComponentProps, createMemo, splitProps } from "solid-js";
import { cn } from "../../lib/utils";

type MarkdownContentProps = Omit<ComponentProps<"div">, "children"> & {
  content: string;
};

export function MarkdownContent(props: MarkdownContentProps) {
  const [local, others] = splitProps(props, ["class", "content"]);
  // Read props.content (not the splitProps snapshot) so the memo recomputes
  // when the prop changes, mirroring useMemo(..., [content]) in the React
  // version. splitProps only exists to keep `content` off the DOM element.
  const html = createMemo(() => markdownToHtml(props.content));

  return (
    <div
      class={cn("typeset whitespace-pre-wrap", local.class)}
      innerHTML={html()}
      {...others}
    />
  );
}
