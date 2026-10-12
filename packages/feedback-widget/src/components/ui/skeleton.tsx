import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

/**
 * Placeholder shape for data that is still loading. The shimmer is the shared
 * `skeleton` keyframe from the web theme, so the widget's loading states move
 * at the same speed as the dashboard's.
 */
export function Skeleton(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "animate-skeleton rounded-sm [--skeleton-highlight:--alpha(var(--color-white)/64%)] [background:linear-gradient(120deg,transparent_40%,var(--skeleton-highlight),transparent_60%)_var(--color-muted)_0_0/200%_100%_fixed] dark:[--skeleton-highlight:--alpha(var(--color-white)/4%)]",
        local.class
      )}
      data-slot="skeleton"
      {...others}
    />
  );
}
