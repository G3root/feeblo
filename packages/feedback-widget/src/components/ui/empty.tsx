import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export function Empty(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-dashed p-12 text-center text-balance",
        local.class
      )}
      data-slot="empty"
      {...others}
    />
  );
}

export function EmptyHeader(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex max-w-sm flex-col items-center gap-2", local.class)}
      data-slot="empty-header"
      {...others}
    />
  );
}

export function EmptyTitle(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("font-heading text-lg font-medium tracking-tight", local.class)}
      data-slot="empty-title"
      {...others}
    />
  );
}

export function EmptyDescription(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        local.class
      )}
      data-slot="empty-description"
      {...others}
    />
  );
}
