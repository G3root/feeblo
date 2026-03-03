import type React from "react";
import { cn } from "~/lib/utils";

type RootProps = {
  children: React.ReactNode;
  className?: string;
};

type HeadingProps = {
  title: string;
  description?: string;
};

type SectionProps = {
  children: React.ReactNode;
  className?: string;
};

function Root({ children, className }: RootProps) {
  return (
    <div
      className={cn(
        "flex min-h-svh w-full flex-col items-center justify-center bg-muted/40 px-4 py-12",
        className
      )}
    >
      <div className="flex w-full max-w-sm flex-col gap-5">{children}</div>
    </div>
  );
}

function Heading({ title, description }: HeadingProps) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-semibold text-lg tracking-tight">{title}</h1>
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
    </header>
  );
}

function Body({ children, className }: SectionProps) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

function Actions({ children, className }: SectionProps) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}

export const OnboardingShell = Object.assign(Root, {
  Heading,
  Body,
  Actions,
});
