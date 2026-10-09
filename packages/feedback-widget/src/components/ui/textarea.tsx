import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

/**
 * The coss textarea surface, flattened for the same reason as `Input`: no
 * addons, so no wrapper element.
 */
export function Textarea(props: ComponentProps<"textarea">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <textarea
      class={cn(
        "border-input bg-background text-foreground placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-ring/24 aria-invalid:border-destructive/36 aria-invalid:ring-destructive/16 dark:bg-input/32 field-sizing-content min-h-20 w-full resize-none rounded-lg border px-[calc(--spacing(3)-1px)] py-[calc(--spacing(2)-1px)] text-base shadow-xs/5 transition-shadow outline-none not-dark:bg-clip-padding focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-64 sm:text-sm",
        local.class
      )}
      data-slot="textarea"
      {...others}
    />
  );
}
