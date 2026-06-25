import { type ComponentProps, splitProps } from "solid-js";
import { cn } from "../../lib/utils";

export function Textarea(props: ComponentProps<"textarea">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <textarea
      class={cn(
        "field-sizing-content flex min-h-24 w-full resize-none rounded-3xl border border-transparent bg-input/50 px-3.5 py-3 text-base outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        local.class
      )}
      data-slot="textarea"
      {...others}
    />
  );
}
