import type * as React from "react";
import { UnlinkIcon } from "../icons";
import { useBubbleMenuContext } from "./context";
import { focusEditor } from "./utils";

export interface BubbleMenuButtonUnlinkProps
  extends Omit<React.ComponentProps<"button">, "type"> {
  onLinkRemove?: () => void;
}

export function BubbleMenuButtonUnlink({
  className,
  children,
  onClick,
  onMouseDown,
  onLinkRemove,
  ...rest
}: BubbleMenuButtonUnlinkProps) {
  const { editor } = useBubbleMenuContext();

  return (
    <button
      {...rest}
      aria-label="Remove link"
      className={className}
      data-item="unlink"
      data-re-btn-bm-item=""
      onClick={(e) => {
        onClick?.(e);
        editor.commands.updateButton({ href: "#" });
        focusEditor(editor);
        onLinkRemove?.();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      type="button"
    >
      {children ?? <UnlinkIcon />}
    </button>
  );
}
