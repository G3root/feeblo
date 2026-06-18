import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/utils";

export function Empty(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 text-balance rounded-2xl border-dashed p-12 text-center",
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

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export function EmptyMedia(
  props: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>
) {
  const [local, others] = splitProps(props, ["class", "variant"]);
  return (
    <div
      class={cn(
        emptyMediaVariants({ variant: local.variant, className: local.class })
      )}
      data-slot="empty-icon"
      data-variant={local.variant ?? "default"}
      {...others}
    />
  );
}

export function EmptyTitle(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "font-heading font-medium text-lg tracking-tight",
        local.class
      )}
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
        "text-muted-foreground text-sm/relaxed [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        local.class
      )}
      data-slot="empty-description"
      {...others}
    />
  );
}

export function EmptyContent(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm",
        local.class
      )}
      data-slot="empty-content"
      {...others}
    />
  );
}
