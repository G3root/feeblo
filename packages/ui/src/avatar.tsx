import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type React from "react";

import { cn } from "./utils";

export function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "sm" | "default" | "lg";
}): React.ReactElement {
  return (
    <AvatarPrimitive.Root
      className={cn(
        // `@container` is what lets the fallback's initials size themselves to
        // the circle. A fixed `text-xs` is 12px of type inside a 24px avatar —
        // clipped — and inside a 16px one it is mostly gone, and callers do set
        // an avatar's size by class (`className="size-5"`), which no `size`
        // prop can see.
        "bg-background @container inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full align-middle font-medium select-none",
        size === "sm" && "size-6",
        size === "default" && "size-8",
        size === "lg" && "size-10",
        className
      )}
      data-slot="avatar"
      {...props}
    />
  );
}

/**
 * Stacks avatars into one group.
 *
 * The group owns the two things that make a stack read as a stack: the overlap
 * and the cut-out ring in the surface colour. Both used to be each caller's
 * job, which is why the same stack in two places disagreed about the ring, and
 * why the overflow count was drawn 8px larger than the faces beside it.
 */
export function AvatarGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        // -6px, not -8: a fallback's initials sit centred in the circle, so a
        // quarter of the face behind its neighbour is enough to clip them.
        "[&>*]:ring-background flex -space-x-1.5 [&>*]:ring-2",
        className
      )}
      data-slot="avatar-group"
      {...props}
    />
  );
}

/**
 * The "+N" chip that closes a stack.
 *
 * A pill, not a circle: it has to hold `+1234` at exactly the height of the
 * faces without the number escaping the shape, and a fixed circle cannot do
 * both. Its ring comes from `AvatarGroup`, like every other child's.
 *
 * `size` is here because the chip has to match the faces beside it, and the
 * mismatch is invisible in the type system: an earlier version hardcoded
 * `size-8` and sat 8px proud of a stack of 24px avatars.
 */
export function AvatarGroupCount({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "sm" | "default" | "lg";
}): React.ReactElement {
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground relative flex shrink-0 items-center justify-center rounded-full font-medium tabular-nums",
        size === "sm" && "h-6 min-w-6 px-1.5 text-[10px]",
        size === "default" && "h-8 min-w-8 px-2 text-xs",
        size === "lg" && "h-10 min-w-10 px-2.5 text-sm",
        className
      )}
      data-slot="avatar-group-count"
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: AvatarPrimitive.Image.Props): React.ReactElement {
  return (
    <AvatarPrimitive.Image
      className={cn("size-full object-cover", className)}
      data-slot="avatar-image"
      // Board lanes render one avatar per row; keep offscreen images from
      // competing with lane content on initial load. Callers can override.
      loading="lazy"
      decoding="async"
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props): React.ReactElement {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        // 40% of the circle's width: two initials stay inside a 24px avatar and
        // a 16px micro-avatar shrinks with them instead of clipping.
        "bg-muted flex size-full items-center justify-center rounded-full text-[40cqw] leading-none",
        className
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

export { AvatarPrimitive };
