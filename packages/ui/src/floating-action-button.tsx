import type * as React from "react";

import { Button, type ButtonProps } from "./button";
import { cn } from "./utils";

export interface FloatingActionButtonProps extends Omit<
  ButtonProps,
  "children"
> {
  /** The accessible name, kept visually hidden. */
  children: React.ReactNode;
  icon: React.ReactNode;
}

/**
 * A circular primary action pinned to the bottom right below `md`. It replaces
 * the inline "create" button on phones; from `md` up the inline button is the
 * one shown and this is hidden.
 */
export function FloatingActionButton({
  children,
  className,
  icon,
  ...props
}: FloatingActionButtonProps): React.ReactElement {
  return (
    <Button
      className={cn(
        "fixed right-4 bottom-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))] z-40",
        "size-12! rounded-full px-0 shadow-lg before:rounded-full md:hidden",
        "[&_svg:not([class*='size-'])]:size-5!",
        className
      )}
      {...props}
    >
      {icon}
      <span className="sr-only">{children}</span>
    </Button>
  );
}
