import type * as React from "react";
import { PencilIcon } from "../icons";
import { useBubbleMenuContext } from "./context";

export interface BubbleMenuButtonEditLinkProps
  extends Omit<React.ComponentProps<"button">, "type"> {}

export function BubbleMenuButtonEditLink({
  className,
  children,
  onClick,
  onMouseDown,
  ...rest
}: BubbleMenuButtonEditLinkProps) {
  const { setIsEditing } = useBubbleMenuContext();

  return (
    <button
      {...rest}
      aria-label="Edit link"
      className={className}
      data-item="edit-link"
      data-re-btn-bm-item=""
      onClick={(e) => {
        onClick?.(e);
        setIsEditing(true);
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      type="button"
    >
      {children ?? <PencilIcon />}
    </button>
  );
}
