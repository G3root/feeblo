import type * as React from "react";
import { UnlinkIcon } from "../icons";
import { useBubbleMenuContext } from "./context";

export interface BubbleMenuLinkUnlinkProps
  extends Omit<React.ComponentProps<"button">, "type"> {}

export function BubbleMenuLinkUnlink({
  className,
  children,
  onClick,
  onMouseDown,
  ...rest
}: BubbleMenuLinkUnlinkProps) {
  const { editor } = useBubbleMenuContext();

  return (
    <button
      aria-label="Remove link"
      className={className}
      data-item="unlink"
      data-re-link-bm-item=""
      onClick={(e) => {
        onClick?.(e);
        editor.chain().focus().unsetLink().run();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      type="button"
      {...rest}
    >
      {children ?? <UnlinkIcon />}
    </button>
  );
}
