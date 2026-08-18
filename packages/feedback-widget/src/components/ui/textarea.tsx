import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export function Textarea(props: ComponentProps<"textarea">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <textarea
      class={cn(
        "bg-input/50 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-24 w-full resize-none rounded-3xl border border-transparent px-3.5 py-3 text-base transition-[color,box-shadow,background-color] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
        local.class
      )}
      data-slot="textarea"
      {...others}
    />
  );
}
