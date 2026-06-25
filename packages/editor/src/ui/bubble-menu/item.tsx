import type * as React from "react";

export interface BubbleMenuItemProps extends React.ComponentProps<"button"> {
  /** Whether this item is currently active */
  isActive: boolean;
  /** Used for aria-label and data-item attribute */
  name: string;
  /** Called when clicked */
  onCommand: () => void;
}

export function BubbleMenuItem({
  name,
  isActive,
  onCommand,
  className,
  children,
  ...rest
}: BubbleMenuItemProps) {
  return (
    <button
      aria-label={name}
      aria-pressed={isActive}
      className={className}
      data-item={name}
      data-re-bubble-menu-item=""
      type="button"
      {...(isActive ? { "data-active": "" } : {})}
      onClick={onCommand}
      onMouseDown={(e) => e.preventDefault()}
      {...rest}
    >
      {children}
    </button>
  );
}
