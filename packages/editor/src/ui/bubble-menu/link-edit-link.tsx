import type * as React from "react";
import { PencilIcon } from "../icons";
import { useBubbleMenuContext } from "./context";

export interface BubbleMenuLinkEditLinkProps
  extends Omit<React.ComponentProps<"button">, "type"> {}

export function BubbleMenuLinkEditLink({
  className,
  children,
  onClick,
  onMouseDown,
  ...rest
}: BubbleMenuLinkEditLinkProps) {
  const { setIsEditing } = useBubbleMenuContext();

  return (
    <button
      aria-label="Edit link"
      className={className}
      data-item="edit-link"
      data-re-link-bm-item=""
      onClick={(e) => {
        onClick?.(e);
        setIsEditing(true);
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      type="button"
      {...rest}
    >
      {children ?? <PencilIcon />}
    </button>
  );
}
