import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import {
  Field as BaseField,
  FieldContent as BaseFieldContent,
  FieldDescription as BaseFieldDescription,
  FieldLabel as BaseFieldLabel,
  FieldGroup,
} from "~/components/ui/field";
import {
  Item as BaseItem,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "~/components/ui/item";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";

function Root({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function Header({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-base">{children}</h3>;
}

function Description({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

function Content({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function Item({
  className,
  variant = "outline",
  ...props
}: React.ComponentProps<typeof BaseItem>) {
  return <BaseItem className={className} variant={variant} {...props} />;
}

function Field({
  className,

  ...props
}: Omit<React.ComponentProps<typeof BaseField>, "orientation"> &
  VariantProps<typeof BaseField>) {
  return (
    <BaseField
      className={cn(
        "@md/field-group:flex-row flex-col @md/field-group:items-center *:w-full @md/field-group:*:w-auto @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        className
      )}
      orientation="vertical"
      {...props}
    />
  );
}

function FieldContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseFieldContent>) {
  return <BaseFieldContent className={className} {...props} />;
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseFieldLabel>) {
  return <BaseFieldLabel className={className} {...props} />;
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseFieldDescription>) {
  return <BaseFieldDescription className={className} {...props} />;
}

export const SettingsItem = {
  Root,
  Header,
  Title,
  Description,
  Content,
  Item,
  ItemContent,
  ItemActions,
  ItemTitle,
  ItemDescription,
  FieldGroup,
  Field,
  FieldContent,
  FieldLabel,
  FieldDescription,
  Separator,
};
