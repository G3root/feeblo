import { isObject, isString } from "@feeblo/utils/runtime-kind";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import type React from "react";

import { Separator } from "./separator";
import { cn } from "./utils";

export function Field({
  className,
  orientation,
  ...props
}: FieldPrimitive.Root.Props & {
  orientation?: "horizontal" | "vertical";
}): React.ReactElement {
  return (
    <FieldPrimitive.Root
      className={cn(
        "flex items-start gap-2",
        orientation === "horizontal" ? "flex-row" : "flex-col",
        className
      )}
      data-orientation={orientation ?? "vertical"}
      data-slot="field"
      {...props}
    />
  );
}

export function FieldLabel({
  className,
  ...props
}: FieldPrimitive.Label.Props): React.ReactElement {
  return (
    <FieldPrimitive.Label
      className={cn(
        "text-foreground inline-flex items-center gap-2 text-base/4.5 font-medium data-disabled:opacity-64 sm:text-sm/4",
        className
      )}
      data-slot="field-label"
      {...props}
    />
  );
}

export function FieldItem({
  className,
  ...props
}: FieldPrimitive.Item.Props): React.ReactElement {
  return (
    <FieldPrimitive.Item
      className={cn("flex", className)}
      data-slot="field-item"
      {...props}
    />
  );
}

export function FieldDescription({
  className,
  ...props
}: FieldPrimitive.Description.Props): React.ReactElement {
  return (
    <FieldPrimitive.Description
      className={cn("text-muted-foreground text-xs", className)}
      data-slot="field-description"
      {...props}
    />
  );
}

export function FieldError({
  className,
  errors,
  children,
  ...props
}: FieldPrimitive.Error.Props & { errors?: unknown[] }): React.ReactElement {
  const message = errors
    ?.map((error) =>
      isString(error)
        ? error
        : error && isObject(error) && "message" in error
          ? String(error.message)
          : null
    )
    .filter(Boolean)
    .join(", ");

  return (
    <FieldPrimitive.Error
      className={cn("text-destructive-foreground text-xs", className)}
      data-slot="field-error"
      {...props}
    >
      {children ?? message}
    </FieldPrimitive.Error>
  );
}

export function FieldGroup(
  props: React.ComponentProps<"div">
): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col gap-4", props.className)}
      data-slot="field-group"
      {...props}
    />
  );
}

export function FieldContent(
  props: React.ComponentProps<"div">
): React.ReactElement {
  return (
    <div
      className={cn("flex flex-1 flex-col gap-1", props.className)}
      data-slot="field-content"
      {...props}
    />
  );
}

export function FieldTitle(
  props: React.ComponentProps<"div">
): React.ReactElement {
  return (
    <div
      className={cn("text-sm font-medium", props.className)}
      data-slot="field-title"
      {...props}
    />
  );
}

export function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("relative flex items-center py-2", className)}
      data-slot="field-separator"
      {...props}
    >
      <Separator className="absolute inset-x-0" />
      {children ? (
        <span className="bg-background text-muted-foreground relative mx-auto px-2 text-xs">
          {children}
        </span>
      ) : null}
    </div>
  );
}

export const FieldControl: typeof FieldPrimitive.Control =
  FieldPrimitive.Control;
export const FieldValidity: typeof FieldPrimitive.Validity =
  FieldPrimitive.Validity;

export { FieldPrimitive };
