import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

/**
 * The coss loading indicator as a bare SVG: the widget ships an icon sprite
 * rather than an icon package, and this one is a single arc that spins well at
 * small sizes.
 */
export function Spinner(props: ComponentProps<"svg">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <svg
      aria-label="Loading"
      class={cn("animate-spin", local.class)}
      data-slot="spinner"
      fill="none"
      role="status"
      viewBox="0 0 24 24"
      {...others}
    >
      <path
        d="M21 12a9 9 0 1 1-6.219-8.56"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="2"
      />
    </svg>
  );
}
