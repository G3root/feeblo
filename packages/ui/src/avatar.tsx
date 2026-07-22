import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type React from "react";
import { cn } from "./utils";

export function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & { size?: "sm" | "default" | "lg" }): React.ReactElement {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-background align-middle font-medium text-xs",
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

export function AvatarGroup(props: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("flex -space-x-2", props.className)} data-slot="avatar-group" {...props} />;
}

export function AvatarGroupCount(props: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("relative flex size-8 items-center justify-center rounded-full bg-muted text-xs ring-2 ring-background", props.className)} data-slot="avatar-group-count" {...props} />;
}

export function AvatarImage({
  className,
  ...props
}: AvatarPrimitive.Image.Props): React.ReactElement {
  return (
    <AvatarPrimitive.Image
      className={cn("size-full object-cover", className)}
      data-slot="avatar-image"
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
        "flex size-full items-center justify-center rounded-full bg-muted",
        className
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

export { AvatarPrimitive };
