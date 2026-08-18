import { cn } from "@feeblo/ui/utils";
import type React from "react";

type HeadingProps = {
  title: string;
  description?: string;
};

type SectionProps = {
  children: React.ReactNode;
  className?: string;
};

export function Heading({ title, description }: HeadingProps) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
    </header>
  );
}
export function Body({ children, className }: SectionProps) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}
export function Actions({ children, className }: SectionProps) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}
