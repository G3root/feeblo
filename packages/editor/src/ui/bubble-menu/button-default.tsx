import { PluginKey } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import type * as React from "react";
import { BubbleMenuButtonEditLink } from "./button-edit-link";
import { BubbleMenuButtonForm } from "./button-form";
import { BubbleMenuButtonToolbar } from "./button-toolbar";
import { BubbleMenuButtonUnlink } from "./button-unlink";
import { useBubbleMenuContext } from "./context";
import { BubbleMenuRoot } from "./root";
import { bubbleMenuTriggers } from "./triggers";

const buttonPluginKey = new PluginKey("buttonBubbleMenu");

export interface BubbleMenuButtonDefaultProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  offset?: number;
  onHide?: () => void;
  onLinkApply?: (href: string) => void;
  onLinkRemove?: () => void;
  placement?: "top" | "bottom";
  validateUrl?: (value: string) => string | null;
}

function BubbleMenuButtonDefaultInner({
  validateUrl,
  onLinkApply,
  onLinkRemove,
}: Pick<
  BubbleMenuButtonDefaultProps,
  "validateUrl" | "onLinkApply" | "onLinkRemove"
>) {
  const { editor } = useBubbleMenuContext();
  const buttonHref = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      (e?.getAttributes("button").href as string) ?? "",
  });
  const hasLink = (buttonHref ?? "") !== "" && buttonHref !== "#";

  return (
    <>
      <BubbleMenuButtonToolbar>
        <BubbleMenuButtonEditLink />
        {hasLink && <BubbleMenuButtonUnlink onLinkRemove={onLinkRemove} />}
      </BubbleMenuButtonToolbar>
      <BubbleMenuButtonForm
        onLinkApply={onLinkApply}
        onLinkRemove={onLinkRemove}
        validateUrl={validateUrl}
      />
    </>
  );
}

export function BubbleMenuButtonDefault({
  placement = "top",
  offset,
  onHide,
  className,
  validateUrl,
  onLinkApply,
  onLinkRemove,
  ...rest
}: BubbleMenuButtonDefaultProps) {
  return (
    <BubbleMenuRoot
      className={className}
      offset={offset}
      onHide={onHide}
      placement={placement}
      pluginKey={buttonPluginKey}
      trigger={bubbleMenuTriggers.node("button")}
      {...rest}
    >
      <BubbleMenuButtonDefaultInner
        onLinkApply={onLinkApply}
        onLinkRemove={onLinkRemove}
        validateUrl={validateUrl}
      />
    </BubbleMenuRoot>
  );
}
