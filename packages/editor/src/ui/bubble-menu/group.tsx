import type * as React from "react";

export interface BubbleMenuItemGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function BubbleMenuItemGroup({
  className,
  children,
}: BubbleMenuItemGroupProps) {
  return (
    <fieldset className={className} data-re-bubble-menu-group="">
      {children}
    </fieldset>
  );
}
