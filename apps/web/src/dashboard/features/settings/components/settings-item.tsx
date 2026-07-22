import {
  Field as BaseField,
  FieldContent as BaseFieldContent,
  FieldDescription as BaseFieldDescription,
  FieldLabel as BaseFieldLabel,
  FieldGroup,
} from "@feeblo/ui/field";
import {
  Item as BaseItem,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@feeblo/ui/item";
import { Separator } from "@feeblo/ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import { cn } from "@feeblo/ui/utils";
import { LockedIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

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
  return (
    <BaseItem
      className={cn("bg-card", className)}
      variant={variant}
      {...props}
    />
  );
}

function Field({
  className,

  ...props
}: Omit<React.ComponentProps<typeof BaseField>, "orientation"> &
  VariantProps<typeof BaseField>) {
  return (
    <BaseField
      className={cn(
        "@md/field-group:flex-row flex-col @md/field-group:items-center [&>.sr-only]:w-auto [&>[data-slot=field-content]]:w-full @md/field-group:[&>[data-slot=field-content]]:min-w-0 @md/field-group:[&>[data-slot=field-content]]:flex-1 @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
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

interface PaidPlanIndicatorProps extends Omit<HugeiconsIconProps, "icon"> {
  content?: React.ReactNode;
}

function PaidPlanIndicator({
  content = "This feature is only available on our Pro plans.",
  ...rest
}: PaidPlanIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <HugeiconsIcon
          strokeWidth={2.5}
          {...rest}
          className={cn("size-4 text-primary-yellow", rest?.className)}
          icon={LockedIcon}
        />
      </TooltipTrigger>
      <TooltipPopup>{content}</TooltipPopup>
    </Tooltip>
  );
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
  PaidPlanIndicator,
};
