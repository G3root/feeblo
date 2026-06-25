import { PluginKey } from "@tiptap/pm/state";
import type * as React from "react";
import { BubbleMenuLinkEditLink } from "./link-edit-link";
import { BubbleMenuLinkForm } from "./link-form";
import { BubbleMenuLinkOpenLink } from "./link-open-link";
import { BubbleMenuLinkToolbar } from "./link-toolbar";
import { BubbleMenuLinkUnlink } from "./link-unlink";
import { BubbleMenuRoot } from "./root";
import { bubbleMenuTriggers } from "./triggers";

const linkPluginKey = new PluginKey("linkBubbleMenu");

type ExcludableItem = "edit-link" | "open-link" | "unlink";

export interface BubbleMenuLinkDefaultProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  excludeItems?: ExcludableItem[];
  offset?: number;
  onHide?: () => void;
  onLinkApply?: (href: string) => void;
  onLinkRemove?: () => void;
  placement?: "top" | "bottom";
  validateUrl?: (value: string) => string | null;
}

export function BubbleMenuLinkDefault({
  excludeItems = [],
  placement = "top",
  offset,
  onHide,
  className,
  validateUrl,
  onLinkApply,
  onLinkRemove,
  ...rest
}: BubbleMenuLinkDefaultProps) {
  const has = (item: ExcludableItem) => !excludeItems.includes(item);

  const hasToolbarItems = has("edit-link") || has("open-link") || has("unlink");

  return (
    <BubbleMenuRoot
      className={className}
      offset={offset}
      onHide={onHide}
      placement={placement}
      pluginKey={linkPluginKey}
      trigger={bubbleMenuTriggers.nodeWithoutSelection("link")}
      {...rest}
    >
      {hasToolbarItems && (
        <BubbleMenuLinkToolbar>
          {has("edit-link") && <BubbleMenuLinkEditLink />}
          {has("open-link") && <BubbleMenuLinkOpenLink />}
          {has("unlink") && <BubbleMenuLinkUnlink />}
        </BubbleMenuLinkToolbar>
      )}
      <BubbleMenuLinkForm
        onLinkApply={onLinkApply}
        onLinkRemove={onLinkRemove}
        validateUrl={validateUrl}
      />
    </BubbleMenuRoot>
  );
}
