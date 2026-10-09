import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

/**
 * The coss input surface, flattened: the dashboard's Input wraps a span so
 * addons can live inside the border, and the widget has no addons, so the
 * border sits on the control itself.
 */
export function Input(props: ComponentProps<"input">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <input
      class={cn(
        "border-input bg-background text-foreground placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-ring/24 aria-invalid:border-destructive/36 aria-invalid:ring-destructive/16 dark:bg-input/32 h-9 w-full min-w-0 rounded-lg border px-[calc(--spacing(3)-1px)] text-base shadow-xs/5 transition-shadow outline-none not-dark:bg-clip-padding focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-64 sm:h-8.5 sm:text-sm",
        local.class
      )}
      data-slot="input"
      {...others}
    />
  );
}
