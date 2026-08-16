import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { Switch } from "./switch";
import { cn } from "./utils";

const switchCardVariants = cva(
  "flex items-center justify-between gap-6 rounded-lg p-3 transition-colors hover:bg-accent/50 has-data-checked:bg-accent/50",
  {
    variants: {
      variant: {
        outline: "border has-data-checked:border-primary/48",
        ghost: "border-transparent",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  }
);

export function SwitchCard({
  className,
  render,
  variant = "outline",
  ...props
}: useRender.ComponentProps<"label"> &
  VariantProps<typeof switchCardVariants>): React.ReactElement {
  const defaultProps = {
    className: cn(switchCardVariants({ variant, className })),
    "data-slot": "switch-card",
  };

  return useRender({
    defaultTagName: "label",
    props: mergeProps<"label">(defaultProps, props),
    render,
  });
}

export function SwitchCardContent({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn("flex flex-1 flex-col gap-1", className),
    "data-slot": "switch-card-content",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function SwitchCardTitle({
  className,
  render,
  ...props
}: useRender.ComponentProps<"p">): React.ReactElement {
  const defaultProps = {
    className: cn("font-medium text-sm", className),
    "data-slot": "switch-card-title",
  };

  return useRender({
    defaultTagName: "p",
    props: mergeProps<"p">(defaultProps, props),
    render,
  });
}

export function SwitchCardDescription({
  className,
  render,
  ...props
}: useRender.ComponentProps<"p">): React.ReactElement {
  const defaultProps = {
    className: cn("text-muted-foreground text-xs", className),
    "data-slot": "switch-card-description",
  };

  return useRender({
    defaultTagName: "p",
    props: mergeProps<"p">(defaultProps, props),
    render,
  });
}

export function SwitchCardInput({
  className,
  ...props
}: React.ComponentProps<typeof Switch>): React.ReactElement {
  return (
    <Switch
      {...props}
      className={cn(
        "[--thumb-size:--spacing(4)] sm:[--thumb-size:--spacing(3)]",
        className
      )}
      data-slot="switch-card-input"
    />
  );
}
